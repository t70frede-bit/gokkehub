import type { Env } from "./_env";
import { getSession } from "@gokkehub/auth/session";
import type { SessionData } from "@gokkehub/auth/types";

/**
 * Session lookup for jeopardy's Pages Functions, with a LOCAL-ONLY dev
 * identity so the app can be tested end-to-end without a real login.
 *
 * Why a bypass is needed at all: the session cookie is
 * `Domain=.gokkehub.com; Secure; SameSite=Lax`, so a browser will never send
 * it to http://localhost — there is no way to be "signed in" locally against
 * the real account app.
 *
 * Two independent gates, both of which must hold:
 *   1. `DEV_USER_ID` is set. It lives only in the gitignored `.dev.vars`
 *      file — never in wrangler.toml, never in a Pages secret. Production
 *      simply has no such binding.
 *   2. The request arrived at localhost / 127.0.0.1. Requests to
 *      jeopardy.gokkehub.com can't satisfy this even if (1) leaked.
 *
 * Anything else falls through to the real KV-backed session.
 */
function devSession(env: Env, request: Request): SessionData | null {
  if (!env.DEV_USER_ID) return null;

  const host = new URL(request.url).hostname;
  if (host !== "localhost" && host !== "127.0.0.1" && host !== "[::1]") return null;

  const now = Date.now();
  return {
    userId:      env.DEV_USER_ID,
    email:       null,
    displayName: env.DEV_USER_NAME ?? "Dev Host",
    avatarUrl:   null,
    buzzerSound: null,
    createdAt:   now,
    expiresAt:   now + 86_400_000,
  };
}

/** Drop-in replacement for getSession(env.SESSIONS, req) in this app. */
export async function readSession(env: Env, request: Request): Promise<SessionData | null> {
  return devSession(env, request) ?? await getSession(env.SESSIONS, request);
}
