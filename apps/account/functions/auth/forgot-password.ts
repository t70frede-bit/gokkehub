import type { PagesFunction } from "@cloudflare/workers-types";
import { createSupabaseClient } from "@gokkehub/db/supabase";
import type { Env } from "../_env";

// POST /auth/forgot-password
// Sends a Supabase password-recovery email. The link in the email redirects
// back to account.gokkehub.com/login where App.tsx picks up the #access_token
// hash and stores it in sessionStorage before forwarding to /reset-password.
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let email: string;
  try {
    const body = await request.json<{ email?: unknown }>();
    email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json({ error: "Enter a valid email address" }, { status: 400 });
  }

  const supabase = createSupabaseClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);

  // redirectTo is where Supabase appends #access_token=...&type=recovery
  // App.tsx on that page handles the fragment and routes to /reset-password.
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `https://account.gokkehub.com/login`,
  });

  if (error) {
    // Don't leak whether the email exists — return success regardless
    console.error("resetPasswordForEmail error:", error.message);
  }

  // Always 204 — don't confirm whether the address is registered
  return new Response(null, { status: 204 });
};
