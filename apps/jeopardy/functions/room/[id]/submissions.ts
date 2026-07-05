import type { PagesFunction } from "@cloudflare/workers-types";
import type { Env } from "../../_env";
import { json, handlePreflight } from "../../_cors";
import { getRoom, getSubmissions } from "../../_supabase";

// Host-only read of the current question's (or Final Jeopardy's) submissions.
// jp_submissions has no anon read policy, so this is the only window into it.

export const onRequest: PagesFunction<Env> = async ({ request, params, env }) => {
  const pre = handlePreflight(request as unknown as Request);
  if (pre) return pre;
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const req    = request as unknown as Request;
  const roomId = (params.id as string).toUpperCase();
  const url    = new URL(req.url);
  const playerId = url.searchParams.get("player_id") ?? "";

  try {
    const room = await getRoom(env, roomId);
    if (!room) return json({ error: "Room not found" }, 404, req);
    if (room.host_id !== playerId) return json({ error: "Host only" }, 403, req);

    const state = room.board_state;
    if (state.final) {
      const rows = await getSubmissions(env, roomId, "__final__");
      return json({ submissions: rows }, 200, req);
    }
    if (state.activeQuestion) {
      const rows = await getSubmissions(env, roomId, state.activeQuestion.tileKey, "answer");
      return json({ submissions: rows }, 200, req);
    }
    return json({ submissions: [] }, 200, req);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: msg }, 500, req);
  }
};
