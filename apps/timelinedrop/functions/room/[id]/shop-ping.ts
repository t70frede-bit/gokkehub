import type { PagesFunction } from "@cloudflare/workers-types";
import type { Env } from "../../_env";
import { json, handlePreflight } from "../../_cors";
import { getRoom, getPlayers } from "../../_supabase";

// POST   /room/:id/shop-ping  { player_id, team_id, token_type }
//   Insert a ping on the given (team, token). Any room member.
//
// DELETE /room/:id/shop-ping  { player_id, team_id, token_type, ping_id? }
//   Remove pings. With ping_id: deletes that specific row (author or
//   host). Without: deletes ALL of the caller's pings on this
//   (team, token) pair — used by the "click my ping again to remove"
//   toggle when the caller fired multiple in quick succession.
//
// Pings auto-expire client-side after 12s; the row sits in
// tl_shop_pings until reset. The buy-token handler also clears
// matching rows so the badge disappears the moment the token is
// purchased.

interface Body {
  player_id:  string;
  team_id:    number;
  token_type: string;
  ping_id?:   number;   // DELETE only
}

export const onRequest: PagesFunction<Env> = async ({ request, params, env }) => {
  const pre = handlePreflight(request as unknown as Request);
  if (pre) return pre;
  const method = request.method;
  if (method !== "POST" && method !== "DELETE") {
    return json({ error: "Method not allowed" }, 405);
  }

  const req    = request as unknown as Request;
  const roomId = params.id as string;

  try {
    const body = await req.json() as Body;
    if (!body.player_id || typeof body.team_id !== "number" || !body.token_type) {
      return json({ error: "player_id, team_id, token_type required" }, 400, req);
    }
    if (body.token_type.length > 64) {
      return json({ error: "token_type too long" }, 400, req);
    }

    const [room, players] = await Promise.all([
      getRoom(env, roomId),
      getPlayers(env, roomId),
    ]);
    if (!room) return json({ error: "Room not found" }, 404, req);

    const me = players.find(p => p.id === body.player_id);
    if (!me) return json({ error: "Not in room" }, 403, req);

    if (method === "POST") {
      const url = `${env.SUPABASE_URL}/rest/v1/tl_shop_pings`;
      const res = await fetch(url, {
        method:  "POST",
        headers: {
          "Content-Type":  "application/json",
          "apikey":        env.SUPABASE_SERVICE_ROLE_KEY,
          "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          "Prefer":        "return=minimal",
        },
        body: JSON.stringify({
          room_id:     roomId,
          team_id:     body.team_id,
          token_type:  body.token_type,
          player_id:   me.id,
          player_name: me.name,
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return json({ error: `Insert failed: ${res.status} ${text}` }, 500, req);
      }
      return json({ ok: true }, 200, req);
    }

    // DELETE — author OR host can remove pings.
    const isHost = me.is_host || room.host_id === me.id;
    let filter = `room_id=eq.${roomId}&team_id=eq.${body.team_id}&token_type=eq.${encodeURIComponent(body.token_type)}`;
    if (typeof body.ping_id === "number") {
      filter += `&id=eq.${body.ping_id}`;
    }
    if (!isHost) {
      filter += `&player_id=eq.${encodeURIComponent(me.id)}`;
    }
    const delUrl = `${env.SUPABASE_URL}/rest/v1/tl_shop_pings?${filter}`;
    const res = await fetch(delUrl, {
      method:  "DELETE",
      headers: {
        apikey:        env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        Prefer:        "return=minimal",
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return json({ error: `Delete failed: ${res.status} ${text}` }, 500, req);
    }
    return json({ ok: true }, 200, req);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500, req);
  }
};
