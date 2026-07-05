import type { PagesFunction } from "@cloudflare/workers-types";
import { requireAuth, updateSession, getSessionId } from "@gokkehub/auth/session";
import { rateLimit } from "../_ratelimit";
import type { Env } from "../_env";

// Buzzer sound setting — carried across all GokkeHub games.
//   GET                     → { current, library }
//   PUT   binary audio      → add a clip to the custom library (and select it)
//   PATCH { preset }        → pick a built-in ("preset:<id>")
//   PATCH { select: id }    → pick a library clip
//   PATCH { update: {id, name?, emoji?} } → rename / re-emoji a library clip
//   PATCH { remove: id }    → delete a library clip (R2 object included)
//   PATCH { clear: true }   → back to the default
//
// The ACTIVE sound stays a plain string ("preset:<id>" or a URL) in the
// session + permanent KV buzzer_sound:<userId> — games never see the library.
// The library itself lives in KV buzzer_library:<userId> as JSON.

const MAX_SIZE_BYTES  = 2 * 1024 * 1024; // 2 MB ≈ plenty for a 3-second clip
const MAX_LIBRARY     = 10;
const PUBLIC_URL      = "https://avatars.gokkehub.com";
const ALLOWED_TYPES: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp4":  "m4a",
  "audio/ogg":  "ogg",
  "audio/webm": "webm",
  "audio/wav":  "wav",
  "audio/x-wav": "wav",
};

export interface BuzzerLibraryEntry {
  id:    string;
  url:   string;
  name:  string;
  emoji: string;
}

const libKey = (userId: string) => `buzzer_library:${userId}`;

async function getLibrary(env: Env, userId: string): Promise<BuzzerLibraryEntry[]> {
  const raw = await env.SESSIONS.get(libKey(userId));
  if (!raw) return [];
  try { return JSON.parse(raw) as BuzzerLibraryEntry[]; } catch { return []; }
}

async function saveLibrary(env: Env, userId: string, lib: BuzzerLibraryEntry[]) {
  await env.SESSIONS.put(libKey(userId), JSON.stringify(lib));
}

async function setCurrent(env: Env, request: Request, userId: string, value: string | null) {
  const kvKey = `buzzer_sound:${userId}`;
  if (value) await env.SESSIONS.put(kvKey, value);
  else       await env.SESSIONS.delete(kvKey);
  const sessionId = getSessionId(request);
  if (sessionId) await updateSession(env.SESSIONS, sessionId, { buzzerSound: value });
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const req = request as unknown as Request;
  const { session, response } = await requireAuth(env.SESSIONS, req);
  if (response) return response;
  const library = await getLibrary(env, session!.userId);
  return Response.json({ current: session!.buzzerSound ?? null, library });
};

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const req = request as unknown as Request;
  const limited = await rateLimit(env.SESSIONS, req, {
    max: 10, windowSeconds: 60, prefix: "rl:buzzer-sound",
  });
  if (limited) return limited;

  const { session, response } = await requireAuth(env.SESSIONS, req);
  if (response) return response;
  const userId = session!.userId;

  const library = await getLibrary(env, userId);
  if (library.length >= MAX_LIBRARY) {
    return Response.json({ error: `Library is full (max ${MAX_LIBRARY} clips) — delete one first.` }, { status: 409 });
  }

  const contentType = req.headers.get("Content-Type") ?? "";
  const ext = ALLOWED_TYPES[contentType];
  if (!ext) {
    return Response.json({ error: "Unsupported audio type. Use MP3, M4A, OGG, WebM, or WAV." }, { status: 415 });
  }

  const body = await req.arrayBuffer();
  if (body.byteLength > MAX_SIZE_BYTES) {
    return Response.json({ error: "File too large. Keep it under 2 MB (~3 seconds)." }, { status: 413 });
  }

  const id  = crypto.randomUUID();
  const key = `buzzer-sounds/${userId}/${id}.${ext}`;
  await env.AVATARS.put(key, body, {
    httpMetadata:   { contentType },
    customMetadata: { userId },
  });

  const entry: BuzzerLibraryEntry = {
    id,
    url:   `${PUBLIC_URL}/${key}`,
    name:  `My sound ${library.length + 1}`,
    emoji: "🎤",
  };
  const nextLib = [...library, entry];
  await saveLibrary(env, userId, nextLib);
  await setCurrent(env, req, userId, entry.url);

  return Response.json({ buzzerSound: entry.url, entry, library: nextLib });
};

export const onRequestPatch: PagesFunction<Env> = async ({ request, env }) => {
  const req = request as unknown as Request;
  const { session, response } = await requireAuth(env.SESSIONS, req);
  if (response) return response;
  const userId = session!.userId;

  let body: {
    preset?: unknown; select?: unknown; remove?: unknown; clear?: unknown;
    update?: { id?: unknown; name?: unknown; emoji?: unknown };
  };
  try {
    body = await req.json() as typeof body;
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (body.clear === true) {
    await setCurrent(env, req, userId, null);
    return Response.json({ buzzerSound: null });
  }

  if (typeof body.preset === "string" && /^[a-z]{2,20}$/.test(body.preset)) {
    const value = `preset:${body.preset}`;
    await setCurrent(env, req, userId, value);
    return Response.json({ buzzerSound: value });
  }

  const library = await getLibrary(env, userId);

  if (typeof body.select === "string") {
    const entry = library.find(e => e.id === body.select);
    if (!entry) return Response.json({ error: "Clip not found" }, { status: 404 });
    await setCurrent(env, req, userId, entry.url);
    return Response.json({ buzzerSound: entry.url });
  }

  if (body.update && typeof body.update.id === "string") {
    const entry = library.find(e => e.id === body.update!.id);
    if (!entry) return Response.json({ error: "Clip not found" }, { status: 404 });
    if (typeof body.update.name === "string" && body.update.name.trim()) {
      entry.name = body.update.name.trim().slice(0, 30);
    }
    if (typeof body.update.emoji === "string" && body.update.emoji.trim()) {
      entry.emoji = body.update.emoji.trim().slice(0, 4);
    }
    await saveLibrary(env, userId, library);
    return Response.json({ library });
  }

  if (typeof body.remove === "string") {
    const entry = library.find(e => e.id === body.remove);
    if (!entry) return Response.json({ error: "Clip not found" }, { status: 404 });
    const nextLib = library.filter(e => e.id !== entry.id);
    await saveLibrary(env, userId, nextLib);
    // Delete the file too — the URL path after the domain is the R2 key.
    const key = new URL(entry.url).pathname.slice(1);
    await env.AVATARS.delete(key);
    // If they were using this clip, fall back to the default.
    if ((session!.buzzerSound ?? "").split("?")[0] === entry.url.split("?")[0]) {
      await setCurrent(env, req, userId, null);
    }
    return Response.json({ library: nextLib });
  }

  return Response.json({ error: "Send { preset }, { select }, { update }, { remove }, or { clear }" }, { status: 400 });
};
