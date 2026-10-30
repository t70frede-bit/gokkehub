import type { PagesFunction } from "@cloudflare/workers-types";
import { requireAuth } from "@gokkehub/auth/session";
import { beginOAuth } from "@gokkehub/auth/oauth-state";
import { unlinkProvider } from "../_accounts";
import { rateLimit } from "../_ratelimit";
import type { Env } from "../_env";

// GET /auth/google — redirect to Google sign-in (OpenID Connect)
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.GOOGLE_CLIENT_ID) {
    return Response.redirect("https://account.gokkehub.com/login?error=google_unconfigured", 302);
  }

  const limited = await rateLimit(env.SESSIONS, request as unknown as Request, {
    max: 20,
    windowSeconds: 60,
    prefix: "rl:oauth",
  });
  if (limited) return limited;

  // `state` ties the callback to this browser (login CSRF) and carries the
  // page to return to after login.
  const returnTo = new URL(request.url).searchParams.get("redirect");
  const { state, cookie } = await beginOAuth(env.SESSIONS, returnTo);

  const params = new URLSearchParams({
    client_id:     env.GOOGLE_CLIENT_ID,
    redirect_uri:  "https://account.gokkehub.com/auth/google/callback",
    response_type: "code",
    scope:         "openid email profile",
    prompt:        "select_account",
    state,
  });

  return new Response(null, {
    status: 302,
    headers: {
      Location:     `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
      "Set-Cookie": cookie,
    },
  });
};

// DELETE /auth/google — unlink Google from the account
export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  const req = request as unknown as Request;
  const { session, response } = await requireAuth(env.SESSIONS, req);
  if (response) return response;
  return unlinkProvider(env, req, session!, "google");
};
