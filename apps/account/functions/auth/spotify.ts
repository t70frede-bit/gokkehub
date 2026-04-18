import type { PagesFunction } from "@cloudflare/workers-types";
import { rateLimit } from "../_ratelimit";
import type { Env } from "../_env";

// GET /auth/spotify — redirect to Spotify OAuth
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
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
    scope: "user-read-email user-read-private",
  });

  return Response.redirect(
    `https://accounts.spotify.com/authorize?${params.toString()}`,
    302
  );
};
