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
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

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

interface SearchHit {
  id:          string;
  title:       string;
  durationSec: number;
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

  const top = hits.find((h) => !isLikelyBadMatch(h.title)) ?? hits[0];

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

export async function createStreamResource(videoId: string): Promise<AudioResource> {
  const binPath  = await ensureYtDlp();
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const proc = spawn(
    binPath,
    [
      "--quiet",
      "--no-warnings",
      "--no-playlist",
      "--format", "bestaudio/best",
      "--output", "-",
      videoUrl,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

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

  return createAudioResource(proc.stdout, { inputType: StreamType.Arbitrary });
}

export function cacheStats() {
  return { size: cache.size };
}
