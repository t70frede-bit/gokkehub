import type { PagesFunction } from "@cloudflare/workers-types";
import type { Env } from "../../_env";
import { json, handlePreflight } from "../../_cors";
import {
  getRoom, getGame, getTeams, getPlayers, getSecrets, getSubmissions, getBuzzAttempts,
  updateRoom, updateTeam, updatePlayer, logEvent, resetRoomData, createSecrets,
} from "../../_supabase";
import { tileValue, getSpecial, specialPowerup, resolvePowerupChoice, assignSpecialTiles } from "../../_game";
import type {
  HostActionRequest, JpClosestNumberConfig, JpMultipleChoiceConfig,
  JpRankingConfig, JpRoom,
} from "../../../src/lib/types";
import { boardCount, getBoard, INITIAL_BOARD_STATE } from "../../../src/lib/types";

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
    // Rematch is the only action allowed on a finished room.
    if (room.status === "finished" && action.type !== "rematch") {
      return json({ error: "Game already ended" }, 409, req);
    }

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

        // Staged reveal: hold back text or media until the host triggers it.
        const staged = (tile.revealOrder ?? "together") !== "together";

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
            ...(staged ? { revealStage: 0 } : {}),
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

      case "replay_media": {
        const q = state.activeQuestion;
        if (!q) return json({ error: "No active question" }, 409, req);
        updates.board_state = {
          ...state,
          activeQuestion: { ...q, mediaNonce: (q.mediaNonce ?? 0) + 1 },
        };
        break;
      }

      case "reveal_rest": {
        const q = state.activeQuestion;
        if (!q) return json({ error: "No active question" }, 409, req);
        updates.board_state = {
          ...state,
          activeQuestion: { ...q, revealStage: 1 },
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
            await logEvent(env, roomId, "answer_wrong", {
              team_id: team.id, player_id: q.buzzedPlayerId,
              payload: { tileKey: q.tileKey, pointsDelta: -loss },
            });

            const lockedOut = [...(q.lockedOutTeamIds ?? []), team.id];

            // Queue Lock-In: the next team that buzzed (initial race losers
            // count as queued) is called automatically, in arrival order.
            let next: { team_id: number; player_id: string } | undefined;
            if (game.config.buzzer.queueMode === "lockIn") {
              const attempts = await getBuzzAttempts(env, roomId, q.tileKey, state.buzzRound);
              next = attempts.find(a => a.team_id !== team.id && !lockedOut.includes(a.team_id));
            }

            if (next) {
              updates.board_state = {
                ...state,
                buzzersOpen: false,
                activeQuestion: {
                  ...q,
                  buzzedBy:         next.team_id,
                  buzzedPlayerId:   next.player_id,
                  timerStart:       Date.now(),
                  secondChanceUsed: false,
                  lockedOutTeamIds: lockedOut,
                },
              };
              await logEvent(env, roomId, "buzz_win", {
                team_id: next.team_id, player_id: next.player_id,
                payload: { tileKey: q.tileKey, buzzRound: state.buzzRound, fromQueue: true },
              });
            } else {
              // Buzzers stay closed until the host reopens — their call when
              // everyone has had a look at the still-open question.
              // secondChanceUsed resets: it described THIS team's buzz.
              updates.board_state = {
                ...state,
                buzzersOpen: false,
                activeQuestion: {
                  ...q,
                  buzzedBy:         null,
                  buzzedPlayerId:   null,
                  timerStart:       null,
                  secondChanceUsed: false,
                  lockedOutTeamIds: lockedOut,
                },
              };
            }
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
          const dist  = (s: typeof subs[number]) => Math.abs((s.payload.value as number) - cn.correct);
          const best  = valid.length ? Math.min(...valid.map(dist)) : null;
          const winners = best === null ? [] : valid.filter(s => dist(s) === best);
          // House rule: ties split the points evenly, each share rounded UP
          // to the nearest 100 (300 two ways → 200 each).
          const share = winners.length <= 1
            ? value
            : Math.ceil(value / winners.length / 100) * 100;
          for (const s of subs) {
            const won = winners.some(w => w.team_id === s.team_id);
            if (won) awards.push({ teamId: s.team_id, delta: share });
            lines.push(`${name(s.team_id)}: ${s.payload.value} ${cn.unit} ${won ? `+${share}` : ""}`.trim());
          }
          lines.push(`Answer: ${cn.correct} ${cn.unit}`);
        } else if (q.mode === "ranking") {
          const rk = cfg as JpRankingConfig;
          const n  = rk.items.length;
          if (rk.scoring === "exact") {
            // All-or-nothing: perfect orders "win the round"; multiple
            // perfects tie and split under the same round-up-to-100 rule.
            const perfect = subs.filter(s => {
              const order = Array.isArray(s.payload.value) ? s.payload.value as number[] : [];
              return order.length === n && order.every((v, i) => v === i);
            });
            const share = perfect.length <= 1
              ? value
              : Math.ceil(value / perfect.length / 100) * 100;
            for (const s of subs) {
              const won = perfect.some(w => w.team_id === s.team_id);
              if (won) awards.push({ teamId: s.team_id, delta: share });
              const order = Array.isArray(s.payload.value) ? s.payload.value as number[] : [];
              const correctCount = order.filter((v, i) => v === i).length;
              lines.push(`${name(s.team_id)}: ${correctCount}/${n} in place ${won ? `+${share}` : ""}`.trim());
            }
          } else {
            for (const s of subs) {
              const order = Array.isArray(s.payload.value) ? s.payload.value as number[] : [];
              const correctCount = order.filter((v, i) => v === i).length;
              const delta = Math.floor((value * correctCount) / n);
              if (delta > 0) awards.push({ teamId: s.team_id, delta });
              lines.push(`${name(s.team_id)}: ${correctCount}/${n} in place ${delta > 0 ? `+${delta}` : ""}`.trim());
            }
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

        // Winner list drives the big screen's reveal audio (house rule: the
        // winning team's buzzer sound plays as the answer is revealed).
        const winnerTeamIds = [
          ...(prompt ? [prompt.teamId] : []),
          ...awards.filter(a => a.delta > 0).map(a => a.teamId),
        ];
        updates.board_state = {
          ...state,
          buzzersOpen:    false,
          spentTiles:     [...state.spentTiles, q.tileKey],
          activeQuestion: null,
          powerupPrompt:  prompt,
          lastResolution: { tileKey: q.tileKey, mode: q.mode ?? "standard", lines, winnerTeamIds },
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

      case "assign_player": {
        const players = await getPlayers(env, roomId);
        const teams   = await getTeams(env, roomId);
        const target  = players.find(p => p.id === action.playerId);
        const team    = teams.find(t => t.id === action.teamId);
        if (!target || !team) return json({ error: "Player or team not found" }, 404, req);

        const oldTeamId = target.team_id;
        await updatePlayer(env, target.id, { team_id: team.id });
        if (!team.captain_id) await updateTeam(env, team.id, { captain_id: target.id });
        // If they captained their old team, promote another member (or clear).
        if (oldTeamId !== null && oldTeamId !== team.id) {
          const oldTeam = teams.find(t => t.id === oldTeamId);
          if (oldTeam?.captain_id === target.id) {
            const successor = players.find(p => p.team_id === oldTeamId && p.id !== target.id);
            await updateTeam(env, oldTeamId, { captain_id: successor?.id ?? null });
          }
        }
        break;
      }

      case "set_captain": {
        const players = await getPlayers(env, roomId);
        const target  = players.find(p => p.id === action.playerId);
        if (!target || target.team_id === null) return json({ error: "Player not on a team" }, 404, req);
        await updateTeam(env, target.team_id, { captain_id: target.id });
        break;
      }

      case "shuffle_teams": {
        if (room.status !== "lobby") return json({ error: "Lobby only" }, 409, req);
        const players = (await getPlayers(env, roomId)).filter(p => p.id !== room.host_id);
        const teams   = await getTeams(env, roomId);
        if (teams.length < 2) return json({ error: "Nothing to shuffle" }, 409, req);

        const shuffled = [...players].sort(() => Math.random() - 0.5);
        const captains = new Map<number, string>();
        for (let i = 0; i < shuffled.length; i++) {
          const team = teams[i % teams.length];
          await updatePlayer(env, shuffled[i].id, { team_id: team.id });
          if (!captains.has(team.id)) captains.set(team.id, shuffled[i].id);
        }
        for (const t of teams) {
          await updateTeam(env, t.id, { captain_id: captains.get(t.id) ?? null });
        }
        break;
      }

      case "rename_team": {
        const name = action.name?.trim().slice(0, 30);
        if (!name) return json({ error: "Name required" }, 400, req);
        const teams = await getTeams(env, roomId);
        if (!teams.some(t => t.id === action.teamId)) return json({ error: "Team not found" }, 404, req);
        await updateTeam(env, action.teamId, { name });
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

      case "rematch": {
        // Same room, same players — scores, board, special tiles, and the
        // event/attempt/submission logs all start over. Back to the lobby.
        if (room.status !== "finished") return json({ error: "Game still running" }, 409, req);
        const game = await getGame(env, room.game_id);
        if (!game) return json({ error: "Game config missing" }, 500, req);

        const teams = await getTeams(env, roomId);
        for (const t of teams) {
          await updateTeam(env, t.id, { score: 0, powerup: null });
        }
        await resetRoomData(env, roomId);
        await createSecrets(env, roomId, assignSpecialTiles(game.config));

        updates.status      = "lobby";
        updates.board_state = INITIAL_BOARD_STATE;
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
