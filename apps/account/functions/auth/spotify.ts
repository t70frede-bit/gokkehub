import type { PagesFunction } from "@cloudflare/workers-types";
import { requireAuth } from "@gokkehub/auth/session";
import { unlinkProvider } from "../_accounts";
import { beginOAuth } from "@gokkehub/auth/oauth-state";
import { rateLimit } from "../_ratelimit";
import type { Env } from "../_env";

// GET /auth/spotify — redirect to Spotify OAuth
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.SPOTIFY_CLIENT_ID) {
    return new Response("SPOTIFY_CLIENT_ID is not configured on this server.", { status: 500 });
  }

  // 20 OAuth initiations per minute per IP
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
    client_id: env.SPOTIFY_CLIENT_ID,
    redirect_uri: `https://account.gokkehub.com/auth/spotify/callback`,
    response_type: "code",
    // user-top-read enables /me/top/{artists,tracks} for the spotify-taste
    // curation source. user-read-recently-played reserved for future use
    // (not currently called). Without user-top-read the new spotify-taste
    // mode silently produces an empty profile (Spotify 403s the request
    // and our fetcher returns []).
    scope: "user-read-email user-read-private user-modify-playback-state user-read-playback-state streaming playlist-read-private playlist-read-collaborative user-top-read user-read-recently-played",
    show_dialog: "true",
    state,
  });

  return new Response(null, {
    status: 302,
    headers: {
      Location:     `https://accounts.spotify.com/authorize?${params.toString()}`,
      "Set-Cookie": cookie,
    },
  });
};

// DELETE /auth/spotify — disconnect Spotify from account
export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  const req = request as unknown as Request;
  const { session, response } = await requireAuth(env.SESSIONS, req);
  if (response) return response;
  return unlinkProvider(env, req, session!, "spotify");
};
