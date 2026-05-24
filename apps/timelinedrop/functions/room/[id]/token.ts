import type { PagesFunction } from "@cloudflare/workers-types";
import type { Env } from "../../_env";
import { json, handlePreflight } from "../../_cors";
import { getRoom, getRound, getPlayers, getTeams, updateRound } from "../../_supabase";

// POST /room/:id/token
// Body: { round_id, player_id, type, payload? }
//   type ∈ "cover_reveal" | "more_or_less" | "recovery_arm"
// Each effect mutates one or two columns on the active round and burns the
// token. More complex effects (steal_by_year, force_lock, etc) will land in
// follow-up commits.

interface UseBody {
  round_id:  number;
  player_id: string;
  type:      string;
  payload?:  Record<string, unknown>;
}

const ALLOWED_TYPES = new Set([
  "cover_reveal",
  "cover_reveal_before",
  "more_or_less",
  "recovery_arm",
  "year_span_5",
  "force_lock",
  "reference_point",
  "card_remover",
  "song_limiter",
]);

// Phase category per token type — drives auth (who can play it). Kept local
// to the server because src/lib/tokens.ts imports from React; this map
// reflects the same shape but only what the server needs.
type TokenCategory = "during_listen" | "before_song" | "before_pass" | "opponent_turn" | "anytime";
const CATEGORY_BY_TYPE: Record<string, TokenCategory> = {
  cover_reveal:        "during_listen",
  cover_reveal_before: "before_song",
  more_or_less:        "during_listen",
  year_span_5:         "during_listen",
  recovery_arm:        "before_pass",
  force_lock:          "opponent_turn",
  reference_point:     "during_listen",
  card_remover:        "during_listen",
  song_limiter:        "opponent_turn",
};

// How many seconds the opposing team gets to listen once song_limiter is
// burned. Catalog description is "20 seconds"; tune here if needed.
const SONG_LIMITER_SECONDS = 20;

