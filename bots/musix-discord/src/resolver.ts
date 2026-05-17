// YouTube resolver — turns a Spotify track into a streamable Discord audio
// resource by searching YouTube for "{artist} - {title}" and streaming the
// top result. Used by the round-playback path in Phase 5.
//
// Two libraries: `youtubei.js` (Innertube) for SEARCH only — it queries
// YouTube's internal mobile/TV API and isn't broken by layout changes.
// `yt-dlp` (spawned subprocess) for the actual audio STREAM — pure JS libs
// like ytdl-core / play-dl break weekly as YouTube tightens anti-bot;
// yt-dlp is the actively-reverse-engineered project that keeps up.

import { Innertube } from "youtubei.js";
import { createAudioResource, StreamType, type AudioResource } from "@discordjs/voice";
import type { SupabaseClient } from "@supabase/supabase-js";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import type { Readable } from "node:stream";
import path from "node:path";

// Dependency-injected so resolver can write/read tl_youtube_reports without
// dragging in env wiring. index.ts calls setSupabaseClient on boot.
let supabaseClient: SupabaseClient | null = null;
export function setSupabaseClient(c: SupabaseClient): void { supabaseClient = c; }

// In-memory cache of video IDs we should skip in YouTube search results.
// Reports with count >= 2 OR blacklisted=true land here. Refreshed lazily
// (TTL) and on every reportVideo call.
const REPORT_SKIP_THRESHOLD = 2;
const BLACKLIST_THRESHOLD   = 5;
const REPORT_CACHE_TTL_MS   = 5 * 60 * 1000;

interface ReportedCache { ids: Set<string>; fetchedAt: number }
let reportedCache: ReportedCache | null = null;

async function getReportedVideoIds(): Promise<Set<string>> {
  if (reportedCache && Date.now() - reportedCache.fetchedAt < REPORT_CACHE_TTL_MS) {
    return reportedCache.ids;
  }
  if (!supabaseClient) return new Set();
  const { data, error } = await supabaseClient
    .from("tl_youtube_reports")
    .select("video_id")
    .gte("reports_count", REPORT_SKIP_THRESHOLD);
  if (error) {
    console.warn(`[resolver] couldn't fetch reported videos:`, error.message);
    return reportedCache?.ids ?? new Set();
  }
  const ids = new Set((data ?? []).map(r => (r as { video_id: string }).video_id));
  reportedCache = { ids, fetchedAt: Date.now() };
  return ids;
}

// Player clicked the "wrong song / bad version" button. Increment the
// report count, blacklist if we crossed the threshold, and invalidate
// both the per-track resolution cache (so the next round re-searches)
// and the reported-videos cache (so the next resolver call sees this
// video as skip-worthy).
export async function reportVideo(videoId: string, trackId?: string): Promise<{ totalReports: number; blacklisted: boolean }> {
  if (!supabaseClient) return { totalReports: 0, blacklisted: false };
  // Atomic-ish via two-step: read, then upsert. Race-conditiony with
  // concurrent reports, but at this scale the worst case is "the count
  // is off by a few" — not a correctness problem.
  const { data: existing } = await supabaseClient
    .from("tl_youtube_reports")
    .select("reports_count, blacklisted")
    .eq("video_id", videoId)
    .maybeSingle();
  const prior = (existing as { reports_count?: number; blacklisted?: boolean } | null);
  const newCount = (prior?.reports_count ?? 0) + 1;
  const blacklisted = (prior?.blacklisted ?? false) || newCount >= BLACKLIST_THRESHOLD;
  const { error } = await supabaseClient
    .from("tl_youtube_reports")
    .upsert({
      video_id:         videoId,
      reports_count:    newCount,
      blacklisted,
      last_reported_at: new Date().toISOString(),
    }, { onConflict: "video_id" });
  if (error) {
    console.warn(`[resolver] failed to upsert report for ${videoId}:`, error.message);
    return { totalReports: 0, blacklisted: false };
  }
  console.log(`[resolver] reported ${videoId}: count=${newCount} blacklisted=${blacklisted}`);
  // Invalidate caches so future resolves skip this video.
  reportedCache = null;
  if (trackId) cache.delete(trackId);
  return { totalReports: newCount, blacklisted };
}

export interface ResolvableTrack {
  id:      string;   // Spotify track id — cache key
  name:    string;   // "Bohemian Rhapsody"
  artists: string[]; // ["Queen"] — may be empty for ad-hoc test queries
}

export interface ResolvedTrack {
  spotifyId:   string;
  videoUrl:    string;
  videoId:     string;
  videoTitle:  string;
  durationSec: number;
  resolvedAt:  number;
}

