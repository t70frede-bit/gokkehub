import type { PagesFunction } from "@cloudflare/workers-types";
import { getSession } from "@gokkehub/auth/session";
import type { Env } from "../../_env";
import { json, handlePreflight } from "../../_cors";
import { getTeams, updateTeam } from "../../_supabase";

// POST /room/:id/dev — developer-only knobs.
//
// Gated by the session's displayName (Discord username) being in
// DEV_USERNAMES. Only purpose: let the developer adjust state for testing
// without writing one-off SQL. Trivially extensible later by adding more
// `action` branches.
//
// Current actions:
//   action="adjust-points"   body: { team_id, delta }
//     Adds delta to tl_teams.points (shop-mode currency). Clamps at 0.
//     Returns the new value.

const DEV_USERNAMES = new Set(["goksi0501"]);

interface DevBody {
  player_id: string;
  action:    "adjust-points";
  team_id:   number;
  delta?:    number;
}

export const onRequest: PagesFunction<Env> = async ({ request, params, env }) => {
  const pre = handlePreflight(request as unknown as Request);
  if (pre) return pre;
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const req    = request as unknown as Request;
  const roomId = params.id as string;

  try {
    const session = await getSession(env.SESSIONS, req);
    if (!session) return json({ error: "Not signed in" }, 401, req);
    const handle = (session.displayName ?? "").toLowerCase();
    if (!DEV_USERNAMES.has(handle)) {
      return json({ error: "Dev tools are restricted" }, 403, req);
    }

    const body = await req.json() as DevBody;
    if (body.action !== "adjust-points") {
      return json({ error: `Unknown dev action: ${body.action}` }, 400, req);
    }

    const teams  = await getTeams(env, roomId);
    const target = teams.find(t => t.id === body.team_id);
    if (!target) return json({ error: "Team not in this room" }, 404, req);

    const delta    = typeof body.delta === "number" ? body.delta : 0;
    const newValue = Math.max(0, (target.points ?? 0) + delta);
    await updateTeam(env, target.id, { points: newValue });

    return json({ ok: true, team_id: target.id, points: newValue }, 200, req);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500, req);
  }
};
