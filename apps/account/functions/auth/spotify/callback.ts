import type { PagesFunction } from "@cloudflare/workers-types";
import { requireAuth, getSessionId, updateSession } from "@gokkehub/auth/session";
import type { Env } from "../../_env";

const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_USER_URL = "https://api.spotify.com/v1/me";
const REDIRECT_URI = "https://account.gokkehub.com/auth/spotify/callback";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error || !code) {
    return Response.redirect("https://account.gokkehub.com/profile?error=spotify_denied", 302);
  }

  const req = request as unknown as Request;

  // Must be logged in to link Spotify
  const { session, response } = await requireAuth(env.SESSIONS, req);
  if (response) {
    return Response.redirect("https://account.gokkehub.com/login", 302);
  }

  // Exchange code for tokens
  const credentials = btoa(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`);
  const tokenRes = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${credentials}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
    }),
  });

  if (!tokenRes.ok) {
    return Response.redirect("https://account.gokkehub.com/profile?error=spotify_token", 302);
  }

  const tokens = await tokenRes.json<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
    scope: string;
  }>();

  // Fetch Spotify user
  const userRes = await fetch(SPOTIFY_USER_URL, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  if (!userRes.ok) {
    return Response.redirect("https://account.gokkehub.com/profile?error=spotify_user", 302);
  }

  const spotifyUser = await userRes.json<{
    id: string;
    display_name?: string;
    images?: Array<{ url: string }>;
  }>();

  const imageUrl = spotifyUser.images?.[0]?.url ?? null;

  const sessionId = getSessionId(req)!;
  await updateSession(env.SESSIONS, sessionId, {
    spotify: {
      id: spotifyUser.id,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + tokens.expires_in * 1000,
      displayName: spotifyUser.display_name ?? null,
      imageUrl,
      scope: tokens.scope,
    },
    avatarUrl: session.avatarUrl ?? imageUrl,
  });

  // Persist refresh token under user ID so it survives logout/re-login
  await env.SESSIONS.put(
    `spotify_link:${session.userId}`,
    JSON.stringify({
      id: spotifyUser.id,
      refreshToken: tokens.refresh_token,
      displayName: spotifyUser.display_name ?? null,
      scope: tokens.scope,
    }),
  );

  return Response.redirect("https://account.gokkehub.com/profile", 302);
};
