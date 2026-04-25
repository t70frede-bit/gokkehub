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

  // Test playlist items with user token — "Today's Top Hits" (Spotify-owned public playlist)
  const testPlaylistId = "37i9dQZF1DXcBWIGoYBM5M";
  const userTracksRes = await fetch(
    `https://api.spotify.com/v1/playlists/${testPlaylistId}/items?limit=1`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const userTracksBody = await userTracksRes.text();

  // Test playlist items with client credentials token (app-level, no user context)
  let ccToken: string | null = null;
  let ccError: string | null = null;
  let ccTracksStatus: number | null = null;
  let ccTracksBody: unknown = null;
  try {
    ccToken = await getClientCredentialsToken(env);
    const ccRes = await fetch(
      `https://api.spotify.com/v1/playlists/${testPlaylistId}/items?limit=1`,
      { headers: { Authorization: `Bearer ${ccToken}` } }
    );
    ccTracksStatus = ccRes.status;
    const ccText = await ccRes.text();
    ccTracksBody = (() => { try { return JSON.parse(ccText); } catch { return ccText; } })();
  } catch (e) {
    ccError = e instanceof Error ? e.message : String(e);
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
    me_body:        (() => { try { return JSON.parse(meBody); } catch { return meBody; } })(),
    test_playlist_id: testPlaylistId,
    user_token_items_status:  userTracksRes.status,
    user_token_items_body:    (() => { try { return JSON.parse(userTracksBody); } catch { return userTracksBody; } })(),
    cc_token_items_status:    ccTracksStatus,
    cc_token_items_body:      ccTracksBody,
    cc_token_error:           ccError,
  }, 200, req);
};
