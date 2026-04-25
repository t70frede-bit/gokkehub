import type { PagesFunction } from "@cloudflare/workers-types";
import { getSession } from "@gokkehub/auth/session";
import type { Env } from "../../_env";
import { json, handlePreflight } from "../../_cors";
import { getRoom, updateRoom, fetchPlaylistTracks } from "../../_supabase";
import type { AddPlaylistResponse } from "../../../src/lib/types";

export const onRequest: PagesFunction<Env> = async ({ request, params, env }) => {
  const pre = handlePreflight(request as unknown as Request);
  if (pre) return pre;
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const req    = request as unknown as Request;
  const roomId = params.id as string;

  try {
    const session = await getSession(env.SESSIONS, req);
    if (!session) return json({ error: "Not authenticated — sign in first" }, 401, req);

    const room = await getRoom(env, roomId);
    if (!room) return json({ error: "Room not found" }, 404, req);

    const storedPlayerId = await env.SESSIONS.get(`tl:${roomId}:player`);
    if (storedPlayerId && room.host_id !== storedPlayerId) {
      return json({ error: "Only the host can add playlists" }, 403, req);
    }

    const body = await req.json() as { url: string };
    const { url } = body;
    if (!url?.trim()) return json({ error: "Playlist URL required" }, 400, req);

    // Extract playlist ID from URL or raw ID
    const match = url.trim().match(/playlist\/([A-Za-z0-9]+)/);
    const playlistId = match?.[1] ?? (/^[A-Za-z0-9]{22}$/.test(url.trim()) ? url.trim() : null);
    if (!playlistId) return json({ error: "Invalid Spotify playlist URL" }, 400, req);

    // Fetch playlist name (client credentials — no user token needed)
    const clientToken = await getClientCredentialsToken(env);
    const metaRes = await fetch(
      `https://api.spotify.com/v1/playlists/${playlistId}?fields=name`,
      { headers: { Authorization: `Bearer ${clientToken}` } }
    );
    if (!metaRes.ok) {
      const status = metaRes.status;
      if (status === 404) return json({ error: "Playlist not found. Make sure the URL is correct and the playlist is public." }, 400, req);
      if (status === 403) return json({ error: "Playlist is private. Only public Spotify playlists can be used." }, 400, req);
      return json({ error: `Spotify error ${status} fetching playlist` }, 502, req);
    }
    const { name } = await metaRes.json() as { name: string };

    // Fetch all tracks server-side using client credentials
    const tracks = await fetchPlaylistTracks(env, playlistId);
    if (tracks.length === 0) return json({ error: "No playable tracks found in playlist" }, 400, req);

    const existingIds = new Set((room.track_pool ?? []).map(t => t.id));
    const unique      = tracks.filter(t => !existingIds.has(t.id));
    const merged      = [...(room.track_pool ?? []), ...unique];
    for (let i = merged.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [merged[i], merged[j]] = [merged[j], merged[i]];
    }

    await updateRoom(env, roomId, { track_pool: merged });

    return json({ added: unique.length, total: merged.length, name } as AddPlaylistResponse, 200, req);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: msg }, 500, req);
  }
};

async function getClientCredentialsToken(env: Env): Promise<string> {
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type":  "application/x-www-form-urlencoded",
      "Authorization": `Basic ${btoa(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`)}`,
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
  });
  if (!res.ok) throw new Error(`Spotify client credentials failed: ${res.status}`);
  const data = await res.json() as { access_token: string };
  return data.access_token;
}
