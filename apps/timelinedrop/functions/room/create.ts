import type { PagesFunction } from "@cloudflare/workers-types";
import { getSession } from "@gokkehub/auth/session";
import type { Env } from "../_env";
import { json, handlePreflight } from "../_cors";
import { createRoom, createTeam, createPlayer } from "../_supabase";
import type { CreateRoomRequest, CreateRoomResponse } from "../../src/lib/types";

function randomId(len = 6): string {
  return Math.random().toString(36).slice(2, 2 + len).toUpperCase();
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  const pre = handlePreflight(request as unknown as Request);
  if (pre) return pre;
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const req = request as unknown as Request;

  try {
    const body = await req.json() as CreateRoomRequest;
    const { name, win_target = 10, team_names = ["Team Red", "Team Blue"] } = body;

    if (!name?.trim()) return json({ error: "Name required" }, 400, req);

    const session = await getSession(env.SESSIONS, req);
    const roomId  = randomId(6);
    const playerId = crypto.randomUUID();

    const room = await createRoom(env, {
      id:               roomId,
      host_id:          playerId,
      status:           "lobby",
      win_target,
      active_team_id:   null,
      track_pool:       [],
      track_cursor:     0,
      current_round_id: null,
      playing_since:    null,
      paused_at_ms:     null,
    });

    for (let i = 0; i < team_names.length; i++) {
      await createTeam(env, {
        room_id:        roomId,
        name:           team_names[i],
        tokens:         2,
        pending_tracks: [],
        sort_order:     i,
      });
    }

    await createPlayer(env, {
      id:         playerId,
      room_id:    roomId,
      team_id:    null,
      name:       name.trim().slice(0, 30),
      is_captain: false,
      is_host:    true,
    });

    if (session) {
      await env.SESSIONS.put(`tl:${roomId}:player`, playerId, { expirationTtl: 86400 });
    }

    return json({ room_id: room.id, player_id: playerId } as CreateRoomResponse, 201, req);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: msg }, 500, req);
  }
};
