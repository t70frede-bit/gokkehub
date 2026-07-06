/**
 * CORS helper for GokkeHub game apps calling account.gokkehub.com.
 *
 * Allowed origins: any *.gokkehub.com subdomain (plus localhost for dev).
 * We use credentials: "include" on the client, so we can't use "*" — we must
 * echo back the exact requesting origin when it's on the allowlist.
 */

// Any *.gokkehub.com subdomain AND the apex — the hub counts too.
const ALLOWED_ORIGIN_RE = /^https?:\/\/(localhost(:\d+)?|([\w-]+\.)?gokkehub\.com)$/;

export function getCorsOrigin(request: Request): string | null {
  const origin = request.headers.get("Origin");
  if (!origin) return null;
  return ALLOWED_ORIGIN_RE.test(origin) ? origin : null;
}

export function corsHeaders(request: Request): Record<string, string> {
  const origin = getCorsOrigin(request);
  // Vary: Origin must be sent on EVERY response — including same-origin ones
  // with no CORS headers. Without it, a browser can cache the same-origin
  // flavour of /auth/me and replay it for a cross-origin fetch from a game
  // app, which then dies on the missing Access-Control-Allow-Origin header.
  if (!origin) return { "Vary": "Origin" };
  return {
    "Access-Control-Allow-Origin":      origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods":     "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers":     "Content-Type",
    "Vary":                             "Origin",
  };
}

/** Handle CORS preflight OPTIONS requests. */
export function handlePreflight(request: Request): Response | null {
  if (request.method !== "OPTIONS") return null;
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}
