import type { PagesFunction } from "@cloudflare/workers-types";
import { getSession } from "@gokkehub/auth/session";
import type { Env } from "./_env";
import { json, handlePreflight } from "./_cors";
import { refreshSpotifyToken } from "./_supabase";
import { parseSessionId } from "@gokkehub/auth/cookie";

async function spotifyGet(url: string, token: string): Promise<{ status: number; body: unknown }> {
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const text = await res.text();
    let body: unknown;
    try { body = JSON.parse(text); } catch { body = text; }
    return { status: res.status, body };
  } catch (e) {
    return { status: -1, body: String(e) };
  }
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  const pre = handlePreflight(request as unknown as Request);
  if (pre) return pre;

  const req = request as unknown as Request;

  try {
    const session = await getSession(env.SESSIONS, req);
    if (!session) return json({ error: "No session" }, 401, req);
    if (!session.spotify) return json({ error: "No Spotify connected" }, 200, req);

    const { expiresAt, refreshToken } = session.spotify;
    let { accessToken } = session.spotify;
    let refreshed = false;
    let refreshError: string | null = null;

    if (Date.now() > expiresAt - 60_000) {
      try {
        const r = await refreshSpotifyToken(env, refreshToken);
        accessToken = r.access_token;
        refreshed = true;
        const sid = parseSessionId(req.headers.get("Cookie"));
        if (sid) {
          await env.SESSIONS.put(
            sid,
            JSON.stringify({ ...session, spotify: { ...session.spotify, accessToken, expiresAt: Date.now() + r.expires_in * 1000 } }),
            { expirationTtl: 604800 }
          );
        }
      } catch (e) {
        refreshError = e instanceof Error ? e.message : String(e);
      }
    }

    const queryId = new URL(req.url).searchParams.get("playlist");
    const token   = accessToken;
    const spotId  = session.spotify.id;

    const me            = await spotifyGet("https://api.spotify.com/v1/me", token);
    const myPlaylists   = await spotifyGet("https://api.spotify.com/v1/me/playlists?limit=10", token);

    const plItems = (myPlaylists.body as { items?: Array<{ id: string; name: string; owner: { id: string }; tracks: { total: number } }> })?.items ?? [];
    const ownedFirst = plItems.find(p => p.owner.id === spotId) ?? plItems[0] ?? null;

    const testId = queryId ?? ownedFirst?.id ?? null;
    let metaResult: { status: number; body: unknown } | null = null;
    let itemsResult: { status: number; body: unknown } | null = null;

    if (testId) {
      metaResult  = await spotifyGet(`https://api.spotify.com/v1/playlists/${testId}?fields=name,owner,public`, token);
      itemsResult = await spotifyGet(`https://api.spotify.com/v1/playlists/${testId}/items?limit=1&market=from_token`, token);
    }

    return json({
      spotify_id:    spotId,
      stored_scope:  session.spotify.scope ?? "(not stored)",
      token_age_s:   Math.round((expiresAt - Date.now()) / 1000),
      refreshed,
      refresh_error: refreshError,
      me_status:     me.status,
      my_playlists_status: myPlaylists.status,
      my_playlists: plItems.map(p => ({ id: p.id, name: p.name, owner: p.owner.id, tracks: p.tracks.total })),
      tested_id:     testId,
      meta:          metaResult,
      items:         itemsResult,
      hint:          queryId ? null : "Append ?playlist=<id> to test a specific playlist",
    }, 200, req);

  } catch (e) {
    return json({ crashed: true, error: e instanceof Error ? e.message : String(e) }, 500, req);
  }
};
