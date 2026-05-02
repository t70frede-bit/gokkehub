import type { PagesFunction } from "@cloudflare/workers-types";
import type { Env } from "../../_env";
import { json, handlePreflight } from "../../_cors";
import { getRoom, getTeams, getPlayers, updatePlayer } from "../../_supabase";
import type { ChangeTeamRequest } from "../../../src/lib/types";

export const onRequest: PagesFunction<Env> = async ({ request, params, env }) => {
  const pre = handlePreflight(request as unknown as Request);
  if (pre) return pre;
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const req    = request as unknown as Request;
  const roomId = params.id as string;

  try {
    const body = await req.json() as ChangeTeamRequest;
    if (!body.player_id) return json({ error: "player_id required" }, 400, req);

    const [room, players, teams] = await Promise.all([
      getRoom(env, roomId),
      getPlayers(env, roomId),
      getTeams(env, roomId),
    ]);
    if (!room) return json({ error: "Room not found" }, 404, req);

    const me = players.find(p => p.id === body.player_id);
    if (!me) return json({ error: "Player not in this room" }, 403, req);

    const isHost = me.is_host;
    const teamSwap = room.settings?.teamSwapEnabled ?? false;

    // Self-team-swap is only allowed in lobby (don't let people jump teams mid-game)
    if (room.status !== "lobby" && !isHost) {
      return json({ error: "Cannot change teams once the game has started" }, 409, req);
    }
    if (!isHost && !teamSwap) {
      return json({ error: "The host has disabled team swapping" }, 403, req);
    }

    let nextTeamId: number | null = null;
    if (body.team_id !== null && body.team_id !== undefined) {
      const valid = teams.find(t => t.id === body.team_id);
      if (!valid) return json({ error: "Invalid team for this room" }, 400, req);
      nextTeamId = valid.id;
    }

    // Moving to a new team also drops captain status (captain re-elected per team)
    await updatePlayer(env, body.player_id, {
      team_id:    nextTeamId,
      is_captain: false,
    });

    return json({ ok: true, team_id: nextTeamId }, 200, req);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: msg }, 500, req);
  }
};
