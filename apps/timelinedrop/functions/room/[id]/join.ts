import type { PagesFunction } from "@cloudflare/workers-types";
import type { Env } from "../../_env";
import { json, handlePreflight } from "../../_cors";
import { getRoom, getPlayers, createPlayer, getTeams } from "../../_supabase";
import type { JoinRoomRequest, JoinRoomResponse } from "../../../src/lib/types";

export const onRequest: PagesFunction<Env> = async ({ request, params, env }) => {
  const pre = handlePreflight(request as unknown as Request);
  if (pre) return pre;
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const req    = request as unknown as Request;
  const roomId = params.id as string;

  try {
    const body = await req.json() as JoinRoomRequest;
    const { name } = body;

    if (!name?.trim()) return json({ error: "Name required" }, 400, req);

    const room = await getRoom(env, roomId);
    if (!room) return json({ error: "Room not found" }, 404, req);
    if (room.status !== "lobby") return json({ error: "Game already started" }, 409, req);

    const [players, teams] = await Promise.all([getPlayers(env, roomId), getTeams(env, roomId)]);

    const counts = new Map(teams.map(t => [t.id, 0]));
    for (const p of players) {
      if (p.team_id !== null) counts.set(p.team_id, (counts.get(p.team_id) ?? 0) + 1);
    }
    const smallestTeam = teams.sort((a, b) => (counts.get(a.id) ?? 0) - (counts.get(b.id) ?? 0))[0];

    const playerId = crypto.randomUUID();
    await createPlayer(env, {
      id:         playerId,
      room_id:    roomId,
      team_id:    smallestTeam?.id ?? null,
      name:       name.trim().slice(0, 30),
      is_captain: false,
      is_host:    false,
    });

    return json({ player_id: playerId, team_id: smallestTeam?.id ?? null } as JoinRoomResponse, 201, req);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: msg }, 500, req);
  }
};
