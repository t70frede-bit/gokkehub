import type { PagesFunction } from "@cloudflare/workers-types";
import { createSupabaseClient } from "@gokkehub/db/supabase";
import { requireAuth } from "@gokkehub/auth/session";
import { rateLimit } from "../_ratelimit";
import type { Env } from "../_env";

// POST /profile/password-reset — send password reset email to the logged-in user
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const limited = await rateLimit(env.SESSIONS, request as unknown as Request, {
    max: 3,
    windowSeconds: 300,
    prefix: "rl:password-reset",
  });
  if (limited) return limited;

  const { session, response } = await requireAuth(
    env.SESSIONS,
    request as unknown as Request
  );
  if (response) return response;

  if (!session!.email) {
    return Response.json({ error: "No email address on this account" }, { status: 400 });
  }

  const supabase = createSupabaseClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);
  const { error } = await supabase.auth.resetPasswordForEmail(session!.email, {
    redirectTo: "https://account.gokkehub.com/profile",
  });

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ message: "Password reset email sent" });
};
