import type { PagesFunction } from "@cloudflare/workers-types";
import { requireAuth, updateSession, getSessionId } from "@gokkehub/auth/session";
import { rateLimit } from "../_ratelimit";
import type { Env } from "../_env";

// GET /auth/steam — redirect to Steam OpenID
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  // 20 OAuth initiations per minute per IP
  const limited = await rateLimit(env.SESSIONS, request as unknown as Request, {
    max: 20,
    windowSeconds: 60,
    prefix: "rl:oauth",
  });
  if (limited) return limited;
  const params = new URLSearchParams({
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.mode": "checkid_setup",
    "openid.return_to": "https://account.gokkehub.com/auth/steam/callback",
    "openid.realm": "https://account.gokkehub.com",
    "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
    "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
  });

  return Response.redirect(
    `https://steamcommunity.com/openid/login?${params.toString()}`,
    302
  );
};

// DELETE /auth/steam — disconnect Steam from account
export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireAuth(
    env.SESSIONS,
    request as unknown as Request
  );
  if (response) return response;

  const sessionId = getSessionId(request as unknown as Request)!;
  await updateSession(env.SESSIONS, sessionId, { steam: undefined });

  return new Response(null, { status: 204 });
};
