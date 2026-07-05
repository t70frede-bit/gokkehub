import type { PagesFunction } from "@cloudflare/workers-types";
import type { Env } from "../../_env";
import { json, handlePreflight } from "../../_cors";
import { getRoom, getTeams, getPlayer } from "../../_supabase";
import { resolvePowerupChoice } from "../../_game";
import type { PowerupChoiceRequest } from "../../../src/lib/types";

// The take-points-or-claim-power-up decision, made from the winning player's
// phone. The host can force the same choice via room/[id]/action.

export const onRequest: PagesFunction<Env> = async ({ request, params, env }) => {
  const pre = handlePreflight(request as unknown as Request);
  if (pre) return pre;
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const req    = request as unknown as Request;
  const roomId = (params.id as string).toUpperCase();

  try {
    const body = await req.json() as PowerupChoiceRequest;
    const { player_id, choice } = body;
    if (!player_id || (choice !== "points" && choice !== "powerup")) {
      return json({ error: "Invalid request" }, 400, req);
    }

    const room = await getRoom(env, roomId);
    if (!room) return json({ error: "Room not found" }, 404, req);

    const prompt = room.board_state.powerupPrompt;
    if (!prompt) return json({ error: "No power-up choice pending" }, 409, req);

    const player = await getPlayer(env, player_id);
    if (!player || player.room_id !== roomId || player.team_id !== prompt.teamId) {
      return json({ error: "This choice belongs to another team" }, 403, req);
    }

    const teams = await getTeams(env, roomId);
    const res   = await resolvePowerupChoice(env, room, teams, choice);
    if (res.error) return json({ error: res.error }, 409, req);

    return json({ ok: true }, 200, req);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: msg }, 500, req);
  }
};
