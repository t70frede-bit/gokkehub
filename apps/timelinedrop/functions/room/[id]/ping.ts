import type { PagesFunction } from "@cloudflare/workers-types";
import type { Env } from "../../_env";
import { json, handlePreflight } from "../../_cors";
import { getRoom, getRound, getPlayers } from "../../_supabase";
import type { DismissPingRequest } from "../../../src/lib/types";

// DELETE /room/:id/ping  — captain (or host in single-screen mode) dismisses a single ping
export const onRequest: PagesFunction<Env> = async ({ request, params, env }) => {
  const pre = handlePreflight(request as unknown as Request);
  if (pre) return pre;

  const req    = request as unknown as Request;
  const roomId = params.id as string;

  if (request.method !== "POST" && request.method !== "DELETE") {
    return json({ error: "Method not allowed" }, 405, req);
  }

  try {
    const body = await req.json() as DismissPingRequest;
    const { ping_id, player_id } = body;
    if (!ping_id || !player_id) return json({ error: "ping_id and player_id required" }, 400, req);

    const room = await getRoom(env, roomId);
    if (!room) return json({ error: "Room not found" }, 404, req);

    // Authorise: captain of active team, host, or the player who created the ping.
    const players = await getPlayers(env, roomId);
    const me = players.find(p => p.id === player_id);
    if (!me) return json({ error: "Not in room" }, 403, req);

    const isHost          = me.is_host || room.host_id === player_id;
    const captainOfActive = !!(room.active_team_id && me.team_id === room.active_team_id && me.is_captain);

    // Need to fetch the ping to check ownership (and to scope deletion to this room's round).
    const round = room.current_round_id ? await getRound(env, room.current_round_id) : null;
    if (!round) return json({ error: "No active round" }, 400, req);

    const lookupUrl = `${env.SUPABASE_URL}/rest/v1/tl_pings?id=eq.${ping_id}&round_id=eq.${round.id}&select=player_id`;
    const lookup = await fetch(lookupUrl, {
      headers: {
        "apikey":        env.SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    });
    if (!lookup.ok) return json({ error: `Lookup failed: ${lookup.status}` }, 500, req);
    const rows = await lookup.json() as Array<{ player_id: string }>;
    const target = rows[0];
    if (!target) return json({ error: "Ping not found" }, 404, req);

    const isOwnPing = target.player_id === player_id;
    if (!isHost && !captainOfActive && !isOwnPing) {
      return json({ error: "Only the captain, host, or the ping's author can dismiss it" }, 403, req);
    }

    const url = `${env.SUPABASE_URL}/rest/v1/tl_pings?id=eq.${ping_id}&round_id=eq.${round.id}`;
    const res = await fetch(url, {
      method:  "DELETE",
      headers: {
        "apikey":        env.SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Prefer":        "return=minimal",
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return json({ error: `Delete failed: ${res.status} ${text}` }, 500, req);
    }
    return json({ ok: true }, 200, req);
  } catch (err: unknown) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500, req);
  }
};
