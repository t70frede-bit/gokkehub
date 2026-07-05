import type { PagesFunction } from "@cloudflare/workers-types";
import type { Env } from "../../_env";
import { json, handlePreflight } from "../../_cors";
import {
  getRoom, getGame, getTeams, getSecrets, getSubmissions,
  updateRoom, updateTeam, logEvent,
} from "../../_supabase";
import { tileValue, getSpecial, specialPowerup, resolvePowerupChoice } from "../../_game";
import type {
  HostActionRequest, JpClosestNumberConfig, JpMultipleChoiceConfig,
  JpRankingConfig, JpRoom,
} from "../../../src/lib/types";
import { boardCount, getBoard } from "../../../src/lib/types";

// All host-driven state transitions run through here so board_state moves
// through one server-side state machine instead of ad-hoc client writes.

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
        const count = getBoard(game.config, state.currentBoard)?.categories.length ?? 0;
        updates.board_state = {
          ...state,
          revealedCategories: Array.from({ length: count }, (_, i) => i),
        };
        break;
      }

      case "select_tile": {
        if (room.status !== "playing") return json({ error: "Not playing" }, 409, req);
        if (state.activeQuestion)      return json({ error: "A question is already active" }, 409, req);
        if (state.powerupPrompt)       return json({ error: "A power-up choice is pending" }, 409, req);
        if (state.spentTiles.includes(action.tileKey)) return json({ error: "Tile already spent" }, 409, req);

        const game = await getGame(env, room.game_id);
        if (!game) return json({ error: "Game config missing" }, 500, req);
        const board = getBoard(game.config, state.currentBoard);
        const tile  = board?.tiles[action.tileKey];
        if (!tile) return json({ error: "Empty tile" }, 409, req);

        const mode    = tile.answerMode ?? "standard";
        const secrets = await getSecrets(env, roomId);
        const special = getSpecial(secrets, state.currentBoard, action.tileKey);

        // Buzzed dangerous tile: the picking team is instantly buzzed in.
        // Only meaningful on buzz questions with a known picker.
        const buzzed = special === "buzzed" && mode === "standard" && action.pickerTeamId != null;
        let buzzedPlayerId: string | null = null;
        if (buzzed) {
          const teams = await getTeams(env, roomId);
          buzzedPlayerId = teams.find(t => t.id === action.pickerTeamId)?.captain_id ?? null;
        }

        updates.board_state = {
          ...state,
          buzzersOpen:    false,
          lastResolution: null,
          activeQuestion: {
            tileKey:          action.tileKey,
            mode,
            buzzedBy:         buzzed ? action.pickerTeamId! : null,
            buzzedPlayerId,
            timerStart:       buzzed ? Date.now() : null,
            secondChanceUsed: false,
            ...(buzzed ? { special: "buzzed" as const } : {}),
            ...(mode !== "standard" ? { submittedTeamIds: [] } : {}),
          },
        };
        await logEvent(env, roomId, "tile_selected", {
          team_id: action.pickerTeamId ?? null,
          payload: { tileKey: action.tileKey, mode, buzzed },
        });
        break;
      }

      case "open_buzzers": {
        // Every open is a fresh race (Must Re-Buzz): first open of a
        // question and reopen-after-wrong-answer behave identically.
        // In submission modes this opens the answer window instead.
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
        const board = getBoard(game.config, state.currentBoard);
        const value = tileValue(board, q.tileKey);

        const teams = await getTeams(env, roomId);
        const team  = teams.find(t => t.id === q.buzzedBy);
        if (!team) return json({ error: "Buzzed team missing" }, 500, req);

        if (action.type === "accept_answer") {
          // Second Chance wrong+right nets zero.
          const award   = q.secondChanceUsed ? 0 : value;
          const secrets = await getSecrets(env, roomId);
          const ptype   = specialPowerup(getSpecial(secrets, state.currentBoard, q.tileKey));

          if (ptype) {
            // Power-up tile revealed: points held back until the team chooses.
            updates.board_state = {
              ...state,
              buzzersOpen:    false,
              spentTiles:     [...state.spentTiles, q.tileKey],
              activeQuestion: null,
              powerupPrompt: {
                teamId:         team.id,
                powerupType:    ptype,
                tileKey:        q.tileKey,
                value:          award,
                currentPowerup: team.powerup,
              },
            };
            // answer_correct is logged when the choice resolves (points vs claim).
          } else {
            await updateTeam(env, team.id, { score: team.score + award });
            updates.board_state = {
              ...state,
              buzzersOpen:    false,
              spentTiles:     [...state.spentTiles, q.tileKey],
              activeQuestion: null,
            };
            await logEvent(env, roomId, "answer_correct", {
              team_id: team.id, player_id: q.buzzedPlayerId,
              payload: { tileKey: q.tileKey, pointsDelta: award },
            });
          }
        } else {
          // Second Chance: first wrong answer is free, they answer again
          // immediately; second wrong answer costs double.
          if (team.powerup === "secondChance" && !q.secondChanceUsed) {
            updates.board_state = {
              ...state,
              activeQuestion: { ...q, secondChanceUsed: true, timerStart: Date.now() },
            };
            await logEvent(env, roomId, "answer_wrong", {
              team_id: team.id, player_id: q.buzzedPlayerId,
              payload: { tileKey: q.tileKey, pointsDelta: 0, secondChance: true },
            });
          } else {
            let loss = q.secondChanceUsed ? value * 2 : value;
            if (team.powerup === "buffer") {
              const reduction = game.config.powerups?.buffer.reductionAmount ?? 0;
              loss = Math.max(0, loss - reduction);
            }
            await updateTeam(env, team.id, { score: team.score - loss });
            // Buzzers stay closed until the host reopens — their call when
            // everyone has had a look at the still-open question.
            updates.board_state = {
              ...state,
              buzzersOpen: false,
              activeQuestion: { ...q, buzzedBy: null, buzzedPlayerId: null, timerStart: null },
            };
            await logEvent(env, roomId, "answer_wrong", {
              team_id: team.id, player_id: q.buzzedPlayerId,
              payload: { tileKey: q.tileKey, pointsDelta: -loss },
            });
          }
        }
        break;
      }

      case "resolve_submissions": {
        const q = state.activeQuestion;
        if (!q || (q.mode ?? "standard") === "standard") {
          return json({ error: "No submission question active" }, 409, req);
        }
        const game = await getGame(env, room.game_id);
        if (!game) return json({ error: "Game config missing" }, 500, req);
        const board = getBoard(game.config, state.currentBoard);
        const tile  = board?.tiles[q.tileKey];
        const cfg   = tile?.answerModeConfig;
        if (!tile || !cfg) return json({ error: "Tile config missing" }, 500, req);

        const value = tileValue(board, q.tileKey);
        const teams = await getTeams(env, roomId);
        const subs  = await getSubmissions(env, roomId, q.tileKey, "answer");
        const name  = (id: number) => teams.find(t => t.id === id)?.name ?? `Team ${id}`;

        // → [{teamId, delta}] plus display lines for the big screen.
        const awards: { teamId: number; delta: number }[] = [];
        const lines:  string[] = [];

        if (q.mode === "multipleChoice") {
          const mc = cfg as JpMultipleChoiceConfig;
          const correct = subs.filter(s => s.payload.value === mc.correctIndex);
          const scorers = mc.firstCorrectOnly ? correct.slice(0, 1) : correct;
          for (const s of subs) {
            const won = scorers.some(w => w.team_id === s.team_id);
            if (won) awards.push({ teamId: s.team_id, delta: value });
            const pick = typeof s.payload.value === "number" ? mc.options[s.payload.value] : "—";
            lines.push(`${name(s.team_id)}: ${pick ?? "—"} ${won ? `+${value}` : ""}`.trim());
          }
        } else if (q.mode === "closestNumber") {
          const cn = cfg as JpClosestNumberConfig;
          const valid = subs.filter(s => typeof s.payload.value === "number");
          // Ties break on submission order — subs are ordered by created_at.
          const winner = [...valid].sort((a, b) =>
            Math.abs((a.payload.value as number) - cn.correct) -
            Math.abs((b.payload.value as number) - cn.correct))[0];
          for (const s of subs) {
            const won = winner && s.team_id === winner.team_id;
            if (won) awards.push({ teamId: s.team_id, delta: value });
            lines.push(`${name(s.team_id)}: ${s.payload.value} ${cn.unit} ${won ? `+${value}` : ""}`.trim());
          }
          lines.push(`Answer: ${cn.correct} ${cn.unit}`);
        } else if (q.mode === "ranking") {
          const rk = cfg as JpRankingConfig;
          const n  = rk.items.length;
          for (const s of subs) {
            const order = Array.isArray(s.payload.value) ? s.payload.value as number[] : [];
            const correctCount = order.filter((v, i) => v === i).length;
            const delta = rk.scoring === "exact"
              ? (correctCount === n ? value : 0)
              : Math.floor((value * correctCount) / n);
            if (delta > 0) awards.push({ teamId: s.team_id, delta });
            lines.push(`${name(s.team_id)}: ${correctCount}/${n} in place ${delta > 0 ? `+${delta}` : ""}`.trim());
          }
        }

        // Power-up tile in a submission mode: the top scorer gets the choice
        // (their award is held back inside the prompt).
        const secrets = await getSecrets(env, roomId);
        const ptype   = specialPowerup(getSpecial(secrets, state.currentBoard, q.tileKey));
        let prompt: JpRoom["board_state"]["powerupPrompt"] = null;
        if (ptype && awards.length) {
          const top  = [...awards].sort((a, b) => b.delta - a.delta)[0];
          const team = teams.find(t => t.id === top.teamId);
          if (team) {
            prompt = {
              teamId:         team.id,
              powerupType:    ptype,
              tileKey:        q.tileKey,
              value:          top.delta,
              currentPowerup: team.powerup,
            };
            awards.splice(awards.indexOf(top), 1);
          }
        }

        for (const a of awards) {
          const team = teams.find(t => t.id === a.teamId);
          if (!team) continue;
          await updateTeam(env, team.id, { score: team.score + a.delta });
          await logEvent(env, roomId, "answer_correct", {
            team_id: team.id,
            payload: { tileKey: q.tileKey, pointsDelta: a.delta, mode: q.mode },
          });
        }

        updates.board_state = {
          ...state,
          buzzersOpen:    false,
          spentTiles:     [...state.spentTiles, q.tileKey],
          activeQuestion: null,
          powerupPrompt:  prompt,
          lastResolution: { tileKey: q.tileKey, mode: q.mode ?? "standard", lines },
        };
        break;
      }

      case "force_powerup_choice": {
        const teams = await getTeams(env, roomId);
        const res   = await resolvePowerupChoice(env, room, teams, action.choice);
        if (res.error) return json({ error: res.error }, 409, req);
        // resolvePowerupChoice writes the room itself.
        return json({ ok: true }, 200, req);
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

      case "advance_board": {
        const game = await getGame(env, room.game_id);
        if (!game) return json({ error: "Game config missing" }, 500, req);
        if (boardCount(game.config) < 2 || state.currentBoard !== 0) {
          return json({ error: "No second board" }, 409, req);
        }
        if ((game.config.powerupCarryover ?? "persist") === "reset") {
          const teams = await getTeams(env, roomId);
          for (const t of teams) {
            if (t.powerup) await updateTeam(env, t.id, { powerup: null });
          }
        }
        updates.board_state = {
          ...state,
          currentBoard:       1,
          spentTiles:         [],
          revealedCategories: [],
          buzzersOpen:        false,
          activeQuestion:     null,
          powerupPrompt:      null,
          lastResolution:     null,
          interlude:          true,
        };
        await logEvent(env, roomId, "board_advance", { payload: { toBoard: 1 } });
        break;
      }

      case "continue_board": {
        updates.board_state = { ...state, interlude: false };
        break;
      }

      case "start_final": {
        const game = await getGame(env, room.game_id);
        if (!game?.config.finalJeopardy?.enabled) {
          return json({ error: "Final Jeopardy not enabled" }, 409, req);
        }
        updates.board_state = {
          ...state,
          buzzersOpen:    false,
          activeQuestion: null,
          powerupPrompt:  null,
          lastResolution: null,
          interlude:      false,
          final: {
            stage:            "wager",
            category:         game.config.finalJeopardy.category || "Final Jeopardy",
            submittedTeamIds: [],
            revealed:         {},
          },
        };
        await logEvent(env, roomId, "final_started");
        break;
      }

      case "final_reveal_question": {
        if (state.final?.stage !== "wager") return json({ error: "Not in wager stage" }, 409, req);
        updates.board_state = {
          ...state,
          final: { ...state.final, stage: "question", submittedTeamIds: [] },
        };
        break;
      }

      case "final_judge": {
        const final = state.final;
        if (!final || final.stage === "wager") return json({ error: "Final not underway" }, 409, req);
        if (final.revealed[action.teamId])     return json({ error: "Already judged" }, 409, req);

        const teams = await getTeams(env, roomId);
        const team  = teams.find(t => t.id === action.teamId);
        if (!team) return json({ error: "Team not found" }, 404, req);

        const subs   = await getSubmissions(env, roomId, "__final__");
        const wagerS = subs.find(s => s.kind === "final_wager"  && s.team_id === team.id);
        const answS  = subs.find(s => s.kind === "final_answer" && s.team_id === team.id);
        const wager  = typeof wagerS?.payload.value === "number" ? wagerS.payload.value : 0;
        const answer = typeof answS?.payload.value === "string"  ? answS.payload.value  : "—";

        const delta = action.correct ? wager : -wager;
        await updateTeam(env, team.id, { score: team.score + delta });
        await logEvent(env, roomId, "final_judged", {
          team_id: team.id,
          payload: { correct: action.correct, wager, pointsDelta: delta },
        });

        updates.board_state = {
          ...state,
          final: {
            ...final,
            stage: "judging",
            revealed: { ...final.revealed, [team.id]: { answer, wager, correct: action.correct } },
          },
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
        updates.board_state = {
          ...state,
          buzzersOpen: false,
          activeQuestion: null,
          powerupPrompt: null,
          interlude: false,
        };
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
