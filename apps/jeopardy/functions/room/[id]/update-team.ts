import type { PagesFunction } from "@cloudflare/workers-types";
import type { Env } from "../../_env";
import { json, handlePreflight } from "../../_cors";
import { getRoom, getTeams, getPlayer, updateTeam } from "../../_supabase";

// Captains may update their team's name and colour during a game.
// Validation: player_id must be the captain of their team.

export const onRequest: PagesFunction<Env> = async ({ request, params, env }) => {
  const pre = handlePreflight(request as unknown as Request);
  if (pre) return pre;

  const req    = request as unknown as Request;
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, req);

  const roomId = (params.id as string).toUpperCase();

  try {
    const body = await req.json() as { player_id?: string; name?: string; color?: string };
    const { player_id, name, color } = body;
    if (!player_id) return json({ error: "player_id required" }, 400, req);

    const room = await getRoom(env, roomId);
    if (!room) return json({ error: "Room not found" }, 404, req);

    const player = await getPlayer(env, player_id);
    if (!player || player.room_id !== roomId) return json({ error: "Player not found" }, 404, req);
    if (player.team_id === null) return json({ error: "Not on a team" }, 403, req);

    const teams = await getTeams(env, roomId);
    const team  = teams.find(t => t.id === player.team_id);
    if (!team) return json({ error: "Team not found" }, 404, req);
    if (team.captain_id !== player_id) return json({ error: "Captains only" }, 403, req);

    const patch: { name?: string; color?: string } = {};

    if (name !== undefined) {
      const trimmed = name.trim().slice(0, 30);
      if (!trimmed) return json({ error: "Name required" }, 400, req);
      patch.name = trimmed;
    }
    if (color !== undefined) {
      if (!/^#[0-9a-fA-F]{6}$/.test(color)) return json({ error: "Invalid colour" }, 400, req);
      patch.color = color;
    }

    if (Object.keys(patch).length === 0) return json({ error: "Nothing to update" }, 400, req);

    await updateTeam(env, team.id, patch);
    return json({ ok: true }, 200, req);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: msg }, 500, req);
  }
};
