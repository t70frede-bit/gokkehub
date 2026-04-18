import type { PagesFunction } from "@cloudflare/workers-types";
import { createSupabaseAdminClient } from "@gokkehub/db/supabase";
import { requireAuth, updateSession, getSessionId } from "@gokkehub/auth/session";
import { rateLimit } from "../_ratelimit";
import type { Env } from "../_env";

// PATCH /profile/update — update display name or request email change
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

  const supabase = createSupabaseAdminClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const sessionId = getSessionId(request as unknown as Request)!;
  const updates: Record<string, unknown> = {};

  if (typeof body.displayName === "string") {
    const displayName = body.displayName.trim();
    if (!displayName || displayName.length > 32) {
      return Response.json({ error: "Display name must be 1–32 characters" }, { status: 400 });
    }

    const { error } = await supabase.auth.admin.updateUserById(session!.userId, {
      user_metadata: { display_name: displayName },
    });
    if (error) return Response.json({ error: error.message }, { status: 500 });

    updates.displayName = displayName;
  }

  if (typeof body.email === "string") {
    const email = body.email.trim().toLowerCase();
    if (!email.includes("@")) {
      return Response.json({ error: "Invalid email address" }, { status: 400 });
    }

    // Supabase sends a confirmation email to the new address before changing it
    const { error } = await supabase.auth.admin.updateUserById(session!.userId, { email });
    if (error) return Response.json({ error: error.message }, { status: 500 });

    // Don't update session email yet — it changes after confirmation
    return Response.json({ message: "Confirmation email sent to new address" });
  }

  if (Object.keys(updates).length > 0) {
    await updateSession(env.SESSIONS, sessionId, updates as Parameters<typeof updateSession>[2]);
  }

  return Response.json({ ok: true });
};
