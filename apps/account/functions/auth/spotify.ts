import type { PagesFunction } from "@cloudflare/workers-types";
import { requireAuth, updateSession, getSessionId } from "@gokkehub/auth/session";
import { rateLimit } from "../_ratelimit";
import type { Env } from "../_env";

// GET /auth/spotify — redirect to Spotify OAuth
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.SPOTIFY_CLIENT_ID) {
    return new Response("SPOTIFY_CLIENT_ID is not configured on this server.", { status: 500 });
  }

  // 20 OAuth initiations per minute per IP
  const limited = await rateLimit(env.SESSIONS, request as unknown as Request, {
    max: 20,
    windowSeconds: 60,
    prefix: "rl:oauth",
  });
  if (limited) return limited;

  const params = new URLSearchParams({
    client_id: env.SPOTIFY_CLIENT_ID,
    redirect_uri: `https://account.gokkehub.com/auth/spotify/callback`,
    response_type: "code",
    scope: "user-read-email user-read-private user-modify-playback-state user-read-playback-state streaming playlist-read-private playlist-read-collaborative",
  });

  return Response.redirect(
    `https://accounts.spotify.com/authorize?${params.toString()}`,
    302
  );
};

// DELETE /auth/spotify — disconnect Spotify from account
export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireAuth(
    env.SESSIONS,
    request as unknown as Request
  );
  if (response) return response;

  const sessionId = getSessionId(request as unknown as Request)!;
  await updateSession(env.SESSIONS, sessionId, { spotify: undefined });

  return new Response(null, { status: 204 });
};
