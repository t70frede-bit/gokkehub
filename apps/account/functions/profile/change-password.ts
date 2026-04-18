import type { PagesFunction } from "@cloudflare/workers-types";
import { createSupabaseAdminClient } from "@gokkehub/db/supabase";
import { requireAuth } from "@gokkehub/auth/session";
import { rateLimit } from "../_ratelimit";
import type { Env } from "../_env";

// POST /profile/change-password — update password for a logged-in user
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const limited = await rateLimit(env.SESSIONS, request as unknown as Request, {
    max: 5,
    windowSeconds: 300,
    prefix: "rl:change-password",
  });
  if (limited) return limited;

  const { session, response } = await requireAuth(
    env.SESSIONS,
    request as unknown as Request
  );
  if (response) return response;

  let password: string;
  try {
    const body = await request.json<{ password?: unknown }>();
    password = typeof body.password === "string" ? body.password : "";
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!password || password.length < 8) {
    return Response.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const { error } = await supabase.auth.admin.updateUserById(session!.userId, { password });

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return new Response(null, { status: 204 });
};
