import type { PagesFunction } from "@cloudflare/workers-types";
import { requireAuth, updateSession, getSessionId } from "@gokkehub/auth/session";
import { rateLimit } from "../_ratelimit";
import type { Env } from "../_env";

// Last.fm linkage uses just a username string — no OAuth.
// We optionally hit user.getInfo to validate that the username actually exists.

interface LastfmInfoResponse {
  user?: { name: string };
  error?: number;
  message?: string;
}

async function validateUsername(env: Env, username: string): Promise<{ ok: true; canonical: string } | { ok: false; error: string }> {
  if (!env.LASTFM_API_KEY) return { ok: false, error: "Last.fm is not configured on this server." };
  const url = `https://ws.audioscrobbler.com/2.0/?method=user.getinfo&user=${encodeURIComponent(username)}&api_key=${env.LASTFM_API_KEY}&format=json`;
  try {
    const res = await fetch(url);
    if (!res.ok) return { ok: false, error: `Last.fm returned ${res.status}` };
    const data = await res.json() as LastfmInfoResponse;
    if (data.error || !data.user) {
      return { ok: false, error: data.message ?? "Last.fm user not found" };
    }
    return { ok: true, canonical: data.user.name };
  } catch {
    return { ok: false, error: "Could not reach Last.fm" };
  }
}

// POST /auth/lastfm  { username }
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireAuth(env.SESSIONS, request as unknown as Request);
  if (response) return response;

  const limited = await rateLimit(env.SESSIONS, request as unknown as Request, {
    max: 10, windowSeconds: 60, prefix: "rl:lastfm",
  });
  if (limited) return limited;

  let body: { username?: string };
  try { body = await (request as unknown as Request).json(); }
  catch { return new Response("Invalid JSON", { status: 400 }); }

  const raw = (body.username ?? "").trim();
  if (!raw || raw.length < 2 || raw.length > 30) {
    return Response.json({ error: "Invalid Last.fm username" }, { status: 400 });
  }
  if (!/^[A-Za-z0-9_-]+$/.test(raw)) {
    return Response.json({ error: "Username must be alphanumeric with - or _" }, { status: 400 });
  }

  const validation = await validateUsername(env, raw);
  if (!validation.ok) return Response.json({ error: validation.error }, { status: 404 });

  const sessionId = getSessionId(request as unknown as Request)!;
  await updateSession(env.SESSIONS, sessionId, {
    lastfm: { username: validation.canonical, linkedAt: Date.now() },
  });
  // Persist to KV under discord id so the Discord re-login restore picks it up.
  const persistKey = session.discord?.id ?? session.userId;
  await env.SESSIONS.put(`lastfm_link:${persistKey}`, validation.canonical, { expirationTtl: 60 * 60 * 24 * 90 });

  return Response.json({ username: validation.canonical });
};

// DELETE /auth/lastfm — disconnect
export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireAuth(env.SESSIONS, request as unknown as Request);
  if (response) return response;

  const sessionId = getSessionId(request as unknown as Request)!;
  await updateSession(env.SESSIONS, sessionId, { lastfm: undefined });
  const persistKey = session.discord?.id ?? session.userId;
  await env.SESSIONS.delete(`lastfm_link:${persistKey}`);

  return new Response(null, { status: 204 });
};
