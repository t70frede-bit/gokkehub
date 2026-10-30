import type { PagesFunction } from "@cloudflare/workers-types";
import { requireAuth } from "@gokkehub/auth/session";
import { saveProfile } from "../_accounts";
import { rateLimit } from "../_ratelimit";
import type { Env } from "../_env";

// PATCH /profile/update — update display name or email (stored in gh_users)
export const onRequestPatch: PagesFunction<Env> = async ({ request, env }) => {
  const limited = await rateLimit(env.SESSIONS, request as unknown as Request, {
    max: 10,
    windowSeconds: 60,
    prefix: "rl:profile-update",
  });
  if (limited) return limited;

  const { session, response } = await requireAuth(
    env.SESSIONS,
    request as unknown as Request
  );
  if (response) return response;

  let body: { displayName?: unknown; email?: unknown };
  try {
    body = (await (request as unknown as Request).json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const fields: { display_name?: string; email?: string } = {};

  if (typeof body.displayName === "string") {
    const displayName = body.displayName.trim();
    if (!displayName || displayName.length > 32) {
      return Response.json({ error: "Display name must be 1–32 characters" }, { status: 400 });
    }
    fields.display_name = displayName;
  }

  if (typeof body.email === "string") {
    const email = body.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return Response.json({ error: "Invalid email address" }, { status: 400 });
    }
    // Contact address only — sign-in never matches on email, so an
    // unverified address can't be used to take over another account.
    fields.email = email;
  }

  if (Object.keys(fields).length > 0) {
    await saveProfile(env, request as unknown as Request, session!, fields);
  }

  return Response.json({ ok: true });
};
