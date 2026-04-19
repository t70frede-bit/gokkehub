import type { PagesFunction } from "@cloudflare/workers-types";
import { requireAuth, updateSession, getSessionId } from "@gokkehub/auth/session";
import { rateLimit } from "../_ratelimit";
import type { Env } from "../_env";

// PATCH /profile/steam-id — save (or clear) the user's Steam ID
export const onRequestPatch: PagesFunction<Env> = async ({ request, env }) => {
  const limited = await rateLimit(env.SESSIONS, request as unknown as Request, {
    max: 10,
    windowSeconds: 60,
    prefix: "rl:profile-steam-id",
  });
  if (limited) return limited;

  const { session, response } = await requireAuth(
    env.SESSIONS,
    request as unknown as Request
  );
  if (response) return response;

  let body: { steamId?: unknown };
  try {
    body = (await (request as unknown as Request).json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const raw = typeof body.steamId === "string" ? body.steamId.trim() : null;

  // Accept a 17-digit Steam ID, a vanity URL, or a full profile URL — store as-is
  // (the /steam/games function handles resolution on fetch)
  if (raw !== null && raw.length > 200) {
    return Response.json({ error: "Steam ID too long" }, { status: 400 });
  }

  const sessionId = getSessionId(request as unknown as Request)!;
  await updateSession(env.SESSIONS, sessionId, { steamId: raw || null });

  return Response.json({ ok: true, steamId: raw || null });
};
