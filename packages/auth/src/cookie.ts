/**
 * Cookie helpers — @gokkehub/auth/cookie
 * ========================================
 * Builds and parses HttpOnly session cookies for Cloudflare Workers.
 * The cookie value is ONLY the session ID — never the session data itself.
 *
 * Security settings enforced on every cookie:
 *   HttpOnly  — not readable by JavaScript
 *   Secure    — HTTPS only
 *   SameSite=Lax — blocks cross-site POST forgery
 *   Domain=.gokkehub.com — valid on all subdomains
 *   Max-Age=604800 — expires in 7 days
 */

import { SESSION_COOKIE_NAME, SESSION_TTL_SECONDS } from "./types.ts";

/**
 * Build a Set-Cookie header string for a new session.
 * Pass cookieDomain from env.COOKIE_DOMAIN (".gokkehub.com").
 */
export function buildSessionCookie(
  sessionId: string,
  cookieDomain: string,
  maxAge = SESSION_TTL_SECONDS,
): string {
  return [
    `${SESSION_COOKIE_NAME}=${sessionId}`,
    `Max-Age=${maxAge}`,
    `Domain=${cookieDomain}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
  ].join("; ");
}

/**
 * Build a Set-Cookie header that clears the session cookie (logout).
 */
export function clearSessionCookie(cookieDomain: string): string {
  return [
    `${SESSION_COOKIE_NAME}=`,
    "Max-Age=0",
    `Domain=${cookieDomain}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
  ].join("; ");
}

/**
 * Parse the session ID out of a Cookie request header string.
 * Returns null if the cookie is absent or empty.
 */
export function parseSessionId(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key.trim() === SESSION_COOKIE_NAME) {
      const value = rest.join("=").trim();
      return value || null;
    }
  }

  return null;
}
