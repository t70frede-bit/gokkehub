import type { PagesFunction } from "@cloudflare/workers-types";
import { getSession } from "@gokkehub/auth/session";
import { parseSessionId } from "@gokkehub/auth/cookie";
import type { Env } from "./_env";
import { json, handlePreflight } from "./_cors";
import { refreshSpotifyToken } from "./_supabase";

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  const pre = handlePreflight(request as unknown as Request);
  if (pre) return pre;
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const req = request as unknown as Request;
  const session = await getSession(env.SESSIONS, req);
  if (!session) return json({ error: "Not authenticated" }, 401, req);
  if (!session.spotify) return json({ error: "Spotify not connected" }, 403, req);

  let { accessToken, expiresAt } = session.spotify;

  if (Date.now() > expiresAt - 60_000) {
    const refreshed = await refreshSpotifyToken(env, session.spotify.refreshToken);
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

  return json({ access_token: accessToken, expiresAt }, 200, req);
};
