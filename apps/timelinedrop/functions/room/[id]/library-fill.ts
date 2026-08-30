import type { PagesFunction } from "@cloudflare/workers-types";
import { getSession } from "@gokkehub/auth/session";
import type { Env } from "../../_env";
import { json, handlePreflight } from "../../_cors";
import { getRoom, updateRoom, indexTracks } from "../../_supabase";
import { searchTrackUri, getActiveHostToken, lookupItunesCover } from "../../_spotify";
import type { SpotifyTrack } from "../../../src/lib/types";

// POST /room/:id/library-fill { player_id, count? }
//
// Fills a room's track_pool by sampling tl_song_library (migration 031) — the
// quick-play path. Unlike catalog-import this needs NO per-track resolution to
// build the pool: the library already carries a verified release year, which
// is the only field placement actually depends on. One RPC call, one write.
//
// Enrichment is layered on top and is strictly best-effort:
//   • Spotify URIs — only required by "browser" (Web Playback SDK) audio mode.
//     Capped, so browser rooms are limited to what fits the subrequest budget.
//   • iTunes covers — cosmetic. Covers stay hidden until the reveal anyway, so
//     tracks past the cap simply show the grey placeholder the rail handles.
// The YouTube-backed audio modes need neither: the bot resolves playback from
// artist + title at round time.

const DEFAULT_COUNT = 40;
const MAX_COUNT     = 100;
// Cloudflare allows 50 subrequests per request. Budget: room read + RPC +
// pool write leaves ~45; keep headroom for retries and jitter.
const MAX_SPOTIFY_LOOKUPS = 38;
const MAX_ITUNES_LOOKUPS  = 38;
const SEARCH_DELAY_MS     = 30;

interface Body { player_id: string; count?: number }

interface LibraryRow {
  id:           number;
  artist:       string;
  title:        string;
  release_year: number;
  decade:       string;
}

export const onRequest: PagesFunction<Env> = async ({ request, params, env }) => {
  const pre = handlePreflight(request as unknown as Request);
  if (pre) return pre;
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const req    = request as unknown as Request;
  const roomId = params.id as string;

  try {
    const body = await req.json() as Body;
    if (!body.player_id) return json({ error: "player_id required" }, 400, req);

    const room = await getRoom(env, roomId);
    if (!room) return json({ error: "Room not found" }, 404, req);
    if (room.host_id !== body.player_id) {
      return json({ error: "Only the host can fill the song pool" }, 403, req);
    }

    const count = Math.min(
      Math.max(typeof body.count === "number" ? Math.round(body.count) : DEFAULT_COUNT, 5),
      MAX_COUNT,
    );

    // Decade-balanced sample. The RPC partitions by decade before taking a
    // random slice so the timeline stays spread out — see migration 031.
    const rpc = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/tl_sample_song_library`, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        apikey:          env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization:   `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ n: count }),
    });
    if (!rpc.ok) {
      const t = await rpc.text().catch(() => "");
      return json({ error: `Song library unavailable: ${rpc.status} ${t.slice(0, 200)}` }, 500, req);
    }
    const rows = await rpc.json() as LibraryRow[];
    if (rows.length === 0) {
      return json({ error: "Song library is empty — run migration 031." }, 400, req);
    }

    // Host Spotify token, if there is one. Same two-step lookup as
    // catalog-import: this request's session first, else the stored host
    // session (background fills don't carry the host's cookie).
    const session = await getSession(env.SESSIONS, req);
    let refreshToken = session?.spotify?.refreshToken;
    if (!refreshToken && room.host_session_id) {
      const raw = await env.SESSIONS.get(room.host_session_id);
      if (raw) {
        try { refreshToken = (JSON.parse(raw) as { spotify?: { refreshToken?: string } }).spotify?.refreshToken; }
        catch { /* malformed — ignore */ }
      }
    }
    const accessToken = refreshToken ? await getActiveHostToken(env, refreshToken) : null;

    const audioMode = room.settings?.audioMode ?? "browser";
    if (!accessToken && audioMode === "browser") {
      return json({
        error: "Spotify SDK playback needs the host's Spotify account. Switch to YouTube audio mode, or link Spotify.",
      }, 400, req);
    }

    let pool: SpotifyTrack[] = [];

    if (audioMode === "browser" && accessToken) {
      // Browser mode can only play tracks with a real Spotify URI, so the
      // pool is limited to what we can resolve within the subrequest budget.
      for (const r of rows.slice(0, MAX_SPOTIFY_LOOKUPS)) {
        const hit = await searchTrackUri(accessToken, r.artist, r.title);
        // The library year wins over Spotify's: Spotify's release_date drifts
        // on compilations and remasters, which is exactly what the library
        // was built to avoid.
        if (hit) pool.push({ ...hit, releaseYear: r.release_year });
        if (SEARCH_DELAY_MS > 0) await new Promise(res => setTimeout(res, SEARCH_DELAY_MS));
      }
      if (pool.length === 0) {
        return json({ error: "Couldn't resolve any library tracks on Spotify." }, 502, req);
      }
    } else {
      // YouTube-backed modes: no per-track resolution needed at all, so the
      // full sample goes in regardless of size. Covers are looked up for the
      // first slice only; the rest fall back to the grey placeholder.
      const withCovers = rows.slice(0, MAX_ITUNES_LOOKUPS);
      const rest       = rows.slice(MAX_ITUNES_LOOKUPS);
      const covers = await Promise.all(
        withCovers.map(r => lookupItunesCover(r.artist, r.title).catch(() => "")),
      );
      pool = [
        ...withCovers.map((r, i) => libraryTrack(r, covers[i] ?? "")),
        ...rest.map(r => libraryTrack(r, "")),
      ];
    }

    // Shuffle so play order differs between rooms even on an identical sample.
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }

    await updateRoom(env, roomId, { track_pool: pool, track_cursor: 0 });
    // Feed the typeahead index so search guess mode can always find these.
    void indexTracks(env, pool, "seed");

    return json({ added: pool.length, sampled: rows.length }, 200, req);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500, req);
  }
};

// Deterministic id across rooms (`lib-<row id>`) so tl_song_stats and the
// recently-heard blacklist aggregate per song rather than per room.
function libraryTrack(r: LibraryRow, coverUrl: string): SpotifyTrack {
  return {
    id:          `lib-${r.id}`,
    name:        r.title,
    artist:      r.artist,
    albumName:   "",
    releaseYear: r.release_year,
    coverUrl,
    uri:         "",
    durationMs:  0,
  };
}