export const onRequest: PagesFunction<Env> = async ({ request, params, env }) => {
  const pre = handlePreflight(request as unknown as Request);
  if (pre) return pre;
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const req    = request as unknown as Request;
  const roomId = params.id as string;

  try {
    const body = await req.json() as UseBody;
    const { round_id, player_id, type, payload } = body;

    if (!ALLOWED_TYPES.has(type)) {
      return json({ error: `Unsupported token type: ${type}` }, 400, req);
    }

    const [room, round, players, teams] = await Promise.all([
      getRoom(env, roomId), getRound(env, round_id),
      getPlayers(env, roomId), getTeams(env, roomId),
    ]);
    if (!room || !round) return json({ error: "Not found" }, 404, req);

    const activeTeam = teams.find(t => t.id === room.active_team_id);
    if (!activeTeam) return json({ error: "No active team" }, 400, req);

    // Resolve the using team. Opponent-turn tokens (Force Lock) come from a
    // non-active team's captain; during_listen tokens from the active team's
    // captain. Host bypass under single-screen mode routes to the right
    // team based on the token's category.
    const category = CATEGORY_BY_TYPE[type] ?? "anytime";
    const requester = players.find(p => p.id === player_id);
    const isHostBypass = !!room.settings?.singleScreenMode && room.host_id === player_id;

    let usingTeamId: number | null = null;
    if (isHostBypass) {
      if (category === "opponent_turn") {
        // Route to a non-active team (2-team rooms unambiguous; 3+ teams
        // currently picks the first non-active team).
        const other = teams.find(t => t.id !== activeTeam.id);
        usingTeamId = other?.id ?? null;
      } else {
        usingTeamId = activeTeam.id;
      }
    } else if (requester && requester.is_captain && requester.team_id !== null) {
      usingTeamId = requester.team_id;
    }
    if (usingTeamId === null) {
      return json({ error: "Only a team captain can use a token" }, 403, req);
    }

    // Phase validation: token category must match the current turn phase.
    if ((category === "during_listen" || category === "before_pass") && usingTeamId !== activeTeam.id) {
      return json({ error: "This token can only be played during your team's turn" }, 403, req);
    }
    if (category === "opponent_turn" && usingTeamId === activeTeam.id) {
      return json({ error: "This token can only be played while the other team is on the spot" }, 403, req);
    }
    if (category === "before_song") {
      // Active team only, and only before the song starts playing — once
      // audio rolls the captain can use the regular cover_reveal instead.
      if (usingTeamId !== activeTeam.id) {
        return json({ error: "Only the active team's captain can play this" }, 403, req);
      }
      if (room.playing_since !== null) {
        return json({ error: "Too late — use Cover Reveal instead once the song is playing" }, 409, req);
      }
    }

    // One-token-per-song rule is PER TEAM. Active team can spend on their
    // own turn and the opposing team can still spend a Force Lock or
    // similar opponent-turn token on the same round.
    if (await teamAlreadyUsedTokenThisRound(env, round.id, usingTeamId)) {
      return json({ error: "Your team already used a token this song" }, 409, req);
    }

    // Map UI type → token type stored in tl_team_tokens.
    // (recovery_arm uses a recovery token; the actual save fires when a wrong
    // placement settles — handled in round.ts.)
    const tokenType =
      type === "recovery_arm"        ? "recovery" :
      type === "cover_reveal"        ? "cover_reveal" :
      type === "cover_reveal_before" ? "cover_reveal_before" :
      type === "more_or_less"        ? "more_or_less" :
      type === "year_span_5"         ? "year_span_5" :
      type === "force_lock"          ? "force_lock"  :
      type === "reference_point"     ? "reference_point" :
      type === "card_remover"        ? "card_remover" :
      type === "song_limiter"        ? "song_limiter" :
      type;

    // Pre-burn payload validation for tokens that target opponent state —
    // we don't want to consume the token on a bad request. card_remover
    // requires the target team to actually own the named track.
    let cardRemoverTarget: { team_id: number; track_id: string } | null = null;
    if (type === "card_remover") {
      const targetTeamId  = typeof payload?.target_team_id === "number" ? payload.target_team_id : null;
      const targetTrackId = typeof payload?.track_id === "string"      ? payload.track_id      : null;
      if (targetTeamId === null || !targetTrackId) {
        return json({ error: "target_team_id and track_id required" }, 400, req);
      }
      if (targetTeamId === activeTeam.id) {
        return json({ error: "Pick an opponent's card, not your own team's" }, 400, req);
      }
      // Pull the WHOLE target timeline so we can both confirm the card
      // exists and refuse to act when removal would leave the opponent
      // with zero cards (game-breaking — the timeline rail would be
      // empty and ordering becomes ill-defined).
      const checkUrl = `${env.SUPABASE_URL}/rest/v1/tl_timeline?team_id=eq.${targetTeamId}&select=track_id`;
      const checkRes = await fetch(checkUrl, {
        headers: {
          apikey:        env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
      });
      if (!checkRes.ok) return json({ error: "Failed to verify target card" }, 500, req);
      const checkRows = await checkRes.json() as Array<{ track_id: string }>;
      if (!checkRows.some(r => r.track_id === targetTrackId)) {
        return json({ error: "That card isn't on the target team's timeline anymore" }, 404, req);
      }
      if (checkRows.length <= 1) {
        return json({ error: "Can't remove an opponent's last card — they'd have nothing to place against" }, 400, req);
      }
      cardRemoverTarget = { team_id: targetTeamId, track_id: targetTrackId };
    }

    // Find + mark used. usingTeamId — NOT necessarily activeTeam — owns the
    // token being burned. Critical for opponent-turn tokens like Force Lock.
    const burned = await findAndUseToken(env, usingTeamId, tokenType, round.id);
    if (!burned) return json({ error: `No ${tokenType} token available` }, 400, req);

    // Apply the effect.
    if (type === "cover_reveal" || type === "cover_reveal_before") {
      // Same in-game effect (round.cover_revealed = true). The category
      // difference is timing: cover_reveal_before is available only before
      // the audio rolls; once the song is playing, cover_reveal is the
      // available variant. Effect-wise they're identical.
      await updateRound(env, round.id, { cover_revealed: true });
    } else if (type === "more_or_less") {
      const cardId = typeof payload?.card_id === "string" ? payload.card_id : null;
      if (!cardId) return json({ error: "card_id required" }, 400, req);
      await updateRound(env, round.id, { more_or_less_card_id: cardId });
    } else if (type === "recovery_arm") {
      await updateRound(env, round.id, { recovery_armed: true });
    } else if (type === "year_span_5") {
      // Widens the captain's placement window by ±5 years. handlePlace reads
      // round.year_tolerance when validating correctness.
      await updateRound(env, round.id, { year_tolerance: 5 });
    } else if (type === "force_lock") {
      // Active team's turn ends after this song regardless of outcome.
      // handleTurnAction rejects action="next" while this flag is set.
      await updateRound(env, round.id, { force_locked: true });
    } else if (type === "steal_by_year") {
      // Arm a Steal by Year attempt. Token burned NOW (during the
      // opponent's turn); the guess submission happens later via
      // /room/:id/steal-year if the opponent gets it wrong. We refuse
      // double-arm so two opposing teams can't both stake a claim on
      // the same round.
      if (round.steal_team_id !== null) {
        return json({ error: "Another team has already armed a steal on this round" }, 409, req);
      }
      if (usingTeamId === round.team_id) {
        return json({ error: "Can't steal your own team's round" }, 400, req);
      }
      await updateRound(env, round.id, { steal_team_id: usingTeamId });
    } else if (type === "song_limiter") {
      // Cut the active team's listening window. The host's audio player
      // watches this column and auto-pauses once playback crosses the
      // threshold. UI shows a "⏱ Ns left" chip while it's active.
      await updateRound(env, round.id, { song_limit_seconds: SONG_LIMITER_SECONDS });
    } else if (type === "card_remover" && cardRemoverTarget) {
      // DELETE the targeted card from the opposing team's timeline. The
      // target team's score (= timeline.length) drops by one — see roadmap
      // decision on "keep the point" (we don't).
      const delUrl = `${env.SUPABASE_URL}/rest/v1/tl_timeline?team_id=eq.${cardRemoverTarget.team_id}&track_id=eq.${encodeURIComponent(cardRemoverTarget.track_id)}`;
      await fetch(delUrl, {
        method: "DELETE",
        headers: {
          apikey:        env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          Prefer:        "return=minimal",
        },
      });
    } else if (type === "reference_point") {
      // Scan the track_pool for a same-year reference (excluding the
      // current round's own track). Fall back to the nearest year if no
      // exact match. Reference is surfaced as a tl_notes row with
      // kind="reference" — UI subscribes and shows it as a hint chip.
      const targetYear = round.corrected_year ?? round.track.releaseYear;
      const candidates = (room.track_pool ?? []).filter(t => t.id !== round.track.id);
      let pick: typeof candidates[number] | null = null;
      const sameYear = candidates.filter(t => t.releaseYear === targetYear);
      if (sameYear.length > 0) {
        pick = sameYear[Math.floor(Math.random() * sameYear.length)];
      } else if (candidates.length > 0) {
        let bestDelta = Number.POSITIVE_INFINITY;
        for (const t of candidates) {
          const d = Math.abs(t.releaseYear - targetYear);
          if (d < bestDelta) { bestDelta = d; pick = t; }
        }
      }
      if (pick) {
        const noteRows = [{
          round_id:    round.id,
          player_id:   "system",
          player_name: "Reference",
          content:     `${pick.artist} — ${pick.name}`,
          kind:        "reference",
        }];
        await fetch(`${env.SUPABASE_URL}/rest/v1/tl_notes`, {
          method:  "POST",
          headers: {
            "Content-Type":  "application/json",
            apikey:          env.SUPABASE_SERVICE_ROLE_KEY,
            Authorization:   `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
            Prefer:          "return=minimal",
          },
          body: JSON.stringify(noteRows),
        });
      }
    }

    return json({ ok: true, token_id: burned }, 200, req);
  } catch (err: unknown) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500, req);
  }
};

async function teamAlreadyUsedTokenThisRound(env: Env, roundId: number, teamId: number): Promise<boolean> {
  const url = `${env.SUPABASE_URL}/rest/v1/tl_team_tokens?used_round=eq.${roundId}&team_id=eq.${teamId}&select=id&limit=1`;
  const res = await fetch(url, {
    headers: {
      apikey:        env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!res.ok) return false;
  const rows = await res.json() as Array<{ id: number }>;
  return rows.length > 0;
}

async function findAndUseToken(
  env: Env, teamId: number, type: string, roundId: number,
): Promise<number | null> {
  const lookupUrl = `${env.SUPABASE_URL}/rest/v1/tl_team_tokens?team_id=eq.${teamId}&type=eq.${encodeURIComponent(type)}&used_at=is.null&pending=eq.false&select=id&limit=1`;
  const lookup = await fetch(lookupUrl, {
    headers: {
      "apikey":        env.SUPABASE_SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!lookup.ok) return null;
  const rows = await lookup.json() as Array<{ id: number }>;
  if (rows.length === 0) return null;
  const id = rows[0].id;

  const updateUrl = `${env.SUPABASE_URL}/rest/v1/tl_team_tokens?id=eq.${id}`;
  await fetch(updateUrl, {
    method: "PATCH",
    headers: {
      "Content-Type":  "application/json",
      "apikey":        env.SUPABASE_SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Prefer":        "return=minimal",
    },
    body: JSON.stringify({
      used_at:    new Date().toISOString(),
      used_round: roundId,
    }),
  });
  return id;
}