// Lazy-init the Innertube client once per process. Creating it does a small
// fetch to bootstrap the API client; we don't want that on every search.
let innertubePromise: Promise<Innertube> | null = null;
function getInnertube(): Promise<Innertube> {
  if (!innertubePromise) innertubePromise = Innertube.create();
  return innertubePromise;
}

const cache = new Map<string, ResolvedTrack>();

function buildQuery(track: ResolvableTrack): string {
  const artist = track.artists[0] ?? "";
  return artist ? `${artist} - ${track.name}` : track.name;
}

function isLikelyBadMatch(title: string): boolean {
  return /\b(live|concert|cover|reaction|tutorial|karaoke|instrumental|lyrics? video|hour)\b/i.test(title);
}

export interface SearchHit {
  id:          string;
  title:       string;
  durationSec: number;
}

// Match a YouTube video ID out of a URL, a youtu.be short link, a /shorts/
// link, a music.youtube.com link, or a bare 11-char video ID.
const VIDEO_ID_RE = /(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|^)([A-Za-z0-9_-]{11})(?:\b|$)/;

export function extractVideoId(input: string): string | null {
  const m = input.trim().match(VIDEO_ID_RE);
  return m ? m[1] : null;
}

// youtubei.js's typed result shape varies by node type; we only read a few
// fields and want a flat shape, so normalise to SearchHit here.
function extractHits(searchResults: unknown): SearchHit[] {
  const r = searchResults as { results?: unknown[]; videos?: unknown[] };
  const raw = (r.videos ?? r.results ?? []) as Array<{
    id?:         string;
    video_id?:   string;
    title?:      { text?: string } | string;
    duration?:   { seconds?: number; text?: string };
  }>;
  const hits: SearchHit[] = [];
  for (const v of raw) {
    const id = v.id ?? v.video_id;
    if (!id) continue;
    const title = typeof v.title === "string" ? v.title : (v.title?.text ?? "");
    if (!title) continue;
    hits.push({ id, title, durationSec: v.duration?.seconds ?? 0 });
  }
  return hits;
}

export async function resolveTrack(track: ResolvableTrack): Promise<ResolvedTrack | null> {
  const cached = cache.get(track.id);
  if (cached) return cached;

  const query = buildQuery(track);
  let hits: SearchHit[];
  try {
    const yt = await getInnertube();
    const results = await yt.search(query, { type: "video" });
    hits = extractHits(results);
  } catch (err) {
    console.warn(`[resolver] search failed for "${query}":`, err);
    return null;
  }

  if (hits.length === 0) {
    console.warn(`[resolver] no YouTube results for "${query}"`);
    return null;
  }

  // Drop hits players have flagged as the wrong version / bad music video.
  // Done before the bad-match filter so a reported video can't sneak in via
  // the "everything looks bad" fallback below.
  const reportedIds = await getReportedVideoIds();
  const allowed = hits.filter(h => !reportedIds.has(h.id));
  const pool    = allowed.length > 0 ? allowed : hits; // last-resort: if every hit is reported, take whatever's there
  const top     = pool.find((h) => !isLikelyBadMatch(h.title)) ?? pool[0];

  const resolved: ResolvedTrack = {
    spotifyId:   track.id,
    videoUrl:    `https://www.youtube.com/watch?v=${top.id}`,
    videoId:     top.id,
    videoTitle:  top.title,
    durationSec: top.durationSec,
    resolvedAt:  Date.now(),
  };
  cache.set(track.id, resolved);
  console.log(`[resolver] "${query}" → "${resolved.videoTitle}" (${resolved.durationSec}s) ${resolved.videoUrl}`);
  return resolved;
}

// Direct lookup by video ID — used when the user passes a URL / video ID
// to /musix play instead of a search query, and as the backing implementation
// for autocomplete suggestions submitted as videoId values.
export async function resolveByVideoId(videoId: string): Promise<ResolvedTrack | null> {
  try {
    const yt = await getInnertube();
    const info = await yt.getBasicInfo(videoId);
    const details = info.basic_info;
    return {
      spotifyId:   `yt-${videoId}`,
      videoUrl:    `https://www.youtube.com/watch?v=${videoId}`,
      videoId,
      videoTitle:  details.title ?? videoId,
      durationSec: details.duration ?? 0,
      resolvedAt:  Date.now(),
    };
  } catch (err) {
    console.warn(`[resolver] getBasicInfo failed for ${videoId}:`, err);
    return null;
  }
}

// Search suggestions for slash-command autocomplete. Returns flat hits
// (videoId + title + duration) so the bot can render them as choices and
// the handler can stream directly via the selected videoId. Caches by
// query to avoid hammering YouTube while the user types.
const suggestCache = new Map<string, { at: number; hits: SearchHit[] }>();
const SUGGEST_TTL_MS = 60_000;

