import type { PagesFunction } from "@cloudflare/workers-types";
import type { Env } from "./_env";
import { json, handlePreflight } from "./_cors";
import type { TlPlaylistCatalogEntry } from "../src/lib/types";

// GET /catalog
//
// Returns the full active playlist catalog (migration 028). Sorted by
// baseline_difficulty ascending so the Lobby browser surfaces friendlier
// playlists first. No auth required — the catalog is intentionally
// public-readable; only writes (admin-style) go through service-role.
//
// Per-player effective difficulty isn't computed here — the Lobby
// browser does that client-side from the player's spotify-taste profile
// and tl_player_song_stats (Phase 2 stats), since those are cached
// locally already.

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  const pre = handlePreflight(request as unknown as Request);
  if (pre) return pre;
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const req = request as unknown as Request;

  try {
    const url = `${env.SUPABASE_URL}/rest/v1/tl_playlist_catalog?is_active=eq.true&select=*&order=baseline_difficulty.asc,name.asc`;
    const res = await fetch(url, {
      headers: {
        apikey:        env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return json({ error: `Catalog fetch failed: ${res.status} ${text.slice(0, 200)}` }, 500, req);
    }
    const items = await res.json() as TlPlaylistCatalogEntry[];
    return json({ items }, 200, req);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500, req);
  }
};
