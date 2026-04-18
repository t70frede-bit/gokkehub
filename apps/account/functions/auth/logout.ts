import type { PagesFunction } from "@cloudflare/workers-types";
import { deleteSession, getSessionId } from "@gokkehub/auth/session";
import { clearSessionCookie } from "@gokkehub/auth/cookie";
import type { Env } from "../_env";

export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  const sessionId = getSessionId(request as unknown as Request);
  if (sessionId) {
    await deleteSession(env.SESSIONS, sessionId);
  }

  const cookie = clearSessionCookie(env.COOKIE_DOMAIN);

  return new Response(null, {
    status: 204,
    headers: { "Set-Cookie": cookie },
  });
};
