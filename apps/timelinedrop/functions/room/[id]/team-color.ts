import type { PagesFunction } from "@cloudflare/workers-types";
import type { Env } from "../../_env";
import { json, handlePreflight } from "../../_cors";
import { getRoom, getTeams, updateTeam } from "../../_supabase";

const PALETTE_ORDER = ["red", "blue", "green", "yellow"] as const;

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

    const [room, teams] = await Promise.all([
      getRoom(env, roomId),
      getTeams(env, roomId),
    ]);
    if (!room) return json({ error: "Room not found" }, 404, req);
    if (room.host_id !== body.player_id) {
      return json({ error: "Only the host can change team colours" }, 403, req);
    }

    // Reject duplicate-colour assignments. `team.color` is null on
    // legacy rooms, in which case the displayed colour falls back to
    // sort_order; compare against that effective colour so we don't
    // let a host pick the same hue another team already shows.
    const target = teams.find(t => t.id === body.team_id);
    if (!target) return json({ error: "Team not found in this room" }, 404, req);
    const effective = (t: { color?: string | null; sort_order: number }): string =>
      (t.color && ALLOWED_COLORS.has(t.color)) ? t.color : PALETTE_ORDER[t.sort_order % PALETTE_ORDER.length];
    const conflict = teams.some(t => t.id !== body.team_id && effective(t) === body.color);
    if (conflict) {
      return json({ error: "Another team is already using that colour" }, 409, req);
    }

    await updateTeam(env, body.team_id, { color: body.color } as never);
    return json({ ok: true, color: body.color }, 200, req);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500, req);
  }
};
