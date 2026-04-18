import type { PagesFunction } from "@cloudflare/workers-types";
import { createSupabaseClient } from "@gokkehub/db/supabase";
import { createSession } from "@gokkehub/auth/session";
import { buildSessionCookie } from "@gokkehub/auth/cookie";
import { rateLimit } from "../_ratelimit";
import type { Env } from "../_env";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  // 5 login attempts per minute per IP
  const limited = await rateLimit(env.SESSIONS, request as unknown as Request, {
    max: 5,
    windowSeconds: 60,
    prefix: "rl:login",
  });
  if (limited) return limited;
  let email: string, password: string;
  try {
    const body = await request.json<{ email?: unknown; password?: unknown }>();
    email = typeof body.email === "string" ? body.email.trim() : "";
    password = typeof body.password === "string" ? body.password : "";
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!email || !password) {
    return Response.json({ error: "Email and password are required" }, { status: 400 });
  }

  const supabase = createSupabaseClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.user || !data.session) {
    return Response.json({ error: "Invalid email or password" }, { status: 401 });
  }

  const { user } = data;

  const sessionId = await createSession(env.SESSIONS, {
    userId: user.id,
    email: user.email ?? email,
    displayName: user.user_metadata?.display_name ?? user.email?.split("@")[0] ?? "Player",
    avatarUrl: user.user_metadata?.avatar_url ?? null,
  });

  const cookie = buildSessionCookie(sessionId, env.COOKIE_DOMAIN);

  return new Response(null, {
    status: 204,
    headers: { "Set-Cookie": cookie },
  });
};
