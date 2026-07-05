import type { PagesFunction } from "@cloudflare/workers-types";
import { requireAuth, updateSession, getSessionId } from "@gokkehub/auth/session";
import { rateLimit } from "../_ratelimit";
import type { Env } from "../_env";

// Buzzer sound setting — carried across all GokkeHub games.
//   PUT   binary audio  → upload clip to the avatars R2 bucket
//   PATCH { preset }    → pick a built-in ("preset:<id>")
//   PATCH { clear }     → back to the default
// The value lives in the session (for /auth/me) AND a permanent KV key
// (buzzer_sound:<userId>) restored at login — same pattern as lastfm_link.

const MAX_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB ≈ plenty for a 3-second clip
const PUBLIC_URL = "https://avatars.gokkehub.com";
const ALLOWED_TYPES: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp4":  "m4a",
  "audio/ogg":  "ogg",
  "audio/webm": "webm",
  "audio/wav":  "wav",
  "audio/x-wav": "wav",
};

async function persist(env: Env, request: Request, userId: string, value: string | null) {
  const kvKey = `buzzer_sound:${userId}`;
  if (value) await env.SESSIONS.put(kvKey, value);
  else       await env.SESSIONS.delete(kvKey);
  const sessionId = getSessionId(request);
  if (sessionId) await updateSession(env.SESSIONS, sessionId, { buzzerSound: value });
}

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const req = request as unknown as Request;
  const limited = await rateLimit(env.SESSIONS, req, {
    max: 10, windowSeconds: 60, prefix: "rl:buzzer-sound",
  });
  if (limited) return limited;

  const { session, response } = await requireAuth(env.SESSIONS, req);
  if (response) return response;

  const contentType = req.headers.get("Content-Type") ?? "";
  const ext = ALLOWED_TYPES[contentType];
  if (!ext) {
    return Response.json({ error: "Unsupported audio type. Use MP3, M4A, OGG, WebM, or WAV." }, { status: 415 });
  }

  const body = await req.arrayBuffer();
  if (body.byteLength > MAX_SIZE_BYTES) {
    return Response.json({ error: "File too large. Keep it under 2 MB (~3 seconds)." }, { status: 413 });
  }

  const key = `buzzer-sounds/${session!.userId}.${ext}`;
  await env.AVATARS.put(key, body, {
    httpMetadata:   { contentType },
    customMetadata: { userId: session!.userId },
  });

  // Cache-bust so a re-recorded clip replaces the old one immediately.
  const url = `${PUBLIC_URL}/${key}?v=${Date.now()}`;
  await persist(env, req, session!.userId, url);

  return Response.json({ buzzerSound: url });
};

export const onRequestPatch: PagesFunction<Env> = async ({ request, env }) => {
  const req = request as unknown as Request;
  const { session, response } = await requireAuth(env.SESSIONS, req);
  if (response) return response;

  let body: { preset?: unknown; clear?: unknown };
  try {
    body = await req.json() as typeof body;
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (body.clear === true) {
    await persist(env, req, session!.userId, null);
    return Response.json({ buzzerSound: null });
  }

  if (typeof body.preset === "string" && /^[a-z]{2,20}$/.test(body.preset)) {
    const value = `preset:${body.preset}`;
    await persist(env, req, session!.userId, value);
    return Response.json({ buzzerSound: value });
  }

  return Response.json({ error: "Send { preset } or { clear: true }" }, { status: 400 });
};
