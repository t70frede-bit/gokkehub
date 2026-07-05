import type { PagesFunction } from "@cloudflare/workers-types";
import {
  getSession,
  getSessionId,
  createSession,
  updateSession,
} from "@gokkehub/auth/session";
import { buildSessionCookie } from "@gokkehub/auth/cookie";
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

  // If already logged in, link the Discord account to the existing session
  const req = request as unknown as Request;
  const existing = await getSession(env.SESSIONS, req);

  if (existing) {
    const sessionId = getSessionId(req)!;
    await updateSession(env.SESSIONS, sessionId, {
      discord: discordData,
      avatarUrl: existing.avatarUrl ?? avatarUrl,
    });
    return Response.redirect("https://account.gokkehub.com/profile", 302);
  }

  // New session — Discord is the primary login
  const sessionId = await createSession(env.SESSIONS, {
    userId: discordUser.id,
    email: discordUser.email ?? `${discordUser.id}@discord`,
    displayName: discordUser.username,
    avatarUrl,
    discord: discordData,
  });

  // Restore the buzzer sound chosen before logging out
  const storedBuzzer = await env.SESSIONS.get(`buzzer_sound:${discordUser.id}`);
  if (storedBuzzer) {
    await updateSession(env.SESSIONS, sessionId, { buzzerSound: storedBuzzer });
  }

  // Restore Last.fm connection if the user had it linked before logging out
  const storedLastfm = await env.SESSIONS.get(`lastfm_link:${discordUser.id}`);
  if (storedLastfm) {
    await updateSession(env.SESSIONS, sessionId, {
      lastfm: { username: storedLastfm, linkedAt: Date.now() },
    });
  }

  // Restore Spotify connection if the user had it linked before logging out
  const storedSpotifyRaw = await env.SESSIONS.get(`spotify_link:${discordUser.id}`);
  if (storedSpotifyRaw) {
    try {
      const stored = JSON.parse(storedSpotifyRaw) as {
        id: string; refreshToken: string; displayName: string | null; scope: string;
      };
      const refreshRes = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Authorization": `Basic ${btoa(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`)}`,
        },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: stored.refreshToken }),
      });
      if (refreshRes.ok) {
        const refreshed = await refreshRes.json<{ access_token: string; expires_in: number }>();
        await updateSession(env.SESSIONS, sessionId, {
          spotify: {
            id: stored.id,
            accessToken: refreshed.access_token,
            refreshToken: stored.refreshToken,
            expiresAt: Date.now() + refreshed.expires_in * 1000,
            displayName: stored.displayName,
            scope: stored.scope,
          },
        });
      }
    } catch {
      // Silently skip — user can reconnect Spotify manually if needed
    }
  }

  const cookie = buildSessionCookie(sessionId, env.COOKIE_DOMAIN);

  return new Response(null, {
    status: 302,
    headers: {
      "Set-Cookie": cookie,
      Location: "https://account.gokkehub.com/profile",
    },
  });
};
