import type { PagesFunction } from "@cloudflare/workers-types";
import { getSession } from "@gokkehub/auth/session";
import type { Env } from "../../_env";
import { json, handlePreflight } from "../../_cors";
import { getGame, createRoom, createPlayer, createSecrets } from "../../_supabase";
import { assignSpecialTiles } from "../../_game";
import type { LaunchGameRequest, LaunchGameResponse } from "../../../src/lib/types";
import { INITIAL_BOARD_STATE } from "../../../src/lib/types";

// Room codes are 4 alphanumeric chars, same scheme as timelinedrop — short
// enough to read out loud and gokkehub.com/api/find-room matches by exact id.
function randomId(len = 4): string {
  return Math.random().toString(36).slice(2, 2 + len).toUpperCase();
}

export const onRequest: PagesFunction<Env> = async ({ request, params, env }) => {
  const pre = handlePreflight(request as unknown as Request);
  if (pre) return pre;
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const req    = request as unknown as Request;
  const gameId = params.id as string;

  try {
    const session = await getSession(env.SESSIONS, req);
    if (!session) return json({ error: "Login required" }, 401, req);

    const game = await getGame(env, gameId);
    if (!game) return json({ error: "Game not found" }, 404, req);
    if (game.host_id !== session.userId) return json({ error: "Not your game" }, 403, req);

    const body     = await req.json() as LaunchGameRequest;
    const hostName = body.host_name?.trim() || session.displayName || "Host";

    const roomId       = randomId();
    const hostPlayerId = crypto.randomUUID();

    await createRoom(env, {
      id:          roomId,
      game_id:     gameId,
      host_id:     hostPlayerId,
      status:      "lobby",
      board_state: INITIAL_BOARD_STATE,
    });

    // Special tiles are rolled once at launch and stored server-side only —
    // board_state is world-readable, so the map must not live there.
    await createSecrets(env, roomId, assignSpecialTiles(game.config));

    // The host is a player row (so the lobby lists them) but never on a team —
    // they run the controller, they don't answer.
    await createPlayer(env, {
      id:      hostPlayerId,
      room_id: roomId,
      team_id: null,
      name:    hostName.slice(0, 30),
      user_id: session.userId,
    });

    return json({ room_id: roomId, player_id: hostPlayerId } as LaunchGameResponse, 201, req);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: msg }, 500, req);
  }
};
