import type { PagesFunction } from "@cloudflare/workers-types";
import { getSession } from "@gokkehub/auth/session";
import type { Env } from "./_env";
import { json, handlePreflight } from "./_cors";
import { refreshSpotifyToken, getClientCredentialsToken } from "./_supabase";
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

  // Optional: test a specific playlist from ?playlist= query param
  const url = new URL(req.url);
  const queryPlaylistId = url.searchParams.get("playlist");

  // Test /v1/me
  const meRes = await fetch("https://api.spotify.com/v1/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  // Get user's own playlists
  const myPlaylistsRes = await fetch(
    "https://api.spotify.com/v1/me/playlists?limit=10",
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const myPlaylistsData = await myPlaylistsRes.json().catch(() => null) as {
    items?: Array<{ id: string; name: string; owner: { id: string }; tracks: { total: number } }>;
  } | null;

  const ownedPlaylists = (myPlaylistsData?.items ?? []).filter(
    p => p.owner.id === session.spotify!.id
  );
  const firstOwned = ownedPlaylists[0] ?? myPlaylistsData?.items?.[0] ?? null;

  async function testPlaylist(id: string) {
    const metaRes = await fetch(
      `https://api.spotify.com/v1/playlists/${id}?fields=name,owner,public`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const metaBody = await metaRes.json().catch(() => null);

    const itemsRes = await fetch(
      `https://api.spotify.com/v1/playlists/${id}/items?limit=1&market=from_token`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const itemsBody = await itemsRes.json().catch((e: unknown) => String(e));

    return {
      playlist_id:   id,
      meta_status:   metaRes.status,
      meta_body:     metaBody,
      items_status:  itemsRes.status,
      items_body:    itemsBody,
    };
  }

  const ownedTest  = firstOwned  ? await testPlaylist(firstOwned.id)  : null;
  const queryTest  = queryPlaylistId ? await testPlaylist(queryPlaylistId) : null;

  return json({
    spotify_id:     session.spotify.id,
    stored_scope:   session.spotify.scope ?? "(not stored)",
    token_expires_in_seconds: tokenAge,
    token_was_refreshed: refreshed,
    refresh_error:  refreshError,
    me_status:      meRes.status,
    my_playlists_status: myPlaylistsRes.status,
    my_playlists: (myPlaylistsData?.items ?? []).map(p => ({
      id:    p.id,
      name:  p.name,
      owner: p.owner.id,
      tracks: p.tracks.total,
    })),
    first_owned_playlist_test: ownedTest,
    query_playlist_test: queryTest,
    hint: queryPlaylistId ? null : "Add ?playlist=<id> to test a specific playlist",
  }, 200, req);
};
