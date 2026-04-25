import type { PagesFunction } from "@cloudflare/workers-types";
import { requireAuth, updateSession, getSessionId } from "@gokkehub/auth/session";
import { rateLimit } from "../_ratelimit";
import type { Env } from "../_env";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.DISCORD_CLIENT_ID) {
    return new Response("DISCORD_CLIENT_ID is not configured on this server.", { status: 500 });
  }

  const limited = await rateLimit(env.SESSIONS, request as unknown as Request, {
    max: 20,
    windowSeconds: 60,
    prefix: "rl:oauth",
  });
  if (limited) return limited;

  const params = new URLSearchParams({
    client_id:     env.DISCORD_CLIENT_ID,
    redirect_uri:  "https://account.gokkehub.com/auth/discord/callback",
    response_type: "code",
    scope:         "identify email",
  });

  return Response.redirect(`https://discord.com/oauth2/authorize?${params}`, 302);
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  const { response } = await requireAuth(env.SESSIONS, request as unknown as Request);
  if (response) return response;

  const sessionId = getSessionId(request as unknown as Request)!;
  await updateSession(env.SESSIONS, sessionId, { discord: undefined });

  return new Response(null, { status: 204 });
};
