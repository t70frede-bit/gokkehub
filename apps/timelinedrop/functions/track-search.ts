import type { PagesFunction } from "@cloudflare/workers-types";
import type { Env } from "./_env";
import { json, handlePreflight } from "./_cors";

// GET /track-search?q=...
//
// Typeahead backing the `guessMode: "search"` guess field. Merges two
// sources:
//
//   • tl_track_index (migration 030) — our own index of every track the
//     platform has served. Guarantees the round's actual answer is always
//     findable, because it came from a track_pool and is therefore in here.
//   • Deezer's public search — no auth, no key, ~50 req/5s. Supplies the
//     breadth (~90M tracks) that stops players brute-forcing a small index
//     by searching a suspected artist and seeing which songs come back.
//
// Deezer has no CORS headers, so it has to be proxied rather than called
// from the browser. That is the main reason this endpoint exists at all.
//
// ── RELEASE YEAR IS DELIBERATELY NOT RETURNED ──────────────────────────────
// The entire game is placing a song on a timeline by year. If the typeahead
// echoed a release year, a captain could search the song, read the year off
// the dropdown, and place it perfectly every time. tl_track_index stores the
// year (useful for dedupe and diagnostics) but this endpoint must never
// serialise it, and Deezer's search response does not carry one anyway.

interface TrackSearchResult {
  /** Spotify id when the row came from our index; Deezer id (prefixed) otherwise. */
  id:        string;
  title:     string;
  artist:    string;
  coverUrl:  string | null;
  /** Present only for local-index hits. Lets the grader do an exact id
   *  compare against round.track.id instead of normalising strings. */
  spotifyId?: string;
}

const MIN_QUERY_LEN  = 2;
const MAX_QUERY_LEN  = 80;
const RESULT_LIMIT   = 12;
const CACHE_TTL_SECS = 3600;

// Per-IP budget. This endpoint is unauthenticated (the captain guessing may
// not have a session), so it needs its own throttle. Typeahead is bursty by
// nature — a captain typing "bohemian" fires ~8 debounced requests — so the
// window is generous. The KV cache absorbs most repeat traffic before it
// ever reaches Deezer.
const RATE_LIMIT_MAX     = 120;
const RATE_LIMIT_WINDOW  = 60;

interface DeezerSearchResponse {
  data?: Array<{
    id:     number;
    title:  string;
    title_short?: string;
    artist?: { name?: string };
    album?:  { cover_medium?: string };
  }>;
}

interface LocalIndexRow {
  track_id:  string;
  title:     string;
  artist:    string;
  cover_url: string | null;
}

/** Dedupe key. Mirrors normalizeAnswer's shape closely enough to collapse
 *  "Bohemian Rhapsody" from Deezer against ours, without importing the
 *  full suffix-stripping machinery (which would wrongly merge a genuine
 *  live version into the studio cut and hide it from the dropdown). */
function dedupeKey(artist: string, title: string): string {
  const norm = (s: string) =>
    s.toLowerCase()
      .replace(/['’‘`´]/g, "")
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^\w\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  return `${norm(artist)}|${norm(title)}`;
}

async function searchLocalIndex(env: Env, q: string): Promise<TrackSearchResult[]> {
  try {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/tl_search_tracks`, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        apikey:          env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization:   `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ q, lim: RESULT_LIMIT }),
    });
    if (!res.ok) return [];
    const rows = await res.json() as LocalIndexRow[];
    return rows.map(r => ({
      id:        r.track_id,
      title:     r.title,
      artist:    r.artist,
      coverUrl:  r.cover_url,
      spotifyId: r.track_id,
    }));
  } catch (e) {
    // A dead index must not take the typeahead down — Deezer alone still
    // gives a playable (if less guaranteed) experience.
    console.warn("[track-search] local index failed:", e);
    return [];
  }
}

