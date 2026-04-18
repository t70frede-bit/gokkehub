import type { PagesFunction } from "@cloudflare/workers-types";
import { createSupabaseClient } from "@gokkehub/db/supabase";
import { createSession } from "@gokkehub/auth/session";
import { buildSessionCookie } from "@gokkehub/auth/cookie";
import type { Env } from "../_env";

// POST /auth/confirm
// Called client-side after Supabase redirects the user back with
// #access_token=...&type=signup in the URL hash.
// Verifies the token with Supabase, creates a GokkeHub KV session, sets cookie.
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let accessToken: string;
  try {
    const body = await request.json<{ accessToken?: unknown }>();
    accessToken = typeof body.accessToken === "string" ? body.accessToken.trim() : "";
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!accessToken) {
    return Response.json({ error: "Missing access token" }, { status: 400 });
  }

  const supabase = createSupabaseClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);

  // Verify the token and get the confirmed user
  const { data: { user }, error } = await supabase.auth.getUser(accessToken);

  if (error || !user) {
    return Response.json({ error: "Invalid or expired confirmation link" }, { status: 401 });
  }

  const sessionId = await createSession(env.SESSIONS, {
    userId: user.id,
    email: user.email ?? null,
    displayName: user.user_metadata?.display_name ?? user.email?.split("@")[0] ?? "Player",
    avatarUrl: user.user_metadata?.avatar_url ?? null,
  });

  const cookie = buildSessionCookie(sessionId, env.COOKIE_DOMAIN);

  return new Response(null, {
    status: 204,
    headers: { "Set-Cookie": cookie },
  });
};
