import type { PagesFunction } from "@cloudflare/workers-types";
import { getSession } from "@gokkehub/auth/session";
import type { Env } from "../../_env";
import { json, handlePreflight } from "../../_cors";
import { getRoom, getTeams, createTeam, updateTeam, createPlayer } from "../../_supabase";
import type { JoinRoomRequest, JoinRoomResponse } from "../../../src/lib/types";

// MVP is individual play modelled as one-member teams: every joiner gets
// their own team (named after them, captained by them). Team mode later
// swaps this for assignment without touching the schema.
export const onRequest: PagesFunction<Env> = async ({ request, params, env }) => {
  const pre = handlePreflight(request as unknown as Request);
  if (pre) return pre;
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const req    = request as unknown as Request;
  const roomId = (params.id as string).toUpperCase();

  try {
    const body = await req.json() as JoinRoomRequest;
    const name = body.name?.trim();
    if (!name) return json({ error: "Name required" }, 400, req);

    const room = await getRoom(env, roomId);
    if (!room) return json({ error: "Room not found" }, 404, req);
    if (room.status === "finished") return json({ error: "Game already ended" }, 409, req);

    const session  = await getSession(env.SESSIONS, req);
    const teams    = await getTeams(env, roomId);
    const playerId = crypto.randomUUID();

    const team = await createTeam(env, {
      room_id:    roomId,
      name:       name.slice(0, 30),
      score:      0,
      powerup:    null,
      captain_id: null,
      sort_order: teams.length,
    });

    await createPlayer(env, {
      id:      playerId,
      room_id: roomId,
      team_id: team.id,
      name:    name.slice(0, 30),
      user_id: session?.userId ?? null,
    });

    await updateTeam(env, team.id, { captain_id: playerId });

    return json({ player_id: playerId, team_id: team.id } as JoinRoomResponse, 201, req);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: msg }, 500, req);
  }
};
