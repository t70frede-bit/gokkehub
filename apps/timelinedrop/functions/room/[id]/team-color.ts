import type { PagesFunction } from "@cloudflare/workers-types";
import type { Env } from "../../_env";
import { json, handlePreflight } from "../../_cors";
import { getRoom, updateTeam } from "../../_supabase";

// POST /room/:id/team-color  { player_id, team_id, color }
//
// Host-only. Sets an explicit colour on a team (persists to tl_teams.color
// via migration 023). Clients fall back to sort_order palette when color
// is null.

const ALLOWED_COLORS = new Set(["red", "blue", "green", "yellow"]);

interface Body {
  player_id: string;
  team_id:   number;
  color:     string;
}

export const onRequest: PagesFunction<Env> = async ({ request, params, env }) => {
  const pre = handlePreflight(request as unknown as Request);
  if (pre) return pre;
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const req    = request as unknown as Request;
  const roomId = params.id as string;

  try {
    const body = await req.json() as Body;
    if (!body.player_id || typeof body.team_id !== "number") {
      return json({ error: "player_id and team_id required" }, 400, req);
    }
    if (!ALLOWED_COLORS.has(body.color)) {
      return json({ error: "Invalid colour" }, 400, req);
    }

    const room = await getRoom(env, roomId);
    if (!room) return json({ error: "Room not found" }, 404, req);
    if (room.host_id !== body.player_id) {
      return json({ error: "Only the host can change team colours" }, 403, req);
    }

    await updateTeam(env, body.team_id, { color: body.color } as never);
    return json({ ok: true, color: body.color }, 200, req);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500, req);
  }
};
