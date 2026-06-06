import type { PagesFunction } from "@cloudflare/workers-types";
import { getSession } from "@gokkehub/auth/session";
import type { Env } from "../../_env";
import { json, handlePreflight } from "../../_cors";
import { getRoom, updateRoom } from "../../_supabase";
import { searchTrackUri, getActiveHostToken, lookupItunesCover } from "../../_spotify";
import type { SpotifyTrack, TlRoomSettings, TlPlaylistCatalogEntry } from "../../../src/lib/types";

// POST /room/:id/catalog-import { catalog_id }
//
// Reads a catalog row by ID and resolves its tracks into the room's
// track_pool. Two modes depending on what the catalog entry carries:
//
//   • track_list (hand-encoded): runs each {artist, title, year}
//     through searchTrackUri to get the Spotify URI. Cap on search
//     subrequests so we stay under Cloudflare's 50-per-request limit.
//   • spotify_playlist_id (legacy): forwards to the existing /playlist
//     endpoint's flow — kept as a fallback, not exercised by current
//     catalog seeds (all multi-decade hand-encoded after 029).
//
// Reuses the same playlistImports + shuffle-unplayed-tail logic the
// URL-paste path uses, so add/remove behaves identically.

const MAX_SPOTIFY_LOOKUPS = 40;
const SEARCH_DELAY_MS     = 30;
// Cap iTunes lookups so a 50-track catalog stays under Cloudflare's
// 50-subrequest budget (room read + catalog read + pool write + ~40
// iTunes = headroom for jitter). Tracks past the cap fall back to
// the grey-square placeholder; not great but not broken.
const MAX_ITUNES_LOOKUPS  = 40;

interface Body {
  player_id:  string;
  catalog_id: number;
}

