import type { PagesFunction } from "@cloudflare/workers-types";
import { getSession } from "@gokkehub/auth/session";
import type { Env } from "../../_env";
import { json, handlePreflight } from "../../_cors";
import {
  getRoom, getGame, getTeams, getPlayers, createTeam, updateTeam, createPlayer,
} from "../../_supabase";
import type { JoinRoomRequest, JoinRoomResponse } from "../../../src/lib/types";

// Solo mode: every joiner gets their own one-member team (named after them).
// Team mode: joiners pick one of the pre-created teams, or get auto-assigned
// to the smallest. First member of a team becomes its captain.
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
    const playerId = crypto.randomUUID();
    const game     = await getGame(env, room.game_id);
    const teamMode = game?.config.teams?.mode === "teams";

    let teamId: number;

    if (teamMode) {
      const [teams, players] = await Promise.all([getTeams(env, roomId), getPlayers(env, roomId)]);
      const requested = teams.find(t => t.id === body.team_id);
      let team = requested;
      if (!team) {
        // Auto-assign to the smallest team.
        const counts = new Map(teams.map(t => [t.id, 0]));
        for (const p of players) {
          if (p.team_id !== null) counts.set(p.team_id, (counts.get(p.team_id) ?? 0) + 1);
        }
        team = [...teams].sort((a, b) => (counts.get(a.id) ?? 0) - (counts.get(b.id) ?? 0))[0];
      }
      if (!team) return json({ error: "No teams in this room" }, 500, req);
      teamId = team.id;
      if (!team.captain_id) {
        await updateTeam(env, team.id, { captain_id: playerId });
      }
    } else {
      const teams = await getTeams(env, roomId);
      const team  = await createTeam(env, {
        room_id:    roomId,
        name:       name.slice(0, 30),
        score:      0,
        powerup:    null,
        captain_id: null,
        sort_order: teams.length,
      });
      teamId = team.id;
      await updateTeam(env, team.id, { captain_id: playerId });
    }

    await createPlayer(env, {
      id:           playerId,
      room_id:      roomId,
      team_id:      teamId,
      name:         name.slice(0, 30),
      user_id:      session?.userId ?? null,
      buzzer_sound: session?.buzzerSound ?? null,
    });

    return json({ player_id: playerId, team_id: teamId } as JoinRoomResponse, 201, req);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: msg }, 500, req);
  }
};
