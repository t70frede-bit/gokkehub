import type { PagesFunction } from "@cloudflare/workers-types";
import { getSession } from "@gokkehub/auth/session";
import type { Env } from "./_env";
import { json, handlePreflight } from "./_cors";
import { refreshSpotifyToken } from "./_supabase";
import { parseSessionId } from "@gokkehub/auth/cookie";

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  const pre = handlePreflight(request as unknown as Request);
  if (pre) return pre;

  const req = request as unknown as Request;
  const session = await getSession(env.SESSIONS, req);

  if (!session) return json({ error: "No session — not logged in" }, 401, req);
  if (!session.spotify) return json({ error: "No Spotify connected on this session" }, 200, req);

  const { expiresAt, refreshToken } = session.spotify;
  let { accessToken } = session.spotify;
  const tokenAge = Math.round((expiresAt - Date.now()) / 1000);
  let refreshed = false;
  let refreshError: string | null = null;

  if (Date.now() > expiresAt - 60_000) {
    try {
      const r = await refreshSpotifyToken(env, refreshToken);
      accessToken = r.access_token;
      refreshed = true;
      const sessionId = parseSessionId(req.headers.get("Cookie"));
      if (sessionId) {
        await env.SESSIONS.put(
          sessionId,
          JSON.stringify({ ...session, spotify: { ...session.spotify, accessToken, expiresAt: Date.now() + r.expires_in * 1000 } }),
          { expirationTtl: 604800 }
        );
      }
    } catch (e) {
      refreshError = e instanceof Error ? e.message : String(e);
    }
  }

  const spotifyId  = session.spotify.id;
  const authHeader = { Authorization: `Bearer ${accessToken}` };

  // /v1/me
  const meStatus = await fetch("https://api.spotify.com/v1/me", { headers: authHeader })
    .then(r => r.status);

  // /v1/me/playlists
  const myPlaylistsRes  = await fetch("https://api.spotify.com/v1/me/playlists?limit=10", { headers: authHeader });
  const myPlaylistsJson = await myPlaylistsRes.json() as { items?: Array<{ id: string; name: string; owner: { id: string }; tracks: { total: number } }> };
  const myPlaylists     = (myPlaylistsJson?.items ?? []).map(p => ({
    id: p.id, name: p.name, owner: p.owner.id, tracks: p.tracks.total,
  }));

  // Pick first owned playlist to test
  const firstOwned = myPlaylists.find(p => p.owner === spotifyId) ?? myPlaylists[0] ?? null;

  // Optional: ?playlist= query param
  const queryId = new URL(req.url).searchParams.get("playlist");

  // Test a playlist: fetch meta + items
  const playlistToTest = queryId ?? firstOwned?.id ?? null;
  let metaStatus: number | null = null;
  let metaBody:   unknown       = null;
  let itemsStatus: number | null = null;
  let itemsBody:   unknown       = null;

  if (playlistToTest) {
    const metaRes = await fetch(
      `https://api.spotify.com/v1/playlists/${playlistToTest}?fields=name,owner,public`,
      { headers: authHeader }
    );
    metaStatus = metaRes.status;
    metaBody   = await metaRes.json().catch(() => null);

    const itemsRes = await fetch(
      `https://api.spotify.com/v1/playlists/${playlistToTest}/items?limit=1&market=from_token`,
      { headers: authHeader }
    );
    itemsStatus = itemsRes.status;
    itemsBody   = await itemsRes.json().catch(() => null);
  }

  return json({
    spotify_id:     spotifyId,
    stored_scope:   session.spotify.scope ?? "(not stored)",
    token_expires_in_seconds: tokenAge,
    token_was_refreshed: refreshed,
    refresh_error:  refreshError,
    me_status:      meStatus,
    my_playlists_status: myPlaylistsRes.status,
    my_playlists:   myPlaylists,
    tested_playlist_id: playlistToTest,
    meta_status:    metaStatus,
    meta_body:      metaBody,
    items_status:   itemsStatus,
    items_body:     itemsBody,
    hint: queryId ? null : "Add ?playlist=<id> to test a specific playlist ID",
  }, 200, req);
};
