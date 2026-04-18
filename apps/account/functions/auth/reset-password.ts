import type { PagesFunction } from "@cloudflare/workers-types";
import { createSupabaseClient, createSupabaseAdminClient } from "@gokkehub/db/supabase";
import { createSession } from "@gokkehub/auth/session";
import { buildSessionCookie } from "@gokkehub/auth/cookie";
import type { Env } from "../_env";

// POST /auth/reset-password
// Called from the ResetPasswordPage after the user lands via a recovery email link.
// Verifies the Supabase recovery token, updates the password, and creates a KV session.
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let accessToken: string, password: string;
  try {
    const body = await request.json<{ accessToken?: unknown; password?: unknown }>();
    accessToken = typeof body.accessToken === "string" ? body.accessToken.trim() : "";
    password   = typeof body.password === "string" ? body.password : "";
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!accessToken || !password) {
    return Response.json({ error: "Missing fields" }, { status: 400 });
  }
  if (password.length < 8) {
    return Response.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }

  // Verify the recovery token
  const supabase = createSupabaseClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);
  const { data: { user }, error: userError } = await supabase.auth.getUser(accessToken);

  if (userError || !user) {
    return Response.json({ error: "Invalid or expired reset link" }, { status: 401 });
  }

  // Update password via admin API
  const admin = createSupabaseAdminClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const { error: updateError } = await admin.auth.admin.updateUserById(user.id, { password });

  if (updateError) {
    return Response.json({ error: updateError.message }, { status: 500 });
  }

  // Auto-login: create a KV session so the user lands on their profile
  const sessionId = await createSession(env.SESSIONS, {
    userId:      user.id,
    email:       user.email ?? null,
    displayName: user.user_metadata?.display_name ?? user.email?.split("@")[0] ?? "Player",
    avatarUrl:   user.user_metadata?.avatar_url ?? null,
  });

  const cookie = buildSessionCookie(sessionId, env.COOKIE_DOMAIN);

  return new Response(null, {
    status: 204,
    headers: { "Set-Cookie": cookie },
  });
};
