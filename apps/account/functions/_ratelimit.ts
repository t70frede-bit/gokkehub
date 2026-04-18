/**
 * KV-based rate limiter for Cloudflare Pages Functions
 *
 * Keyed by IP address. Sliding window: tracks attempt count within
 * a fixed TTL window. If the count exceeds the limit the function
 * returns a 429 response and the caller should return it immediately.
 *
 * Usage:
 *   const limited = await rateLimit(env.SESSIONS, request, { max: 5, windowSeconds: 60 });
 *   if (limited) return limited;   // returns Response with 429
 */

import type { KVNamespace } from "@cloudflare/workers-types";

interface RateLimitOptions {
  /** Maximum requests allowed in the window */
  max: number;
  /** Window size in seconds */
  windowSeconds: number;
  /** Optional key prefix so different endpoints share no state */
  prefix?: string;
}

export async function rateLimit(
  kv: KVNamespace,
  request: Request,
  options: RateLimitOptions
): Promise<Response | null> {
  const { max, windowSeconds, prefix = "rl" } = options;

  // Use CF-Connecting-IP (set by Cloudflare) — falls back to a fixed key for local dev
  const ip =
    (request as Request & { headers: Headers }).headers.get("CF-Connecting-IP") ??
    "local";

  const key = `${prefix}:${ip}`;

  const raw = await kv.get(key);
  const count = raw ? Number(raw) : 0;

  if (count >= max) {
    return new Response(
      JSON.stringify({ error: "Too many requests — please wait and try again" }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(windowSeconds),
        },
      }
    );
  }

  // Increment — TTL resets on each hit (sliding window approximation)
  await kv.put(key, String(count + 1), { expirationTtl: windowSeconds });

  return null;
}
