import type { PagesFunction } from "@cloudflare/workers-types";
import type { Env } from "../../_env";
import { json, handlePreflight } from "../../_cors";
import { getRoom, getGame, getTeams, updateRoom, updateTeam, logEvent } from "../../_supabase";
import type { HostActionRequest, JpRoom } from "../../../src/lib/types";

// All host-driven state transitions run through here so board_state moves
// through one server-side state machine instead of ad-hoc client writes.

function tileValue(pointValues: number[], tileKey: string): number {
  const row = Number(tileKey.split("-")[1]);
  return pointValues[row] ?? 0;
}

export const onRequest: PagesFunction<Env> = async ({ request, params, env }) => {
  const pre = handlePreflight(request as unknown as Request);
  if (pre) return pre;
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const req    = request as unknown as Request;
  const roomId = (params.id as string).toUpperCase();

  try {
    const body = await req.json() as HostActionRequest;
    const { player_id, action } = body;
    if (!player_id || !action?.type) return json({ error: "Invalid request" }, 400, req);

    const room = await getRoom(env, roomId);
    if (!room) return json({ error: "Room not found" }, 404, req);
    if (room.host_id !== player_id) return json({ error: "Host only" }, 403, req);
    if (room.status === "finished") return json({ error: "Game already ended" }, 409, req);

    const state   = room.board_state;
    const updates: Partial<JpRoom> = {};

    switch (action.type) {
      case "start": {
        if (room.status !== "lobby") return json({ error: "Already started" }, 409, req);
        updates.status = "playing";
        await logEvent(env, roomId, "game_start");
        break;
      }

      case "reveal_category": {
        if (!state.revealedCategories.includes(action.categoryIndex)) {
          updates.board_state = {
            ...state,
            revealedCategories: [...state.revealedCategories, action.categoryIndex],
          };
        }
        break;
      }

      case "reveal_all_categories": {
        const game = await getGame(env, room.game_id);
        if (!game) return json({ error: "Game config missing" }, 500, req);
        const count = game.config.boards[state.currentBoard]?.categories.length ?? 0;
        updates.board_state = {
          ...state,
          revealedCategories: Array.from({ length: count }, (_, i) => i),
        };
        break;
      }

      case "select_tile": {
        if (room.status !== "playing") return json({ error: "Not playing" }, 409, req);
        if (state.activeQuestion)      return json({ error: "A question is already active" }, 409, req);
        if (state.spentTiles.includes(action.tileKey)) return json({ error: "Tile already spent" }, 409, req);
        updates.board_state = {
          ...state,
          buzzersOpen: false,
          activeQuestion: {
            tileKey:          action.tileKey,
            buzzedBy:         null,
            buzzedPlayerId:   null,
            timerStart:       null,
            secondChanceUsed: false,
          },
        };
        await logEvent(env, roomId, "tile_selected", { payload: { tileKey: action.tileKey } });
        break;
      }

      case "open_buzzers": {
        // Every open is a fresh race (Must Re-Buzz): first open of a
        // question and reopen-after-wrong-answer behave identically.
        if (!state.activeQuestion) return json({ error: "No active question" }, 409, req);
        if (state.activeQuestion.buzzedBy !== null) return json({ error: "Someone already buzzed" }, 409, req);
        updates.board_state = {
          ...state,
          buzzersOpen: true,
          buzzRound:   state.buzzRound + 1,
        };
        break;
      }

      case "accept_answer":
      case "reject_answer": {
        const q = state.activeQuestion;
        if (!q || q.buzzedBy === null) return json({ error: "Nobody has buzzed" }, 409, req);

        const game = await getGame(env, room.game_id);
        if (!game) return json({ error: "Game config missing" }, 500, req);
        const board = game.config.boards[state.currentBoard];
        const value = tileValue(board?.pointValues ?? [], q.tileKey);

        const teams = await getTeams(env, roomId);
        const team  = teams.find(t => t.id === q.buzzedBy);
        if (!team) return json({ error: "Buzzed team missing" }, 500, req);

        if (action.type === "accept_answer") {
          await updateTeam(env, team.id, { score: team.score + value });
          updates.board_state = {
            ...state,
            buzzersOpen:    false,
            spentTiles:     [...state.spentTiles, q.tileKey],
            activeQuestion: null,
          };
          await logEvent(env, roomId, "answer_correct", {
            team_id: team.id, player_id: q.buzzedPlayerId,
            payload: { tileKey: q.tileKey, pointsDelta: value },
          });
        } else {
          await updateTeam(env, team.id, { score: team.score - value });
          // Buzzers stay closed until the host reopens — their call when
          // everyone has had a look at the still-open question.
          updates.board_state = {
            ...state,
            buzzersOpen: false,
            activeQuestion: { ...q, buzzedBy: null, buzzedPlayerId: null, timerStart: null },
          };
          await logEvent(env, roomId, "answer_wrong", {
            team_id: team.id, player_id: q.buzzedPlayerId,
            payload: { tileKey: q.tileKey, pointsDelta: -value },
          });
        }
        break;
      }

      case "dismiss_question": {
        // Nobody knew it — spend the tile, reveal moves on.
        const q = state.activeQuestion;
        if (!q) return json({ error: "No active question" }, 409, req);
        updates.board_state = {
          ...state,
          buzzersOpen:    false,
          spentTiles:     [...state.spentTiles, q.tileKey],
          activeQuestion: null,
        };
        break;
      }

      case "set_score": {
        const teams = await getTeams(env, roomId);
        const team  = teams.find(t => t.id === action.teamId);
        if (!team) return json({ error: "Team not found" }, 404, req);
        if (!Number.isFinite(action.score)) return json({ error: "Invalid score" }, 400, req);
        await updateTeam(env, team.id, { score: Math.round(action.score) });
        await logEvent(env, roomId, "score_edit", {
          team_id: team.id,
          payload: { from: team.score, to: Math.round(action.score) },
        });
        break;
      }

      case "end_game": {
        updates.status = "finished";
        updates.board_state = { ...state, buzzersOpen: false, activeQuestion: null };
        await logEvent(env, roomId, "game_end");
        break;
      }

      default:
        return json({ error: "Unknown action" }, 400, req);
    }

    if (updates.status || updates.board_state) {
      await updateRoom(env, roomId, updates);
    }
    return json({ ok: true }, 200, req);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: msg }, 500, req);
  }
};
