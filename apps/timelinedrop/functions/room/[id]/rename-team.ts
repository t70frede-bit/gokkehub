import type { PagesFunction } from "@cloudflare/workers-types";
import type { Env } from "../../_env";
import { json, handlePreflight } from "../../_cors";
import { getRoom, getTeams, req as supaReq } from "../../_supabase";

// POST /room/:id/rename-team
// Host-only — change a team's display name. Trimmed and capped at 30 chars
// to match the same caps the Create-Room sanitizer applies to player names.
interface RenameTeamRequest {
  player_id: string;
  team_id:   number;
  name:      string;
}

export const onRequest: PagesFunction<Env> = async ({ request, params, env }) => {
  const pre = handlePreflight(request as unknown as Request);
  if (pre) return pre;
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const r      = request as unknown as Request;
  const roomId = params.id as string;

  try {
    const body = await r.json() as RenameTeamRequest;
    if (!body.player_id) return json({ error: "player_id required" }, 400, r);
    if (typeof body.team_id !== "number") return json({ error: "team_id required" }, 400, r);
    const trimmed = (body.name ?? "").trim().slice(0, 30);
    if (!trimmed) return json({ error: "Team name cannot be empty" }, 400, r);

    const [room, teams] = await Promise.all([
      getRoom(env, roomId),
      getTeams(env, roomId),
    ]);
    if (!room) return json({ error: "Room not found" }, 404, r);
    if (room.host_id !== body.player_id) {
      return json({ error: "Only the host can rename teams" }, 403, r);
    }
    if (!teams.some(t => t.id === body.team_id)) {
      return json({ error: "Team not in this room" }, 400, r);
    }

    await supaReq(env, "PATCH", "tl_teams", `id=eq.${body.team_id}`, { name: trimmed });
    return json({ ok: true, team_id: body.team_id, name: trimmed }, 200, r);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: msg }, 500, r);
  }
};
