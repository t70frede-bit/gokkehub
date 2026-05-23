import type { PagesFunction } from "@cloudflare/workers-types";
import type { Env } from "../../_env";
import { json, handlePreflight } from "../../_cors";
import {
  getRoom, getPlayers, getRound, updateRound, updateTeam, getTeams,
} from "../../_supabase";
import type { TlTeamToken } from "../../../src/lib/types";

// POST /room/:id/counter
// Body: { player_id, round_id, target_token_id }
//
// Opposing-team captain burns a token_counter to cancel a recently
// activated token. Both tokens are consumed (CCG-style 1-for-1 trade).
// The target token's effect is rolled back based on its type — see the
// rollbackEffect helper below. Counters are time-gated to the last
// COUNTER_WINDOW_SEC seconds since the target was activated; the client
// shows a 3s/10s window in the cinematic but we use a more generous
// server cap to absorb latency and clock skew.

const COUNTER_WINDOW_SEC = 15;

// Rollback table. Only tokens that have a reversible round-level effect
// participate; one-shot destructive tokens (card_remover, artist_picker)
// are NOT counterable — by the time a counter fires the effect has
// already mutated opponent state and undoing it is brittle.
// Tokens whose effect can be cleanly rolled back via a single round
// column flip. One-shot tokens that write to other tables (reference_point
// inserts a tl_notes row; card_remover deletes a tl_timeline row;
// artist_picker rotates the upcoming pool) are NOT counterable because
// the rollback path would need to track + reverse those side-effects.
const COUNTERABLE = new Set<string>([
  "cover_reveal",
  "cover_reveal_before",
  "more_or_less",
  "recovery",         // stored type; UI sends "recovery_arm" but server burns "recovery"
  "year_span_5",
  "force_lock",
  "song_limiter",
]);

async function rollbackEffect(env: Env, roundId: number, tokenType: string): Promise<void> {
  switch (tokenType) {
    case "cover_reveal":
    case "cover_reveal_before":
      await updateRound(env, roundId, { cover_revealed: false });
      return;
    case "more_or_less":
      await updateRound(env, roundId, { more_or_less_card_id: null });
      return;
    case "recovery":
      await updateRound(env, roundId, { recovery_armed: false });
      return;
    case "year_span_5":
      await updateRound(env, roundId, { year_tolerance: 0 });
      return;
    case "force_lock":
      await updateRound(env, roundId, { force_locked: false });
      return;
    case "song_limiter":
      await updateRound(env, roundId, { song_limit_seconds: null });
      return;
    default:
      return;
  }
}

interface Body {
  player_id:       string;
  round_id:        number;
  target_token_id: number;
}

export const onRequest: PagesFunction<Env> = async ({ request, params, env }) => {
  const pre = handlePreflight(request as unknown as Request);
  if (pre) return pre;
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const req    = request as unknown as Request;
  const roomId = params.id as string;

  try {
    const body = await req.json() as Body;
    if (!body.player_id || typeof body.round_id !== "number" || typeof body.target_token_id !== "number") {
      return json({ error: "player_id, round_id, target_token_id required" }, 400, req);
    }

    const [room, players, round, teams] = await Promise.all([
      getRoom(env, roomId),
      getPlayers(env, roomId),
      getRound(env, body.round_id),
      getTeams(env, roomId),
    ]);
    if (!room || !round) return json({ error: "Not found" }, 404, req);

    const me = players.find(p => p.id === body.player_id);
    if (!me) return json({ error: "Not in room" }, 403, req);
    if (!me.is_captain) return json({ error: "Only a captain can counter" }, 403, req);
    if (me.team_id === null) return json({ error: "Not on a team" }, 403, req);

    // Fetch the target token row to validate it exists, is fresh, and
    // belongs to an opposing team.
    const tgtUrl = `${env.SUPABASE_URL}/rest/v1/tl_team_tokens?id=eq.${body.target_token_id}&select=*&limit=1`;
    const tgtRes = await fetch(tgtUrl, {
      headers: {
        apikey:        env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    });
    if (!tgtRes.ok) return json({ error: "Target lookup failed" }, 500, req);
    const targetRows = await tgtRes.json() as TlTeamToken[];
    const target = targetRows[0];
    if (!target) return json({ error: "Target token not found" }, 404, req);
    if (target.team_id === me.team_id) return json({ error: "Cannot counter your own team's token" }, 403, req);
    if (!target.used_at) return json({ error: "Target token hasn't been activated yet" }, 400, req);
    const usedAtMs = Date.parse(target.used_at);
    if (Number.isNaN(usedAtMs) || Date.now() - usedAtMs > COUNTER_WINDOW_SEC * 1000) {
      return json({ error: "Counter window has expired" }, 400, req);
    }
    if (!COUNTERABLE.has(target.type)) {
      return json({ error: `${target.type} cannot be countered` }, 400, req);
    }

    // Find an available counter token on the caller's team and burn it.
    const counterUrl = `${env.SUPABASE_URL}/rest/v1/tl_team_tokens?team_id=eq.${me.team_id}&type=eq.token_counter&used_at=is.null&pending=eq.false&select=id&limit=1`;
    const counterRes = await fetch(counterUrl, {
      headers: {
        apikey:        env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    });
    if (!counterRes.ok) return json({ error: "Counter lookup failed" }, 500, req);
    const counterRows = await counterRes.json() as Array<{ id: number }>;
    if (counterRows.length === 0) return json({ error: "No Token Counter available" }, 400, req);
    const counterId = counterRows[0].id;

    const burnCounterUrl = `${env.SUPABASE_URL}/rest/v1/tl_team_tokens?id=eq.${counterId}`;
    await fetch(burnCounterUrl, {
      method: "PATCH",
      headers: {
        "Content-Type":  "application/json",
        "apikey":        env.SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Prefer":        "return=minimal",
      },
      body: JSON.stringify({
        used_at:    new Date().toISOString(),
        used_round: body.round_id,
      }),
    });

    // Roll back the target's effect.
    await rollbackEffect(env, body.round_id, target.type);

    // Persist a small audit trail on the team so the UI can show a
    // "countered" beat. Cheap: just bump a counter-events column if we
    // had one — for now we rely on realtime tl_team_tokens.used_at
    // flipping + the rollback's flag flip to drive UI.
    void teams; void round;

    return json({
      ok:               true,
      counter_token_id: counterId,
      target_token_id:  body.target_token_id,
      rolled_back:      target.type,
    }, 200, req);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500, req);
  }
};