export async function searchSuggestions(query: string, limit = 5): Promise<SearchHit[]> {
  const key = query.trim().toLowerCase();
  if (!key) return [];
  const cached = suggestCache.get(key);
  if (cached && Date.now() - cached.at < SUGGEST_TTL_MS) {
    return cached.hits.slice(0, limit);
  }
  try {
    const yt = await getInnertube();
    const results = await yt.search(key, { type: "video" });
    const hits = extractHits(results).slice(0, limit);
    suggestCache.set(key, { at: Date.now(), hits });
    return hits;
  } catch (err) {
    console.warn(`[resolver] suggestion search failed for "${key}":`, err);
    return [];
  }
}

// Streaming via yt-dlp subprocess. yt-dlp is THE actively-maintained YouTube
// downloader — they ship updates faster than YouTube changes their anti-bot
// surface. Pure JS libraries (play-dl, ytdl-core forks, youtubei.js's own
// download) all break repeatedly because they can't keep up with the
// signature cipher / PO token / n-throttling parameter dance. Spawning
// yt-dlp sidesteps all of it.
//
// We auto-download the yt-dlp binary into bots/musix-discord/bin/ on first
// use — zero manual setup required. Subsequent runs use the cached binary.
// For Linux deploys (Fly/Railway), the same code path downloads the Linux
// build at startup; you could also bake it into the Dockerfile to skip the
// runtime download.

const YT_DLP_DIR  = path.join(__dirname, "..", "bin");
const YT_DLP_NAME = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
const YT_DLP_PATH = path.join(YT_DLP_DIR, YT_DLP_NAME);
const YT_DLP_URL  = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${YT_DLP_NAME}`;

let ytDlpReadyPromise: Promise<string> | null = null;
function ensureYtDlp(): Promise<string> {
  if (ytDlpReadyPromise) return ytDlpReadyPromise;
  ytDlpReadyPromise = (async () => {
    if (existsSync(YT_DLP_PATH)) return YT_DLP_PATH;
    console.log(`[yt-dlp] binary not found, downloading from ${YT_DLP_URL} ...`);
    await mkdir(YT_DLP_DIR, { recursive: true });
    const res = await fetch(YT_DLP_URL, { redirect: "follow" });
    if (!res.ok) throw new Error(`yt-dlp download failed: HTTP ${res.status}`);
    await writeFile(YT_DLP_PATH, Buffer.from(await res.arrayBuffer()));
    if (process.platform !== "win32") await chmod(YT_DLP_PATH, 0o755);
    console.log(`[yt-dlp] installed at ${YT_DLP_PATH}`);
    return YT_DLP_PATH;
  })();
  // Reset on failure so a retry can try again.
  ytDlpReadyPromise.catch(() => { ytDlpReadyPromise = null; });
  return ytDlpReadyPromise;
}

// Lower-level helper: spawn yt-dlp and return its stdout stream + a kill
// handle. Used both by createStreamResource (Discord voice) and by the
// HTTP audio proxy (clients fetching audio for the all-clients-stream
// mode). Caller is responsible for piping stdout and calling kill() on
// disconnect.
export async function spawnYtDlpAudioStream(
  videoId: string,
  opts: { seekSec?: number } = {},
): Promise<{ stdout: Readable; kill: () => void }> {
  const binPath  = await ensureYtDlp();
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const args = [
    "--quiet",
    "--no-warnings",
    "--no-playlist",
    "--format", "bestaudio/best",
    "--output", "-",
  ];
  // yt-dlp's --download-sections "*N-" remuxes the audio starting at N
  // seconds. Used for the in-game Restart (seek=0 → omit) and +30s
  // buttons, and for browser clients catching up to playing_since in
  // synchronized stream mode.
  if (opts.seekSec && opts.seekSec > 0) {
    args.push("--download-sections", `*${opts.seekSec}-`);
  }
  args.push(videoUrl);
  const proc = spawn(binPath, args, { stdio: ["ignore", "pipe", "pipe"] });

  proc.stderr.on("data", (chunk: Buffer) => {
    const msg = chunk.toString().trim();
    if (msg) console.warn(`[yt-dlp] ${msg}`);
  });
  proc.on("error", (err) => {
    console.warn(`[yt-dlp] spawn failed:`, err.message);
  });
  proc.on("exit", (code, signal) => {
    if (code !== 0 && code !== null) {
      console.warn(`[yt-dlp] exited code=${code} signal=${signal}`);
    }
  });

  return {
    stdout: proc.stdout!,
    kill:   () => { try { proc.kill("SIGTERM"); } catch { /* already dead */ } },
  };
}

export async function createStreamResource(
  videoId: string,
  opts: { seekSec?: number } = {},
): Promise<AudioResource> {
  const { stdout } = await spawnYtDlpAudioStream(videoId, opts);
  return createAudioResource(stdout, { inputType: StreamType.Arbitrary });
}

export function cacheStats() {
  return { size: cache.size };
}
