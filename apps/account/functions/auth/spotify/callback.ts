import type { PagesFunction } from "@cloudflare/workers-types";
import { finishOAuth, clearOAuthStateCookie } from "@gokkehub/auth/oauth-state";
import { completeLogin, IdentityTakenError } from "../../_accounts";
import type { Env } from "../../_env";

const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_USER_URL  = "https://api.spotify.com/v1/me";
const REDIRECT_URI      = "https://account.gokkehub.com/auth/spotify/callback";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const code  = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error || !code) {
    // Old behaviour redirected to /profile?error=, but Spotify can now be
    // the primary login — if there's no existing session, /profile would
    // 401. Redirect to /login in that case.
    return Response.redirect("https://account.gokkehub.com/login?error=spotify_denied", 302);
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
  const credentials = btoa(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`);
  const tokenRes = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization:  `Basic ${credentials}`,
    },
    body: new URLSearchParams({
      grant_type:   "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
    }),
  });
  if (!tokenRes.ok) {
    return Response.redirect("https://account.gokkehub.com/login?error=spotify_token", 302);
  }
  const tokens = await tokenRes.json<{
    access_token:  string;
    refresh_token: string;
    expires_in:    number;
    scope:         string;
  }>();

  // Fetch Spotify user
  const userRes = await fetch(SPOTIFY_USER_URL, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!userRes.ok) {
    return Response.redirect("https://account.gokkehub.com/login?error=spotify_user", 302);
  }
  const spotifyUser = await userRes.json<{
    id:            string;
    email?:        string;
    display_name?: string;
    images?:       Array<{ url: string }>;
  }>();
  const imageUrl = spotifyUser.images?.[0]?.url ?? null;

  const spotifyData = {
    id:           spotifyUser.id,
    accessToken:  tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt:    Date.now() + tokens.expires_in * 1000,
    displayName:  spotifyUser.display_name ?? null,
    imageUrl,
    scope:        tokens.scope,
  };

  // Signed in already → link Spotify to that account. Otherwise Spotify is
  // the sign-in method (only allowlisted accounts while the Spotify app is in
  // development mode); a first sign-up gets the user id "sp:<spotify id>".
  try {
    const cookie = await completeLogin(env, request as unknown as Request, {
      provider:       "spotify",
      providerUserId: spotifyUser.id,
      displayName:    spotifyUser.display_name ?? spotifyUser.id,
      avatarUrl:      imageUrl,
      email:          spotifyUser.email ?? null,
      refreshToken:   tokens.refresh_token,
      scope:          tokens.scope,
    }, { spotify: spotifyData });
    return done(cookie ?? undefined);
  } catch (err) {
    if (err instanceof IdentityTakenError) {
      return Response.redirect("https://account.gokkehub.com/profile?error=spotify_taken", 302);
    }
    throw err;
  }
};
