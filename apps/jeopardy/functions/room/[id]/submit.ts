import type { PagesFunction } from "@cloudflare/workers-types";
import type { Env } from "../../_env";
import { json, handlePreflight } from "../../_cors";
import { getRoom, getGame, getTeams, getPlayer, createSubmission, rpc } from "../../_supabase";
import type {
  JpClosestNumberConfig, JpMultipleChoiceConfig, JpRankingConfig, SubmitRequest,
} from "../../../src/lib/types";
import { getBoard } from "../../../src/lib/types";

// One endpoint for every lock-in: tile answers (MC / closest / ranking) and
// Final Jeopardy wagers + answers. First submission per team wins (unique
// index); answers live in the RLS-locked jp_submissions table so phones
// can't peek at each other.

export const onRequest: PagesFunction<Env> = async ({ request, params, env }) => {
  const pre = handlePreflight(request as unknown as Request);
  if (pre) return pre;
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const req    = request as unknown as Request;
  const roomId = (params.id as string).toUpperCase();

  try {
    const body = await req.json() as SubmitRequest;
    const { player_id, kind, value } = body;
    if (!player_id || !kind) return json({ error: "Invalid request" }, 400, req);

    const room = await getRoom(env, roomId);
    if (!room)                       return json({ error: "Room not found" }, 404, req);
    if (room.status !== "playing")   return json({ error: "Not playing" }, 409, req);

    const player = await getPlayer(env, player_id);
    if (!player || player.room_id !== roomId) return json({ error: "Player not in room" }, 403, req);
    if (player.team_id === null)              return json({ error: "Not on a team" }, 403, req);

    const state = room.board_state;

    if (kind === "final_wager" || kind === "final_answer") {
      const final = state.final;
      if (!final) return json({ error: "Final Jeopardy not underway" }, 409, req);

      if (kind === "final_wager") {
        if (final.stage !== "wager") return json({ error: "Wagering is closed" }, 409, req);
        const teams = await getTeams(env, roomId);
        const team  = teams.find(t => t.id === player.team_id);
        const max   = Math.max(0, team?.score ?? 0);
        const wager = Math.round(Number(value));
        if (!Number.isFinite(wager) || wager < 0 || wager > max) {
          return json({ error: `Wager must be 0–${max}` }, 400, req);
        }
        const fresh = await createSubmission(env, roomId, "__final__", "final_wager", player.team_id, player.id, wager);
        if (!fresh) return json({ error: "Already wagered" }, 409, req);
      } else {
        if (final.stage !== "question") return json({ error: "Answers are closed" }, 409, req);
        const answer = String(value ?? "").trim().slice(0, 200);
        if (!answer) return json({ error: "Answer required" }, 400, req);
        const fresh = await createSubmission(env, roomId, "__final__", "final_answer", player.team_id, player.id, answer);
        if (!fresh) return json({ error: "Already answered" }, 409, req);
      }

      await rpc(env, "jp_mark_submitted", { p_room_id: roomId, p_team_id: player.team_id, p_final: true });
      return json({ ok: true }, 201, req);
    }

    // ── Tile answer (MC / closest number / ranking) ────────────────────────
    const q = state.activeQuestion;
    if (!q || (q.mode ?? "standard") === "standard") {
      return json({ error: "No answer question active" }, 409, req);
    }
    if (!state.buzzersOpen) return json({ error: "Answers are closed" }, 409, req);

    const game  = await getGame(env, room.game_id);
    const board = game ? getBoard(game.config, state.currentBoard) : null;
    const cfg   = board?.tiles[q.tileKey]?.answerModeConfig;
    if (!cfg) return json({ error: "Tile config missing" }, 500, req);

    let payload: number | number[];
    if (q.mode === "multipleChoice") {
      const mc  = cfg as JpMultipleChoiceConfig;
      const idx = Math.round(Number(value));
      if (!Number.isInteger(idx) || idx < 0 || idx >= mc.options.length) {
        return json({ error: "Invalid option" }, 400, req);
      }
      payload = idx;
    } else if (q.mode === "closestNumber") {
      const num = Number(value);
      if (!Number.isFinite(num)) return json({ error: "Invalid number" }, 400, req);
      payload = num;
    } else {
      const rk = cfg as JpRankingConfig;
      const n  = rk.items.length;
      const arr = Array.isArray(value) ? value.map(Number) : [];
      const distinct = new Set(arr);
      if (arr.length !== n || distinct.size !== n || arr.some(v => !Number.isInteger(v) || v < 0 || v >= n)) {
        return json({ error: "Invalid ranking" }, 400, req);
      }
      payload = arr;
    }

    const fresh = await createSubmission(env, roomId, q.tileKey, "answer", player.team_id, player.id, payload);
    if (!fresh) return json({ error: "Already submitted" }, 409, req);

    await rpc(env, "jp_mark_submitted", { p_room_id: roomId, p_team_id: player.team_id, p_final: false });
    return json({ ok: true }, 201, req);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: msg }, 500, req);
  }
};
