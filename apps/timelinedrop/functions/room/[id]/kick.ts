import type { PagesFunction } from "@cloudflare/workers-types";
import type { Env } from "../../_env";
import { json, handlePreflight } from "../../_cors";
import { getRoom, getPlayers } from "../../_supabase";
import type { KickPlayerRequest } from "../../../src/lib/types";

export const onRequest: PagesFunction<Env> = async ({ request, params, env }) => {
  const pre = handlePreflight(request as unknown as Request);
  if (pre) return pre;
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const req    = request as unknown as Request;
  const roomId = params.id as string;

  try {
    const body = await req.json() as KickPlayerRequest;
    if (!body.player_id || !body.target_id) {
      return json({ error: "player_id and target_id required" }, 400, req);
    }

    const room = await getRoom(env, roomId);
    if (!room) return json({ error: "Room not found" }, 404, req);
    if (room.host_id !== body.player_id) return json({ error: "Only the host can kick" }, 403, req);
    if (body.target_id === room.host_id) return json({ error: "Host cannot kick themselves" }, 400, req);

    const players = await getPlayers(env, roomId);
    const target  = players.find(p => p.id === body.target_id);
    if (!target) return json({ error: "Player not found" }, 404, req);

    const url = `${env.SUPABASE_URL}/rest/v1/tl_players?id=eq.${body.target_id}`;
    const res = await fetch(url, {
      method: "DELETE",
      headers: {
        "apikey":        env.SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Prefer":        "return=minimal",
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return json({ error: `Failed to kick: ${res.status} ${text}` }, 500, req);
    }

    return json({ ok: true }, 200, req);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: msg }, 500, req);
  }
};