async function searchDeezer(q: string): Promise<TrackSearchResult[]> {
  try {
    const url = `https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=${RESULT_LIMIT}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "GokkeHub-Musix/1.0 (+https://musix.gokkehub.com)" },
    });
    if (!res.ok) return [];
    const data = await res.json() as DeezerSearchResponse;
    return (data.data ?? [])
      .filter(t => t.title && t.artist?.name)
      .map(t => ({
        id:       `dz:${t.id}`,
        // title_short drops Deezer's own "(Remastered)" style tails, which
        // makes the dropdown read cleanly. The grader strips suffixes on
        // both sides anyway, so nothing is lost by preferring it.
        title:    t.title_short || t.title,
        artist:   t.artist!.name!,
        coverUrl: t.album?.cover_medium ?? null,
      }));
  } catch (e) {
    console.warn("[track-search] deezer failed:", e);
    return [];
  }
}

/**
 * Wrap json() with the cache headers this endpoint needs.
 *
 * The response body depends on the request Origin (corsHeaders only emits
 * Access-Control-Allow-Origin for allowed origins, and omits the header
 * entirely otherwise), and the client calls this with credentials. Per the
 * platform's cross-origin cache invariant, that combination must never be
 * shared-cacheable: a response cached without an ACAO header and later
 * replayed to an allowed origin would fail CORS. Vary: Origin is set
 * unconditionally — including on the non-allowed flavour, which is the case
 * corsHeaders itself doesn't cover.
 *
 * Repeat traffic is absorbed by the KV cache instead, which is keyed on the
 * query alone and therefore origin-independent.
 */
function searchJson(data: unknown, status: number, req: Request): Response {
  const res = json(data, status, req);
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("Vary", "Origin");
  return res;
}

async function isRateLimited(env: Env, ip: string): Promise<boolean> {
  if (!ip) return false;
  const key = `tl:tsearch:rl:${ip}`;
  try {
    const current = parseInt((await env.SESSIONS.get(key)) ?? "0", 10) || 0;
    if (current >= RATE_LIMIT_MAX) return true;
    // KV has no atomic increment. A racing burst can slip a few requests
    // past the ceiling, which is fine — this is a courtesy throttle to
    // protect Deezer, not a security control.
    await env.SESSIONS.put(key, String(current + 1), { expirationTtl: RATE_LIMIT_WINDOW });
    return false;
  } catch {
    return false;
  }
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  const pre = handlePreflight(request as unknown as Request);
  if (pre) return pre;
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const req = request as unknown as Request;
  const url = new URL(req.url);
  const raw = (url.searchParams.get("q") ?? "").trim().slice(0, MAX_QUERY_LEN);

  if (raw.length < MIN_QUERY_LEN) return searchJson({ items: [] }, 200, req);

  const ip = req.headers.get("CF-Connecting-IP") ?? "";
  if (await isRateLimited(env, ip)) {
    return searchJson({ error: "Too many searches — slow down a moment." }, 429, req);
  }

  const cacheKey = `tl:tsearch:${raw.toLowerCase()}`;
  try {
    const cached = await env.SESSIONS.get(cacheKey);
    if (cached) {
      return searchJson({ items: JSON.parse(cached) as TrackSearchResult[], cached: true }, 200, req);
    }
  } catch { /* cache miss on error */ }

  // Both sources in parallel; each already swallows its own failures.
  const [local, deezer] = await Promise.all([
    searchLocalIndex(env, raw),
    searchDeezer(raw),
  ]);

  // Local first so our own (id-matchable) rows win the dedupe — a local hit
  // carries spotifyId, which lets the grader skip string comparison.
  const seen  = new Set<string>();
  const items: TrackSearchResult[] = [];
  for (const r of [...local, ...deezer]) {
    const key = dedupeKey(r.artist, r.title);
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(r);
    if (items.length >= RESULT_LIMIT) break;
  }

  try {
    await env.SESSIONS.put(cacheKey, JSON.stringify(items), { expirationTtl: CACHE_TTL_SECS });
  } catch { /* caching is best-effort */ }

  return searchJson({ items }, 200, req);
};
