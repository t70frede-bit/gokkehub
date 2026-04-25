import type { PagesFunction } from "@cloudflare/workers-types";
import { getSession } from "@gokkehub/auth/session";
import { parseSessionId } from "@gokkehub/auth/cookie";
import type { Env } from "../_env";
import { json, handlePreflight } from "../_cors";
import { refreshSpotifyToken } from "../_supabase";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const pre = handlePreflight(request as unknown as Request);
  if (pre) return pre;

  const req = request as unknown as Request;

  try {
    const session = await getSession(env.SESSIONS, req);
    if (!session?.spotify) return json({ error: "Spotify not connected" }, 403, req);

    let { accessToken, refreshToken, expiresAt } = session.spotify;

    if (Date.now() > expiresAt - 60_000) {
      if (!env.SPOTIFY_CLIENT_ID || !env.SPOTIFY_CLIENT_SECRET) {
        return json({ error: "Spotify credentials not configured on server" }, 500, req);
      }
      const refreshed = await refreshSpotifyToken(env, refreshToken);
      accessToken = refreshed.access_token;
      expiresAt   = Date.now() + refreshed.expires_in * 1000;

      const sessionId = parseSessionId(req.headers.get("Cookie"));
      if (sessionId) {
        await env.SESSIONS.put(
          sessionId,
          JSON.stringify({ ...session, spotify: { ...session.spotify, accessToken, expiresAt } }),
          { expirationTtl: 604800 }
        );
      }
    }

    return json({ access_token: accessToken }, 200, req);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: msg }, 500, req);
  }
};
