import type { PagesFunction } from "@cloudflare/workers-types";
import type { Env } from "../../_env";
import { json, handlePreflight } from "../../_cors";
import { getRoom, getGame, getPlayer, rpc } from "../../_supabase";
import type { BuzzRequest, BuzzResponse } from "../../../src/lib/types";

// The authoritative buzz handler. Pages Functions are stateless, so the
// collection window lives in Postgres, not in memory:
//   1. every buzz inserts into jp_buzz_attempts (timestamp = Postgres now())
//   2. the request whose insert ranked FIRST waits the collection window,
//      then calls jp_resolve_buzz; later arrivals wait slightly longer and
//      call it too, purely as a backstop in case the first request died —
//      resolution is a conditional write, so double-calling is harmless
//   3. everyone learns the winner via postgres_changes on jp_rooms

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

interface ResolveRow { winner_team_id: number | null; winner_player_id: string | null }

export const onRequest: PagesFunction<Env> = async ({ request, params, env }) => {
  const pre = handlePreflight(request as unknown as Request);
  if (pre) return pre;
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const req    = request as unknown as Request;
  const roomId = (params.id as string).toUpperCase();

  try {
    const body = await req.json() as BuzzRequest;
    if (!body.player_id) return json({ error: "player_id required" }, 400, req);

    const room = await getRoom(env, roomId);
    if (!room) return json({ error: "Room not found" }, 404, req);

    const state = room.board_state;
    const q     = state.activeQuestion;
    // Fast pre-checks; the resolve RPC re-checks all of this atomically.
    if (room.status !== "playing" || !state.buzzersOpen || !q || q.buzzedBy !== null) {
      return json({ error: "Buzzers are closed" }, 409, req);
    }

    const [player, game] = await Promise.all([
      getPlayer(env, body.player_id),
      getGame(env, room.game_id),
    ]);
    if (!player || player.room_id !== roomId) return json({ error: "Player not in room" }, 403, req);
    if (player.team_id === null)              return json({ error: "Not on a team" }, 403, req);

    const windowMs = game?.config.buzzer.collectionWindowMs ?? 300;

    const rank = await rpc<number>(env, "jp_buzz_insert", {
      p_room_id:    roomId,
      p_tile_key:   q.tileKey,
      p_buzz_round: state.buzzRound,
      p_team_id:    player.team_id,
      p_player_id:  player.id,
    });

    if (rank === 0) {
      // Duplicate tap — they're already in this race.
      return json({ winner_team_id: null, winner_player_id: null } as BuzzResponse, 200, req);
    }

    // Rank 1 owns the window; everyone else is only a backstop resolver.
    await sleep(rank === 1 ? windowMs : windowMs + 150);

    const rows = await rpc<ResolveRow[]>(env, "jp_resolve_buzz", {
      p_room_id:    roomId,
      p_tile_key:   q.tileKey,
      p_buzz_round: state.buzzRound,
      p_sniper_ms:  0, // power-ups are a later pass; the plumbing is ready
    });
    const winner = rows[0] ?? { winner_team_id: null, winner_player_id: null };

    return json(winner as BuzzResponse, 200, req);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: msg }, 500, req);
  }
};
