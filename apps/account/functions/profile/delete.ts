import type { PagesFunction } from "@cloudflare/workers-types";
import { createSupabaseAdminClient } from "@gokkehub/db/supabase";
import { requireAuth, deleteSession, getSessionId } from "@gokkehub/auth/session";
import { clearSessionCookie } from "@gokkehub/auth/cookie";
import type { Env } from "../_env";

// DELETE /profile/delete — permanently delete account
export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireAuth(
    env.SESSIONS,
    request as unknown as Request
  );
  if (response) return response;

  const supabase = createSupabaseAdminClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  // Delete from Supabase auth — cascades to all user data
  const { error } = await supabase.auth.admin.deleteUser(session!.userId);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  // Delete KV session
  const sessionId = getSessionId(request as unknown as Request);
  if (sessionId) await deleteSession(env.SESSIONS, sessionId);

  const cookie = clearSessionCookie(env.COOKIE_DOMAIN);

  return new Response(null, {
    status: 204,
    headers: { "Set-Cookie": cookie },
  });
};
