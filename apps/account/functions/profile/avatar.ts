import type { PagesFunction } from "@cloudflare/workers-types";
import { requireAuth, updateSession, getSessionId } from "@gokkehub/auth/session";
import { rateLimit } from "../_ratelimit";
import type { Env } from "../_env";

const MAX_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const PUBLIC_URL = "https://avatars.gokkehub.com";

// PUT /profile/avatar — upload a new avatar
export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const limited = await rateLimit(env.SESSIONS, request as unknown as Request, {
    max: 10,
    windowSeconds: 60,
    prefix: "rl:avatar",
  });
  if (limited) return limited;

  const { session, response } = await requireAuth(
    env.SESSIONS,
    request as unknown as Request
  );
  if (response) return response;

  const contentType = request.headers.get("Content-Type") ?? "";
  if (!ALLOWED_TYPES.includes(contentType)) {
    return Response.json(
      { error: "Unsupported file type. Use JPEG, PNG, WebP, or GIF." },
      { status: 415 }
    );
  }

  const contentLength = Number(request.headers.get("Content-Length") ?? 0);
  if (contentLength > MAX_SIZE_BYTES) {
    return Response.json({ error: "File too large. Maximum size is 2 MB." }, { status: 413 });
  }

  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_SIZE_BYTES) {
    return Response.json({ error: "File too large. Maximum size is 2 MB." }, { status: 413 });
  }

  const ext = contentType.split("/")[1].replace("jpeg", "jpg");
  const key = `avatars/${session!.userId}.${ext}`;

  await env.AVATARS.put(key, body, {
    httpMetadata: { contentType },
    customMetadata: { userId: session!.userId },
  });

  const avatarUrl = `${PUBLIC_URL}/${key}`;

  // Persist the new URL in the session so /auth/me returns it immediately
  const sessionId = getSessionId(request as unknown as Request);
  if (sessionId) {
    await updateSession(env.SESSIONS, sessionId, { avatarUrl });
  }

  return Response.json({ avatarUrl });
};

// DELETE /profile/avatar — remove avatar, fall back to initials
export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireAuth(
    env.SESSIONS,
    request as unknown as Request
  );
  if (response) return response;

  // Delete all known extensions for this user
  for (const ext of ["jpg", "png", "webp", "gif"]) {
    await env.AVATARS.delete(`avatars/${session!.userId}.${ext}`);
  }

  const sessionId = getSessionId(request as unknown as Request);
  if (sessionId) {
    await updateSession(env.SESSIONS, sessionId, { avatarUrl: null });
  }

  return new Response(null, { status: 204 });
};
