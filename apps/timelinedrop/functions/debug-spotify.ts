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

  // Test /v1/me with user token
  const meRes = await fetch("https://api.spotify.com/v1/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const meBody = await meRes.text();

  // Get user's own playlists — pick the first one to test /items
  const myPlaylistsRes = await fetch(
    "https://api.spotify.com/v1/me/playlists?limit=5",
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const myPlaylistsText = await myPlaylistsRes.text();
  const myPlaylistsData = (() => { try { return JSON.parse(myPlaylistsText); } catch { return null; } })() as {
    items?: Array<{ id: string; name: string; owner: { id: string }; tracks: { total: number } }>;
  } | null;

  const ownedPlaylists = (myPlaylistsData?.items ?? []).filter(
    p => p.owner.id === session.spotify!.id
  );
  const firstOwned = ownedPlaylists[0] ?? myPlaylistsData?.items?.[0] ?? null;

  // Test /items on the first playlist (owned or followed)
  let ownedItemsStatus: number | null = null;
  let ownedItemsBody: unknown = null;
  let ownedPlaylistId: string | null = null;
  if (firstOwned) {
    ownedPlaylistId = firstOwned.id;
    const ownedRes = await fetch(
      `https://api.spotify.com/v1/playlists/${firstOwned.id}/items?limit=1&market=from_token`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    ownedItemsStatus = ownedRes.status;
    const ownedText = await ownedRes.text();
    ownedItemsBody = (() => { try { return JSON.parse(ownedText); } catch { return ownedText; } })();
  }

  // Also show what scopes the stored token has
  const storedScope = session.spotify.scope ?? "(not stored)";

  return json({
    session_user:   session.userId,
    spotify_id:     session.spotify.id,
    stored_scope:   storedScope,
    token_expires_in_seconds: tokenAge,
    token_was_refreshed: refreshed,
    refresh_error:  refreshError,
    token_prefix:   accessToken.slice(0, 12) + "...",
    me_status:      meRes.status,
    my_playlists_status: myPlaylistsRes.status,
    my_playlists: (myPlaylistsData?.items ?? []).map(p => ({
      id:    p.id,
      name:  p.name,
      owner: p.owner.id,
      total: p.tracks.total,
    })),
    test_playlist_id:      ownedPlaylistId,
    owned_items_status:    ownedItemsStatus,
    owned_items_body:      ownedItemsBody,
  }, 200, req);
};
