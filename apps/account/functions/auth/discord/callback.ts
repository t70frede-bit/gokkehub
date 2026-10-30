import type { PagesFunction } from "@cloudflare/workers-types";
import { finishOAuth, clearOAuthStateCookie } from "@gokkehub/auth/oauth-state";
import { completeLogin, IdentityTakenError } from "../../_accounts";
import type { Env } from "../../_env";

const DISCORD_TOKEN_URL = "https://discord.com/api/oauth2/token";
const DISCORD_USER_URL = "https://discord.com/api/users/@me";
const REDIRECT_URI = "https://account.gokkehub.com/auth/discord/callback";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error || !code) {
    return Response.redirect("https://account.gokkehub.com/login?error=discord_denied", 302);
  }

  // Reject callbacks this browser didn't start (login CSRF), and pick up
  // where to send the player afterwards.
  const oauth = await finishOAuth(env.SESSIONS, request as unknown as Request);
  if (!oauth.ok) {
    return Response.redirect("https://account.gokkehub.com/login?error=oauth_state", 302);
  }
  const done = (extraCookie?: string) => {
    const headers = new Headers({ Location: oauth.returnTo ?? "https://account.gokkehub.com/profile" });
    headers.append("Set-Cookie", clearOAuthStateCookie());
    if (extraCookie) headers.append("Set-Cookie", extraCookie);
    return new Response(null, { status: 302, headers });
  };

  // Exchange code for tokens
  const tokenRes = await fetch(DISCORD_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.DISCORD_CLIENT_ID,
      client_secret: env.DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
    }),
  });

  if (!tokenRes.ok) {
    return Response.redirect("https://account.gokkehub.com/login?error=discord_token", 302);
  }

  const tokens = await tokenRes.json<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
  }>();

  // Fetch Discord user
  const userRes = await fetch(DISCORD_USER_URL, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  if (!userRes.ok) {
    return Response.redirect("https://account.gokkehub.com/login?error=discord_user", 302);
  }

  const discordUser = await userRes.json<{
    id: string;
    username: string;
    email?: string;
    avatar?: string;
  }>();

  const avatarUrl = discordUser.avatar
    ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`
    : null;

  const discordData = {
    id: discordUser.id,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
    username: discordUser.username,
    avatarUrl,
  };

  try {
    const cookie = await completeLogin(env, request as unknown as Request, {
      provider:       "discord",
      providerUserId: discordUser.id,
      displayName:    discordUser.username,
      avatarUrl,
      email:          discordUser.email ?? null,
    }, { discord: discordData });
    return done(cookie ?? undefined);
  } catch (err) {
    if (err instanceof IdentityTakenError) {
      return Response.redirect("https://account.gokkehub.com/profile?error=discord_taken", 302);
    }
    throw err;
  }
};
