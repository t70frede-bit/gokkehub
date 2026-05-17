import type { PagesFunction } from "@cloudflare/workers-types";
import { getSession, getSessionId, createSession, updateSession } from "@gokkehub/auth/session";
import { buildSessionCookie } from "@gokkehub/auth/cookie";
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

  const req = request as unknown as Request;
  const existing = await getSession(env.SESSIONS, req);

  if (existing) {
    // Already logged in (via Discord, or via a previous Spotify-primary
    // login) — just link / refresh the Spotify data on the existing session.
    const sessionId = getSessionId(req)!;
    await updateSession(env.SESSIONS, sessionId, {
      spotify:   spotifyData,
      avatarUrl: existing.avatarUrl ?? imageUrl,
    });
    // Persist refresh token under the existing user id so the Discord-
    // callback restore path can reconnect Spotify after a logout.
    await env.SESSIONS.put(
      `spotify_link:${existing.userId}`,
      JSON.stringify({
        id:           spotifyUser.id,
        refreshToken: tokens.refresh_token,
        displayName:  spotifyUser.display_name ?? null,
        scope:        tokens.scope,
      }),
    );
    return Response.redirect("https://account.gokkehub.com/profile", 302);
  }

  // ── No existing session — Spotify is the primary login ─────────────
  // Lower-friction onboarding path: a player who only wants to play the
  // music game can sign in with their existing Spotify account instead
  // of needing a Discord account too.
  //
  // userId is prefixed with "sp:" so the namespace doesn't collide with
  // Discord-primary sessions (which use the raw Discord snowflake id).
  const sessionId = await createSession(env.SESSIONS, {
    userId:      `sp:${spotifyUser.id}`,
    email:       spotifyUser.email ?? null,
    displayName: spotifyUser.display_name ?? spotifyUser.id,
    avatarUrl:   imageUrl,
    spotify:     spotifyData,
  });

  // Persist refresh token under the new sp:userId so future Spotify-
  // primary logins from the same account get the prior link state back.
  await env.SESSIONS.put(
    `spotify_link:sp:${spotifyUser.id}`,
    JSON.stringify({
      id:           spotifyUser.id,
      refreshToken: tokens.refresh_token,
      displayName:  spotifyUser.display_name ?? null,
      scope:        tokens.scope,
    }),
  );

  const cookie = buildSessionCookie(sessionId, env.COOKIE_DOMAIN);
  return new Response(null, {
    status: 302,
    headers: {
      "Set-Cookie": cookie,
      Location:     "https://account.gokkehub.com/profile",
    },
  });
};
