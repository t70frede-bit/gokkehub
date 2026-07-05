import type { PagesFunction } from "@cloudflare/workers-types";
import type { Env } from "../../_env";
import { json, handlePreflight } from "../../_cors";
import { getRoom, getGame, getPlayer, getTeams, rpc } from "../../_supabase";
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
    if (room.status !== "playing" || !q) {
      return json({ error: "Buzzers are closed" }, 409, req);
    }
    if ((q.mode ?? "standard") !== "standard") {
      return json({ error: "This question uses answers, not buzzers" }, 409, req);
    }

    const [player, game] = await Promise.all([
      getPlayer(env, body.player_id),
      getGame(env, room.game_id),
    ]);
    if (!player || player.room_id !== roomId) return json({ error: "Player not in room" }, 403, req);
    if (player.team_id === null)              return json({ error: "Not on a team" }, 403, req);

    const queueMode = game?.config.buzzer.queueMode ?? "rebuzz";
    const answering = q.buzzedBy !== null;

    // Captain-only buzzing (team mode option). Standard questions only —
    // device questions never reach this endpoint.
    if (game?.config.teams?.mode === "teams" && game.config.teams.buzzerMode === "captain") {
      const teams = await getTeams(env, roomId);
      const team  = teams.find(t => t.id === player.team_id);
      if (team?.captain_id !== player.id) {
        return json({ error: "Only your captain can buzz in this game" }, 403, req);
      }
    }

    // Fast pre-checks; the resolve RPC re-checks the race case atomically.
    // A fresh race needs open buzzers. Buzzing while someone is answering is
    // only allowed in Queue Lock-In — it queues you for the wrong-answer case.
    if (!answering && !state.buzzersOpen) {
      return json({ error: "Buzzers are closed" }, 409, req);
    }
    if (answering && queueMode !== "lockIn") {
      return json({ error: "Buzzers are closed" }, 409, req);
    }
    if (q.buzzedBy === player.team_id) {
      return json({ error: "You're already in" }, 409, req);
    }
    // Lock-outs only exist in Queue Lock-In; Must Re-Buzz lets everyone
    // compete fresh each time the host reopens.
    if (queueMode === "lockIn" && (q.lockedOutTeamIds ?? []).includes(player.team_id)) {
      return json({ error: "Your team already answered this one" }, 409, req);
    }

    const windowMs = game?.config.buzzer.collectionWindowMs ?? 300;
    const sniper   = game?.config.powerups?.sniper;
    const sniperMs = sniper?.enabled ? (sniper.advantageMs ?? 0) : 0;

    const rank = await rpc<number>(env, "jp_buzz_insert", {
      p_room_id:    roomId,
      p_tile_key:   q.tileKey,
      p_buzz_round: state.buzzRound,
      p_team_id:    player.team_id,
      p_player_id:  player.id,
    });

    if (rank === 0) {
      // Duplicate tap — they're already in this race / queue.
      return json({ winner_team_id: null, winner_player_id: null } as BuzzResponse, 200, req);
    }

    // Queued behind the current answerer (Queue Lock-In): no race to resolve —
    // the reject handler promotes the queue in arrival order.
    if (answering) {
      return json({ winner_team_id: q.buzzedBy, winner_player_id: q.buzzedPlayerId } as BuzzResponse, 200, req);
    }

    // Rank 1 owns the window; everyone else is only a backstop resolver.
    await sleep(rank === 1 ? windowMs : windowMs + 150);

    const rows = await rpc<ResolveRow[]>(env, "jp_resolve_buzz", {
      p_room_id:    roomId,
      p_tile_key:   q.tileKey,
      p_buzz_round: state.buzzRound,
      p_sniper_ms:  sniperMs, // applied only to teams holding the Sniper power-up
    });
    const winner = rows[0] ?? { winner_team_id: null, winner_player_id: null };

    return json(winner as BuzzResponse, 200, req);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: msg }, 500, req);
  }
};
