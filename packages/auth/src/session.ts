/**
 * KV session helpers — @gokkehub/auth/session
 * =============================================
 * Implements the secure KV session pattern:
 *
 *   LOGIN:
 *     1. Generate a random session ID  (crypto.randomUUID())
 *     2. Store SessionData in KV under that ID  (TTL = 7 days)
 *     3. Set an HttpOnly cookie containing ONLY the session ID
 *
 *   EACH REQUEST:
 *     1. Read session ID from cookie  (parseSessionId)
 *     2. Look up KV → get SessionData
 *     3. Use SessionData — NEVER trust anything from the cookie itself
 *
 *   LOGOUT:
 *     1. Delete the KV entry
 *     2. Clear the cookie
 *
 * The KV binding is named SESSIONS (from wrangler.toml).
 * Import this only in /functions/ (server-side Workers code).
 */

import type { SessionData, PublicSessionData } from "./types.ts";
import { SESSION_TTL_SECONDS } from "./types.ts";
import { parseSessionId } from "./cookie.ts";

// KVNamespace is injected by the Workers runtime
type KV = KVNamespace;

/**
 * Create a new session in KV and return the session ID.
 * The caller is responsible for setting the cookie on the response.
 */
export async function createSession(
  kv: KV,
  data: Omit<SessionData, "createdAt" | "expiresAt">,
): Promise<string> {
  const sessionId = crypto.randomUUID();
  const now = Date.now();

  const sessionData: SessionData = {
    ...data,
    createdAt: now,
    expiresAt: now + SESSION_TTL_SECONDS * 1000,
  };

  await kv.put(sessionId, JSON.stringify(sessionData), {
    expirationTtl: SESSION_TTL_SECONDS,
  });

  return sessionId;
}

/**
 * Read session data from KV using the session ID from the request cookie.
 * Returns null if the cookie is missing, the session doesn't exist, or expired.
 */
export async function getSession(
  kv: KV,
  request: Request,
): Promise<SessionData | null> {
  const cookieHeader = request.headers.get("Cookie");
  const sessionId = parseSessionId(cookieHeader);
  if (!sessionId) return null;

  const raw = await kv.get(sessionId);
  if (!raw) return null;

  try {
    const data = JSON.parse(raw) as SessionData;
    // Double-check expiry even though KV TTL should handle it
    if (data.expiresAt < Date.now()) {
      await kv.delete(sessionId);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

/**
 * Get the session ID from the request cookie (without fetching the data).
 * Useful when you just need to delete the session.
 */
export function getSessionId(request: Request): string | null {
  return parseSessionId(request.headers.get("Cookie"));
}

/**
 * Update an existing session (e.g. after linking a new OAuth account).
 * Resets the TTL.
 */
export async function updateSession(
  kv: KV,
  sessionId: string,
  updates: Partial<Omit<SessionData, "createdAt" | "expiresAt">>,
): Promise<void> {
  const raw = await kv.get(sessionId);
  if (!raw) return;

  const existing = JSON.parse(raw) as SessionData;
  const updated: SessionData = {
    ...existing,
    ...updates,
    expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000,
  };

  await kv.put(sessionId, JSON.stringify(updated), {
    expirationTtl: SESSION_TTL_SECONDS,
  });
}

/**
 * Delete a session from KV (logout).
 * Always pair this with clearSessionCookie() on the response.
 */
export async function deleteSession(
  kv: KV,
  sessionId: string,
): Promise<void> {
  await kv.delete(sessionId);
}

/**
 * Strip all OAuth tokens from SessionData before sending to the client.
 * Use this whenever you need to expose session info to the browser.
 * NEVER send the raw SessionData — it contains access/refresh tokens.
 */
export function toPublicSession(data: SessionData): PublicSessionData {
  return {
    userId:      data.userId,
    email:       data.email,
    displayName: data.displayName,
    avatarUrl:   data.avatarUrl,
    linked: {
      spotify: !!data.spotify,
      discord: !!data.discord,
      steam:   !!data.steam,
    },
  };
}

/**
 * Middleware helper — reads session and returns 401 if not authenticated.
 * Use at the top of any protected /functions/ handler.
 *
 * Usage:
 *   const { session, response } = await requireAuth(env.SESSIONS, request);
 *   if (response) return response;  // 401
 *   // session is now typed as SessionData
 */
export async function requireAuth(
  kv: KV,
  request: Request,
): Promise<{ session: SessionData; response: null } | { session: null; response: Response }> {
  const session = await getSession(kv, request);
  if (!session) {
    return {
      session: null,
      response: new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    };
  }
  return { session, response: null };
}
