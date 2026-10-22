import type { PagesFunction } from "@cloudflare/workers-types";
import type { Env } from "../../_env";
import { json, handlePreflight } from "../../_cors";
import { getRoom } from "../../_supabase";
import { handleBingoAction, type BingoBody } from "../../_bingo";

// POST /room/:id/bingo?action=…   — Music Bingo actions.
//   next     host: play the next track (auto-advance or manual skip)
//   end      host: finish the game
//   suggest  teammate: propose a tick for the captain
//   confirm  captain: cross a word off (checked per settings.bingoCheckMode)
//   dismiss  captain / suggester: drop a suggestion
//   unmark   captain: un-tick a word
//   add-team host, lobby only: add another team (bingo allows up to 8)
// All logic lives in functions/_bingo.ts.
export const onRequest: PagesFunction<Env> = async ({ request, params, env }) => {
  const pre = handlePreflight(request as unknown as Request);
  if (pre) return pre;
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const req    = request as unknown as Request;
  const roomId = params.id as string;
  const action = new URL(req.url).searchParams.get("action") ?? "";

  try {
    const room = await getRoom(env, roomId);
    if (!room) return json({ error: "Room not found" }, 404, req);
    const body = await req.json().catch(() => ({}));
    return await handleBingoAction(env, req, room, action, body as BingoBody);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: msg }, 500, req);
  }
};