export const onRequest: PagesFunction<Env> = async ({ request, params, env }) => {
  const pre = handlePreflight(request as unknown as Request);
  if (pre) return pre;
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const req    = request as unknown as Request;
  const roomId = params.id as string;

  try {
    const body = await req.json() as Body;
    if (!body.player_id || typeof body.catalog_id !== "number") {
      return json({ error: "player_id and catalog_id required" }, 400, req);
    }

    const room = await getRoom(env, roomId);
    if (!room) return json({ error: "Room not found" }, 404, req);
    if (room.host_id !== body.player_id) {
      return json({ error: "Only the host can add playlists" }, 403, req);
    }

    // Fetch the catalog entry.
    const catUrl = `${env.SUPABASE_URL}/rest/v1/tl_playlist_catalog?id=eq.${body.catalog_id}&is_active=eq.true&select=*&limit=1`;
    const catRes = await fetch(catUrl, {
      headers: {
        apikey:        env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    });
    if (!catRes.ok) return json({ error: `Catalog lookup failed: ${catRes.status}` }, 500, req);
    const rows = await catRes.json() as TlPlaylistCatalogEntry[];
    const entry = rows[0];
    if (!entry) return json({ error: "Catalog entry not found" }, 404, req);

    if (!entry.track_list || entry.track_list.length === 0) {
      return json({ error: "Catalog entry has no track list to import" }, 400, req);
    }

    // Resolve host's Spotify token if available — used to enrich each
    // track with the canonical Spotify URI + cover art. NOT required:
    // when the host has no Spotify (or the audio mode is YouTube-based),
    // the bot resolves playback from track.name + track.artist at round
    // time, and the catalog year is authoritative anyway.
    const requestSession = await getSession(env.SESSIONS, req);
    let refreshToken = requestSession?.spotify?.refreshToken;
    if (!refreshToken && room.host_session_id) {
      const raw = await env.SESSIONS.get(room.host_session_id);
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as { spotify?: { refreshToken?: string } };
          refreshToken = parsed.spotify?.refreshToken;
        } catch { /* malformed — ignore */ }
      }
    }
    let accessToken: string | null = null;
    if (refreshToken) {
      accessToken = await getActiveHostToken(env, refreshToken);
    }

    // Browser/SDK audio mode REQUIRES a real Spotify URI; YouTube modes
    // can play from artist+title strings the bot YouTube-searches at
    // round time. Refuse only when the host has chosen Spotify SDK
    // playback without a Spotify session.
    const audioMode = room.settings?.audioMode ?? "browser";
    if (!accessToken && audioMode === "browser") {
      return json({
        error: "Spotify SDK playback needs the host's Spotify account. Switch to Discord-bot or YouTube audio mode, or link Spotify.",
      }, 400, req);
    }

    const imported: SpotifyTrack[] = [];
    if (accessToken) {
      // Spotify-enriched path: resolve a real URI per track. Cap on
      // subrequests + small delay to stay under Cloudflare's 50-per-
      // request budget for big catalog lists.
      let attempts = 0;
      for (const t of entry.track_list) {
        if (attempts >= MAX_SPOTIFY_LOOKUPS) break;
        attempts++;
        const hit = await searchTrackUri(accessToken, t.artist, t.title);
        if (hit) {
          // Override Spotify's release year with the curated one — Spotify's
          // release_date can drift on compilations / remasters. The catalog
          // year is what the curator vetted, so it wins for placement.
          imported.push({ ...hit, releaseYear: t.year });
        }
        if (SEARCH_DELAY_MS > 0) await new Promise(r => setTimeout(r, SEARCH_DELAY_MS));
      }
      if (imported.length === 0) {
        return json({ error: "No tracks matched on Spotify — check the catalog entry" }, 400, req);
      }
    } else {
      // No-Spotify fallback: synthesise SpotifyTrack-shaped rows from
      // catalog metadata. ID is deterministic across rooms
      // (catalog-{catalogId}-{index}) so per-track stats aggregate
      // correctly even without Spotify enrichment.
      //
      // Cover art comes from iTunes Search — free, no auth, returns
      // an album-art URL we can resize via path substitution. Lookups
      // run in parallel up to MAX_ITUNES_LOOKUPS to stay under
      // Cloudflare's 50-subrequest budget; the rest fall back to the
      // grey-square placeholder the timeline rail already handles.
      const toLookup = entry.track_list.slice(0, MAX_ITUNES_LOOKUPS);
      const rest    = entry.track_list.slice(MAX_ITUNES_LOOKUPS);
      const covers  = await Promise.all(
        toLookup.map(t => lookupItunesCover(t.artist, t.title)),
      );
      toLookup.forEach((t, i) => {
        imported.push({
          id:          `catalog-${entry.id}-${i}`,
          name:        t.title,
          artist:      t.artist,
          releaseYear: t.year,
          coverUrl:    covers[i] ?? "",
          durationMs:  0,
          uri:         "",
        } as SpotifyTrack);
      });
      rest.forEach((t, i) => {
        imported.push({
          id:          `catalog-${entry.id}-${i + MAX_ITUNES_LOOKUPS}`,
          name:        t.title,
          artist:      t.artist,
          releaseYear: t.year,
          coverUrl:    "",
          durationMs:  0,
          uri:         "",
        } as SpotifyTrack);
      });
    }

    // Merge into pool with the same shuffle-unplayed-tail approach the
    // /playlist endpoint uses. Played head stays put; unplayed tail
    // (existing + new imports) shuffles.
    const existingIds = new Set((room.track_pool ?? []).map(t => t.id));
    const unique      = imported.filter(t => !existingIds.has(t.id));
    const existing    = room.track_pool ?? [];
    const cursor      = Math.min(room.track_cursor ?? 0, existing.length);
    const played      = existing.slice(0, cursor);
    const tail        = [...existing.slice(cursor), ...unique];
    for (let i = tail.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [tail[i], tail[j]] = [tail[j], tail[i]];
    }
    const merged = [...played, ...tail];

    const importRecord = {
      id:        crypto.randomUUID(),
      name:      entry.name,
      source:    "catalog" as const,
      added_at:  new Date().toISOString(),
      track_ids: unique.map(t => t.id),
    };
    const mergedSettings: TlRoomSettings = {
      ...(room.settings ?? {}),
      playlistImports: [...((room.settings?.playlistImports) ?? []), importRecord as never],
    };
    await updateRoom(env, roomId, { track_pool: merged, settings: mergedSettings });

    return json({
      added:     unique.length,
      total:     merged.length,
      name:      entry.name,
      attempted: entry.track_list.length,
      matched:   imported.length,
    }, 200, req);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500, req);
  }
};
