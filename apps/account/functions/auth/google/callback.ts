import type { PagesFunction } from "@cloudflare/workers-types";
import { finishOAuth, clearOAuthStateCookie } from "@gokkehub/auth/oauth-state";
import { completeLogin, IdentityTakenError } from "../../_accounts";
import type { Env } from "../../_env";

const GOOGLE_TOKEN_URL    = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const REDIRECT_URI        = "https://account.gokkehub.com/auth/google/callback";
const LOGIN               = "https://account.gokkehub.com/login";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const code  = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error || !code) {
    return Response.redirect(`${LOGIN}?error=google_denied`, 302);
  }

  // Reject callbacks this browser didn't start (login CSRF), and pick up
  // where to send the player afterwards.
  const oauth = await finishOAuth(env.SESSIONS, request as unknown as Request);
  if (!oauth.ok) {
    return Response.redirect(`${LOGIN}?error=oauth_state`, 302);
  }
  const done = (extraCookie?: string) => {
    const headers = new Headers({ Location: oauth.returnTo ?? "https://account.gokkehub.com/profile" });
    headers.append("Set-Cookie", clearOAuthStateCookie());
    if (extraCookie) headers.append("Set-Cookie", extraCookie);
    return new Response(null, { status: 302, headers });
  };

  // Exchange code for tokens (server-to-server, so the userinfo endpoint can
  // be trusted without verifying the id_token signature ourselves).
  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id:     env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      grant_type:    "authorization_code",
      code,
      redirect_uri:  REDIRECT_URI,
    }),
  });
  if (!tokenRes.ok) {
    return Response.redirect(`${LOGIN}?error=google_token`, 302);
  }
  const tokens = await tokenRes.json<{ access_token: string }>();

  const userRes = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!userRes.ok) {
    return Response.redirect(`${LOGIN}?error=google_user`, 302);
  }
  const googleUser = await userRes.json<{
    sub:             string;
    email?:          string;
    email_verified?: boolean;
    name?:           string;
    given_name?:     string;
    picture?:        string;
  }>();

  try {
    const cookie = await completeLogin(env, request as unknown as Request, {
      provider:       "google",
      providerUserId: googleUser.sub,
      displayName:    googleUser.given_name ?? googleUser.name ?? null,
      avatarUrl:      googleUser.picture ?? null,
      email:          googleUser.email_verified ? googleUser.email ?? null : null,
    }, {});
    return done(cookie ?? undefined);
  } catch (err) {
    if (err instanceof IdentityTakenError) {
      return Response.redirect("https://account.gokkehub.com/profile?error=google_taken", 302);
    }
    console.error("[google] login failed", err);
    return Response.redirect(`${LOGIN}?error=google_unavailable`, 302);
  }
};
