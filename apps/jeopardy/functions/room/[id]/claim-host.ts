import type { PagesFunction } from "@cloudflare/workers-types";
import { getSession } from "@gokkehub/auth/session";
import type { Env } from "../../_env";
import { json, handlePreflight } from "../../_cors";
import { getRoom, getGame } from "../../_supabase";

// Host takeover: a logged-in game owner can pull host control onto the
// current device (e.g. moved from laptop to phone mid-game). Returns the
// host player id, which the client stores in localStorage — the same
// credential the original hosting device holds.
export const onRequest: PagesFunction<Env> = async ({ request, params, env }) => {
  const pre = handlePreflight(request as unknown as Request);
  if (pre) return pre;
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const req    = request as unknown as Request;
  const roomId = (params.id as string).toUpperCase();

  try {
    const session = await getSession(env.SESSIONS, req);
    if (!session) return json({ error: "Login required" }, 401, req);

    const room = await getRoom(env, roomId);
    if (!room) return json({ error: "Room not found" }, 404, req);

    const game = await getGame(env, room.game_id);
    if (!game || game.host_id !== session.userId) {
      return json({ error: "Only the game owner can take over hosting" }, 403, req);
    }

    return json({ player_id: room.host_id }, 200, req);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: msg }, 500, req);
  }
};
