import type { PagesFunction } from "@cloudflare/workers-types";
import { getSession } from "@gokkehub/auth/session";
import type { Env } from "../../_env";
import { json, handlePreflight } from "../../_cors";
import { getRoom, updateRoom } from "../../_supabase";
import type { AddPlaylistRequest, AddPlaylistResponse } from "../../../src/lib/types";
import type { SpotifyTrack } from "../../../src/lib/types";

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

    const body = await req.json() as AddPlaylistRequest;
    const { name, tracks } = body;

    if (!name || !Array.isArray(tracks) || tracks.length === 0) {
      return json({ error: "Invalid request — name and tracks required" }, 400, req);
    }

    const valid = (tracks as SpotifyTrack[]).filter(
      t => t.id && t.name && t.uri && t.releaseYear && Number.isFinite(t.releaseYear)
    );
    if (valid.length === 0) return json({ error: "No valid tracks in playlist" }, 400, req);

    const existingIds = new Set((room.track_pool ?? []).map(t => t.id));
    const unique      = valid.filter(t => !existingIds.has(t.id));
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
