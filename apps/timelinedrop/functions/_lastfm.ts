import type { Env } from "./_env";

// ── Last.fm REST client with KV-cached fetchers ─────────────────────────────
// Free-tier API key only. No write actions. All endpoints public read.
//
// Cache TTL: 1 hour by default. Per-user listening data drifts slowly; tracks
// & artist info are essentially static.

const LASTFM_BASE = "http://ws.audioscrobbler.com/2.0/";
const CACHE_TTL_SECONDS = 60 * 60; // 1 hour

// ── Types (subset of Last.fm response shapes) ───────────────────────────────

export interface LastfmArtistRef {
  name:        string;
  mbid?:       string;
  playcount?:  string; // numeric strings from the API
  url?:        string;
}

export interface LastfmTrackRef {
  name:        string;
  artist:      { name: string; mbid?: string } | string;
  playcount?:  string;
  date?:       { uts: string; "#text": string };
  url?:        string;
}

export interface LastfmArtistInfo {
  name:        string;
  stats?:      { listeners?: string; playcount?: string; userplaycount?: string };
  tags?:       { tag: Array<{ name: string; url: string }> };
  similar?:    { artist: LastfmArtistRef[] };
  bio?:        { summary?: string };
}

export interface LastfmTrackInfo {
  name:           string;
  userplaycount?: string;
  artist?:        { name: string };
  playcount?:     string;
  listeners?:     string;
}

// ── Internal: fetch with KV cache ───────────────────────────────────────────

async function cachedJson<T>(env: Env, cacheKey: string, url: string, ttl = CACHE_TTL_SECONDS): Promise<T | null> {
  // Try cache first
  try {
    const cached = await env.SESSIONS.get(`lfm:${cacheKey}`);
    if (cached) return JSON.parse(cached) as T;
  } catch { /* fall through */ }

  // Fetch fresh
  const res = await fetch(url);
  if (!res.ok) return null;
  let data: unknown;
  try { data = await res.json(); }
  catch { return null; }

  // Last.fm uses {error: number, message: string} for failures
  if (typeof data === "object" && data !== null && "error" in data) {
    return null;
  }

  // Cache (best-effort)
  try {
    await env.SESSIONS.put(`lfm:${cacheKey}`, JSON.stringify(data), { expirationTtl: ttl });
  } catch { /* fall through */ }

  return data as T;
}

function buildUrl(env: Env, params: Record<string, string>): string {
  const search = new URLSearchParams({ ...params, api_key: env.LASTFM_API_KEY, format: "json" });
  return `${LASTFM_BASE}?${search.toString()}`;
}

// ── Public fetchers ─────────────────────────────────────────────────────────

export type Period = "overall" | "7day" | "1month" | "3month" | "6month" | "12month";

export async function getTopArtists(env: Env, user: string, period: Period, limit: number): Promise<LastfmArtistRef[]> {
  const url = buildUrl(env, { method: "user.gettopartists", user, period, limit: String(limit) });
  const key = `topa:${user}:${period}:${limit}`;
  type Resp = { topartists?: { artist: LastfmArtistRef[] } };
  const data = await cachedJson<Resp>(env, key, url);
  return data?.topartists?.artist ?? [];
}

export async function getTopTracks(env: Env, user: string, period: Period, limit: number): Promise<LastfmTrackRef[]> {
  const url = buildUrl(env, { method: "user.gettoptracks", user, period, limit: String(limit) });
  const key = `topt:${user}:${period}:${limit}`;
  type Resp = { toptracks?: { track: LastfmTrackRef[] } };
  const data = await cachedJson<Resp>(env, key, url);
  return data?.toptracks?.track ?? [];
}

export async function getRecentTracks(env: Env, user: string, limit: number): Promise<LastfmTrackRef[]> {
  const url = buildUrl(env, { method: "user.getrecenttracks", user, limit: String(limit) });
  const key = `recent:${user}:${limit}`;
  type Resp = { recenttracks?: { track: LastfmTrackRef[] } };
  // Recent tracks change quickly — cache for 5 minutes only
  const data = await cachedJson<Resp>(env, key, url, 5 * 60);
  return data?.recenttracks?.track ?? [];
}

export async function getArtistInfo(env: Env, artist: string, user?: string): Promise<LastfmArtistInfo | null> {
  const params: Record<string, string> = { method: "artist.getinfo", artist };
  if (user) params.username = user;
  const url = buildUrl(env, params);
  const key = `ainfo:${artist}:${user ?? ""}`;
  type Resp = { artist?: LastfmArtistInfo };
  const data = await cachedJson<Resp>(env, key, url);
  return data?.artist ?? null;
}

export async function getSimilarArtists(env: Env, artist: string, limit = 30): Promise<LastfmArtistRef[]> {
  const url = buildUrl(env, { method: "artist.getsimilar", artist, limit: String(limit) });
  const key = `sim:${artist}:${limit}`;
  type Resp = { similarartists?: { artist: LastfmArtistRef[] } };
  const data = await cachedJson<Resp>(env, key, url);
  return data?.similarartists?.artist ?? [];
}

export async function getArtistTopTracks(env: Env, artist: string, limit = 25): Promise<LastfmTrackRef[]> {
  const url = buildUrl(env, { method: "artist.gettoptracks", artist, limit: String(limit) });
  const key = `att:${artist}:${limit}`;
  type Resp = { toptracks?: { track: LastfmTrackRef[] } };
  const data = await cachedJson<Resp>(env, key, url);
  return data?.toptracks?.track ?? [];
}

export async function getTopArtistsByTag(env: Env, tag: string, limit = 50): Promise<LastfmArtistRef[]> {
  const url = buildUrl(env, { method: "tag.gettopartists", tag, limit: String(limit) });
  const key = `tag:${tag}:${limit}`;
  type Resp = { topartists?: { artist: LastfmArtistRef[] } };
  const data = await cachedJson<Resp>(env, key, url);
  return data?.topartists?.artist ?? [];
}

export async function getTrackInfo(env: Env, artist: string, track: string, user?: string): Promise<LastfmTrackInfo | null> {
  const params: Record<string, string> = { method: "track.getinfo", artist, track };
  if (user) params.username = user;
  const url = buildUrl(env, params);
  const key = `tinfo:${artist}:${track}:${user ?? ""}`;
  type Resp = { track?: LastfmTrackInfo };
  const data = await cachedJson<Resp>(env, key, url);
  return data?.track ?? null;
}

// Helper: parse playcount safely
export function parsePlaycount(s: string | undefined): number {
  if (!s) return 0;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : 0;
}
