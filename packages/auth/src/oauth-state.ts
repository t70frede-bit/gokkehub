/**
 * OAuth `state` helpers — @gokkehub/auth/oauth-state
 * ====================================================
 * Protects the Discord/Spotify login flows against login CSRF and carries the
 * post-login return URL through the provider round-trip.
 *
 *   START  (GET /auth/<provider>)
 *     1. Generate a random state
 *     2. KV  oauth_state:<state> → { returnTo }   (TTL 10 min)
 *     3. Set a short-lived HttpOnly cookie holding the same state, so the
 *        callback only succeeds in the browser that started the flow
 *
 *   CALLBACK (GET /auth/<provider>/callback?state=…)
 *     1. Query state must equal the cookie state
 *     2. KV entry must exist — it is deleted on read (single use)
 *
 * The cookie is host-only (no Domain) — it is only needed on
 * account.gokkehub.com, where both ends of the flow live.
 */

import { safeReturnUrl } from "./redirect.ts";

type KV = KVNamespace;

export const OAUTH_STATE_COOKIE = "gh_oauth_state";
const STATE_TTL_SECONDS = 600;
const kvKey = (state: string) => `oauth_state:${state}`;

function stateCookie(value: string, maxAge: number): string {
  return [
    `${OAUTH_STATE_COOKIE}=${value}`,
    `Max-Age=${maxAge}`,
    "Path=/auth",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
  ].join("; ");
}

/** Set-Cookie value that removes the state cookie. */
export const clearOAuthStateCookie = (): string => stateCookie("", 0);

/**
 * Start an OAuth flow. Returns the `state` to send to the provider and the
 * Set-Cookie header to put on the redirect response.
 */
export async function beginOAuth(
  kv: KV,
  returnTo: string | null | undefined,
): Promise<{ state: string; cookie: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const state = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

  await kv.put(
    kvKey(state),
    JSON.stringify({ returnTo: safeReturnUrl(returnTo) }),
    { expirationTtl: STATE_TTL_SECONDS },
  );

  return { state, cookie: stateCookie(state, STATE_TTL_SECONDS) };
}

function readStateCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === OAUTH_STATE_COOKIE) return rest.join("=") || null;
  }
  return null;
}

/**
 * Verify the callback's `state`. On success returns the stored return URL
 * (null = none given). Returns `{ ok: false }` for a missing, mismatched,
 * expired or already-used state.
 */
export async function finishOAuth(
  kv: KV,
  request: Request,
): Promise<{ ok: true; returnTo: string | null } | { ok: false }> {
  const state = new URL(request.url).searchParams.get("state");
  const cookieState = readStateCookie(request.headers.get("Cookie"));
  if (!state || !cookieState || state !== cookieState) return { ok: false };

  const raw = await kv.get(kvKey(state));
  if (!raw) return { ok: false };
  await kv.delete(kvKey(state));

  try {
    const { returnTo } = JSON.parse(raw) as { returnTo: string | null };
    return { ok: true, returnTo: safeReturnUrl(returnTo) };
  } catch {
    return { ok: true, returnTo: null };
  }
}
