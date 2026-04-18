import type { PagesFunction } from "@cloudflare/workers-types";
import { createSupabaseClient } from "@gokkehub/db/supabase";
import { createSession } from "@gokkehub/auth/session";
import { buildSessionCookie } from "@gokkehub/auth/cookie";
import { rateLimit } from "../_ratelimit";
import type { Env } from "../_env";

// POST /auth/register — create a new email/password account
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  // 3 registrations per 10 minutes per IP
  const limited = await rateLimit(env.SESSIONS, request as unknown as Request, {
    max: 3,
    windowSeconds: 600,
    prefix: "rl:register",
  });
  if (limited) return limited;

  let email: string, password: string, displayName: string;
  try {
    const body = await request.json<{ email?: unknown; password?: unknown; displayName?: unknown }>();
    email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    password = typeof body.password === "string" ? body.password : "";
    displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!email || !password) {
    return Response.json({ error: "Email and password are required" }, { status: 400 });
  }
  if (password.length < 8) {
    return Response.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }
  if (displayName.length > 32) {
    return Response.json({ error: "Display name must be 32 characters or fewer" }, { status: 400 });
  }

  const supabase = createSupabaseClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        display_name: displayName || email.split("@")[0],
      },
      emailRedirectTo: "https://account.gokkehub.com/profile",
    },
  });

  if (error) {
    // Supabase returns a generic error for duplicate emails to prevent enumeration;
    // surface it as-is so the user knows to sign in instead.
    return Response.json({ error: error.message }, { status: 400 });
  }

  if (!data.session) {
    // Email confirmation is enabled in Supabase — user must confirm before logging in.
    return Response.json(
      { confirm: true, message: "Check your email for a confirmation link." },
      { status: 200 }
    );
  }

  // Email confirmation is disabled — session is immediately available.
  const { user } = data;
  const name = displayName || user!.user_metadata?.display_name || email.split("@")[0];

  const sessionId = await createSession(env.SESSIONS, {
    userId: user!.id,
    email: user!.email ?? email,
    displayName: name,
    avatarUrl: null,
  });

  const cookie = buildSessionCookie(sessionId, env.COOKIE_DOMAIN);

  return new Response(null, {
    status: 204,
    headers: { "Set-Cookie": cookie },
  });
};
