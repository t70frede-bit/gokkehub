import type { PagesFunction } from "@cloudflare/workers-types";
import type { Env } from "../../_env";
import { json, handlePreflight } from "../../_cors";
import {
  getRoom, getPlayers, getRound, getTeams,
  updateRound, insertTimelineEntry,
} from "../../_supabase";
import type { TlRound, TlTimelineEntry } from "../../../src/lib/types";

// POST /room/:id/steal-year   { player_id, round_id, year_guess }
//
// Steal by Year — GUESS submission only. The token itself is burned
// when the opposing captain plays it DURING the original team's turn
// (via /room/:id/token, type="steal_by_year"); that handler sets
// `round.steal_team_id`. This endpoint is the follow-through: after
// the original team's incorrect placement, the stealing captain guesses
// the year (±2). Correct → card locks into stealing team's timeline.
// Wrong → card is lost in the normal incorrect-outcome flow.

const STEAL_TOLERANCE = 2;

interface Body {
  player_id:  string;
  round_id:   number;
  year_guess: number;
}

export const onRequest: PagesFunction<Env> = async ({ request, params, env }) => {
  const pre = handlePreflight(request as unknown as Request);
  if (pre) return pre;
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const req    = request as unknown as Request;
  const roomId = params.id as string;

  try {
    const body = await req.json() as Body;
    if (!body.player_id || typeof body.round_id !== "number" || typeof body.year_guess !== "number") {
      return json({ error: "player_id, round_id, year_guess required" }, 400, req);
    }
    if (!Number.isInteger(body.year_guess) || body.year_guess < 1900 || body.year_guess > 2100) {
      return json({ error: "year_guess must be an integer 1900–2100" }, 400, req);
    }

    const [room, players, round, teams] = await Promise.all([
      getRoom(env, roomId),
      getPlayers(env, roomId),
      getRound(env, body.round_id),
      getTeams(env, roomId),
    ]);
    if (!room || !round) return json({ error: "Not found" }, 404, req);
    if (round.outcome !== "incorrect") {
      return json({ error: "Steal only applies after a wrong placement" }, 409, req);
    }
    if (round.steal_outcome !== null) {
      return json({ error: "Steal already resolved on this round" }, 409, req);
    }
    if (round.steal_team_id === null) {
      return json({ error: "No steal has been armed on this round" }, 409, req);
    }

    const me = players.find(p => p.id === body.player_id);
    if (!me) return json({ error: "Not in room" }, 403, req);
    if (!me.is_captain) return json({ error: "Only a captain can steal" }, 403, req);
    if (me.team_id !== round.steal_team_id) {
      return json({ error: "Your team didn't arm the steal on this round" }, 403, req);
    }

    const myTeam = teams.find(t => t.id === me.team_id);
    if (!myTeam) return json({ error: "Team not found" }, 404, req);

    const actualYear = round.corrected_year ?? round.track.releaseYear;
    const success    = Math.abs(body.year_guess - actualYear) <= STEAL_TOLERANCE;

    const patch: Partial<TlRound> = {
      steal_year_guess: body.year_guess,
      steal_outcome:    success ? "success" : "fail",
    };
    await updateRound(env, body.round_id, patch);

    if (success) {
      const entry: TlTimelineEntry = {
        team_id:        myTeam.id,
        track_id:       round.track.id,
        year:           actualYear,
        position:       0,    // recomputed by insertTimelineEntry
        track:          { ...round.track, releaseYear: actualYear },
        corrected_year: round.corrected_year,
      };
      await insertTimelineEntry(env, entry);
    }

    return json({
      ok:         true,
      success,
      actualYear,
      tolerance:  STEAL_TOLERANCE,
    }, 200, req);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500, req);
  }
};
