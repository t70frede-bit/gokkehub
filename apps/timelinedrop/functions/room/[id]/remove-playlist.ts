import type { PagesFunction } from "@cloudflare/workers-types";
import type { Env } from "../../_env";
import { json, handlePreflight } from "../../_cors";
import { getRoom, updateRoom } from "../../_supabase";
import type { TlRoomSettings } from "../../../src/lib/types";

// POST /room/:id/remove-playlist
// Host-only — drop every track that came from a single playlist import
// AND remove the corresponding settings.playlistImports record. Hosts
// curate playlists in batches, not one song at a time. track_ids on the
// import record point at Spotify track IDs in the pool.
interface RemovePlaylistBody {
  player_id:   string;
  playlist_id: string;   // the uuid generated when /playlist recorded the import
}

export const onRequest: PagesFunction<Env> = async ({ request, params, env }) => {
  const pre = handlePreflight(request as unknown as Request);
  if (pre) return pre;
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const req    = request as unknown as Request;
  const roomId = params.id as string;

  try {
    const body = await req.json() as RemovePlaylistBody;
    if (!body.player_id || !body.playlist_id) {
      return json({ error: "player_id and playlist_id required" }, 400, req);
    }

    const room = await getRoom(env, roomId);
    if (!room) return json({ error: "Room not found" }, 404, req);
    if (room.host_id !== body.player_id) {
      return json({ error: "Only the host can remove playlists" }, 403, req);
    }

    const imports = (room.settings?.playlistImports ?? []);
    const target  = imports.find(i => i.id === body.playlist_id);
    if (!target) return json({ error: "Playlist not found in this room's imports" }, 404, req);

    const dropIds = new Set(target.track_ids);
    const pool    = room.track_pool ?? [];
    const cursor  = room.track_cursor ?? 0;

    // Recompute track_cursor: count how many removed tracks sat BEFORE the
    // current cursor (= already played) so we keep cursor pointing at the
    // same upcoming track. Removed tracks at/after cursor don't shift it.
    let removedBefore = 0;
    for (let i = 0; i < cursor && i < pool.length; i++) {
      if (dropIds.has(pool[i].id)) removedBefore++;
    }
    const newPool   = pool.filter(t => !dropIds.has(t.id));
    const newCursor = Math.max(0, cursor - removedBefore);

    const mergedSettings: TlRoomSettings = {
      ...(room.settings ?? {}),
      playlistImports: imports.filter(i => i.id !== target.id),
    };

    await updateRoom(env, roomId, {
      track_pool:   newPool,
      track_cursor: newCursor,
      settings:     mergedSettings,
    });

    return json({
      ok:      true,
      removed: dropIds.size - (pool.length - newPool.length === dropIds.size ? 0 : 0), // simple count
      total:   newPool.length,
      name:    target.name,
    }, 200, req);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500, req);
  }
};
