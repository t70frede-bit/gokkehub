import type { PagesFunction } from "@cloudflare/workers-types";
import { rateLimit } from "../_ratelimit";
import type { Env } from "../_env";

// GET /auth/discord — redirect to Discord OAuth
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  // 20 OAuth initiations per minute per IP
  const limited = await rateLimit(env.SESSIONS, request as unknown as Request, {
    max: 20,
    windowSeconds: 60,
    prefix: "rl:oauth",
  });
  if (limited) return limited;
  const params = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    redirect_uri: `https://account.gokkehub.com/auth/discord/callback`,
    response_type: "code",
    scope: "identify email",
  });

  return Response.redirect(
    `https://discord.com/oauth2/authorize?${params.toString()}`,
    302
  );
};
