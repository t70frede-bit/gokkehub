import type { PagesFunction } from "@cloudflare/workers-types";
import type { Env } from "../../_env";
import { json, handlePreflight } from "../../_cors";
import {
  getRoom, updateRoom, getTeams, getPlayers, getRound, updateRound,
  createRound, getTimeline, insertTimelineEntry, updateTeam, recordPlayedTracks,
  batchLookupCorrections, lookupCorrectedYear, upsertSongCorrection,
  lookupAcceptedAnswers, recordAcceptedAnswer, autoJudgeGuess,
} from "../../_supabase";
import { handleGenerate } from "./curate";

// Background pool top-up — fires when the pool is about to run out so the
// game doesn't end abruptly. The handleGenerate function uses host_session_id
// from the room to authenticate, so this works regardless of who triggered
// the round transition.
const POOL_TOPUP_WATERMARK = 5;   // start refill when ≤5 unplayed tracks remain
const POOL_CAP             = 60;  // don't grow indefinitely
import type {
  PlacementRequest, TurnActionRequest, GuessRequest, JudgeRequest,
  FinalizeJudgmentRequest, UseTokenRequest, StageRequest,
  ProposeYearCorrectionRequest, ApproveYearCorrectionRequest,
  TlRoom, TlRound, TlTeam, TlPlayer, JudgeMode,
} from "../../../src/lib/types";

// POST /room/:id/round — sub-actions via ?action= query param
//   ?action=place           — captain submits placement (left_year / right_year)
//   ?action=guess           — captain submits artist/songname guess
//   ?action=judge           — eligible player marks the guess correct/incorrect
//   ?action=finalize        — finalize vote-all judging when timer expires
//   ?action=usetoken        — captain spends a token mid-round (no placement, lock pending, end turn)
//   ?action=turn            — captain ends/continues turn (stop | next)
//   ?action=propose-year    — any player suggests a year correction for the current track
//   ?action=approve-year    — host accepts/rejects the proposed year correction

export const onRequest: PagesFunction<Env> = async ({ request, params, env, waitUntil }) => {
  const pre = handlePreflight(request as unknown as Request);
  if (pre) return pre;
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const req    = request as unknown as Request;
  const roomId = params.id as string;
  const action = new URL(req.url).searchParams.get("action");

  if (action === "place")        return handlePlace(req, roomId, env);
  if (action === "stage")        return handleStage(req, roomId, env);
  if (action === "guess")        return handleGuess(req, roomId, env);
  if (action === "judge")        return handleJudge(req, roomId, env);
  if (action === "finalize")     return handleFinalize(req, roomId, env, waitUntil);
  if (action === "usetoken")     return handleUseToken(req, roomId, env, waitUntil);
  if (action === "turn")         return handleTurnAction(req, roomId, env, waitUntil);
  if (action === "propose-year") return handleProposeYear(req, roomId, env);
  if (action === "approve-year") return handleApproveYear(req, roomId, env);
  if (action === "recovery-pick") return handleRecoveryPick(req, roomId, env);
  if (action === "report-video") return handleReportVideo(req, roomId, env);
  if (action === "approve-video-report") return handleApproveVideoReport(req, roomId, env);
  if (action === "redo-round")   return handleRedoRound(req, roomId, env);
  if (action === "buy-token")    return handleBuyToken(req, roomId, env);
  return json({ error: "Unknown action" }, 400, req);
};

type WaitUntil = ((p: Promise<unknown>) => void) | undefined;

// If the pool is running low, kick off a refill in the background. handleGenerate
// authenticates via room.host_session_id (migration 011) so it doesn't need
// the triggering player to be the host.
function maybeTopUpPool(
  env: Env,
  req: Request,
  roomId: string,
  poolLength: number,
  newCursor: number,
  waitUntil: WaitUntil,
) {
  const remaining = poolLength - newCursor;
  if (remaining > POOL_TOPUP_WATERMARK) return;
  if (poolLength >= POOL_CAP)            return;
  const synthReq = new Request(req.url, {
    method:  "POST",
    headers: req.headers,
    body:    JSON.stringify({ player_id: "auto-topup" }),
  });
  const work = handleGenerate(synthReq, roomId, env, true)
    .then(async (r) => {
      if (!r.ok) {
        const text = await r.text().catch(() => "");
        console.warn("[musix] auto top-up returned", r.status, text.slice(0, 200));
      }
    })
    .catch((e) => console.warn("[musix] auto top-up threw:", e));
  if (waitUntil) waitUntil(work); else void work;
}

// In gamemaster (or legacy singleScreenMode) the host stands in for every
// team's captain so one device can drive the whole game. This helper
// centralises the check.
function actsAsCaptain(room: TlRoom, captain: TlPlayer | undefined, playerId: string): boolean {
  if (captain && captain.id === playerId) return true;
  const gamemastering = !!(room.settings?.gamemasterMode || room.settings?.singleScreenMode);
  if (gamemastering && room.host_id === playerId) return true;
  return false;
}

// Gamemaster mode forces "host" judging — the gamemaster is the only human
// in the room, so "team captain" / "next team captain" / "vote all" would
// either gate nobody (no captain on the host's nonexistent team, no opposing
// captain, no other voters) or require fake votes. Keeping the user's
// stored judgeMode value untouched lets them switch back if they later
// leave gamemaster mode.
function effectiveJudgeMode(room: Pick<TlRoom, "settings">): JudgeMode {
  if (room.settings?.gamemasterMode || room.settings?.singleScreenMode) return "host";
  return (room.settings?.judgeMode ?? "team-captain") as JudgeMode;
}

// Update a single pending-track entry's releaseYear inside team.pending_tracks
// JSON, e.g. when a year correction is approved and the cached SpotifyTrack
// still holds the wrong Spotify year. PostgREST doesn't have an in-place
// JSON array update, so we read → mutate → write back.
async function patchPendingTrackYear(env: Env, teamId: number, trackId: string, year: number) {
  const teamRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/tl_teams?id=eq.${teamId}&select=pending_tracks`,
    {
      headers: {
        apikey:        env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    },
  );
  if (!teamRes.ok) return;
  const rows = await teamRes.json() as Array<{ pending_tracks?: Array<{ id: string; releaseYear?: number; [k: string]: unknown }> }>;
  const current = rows[0]?.pending_tracks ?? [];
  if (!current.some(t => t.id === trackId)) return;
  const patched = current.map(t => t.id === trackId ? { ...t, releaseYear: year } : t);
  await updateTeam(env, teamId, { pending_tracks: patched as never });
}

// ── Stage (live staging — captain's tentative placement) ────────────────────

async function handleStage(req: Request, roomId: string, env: Env) {
  const body = await req.json() as StageRequest;
  const { round_id, player_id, staged_left_year, staged_right_year } = body;

  const [room, round, players] = await Promise.all([
    getRoom(env, roomId), getRound(env, round_id), getPlayers(env, roomId),
  ]);
  if (!room || !round)        return json({ error: "Not found" }, 404, req);
  if (round.outcome !== null) return json({ error: "Round already resolved" }, 409, req);

  const captain = players.find(p => p.team_id === room.active_team_id && p.is_captain);
  if (!actsAsCaptain(room, captain, player_id)) {
    return json({ error: "Only the captain can stage placement" }, 403, req);
  }

  await updateRound(env, round_id, {
    staged_left_year:  staged_left_year,
    staged_right_year: staged_right_year,
  });
  return json({ ok: true }, 200, req);
}

// ── Place ─────────────────────────────────────────────────────────────────────

async function handlePlace(req: Request, roomId: string, env: Env) {
  const body = await req.json() as PlacementRequest & { player_id: string };
  const { round_id, left_year, right_year, player_id, artist_guess, songname_guess } = body;

  const [room, round, players] = await Promise.all([
    getRoom(env, roomId), getRound(env, round_id), getPlayers(env, roomId),
  ]);
  if (!room || !round) return json({ error: "Not found" }, 404, req);
  if (round.outcome !== null) return json({ error: "Round already resolved" }, 409, req);

  const captain = players.find(p => p.team_id === room.active_team_id && p.is_captain);
  if (!actsAsCaptain(room, captain, player_id)) {
    return json({ error: "Only the team captain can place" }, 403, req);
  }

  // Use host-approved corrected year when present (overrides Spotify default).
  const actualYear = round.corrected_year ?? round.track.releaseYear;
  // year_tolerance widens both edges of the placement window. ±5 Years token
  // sets this to 5; default is 0.
  const tolerance = round.year_tolerance ?? 0;
  // At least one bound must be set: both-null means "no placement attempted"
  // and is the auto-fail path used when the turn timer expires without the
  // captain dragging the card. Without this guard, both-null collapsed the
  // boolean to `(true && true) === true` and silently marked the round
  // correct — the bug the timer-expiry behaviour was originally hitting.
  const placed = left_year !== null || right_year !== null;
  const correct = placed &&
    (left_year === null  || (left_year - tolerance) <= actualYear) &&
    (right_year === null || actualYear <= (right_year + tolerance));

  const outcome = correct ? "correct" : "incorrect";
  const update: Partial<TlRound> = {
    outcome,
    left_year:   left_year ?? undefined,
    right_year:  right_year ?? undefined,
    revealed_at: new Date().toISOString(),
  };

  // Combine guess with placement when correct: store guesses + start judging window only if there's actual content.
  if (correct) {
    const a = (artist_guess   ?? "").slice(0, 120);
    const s = (songname_guess ?? "").slice(0, 120);
    update.artist_guess   = a;
    update.songname_guess = s;
    if (a.trim() !== "" || s.trim() !== "") {
      update.judging_started_at = new Date().toISOString();
    }

    // Auto-judge against canonical + stored accepted answers. If both
    // fields auto-resolve to true, also mark judging_finalized so the
    // bonus path can fire without a human in the loop.
    const accepted = await lookupAcceptedAnswers(env, round.track.id);
    const artistMatch = a.trim() ? autoJudgeGuess(a, "artist",   round.track.artist, accepted) : null;
    const songMatch   = s.trim() ? autoJudgeGuess(s, "songname", round.track.name,   accepted) : null;
    if (artistMatch) {
      update.artist_correct = true;
      console.log(`[auto-judge] artist "${a}" matched ${artistMatch.matched}${artistMatch.storedConfirmations ? ` (confirmations=${artistMatch.storedConfirmations})` : ""} for ${round.track.id}`);
    }
    if (songMatch) {
      update.songname_correct = true;
      console.log(`[auto-judge] songname "${s}" matched ${songMatch.matched}${songMatch.storedConfirmations ? ` (confirmations=${songMatch.storedConfirmations})` : ""} for ${round.track.id}`);
    }
    if (artistMatch && songMatch) update.judging_finalized = true;
  }

  await updateRound(env, round_id, update);

  if (correct) {
    const teams = await getTeams(env, roomId);
    const activeTeam = teams.find(t => t.id === room.active_team_id);
    if (activeTeam) {
      await updateTeam(env, activeTeam.id, {
        pending_tracks: [...(activeTeam.pending_tracks ?? []), round.track],
      });
      // Shop-mode: credit points immediately for any fields the auto-judge
      // just flipped to true. Read the round back to pick up the
      // auto-judge updates we wrote a few lines above.
      const tokenEconomy = (room.settings?.tokenEconomy ?? "bonus") as "standard" | "bonus" | "shop";
      if (tokenEconomy === "shop") {
        const refreshedRound = await getRound(env, round_id);
        await maybeAwardShopPoints(env, refreshedRound, activeTeam, tokenEconomy);
      }
    }
  } else {
    // Wrong: clear pending; captain advances turn explicitly via ?action=turn
    const teams = await getTeams(env, roomId);
    const activeTeam = teams.find(t => t.id === room.active_team_id);
    if (activeTeam) await updateTeam(env, activeTeam.id, { pending_tracks: [] });
  }

  return json({ outcome, actual_year: actualYear }, 200, req);
}

// ── Guess (captain only) ─────────────────────────────────────────────────────

async function handleGuess(req: Request, roomId: string, env: Env) {
  const body = await req.json() as GuessRequest;
  const { round_id, player_id, artist_guess, songname_guess } = body;

  const [room, round, players] = await Promise.all([
    getRoom(env, roomId), getRound(env, round_id), getPlayers(env, roomId),
  ]);
  if (!room || !round)             return json({ error: "Not found" }, 404, req);
  if (round.outcome !== "correct") return json({ error: "Cannot guess on this round" }, 400, req);

  const captain = players.find(p => p.team_id === room.active_team_id && p.is_captain);
  if (!actsAsCaptain(room, captain, player_id)) {
    return json({ error: "Only the team captain can submit guesses" }, 403, req);
  }

  await updateRound(env, round_id, {
    artist_guess:       (artist_guess   ?? "").slice(0, 120),
    songname_guess:     (songname_guess ?? "").slice(0, 120),
    judging_started_at: new Date().toISOString(),
  });

  return json({ ok: true }, 200, req);
}

// ── Judge (mode-aware) ───────────────────────────────────────────────────────

async function handleJudge(req: Request, roomId: string, env: Env) {
  const body = await req.json() as JudgeRequest;
  const { round_id, player_id, kind, verdict } = body;

  if (kind !== "artist" && kind !== "songname" && kind !== "combined") {
    return json({ error: "kind must be 'artist', 'songname', or 'combined'" }, 400, req);
  }

  const [room, round, players, teams] = await Promise.all([
    getRoom(env, roomId), getRound(env, round_id), getPlayers(env, roomId), getTeams(env, roomId),
  ]);
  if (!room || !round)             return json({ error: "Not found" }, 404, req);
  if (round.outcome !== "correct") return json({ error: "Cannot judge this round" }, 400, req);
  if (round.judging_finalized)     return json({ error: "Judgment already finalized" }, 409, req);

  const me = players.find(p => p.id === player_id);
  if (!me) return json({ error: "Player not in room" }, 403, req);

  const judgeMode: JudgeMode = effectiveJudgeMode(room);
  const eligible = isJudgeEligible(judgeMode, me, room.host_id, room.active_team_id ?? null, teams, players);
  if (!eligible) return json({ error: "Not eligible to judge in this mode" }, 403, req);

  if (judgeMode === "vote-all") {
    // Vote: combined verdict counts for both fields. artist|songname kinds
    // remain supported for compatibility but UI now only sends "combined".
    const newArtist   = kind === "artist"   || kind === "combined" ? { ...(round.artist_votes   ?? {}), [player_id]: verdict } : round.artist_votes;
    const newSongname = kind === "songname" || kind === "combined" ? { ...(round.songname_votes ?? {}), [player_id]: verdict } : round.songname_votes;
    await updateRound(env, round_id, {
      artist_votes:   newArtist   as never,
      songname_votes: newSongname as never,
    });
    await maybeAutoFinalize(env, { ...round, artist_votes: newArtist as never, songname_votes: newSongname as never }, players);
  } else {
    // Direct verdict from the single eligible judge.
    const update: Partial<TlRound> = {};
    if (kind === "artist"   || kind === "combined") update.artist_correct   = verdict;
    if (kind === "songname" || kind === "combined") update.songname_correct = verdict;
    await updateRound(env, round_id, update);

    // Shop-mode: credit points for any positive verdict that wasn't
    // already counted. Idempotent via shop_*_pointed flags.
    const tokenEconomy = (room.settings?.tokenEconomy ?? "bonus") as "standard" | "bonus" | "shop";
    if (tokenEconomy === "shop" && verdict === true) {
      const team = teams.find(t => t.id === round.team_id);
      const refreshedRound = await getRound(env, round_id);
      if (team) await maybeAwardShopPoints(env, refreshedRound, team, tokenEconomy);
    }

    // On a positive verdict, teach the global accepted-answers table the
    // variant this judge accepted so future games auto-judge it. Audit
    // fields capture WHO accepted what — easy to spot a lenient host
    // pattern after the fact.
    if (verdict === true) {
      if ((kind === "artist"   || kind === "combined") && round.artist_guess) {
        await recordAcceptedAnswer(env, {
          trackId:    round.track.id,
          kind:       "artist",
          rawGuess:   round.artist_guess,
          playerId:   me.id,
          playerName: me.name,
          sourceRoom: roomId,
        });
      }
      if ((kind === "songname" || kind === "combined") && round.songname_guess) {
        await recordAcceptedAnswer(env, {
          trackId:    round.track.id,
          kind:       "songname",
          rawGuess:   round.songname_guess,
          playerId:   me.id,
          playerName: me.name,
          sourceRoom: roomId,
        });
      }
    }
  }

  return json({ ok: true }, 200, req);
}

// ── Year correction (player proposes; host approves) ────────────────────────

async function handleProposeYear(req: Request, roomId: string, env: Env) {
  const body = await req.json() as ProposeYearCorrectionRequest;
  const { round_id, player_id, year } = body;

  if (!Number.isInteger(year) || year < 1900 || year > 2100) {
    return json({ error: "Year must be between 1900 and 2100" }, 400, req);
  }

  const [room, round, players] = await Promise.all([
    getRoom(env, roomId), getRound(env, round_id), getPlayers(env, roomId),
  ]);
  if (!room || !round) return json({ error: "Not found" }, 404, req);

  const me = players.find(p => p.id === player_id);
  if (!me) return json({ error: "Not in room" }, 403, req);

  // Host applies immediately; everyone else proposes for host approval.
  if (me.is_host || room.host_id === player_id) {
    await applyYearCorrection(env, round, year);
    // Persist globally so the corrected year flows to the timeline when
    // the pending card locks — and so every future room inherits it.
    // Audit fields capture who; in this branch it's the host, who just
    // self-approved by being host. (Audit visible via migration 017.)
    await upsertSongCorrection(env, round.track.id, year, roomId, me.id, me.name);
    return json({ ok: true, applied: true }, 200, req);
  }

  await updateRound(env, round_id, {
    year_correction_proposed:      year,
    year_correction_proposed_by:   player_id,
    year_correction_proposed_name: me.name,
  } as Partial<TlRound>);
  return json({ ok: true, proposed: year }, 200, req);
}

async function handleApproveYear(req: Request, roomId: string, env: Env) {
  const body = await req.json() as ApproveYearCorrectionRequest;
  const { round_id, player_id, approve } = body;

  const [room, round] = await Promise.all([getRoom(env, roomId), getRound(env, round_id)]);
  if (!room || !round) return json({ error: "Not found" }, 404, req);
  if (room.host_id !== player_id) return json({ error: "Only the host can approve" }, 403, req);
  if (round.year_correction_proposed === null) return json({ error: "No pending correction" }, 400, req);

  if (approve) {
    await applyYearCorrection(env, round, round.year_correction_proposed);
    // Persist the correction so every future game inherits it (migration
    // 013). Latest-wins — overwrites any prior correction for this track.
    // Audit identifies the original PROPOSER (not the approving host) so
    // a player who repeatedly proposes nonsense is easy to spot even
    // after the host approves; the host approval is itself implicit.
    await upsertSongCorrection(
      env,
      round.track.id,
      round.year_correction_proposed,
      roomId,
      round.year_correction_proposed_by ?? undefined,
      round.year_correction_proposed_name ?? undefined,
    );
  }
  // Clear the proposal either way
  await updateRound(env, round_id, {
    year_correction_proposed:      null,
    year_correction_proposed_by:   null,
    year_correction_proposed_name: null,
  } as Partial<TlRound>);
  return json({ ok: true, approved: approve }, 200, req);
}

// Update the round's corrected_year and propagate the new year to every place
// the old (wrong) year may have been cached: the locked timeline entry if
// already there, and team.pending_tracks for cards still on the spotlight
// rail. Without the pending-tracks patch, the rail visually keeps a card at
// its original Spotify year even though the round is now marked correct,
// which is what the user actually sees first.
async function applyYearCorrection(env: Env, round: TlRound, year: number) {
  await updateRound(env, round.id, { corrected_year: year } as Partial<TlRound>);
  // Patch the timeline entry if this track has been locked already.
  const url = `${env.SUPABASE_URL}/rest/v1/tl_timeline?track_id=eq.${round.track.id}&team_id=eq.${round.team_id}`;
  await fetch(url, {
    method: "PATCH",
    headers: {
      "Content-Type":  "application/json",
      "apikey":        env.SUPABASE_SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Prefer":        "return=minimal",
    },
    body: JSON.stringify({ corrected_year: year, year }),
  });

  // Patch the same track inside team.pending_tracks JSON so the timeline
  // rail's pending-card row reflects the corrected year before turn-end.
  // The rail merges locked entries + pending tracks by year, so leaving the
  // old releaseYear here makes the card sit between the wrong gap markers.
  await patchPendingTrackYear(env, round.team_id, round.track.id, year);

  // Re-evaluate placement against the corrected year. If a wrong placement
  // now falls within the captain's window, flip outcome to "correct" and
  // restore the track into the active team's pending pile. Only upgrades —
  // we never demote a correct round (would punish accidental wins from a
  // bad Spotify year that happened to land in the right slot).
  if (round.outcome === "incorrect") {
    const tolerance = round.year_tolerance ?? 0;
    const nowCorrect =
      (round.left_year  === null || (round.left_year  - tolerance) <= year) &&
      (round.right_year === null || year <= (round.right_year + tolerance));
    if (nowCorrect) {
      await updateRound(env, round.id, { outcome: "correct" } as Partial<TlRound>);
      // Restore the track to pending. Previous-round pending cards already
      // lost from the wrong placement aren't recoverable (we don't track
      // pre-placement state) — but the current track being placed is.
      const teamRes = await fetch(
        `${env.SUPABASE_URL}/rest/v1/tl_teams?id=eq.${round.team_id}&select=pending_tracks`,
        {
          headers: {
            apikey:        env.SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          },
        },
      );
      if (teamRes.ok) {
        const rows = await teamRes.json() as Array<{ pending_tracks?: Array<{ id: string }> }>;
        const current = rows[0]?.pending_tracks ?? [];
        if (!current.some(t => t.id === round.track.id)) {
          // Restore with the corrected releaseYear so the timeline rail
          // visualises the card at the (now correct) year, not the wrong
          // Spotify default it would have used otherwise.
          const trackCorrected = { ...round.track, releaseYear: year };
          await updateTeam(env, round.team_id, {
            pending_tracks: [...current, trackCorrected] as never,
          });
        }
      }
    }
  }
}

// ── Bad-YouTube-version flow (player proposes; host approves; redo) ─────────

async function handleReportVideo(req: Request, roomId: string, env: Env) {
  const body = await req.json() as { round_id: number; player_id: string };
  const { round_id, player_id } = body;

  const [room, round, players] = await Promise.all([
    getRoom(env, roomId), getRound(env, round_id), getPlayers(env, roomId),
  ]);
  if (!room || !round) return json({ error: "Not found" }, 404, req);
  const me = players.find(p => p.id === player_id);
  if (!me) return json({ error: "Not in room" }, 403, req);

  await updateRound(env, round_id, {
    video_report_proposed:      true,
    video_report_proposed_by:   player_id,
    video_report_proposed_name: me.name,
  } as Partial<TlRound>);
  return json({ ok: true, proposed: true }, 200, req);
}

async function handleApproveVideoReport(req: Request, roomId: string, env: Env) {
  const body = await req.json() as { round_id: number; player_id: string; approve: boolean };
  const { round_id, player_id, approve } = body;

  const [room, round] = await Promise.all([getRoom(env, roomId), getRound(env, round_id)]);
  if (!room || !round) return json({ error: "Not found" }, 404, req);
  if (room.host_id !== player_id) return json({ error: "Only the host can approve" }, 403, req);
  if (!round.video_report_proposed) return json({ error: "No pending report" }, 400, req);

  const update: Partial<TlRound> = {
    video_report_proposed:      false,
    video_report_proposed_by:   null,
    video_report_proposed_name: null,
  };
  if (approve) update.video_report_approved = true;
  await updateRound(env, round_id, update as never);
  return json({ ok: true, approved: approve }, 200, req);
}

async function handleRedoRound(req: Request, roomId: string, env: Env) {
  const body = await req.json() as { round_id: number; player_id: string };
  const { round_id, player_id } = body;

  const [room, round, teams] = await Promise.all([
    getRoom(env, roomId), getRound(env, round_id), getTeams(env, roomId),
  ]);
  if (!room || !round) return json({ error: "Not found" }, 404, req);
  if (room.host_id !== player_id) return json({ error: "Only the host can redo" }, 403, req);
  if (!round.video_report_approved) return json({ error: "Report must be approved first" }, 400, req);

  // If the captain had answered correctly, the track was added to pending.
  // We're undoing the placement attempt so the track should leave pending —
  // it can be re-earned (or lost) once the redo plays out.
  if (round.outcome === "correct") {
    const activeTeam = teams.find(t => t.id === round.team_id);
    if (activeTeam) {
      const pending = (activeTeam.pending_tracks ?? []) as Array<{ id: string }>;
      const filtered = pending.filter(t => t.id !== round.track.id);
      if (filtered.length !== pending.length) {
        await updateTeam(env, activeTeam.id, { pending_tracks: filtered as never });
      }
    }
  }

  // Reset round state so the captain starts fresh.
  await updateRound(env, round_id, {
    outcome:               null,
    left_year:             null,
    right_year:            null,
    staged_left_year:      null,
    staged_right_year:     null,
    revealed_at:           null,
    artist_guess:          null,
    songname_guess:        null,
    artist_correct:        null,
    songname_correct:      null,
    judging_started_at:    null,
    judging_finalized:     false,
    bonus_awarded:         false,
    video_report_approved: false,
    redo_requested_at:     new Date().toISOString(),
  } as Partial<TlRound>);

  // Reset audio state — bot will re-resolve and set playing_since fresh.
  await updateRoom(env, roomId, { playing_since: null, paused_at_ms: null });
  return json({ ok: true, redo: true }, 200, req);
}

// ── Shop: buy a token with points (shop tokenEconomy only) ──────────────────

async function handleBuyToken(req: Request, roomId: string, env: Env) {
  const body = await req.json() as { player_id: string; token_type: string };
  const { player_id, token_type } = body;

  const [room, players, teams] = await Promise.all([
    getRoom(env, roomId), getPlayers(env, roomId), getTeams(env, roomId),
  ]);
  if (!room) return json({ error: "Room not found" }, 404, req);

  const tokenEconomy = (room.settings?.tokenEconomy ?? "bonus") as "standard" | "bonus" | "shop";
  if (tokenEconomy !== "shop") {
    return json({ error: "Token shop is only available in shop mode" }, 400, req);
  }
  // SHOP_TOKEN_COSTS lives in src/lib/types.ts so the lobby + game UI
  // and this endpoint stay in lock-step. Server inlines the same table
  // here to avoid a cross-import from server functions into client lib.
  // Mirror of SHOP_TOKEN_COSTS in src/lib/types.ts — keep in sync. Token
  // names match TOKEN_CATALOG types in src/lib/tokens.ts.
  const SHOP_COSTS: Record<string, number> = {
    cover_reveal_before: 2, cover_reveal: 2, song_skipper: 2,
    year_span_5: 3, more_or_less: 3, reference_point: 3,
    recovery: 4, card_remover: 4,
    force_lock: 6, song_limiter: 6,
  };
  const cost = SHOP_COSTS[token_type];
  if (!cost) return json({ error: `Token ${token_type} can't be purchased` }, 400, req);

  const team = teams.find(t => t.id === room.active_team_id);
  if (!team) return json({ error: "No active team" }, 400, req);

  const captain = players.find(p => p.team_id === team.id && p.is_captain);
  if (!actsAsCaptain(room, captain, player_id)) {
    return json({ error: "Only the team captain can buy tokens" }, 403, req);
  }
  if ((team.points ?? 0) < cost) {
    return json({ error: `Not enough points (need ${cost}, have ${team.points ?? 0})` }, 400, req);
  }

  // Deduct + grant. The bought token is immediately ready (pending=false)
  // — buyer paid points, they shouldn't have to wait until next turn to
  // use it. That's different from bonus-mode tokens which are pending.
  const remaining = (team.points ?? 0) - cost;
  await updateTeam(env, team.id, { points: remaining });
  await insertTeamToken(env, {
    room_id: roomId,
    team_id: team.id,
    type:    token_type,
    granted_round: room.current_round_id ?? undefined,
    pending: false,
  });
  console.log(`[shop] team ${team.id} bought ${token_type} for ${cost} (remaining ${remaining})`);
  return json({ ok: true, remaining }, 200, req);
}

// ── Recovery pick (save one pending card after wrong placement) ─────────────

interface RecoveryPickRequest {
  round_id:  number;
  player_id: string;
  track_id:  string;
}

async function handleRecoveryPick(req: Request, roomId: string, env: Env) {
  const body = await req.json() as RecoveryPickRequest;
  const { round_id, player_id, track_id } = body;

  const [room, round, players, teams] = await Promise.all([
    getRoom(env, roomId), getRound(env, round_id),
    getPlayers(env, roomId), getTeams(env, roomId),
  ]);
  if (!room || !round) return json({ error: "Not found" }, 404, req);
  if (round.outcome !== "incorrect") {
    return json({ error: "Recovery only applies after a wrong placement" }, 409, req);
  }
  if (!round.recovery_armed) {
    return json({ error: "Recovery token not active on this round" }, 409, req);
  }

  const activeTeam = teams.find(t => t.id === room.active_team_id);
  if (!activeTeam) return json({ error: "No active team" }, 400, req);

  const captain = players.find(p => p.team_id === activeTeam.id && p.is_captain);
  if (!actsAsCaptain(room, captain, player_id)) {
    return json({ error: "Only the captain can pick a recovery card" }, 403, req);
  }

  const pending = (activeTeam.pending_tracks ?? []) as Array<{ id: string; releaseYear: number; [k: string]: unknown }>;
  const picked  = pending.find(p => p.id === track_id);
  if (!picked) {
    return json({ error: "That card isn't in your pending pile" }, 400, req);
  }

  // Save ONLY the picked card. Other pending tracks are lost (standard
  // "save one" semantics — see roadmap decision).
  await lockPendingTracks(env, activeTeam.id, [picked]);
  await updateTeam(env, activeTeam.id, { pending_tracks: [] });
  await updateRound(env, round.id, { recovery_armed: false });

  return json({ ok: true }, 200, req);
}

// ── Finalize (vote-all timer expiry) ─────────────────────────────────────────

async function handleFinalize(req: Request, roomId: string, env: Env, _waitUntil?: WaitUntil) {
  const body = await req.json() as FinalizeJudgmentRequest;
  const { round_id } = body;

  const [room, round, players] = await Promise.all([
    getRoom(env, roomId), getRound(env, round_id), getPlayers(env, roomId),
  ]);
  if (!room || !round)            return json({ error: "Not found" }, 404, req);
  if (round.judging_finalized)    return json({ ok: true, already: true }, 200, req);
  if (round.outcome !== "correct") return json({ error: "Cannot finalize" }, 400, req);

  const judgeMode = effectiveJudgeMode(room);
  if (judgeMode !== "vote-all") return json({ error: "Only vote-all needs finalize" }, 400, req);

  // Verify the timer has actually expired (or all voters in)
  const startedAt = round.judging_started_at ? Date.parse(round.judging_started_at) : 0;
  const timerSec  = room.settings?.voteTimerSeconds ?? 20;
  const allVoted  = isAllVoted(round, players);
  const expired   = startedAt > 0 && Date.now() >= startedAt + timerSec * 1000;
  if (!allVoted && !expired) {
    return json({ error: "Timer has not expired and not all players have voted" }, 400, req);
  }

  const artistFinal   = tally(round.artist_votes);
  const songnameFinal = tally(round.songname_votes);
  await updateRound(env, round_id, {
    artist_correct:    artistFinal,
    songname_correct:  songnameFinal,
    judging_finalized: true,
  });

  // Shop-mode: credit points for whatever the vote tally just confirmed.
  const tokenEconomy = (room.settings?.tokenEconomy ?? "bonus") as "standard" | "bonus" | "shop";
  if (tokenEconomy === "shop" && (artistFinal === true || songnameFinal === true)) {
    const teams = await getTeams(env, roomId);
    const team = teams.find(t => t.id === round.team_id);
    const refreshedRound = await getRound(env, round_id);
    if (team) await maybeAwardShopPoints(env, refreshedRound, team, tokenEconomy);
  }

  // Teach the global accepted-answers table when the vote-all judging
  // finalizes positive. Source attribution goes to the host since
  // vote-all is collective — easier to spot a host with permissively-
  // judged rooms than to track every individual voter's calls.
  const host = players.find(p => p.id === room.host_id);
  if (host) {
    if (artistFinal === true && round.artist_guess) {
      await recordAcceptedAnswer(env, {
        trackId:    round.track.id,
        kind:       "artist",
        rawGuess:   round.artist_guess,
        playerId:   host.id,
        playerName: host.name,
        sourceRoom: roomId,
      });
    }
    if (songnameFinal === true && round.songname_guess) {
      await recordAcceptedAnswer(env, {
        trackId:    round.track.id,
        kind:       "songname",
        rawGuess:   round.songname_guess,
        playerId:   host.id,
        playerName: host.name,
        sourceRoom: roomId,
      });
    }
  }

  return json({ ok: true }, 200, req);
}

// ── Use token (mid-round skip) ───────────────────────────────────────────────

async function handleUseToken(req: Request, roomId: string, env: Env, waitUntil?: WaitUntil) {
  const body = await req.json() as UseTokenRequest;
  const { round_id, player_id } = body;

  const [room, round, players, teams] = await Promise.all([
    getRoom(env, roomId), getRound(env, round_id), getPlayers(env, roomId), getTeams(env, roomId),
  ]);
  if (!room || !round) return json({ error: "Not found" }, 404, req);
  if (round.outcome !== null) return json({ error: "Round already resolved" }, 409, req);

  const activeTeam = teams.find(t => t.id === room.active_team_id);
  if (!activeTeam) return json({ error: "No active team" }, 400, req);

  const captain = players.find(p => p.team_id === activeTeam.id && p.is_captain);
  if (!actsAsCaptain(room, captain, player_id)) {
    return json({ error: "Only the captain can use a token" }, 403, req);
  }

  // One-token-per-song rule — PER TEAM, not global (so opponents using an
  // opponent-turn token doesn't block the active team's Song Skipper).
  // Song Skipper is by definition the active team, so we filter on activeTeam.id.
  const usedUrl = `${env.SUPABASE_URL}/rest/v1/tl_team_tokens?used_round=eq.${round.id}&team_id=eq.${activeTeam.id}&select=id&limit=1`;
  const usedRes = await fetch(usedUrl, {
    headers: {
      apikey:        env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (usedRes.ok) {
    const usedRows = await usedRes.json() as Array<{ id: number }>;
    if (usedRows.length > 0) {
      return json({ error: "Your team already used a token this song" }, 409, req);
    }
  }

  // Find an available song_skipper token for the active team and burn it.
  const tokenId = await findAndUseToken(env, activeTeam.id, "song_skipper", round.id);
  if (!tokenId) {
    return json({ error: "No Song Skipper token available" }, 400, req);
  }

  // Lock pending, mark round as a friendly skip (year still revealed), advance turn.
  await lockPendingTracks(env, activeTeam.id,
    (activeTeam.pending_tracks ?? []) as Array<{ id: string; releaseYear: number; [k: string]: unknown }>);
  await updateTeam(env, activeTeam.id, {
    tokens:         Math.max(0, activeTeam.tokens - 1),
    pending_tracks: [],
  });
  await updateRound(env, round.id, {
    skipped:     true,
    revealed_at: new Date().toISOString(),
  });

  // Win check
  const timeline = await getTimeline(env, activeTeam.id);
  if (timeline.length >= room.win_target) {
    await updateRoom(env, roomId, { status: "finished" });
    return json({ ok: true, winner: activeTeam.id }, 200, req);
  }

  await advanceTurn(env, roomId, room, teams, req, waitUntil);
  return json({ ok: true }, 200, req);
}

// Find an unused token of the given type for this team and mark it used.
// Returns the token id on success, null when none available.
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

export { findAndUseToken };

// ── Turn action (stop | next) ────────────────────────────────────────────────

async function handleTurnAction(req: Request, roomId: string, env: Env, waitUntil?: WaitUntil) {
  try {
    return await handleTurnActionInner(req, roomId, env, waitUntil);
  } catch (err) {
    const msg = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);
    console.error(`[turn] 500 in handleTurnAction for room ${roomId}:`, msg);
    return json({ error: `turn action threw: ${err instanceof Error ? err.message : String(err)}` }, 500, req);
  }
}

// Run an awaited step and rethrow with the step label prepended, so the
// caller's catch knows exactly which call site threw. Cheap diagnostics
// for paths that touch ~10 sequential DB calls.
async function step<T>(label: string, p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (e) {
    const inner = e instanceof Error ? e.message : String(e);
    const wrapped = new Error(`step "${label}" failed: ${inner}`);
    if (e instanceof Error && e.stack) wrapped.stack = e.stack;
    throw wrapped;
  }
}

async function handleTurnActionInner(req: Request, roomId: string, env: Env, waitUntil?: WaitUntil) {
  const body = await req.json() as TurnActionRequest & { player_id: string };
  const { action, player_id } = body;

  const [room, teams, players] = await Promise.all([
    step("getRoom",    getRoom(env, roomId)),
    step("getTeams",   getTeams(env, roomId)),
    step("getPlayers", getPlayers(env, roomId)),
  ]);
  if (!room) return json({ error: "Room not found" }, 404, req);

  let activeTeam = teams.find(t => t.id === room.active_team_id);
  if (!activeTeam) return json({ error: "No active team" }, 400, req);

  const captain = players.find(p => p.team_id === activeTeam.id && p.is_captain);
  if (!actsAsCaptain(room, captain, player_id)) {
    return json({ error: "Only the team captain can act" }, 403, req);
  }

  // Award token bonus / shop points on the round being closed if
  // eligible. Both calls are idempotent and mode-gated — in shop mode
  // awardBonusIfEligible no-ops and maybeAwardShopPoints credits per-
  // field; in standard/bonus modes the reverse.
  const currentRound = room.current_round_id
    ? await step("getRound", getRound(env, room.current_round_id))
    : null;
  const tokenEconomy = (room.settings?.tokenEconomy ?? "bonus") as "standard" | "bonus" | "shop";
  activeTeam = await step("maybeAwardShopPoints",
    maybeAwardShopPoints(env, currentRound, activeTeam, tokenEconomy)) ?? activeTeam;
  activeTeam = await step("awardBonusIfEligible",
    awardBonusIfEligible(env, currentRound, activeTeam, roomId, tokenEconomy)) ?? activeTeam;

  if (action === "next") {
    // Force Lock — opponent played the token, active team can't continue.
    // Their turn ends after the current song via the "stop" path (pending
    // cards lock, advanceTurn fires).
    if (currentRound?.force_locked) {
      return json({ error: "Your turn was locked by the opposing team" }, 403, req);
    }
    const nextTrack = room.track_pool[room.track_cursor];
    if (!nextTrack) return json({ error: "No more tracks" }, 400, req);

    const nextCorrected = await lookupCorrectedYear(env, nextTrack.id);
    const round = await createRound(env, {
      room_id:        roomId,
      team_id:        activeTeam.id,
      track:          nextTrack,
      outcome:        null,
      revealed_at:    null,
      corrected_year: nextCorrected,
    });
    await recordPlayedTracks(
      env, roomId,
      players.filter(p => !p.is_spectator).map(p => p.id),
      nextTrack.id,
    );
    const newCursor = room.track_cursor + 1;
    // In all-clients-stream mode there's no bot or Spotify player to stamp
    // playing_since — auto-stamp here so each client's <audio> sees the
    // non-null value and tries to autoplay the new track.
    const autoStart = (room.settings?.audioMode ?? "discord-bot") === "all-clients-stream";
    await updateRoom(env, roomId, {
      track_cursor:     newCursor,
      current_round_id: round.id,
      playing_since:    autoStart ? Date.now() : null,
      paused_at_ms:     null,
    });
    maybeTopUpPool(env, req, roomId, room.track_pool.length, newCursor, waitUntil);
    return json({ ok: true, round_id: round.id }, 200, req);
  }

  // stop — lock pending into the timeline, end turn, advance
  await lockPendingTracks(env, activeTeam.id,
    (activeTeam.pending_tracks ?? []) as Array<{ id: string; releaseYear: number; [k: string]: unknown }>);
  await updateTeam(env, activeTeam.id, { pending_tracks: [] });

  // Win condition
  const timeline = await getTimeline(env, activeTeam.id);
  if (timeline.length >= room.win_target) {
    await updateRoom(env, roomId, { status: "finished" });
    return json({ ok: true, winner: activeTeam.id }, 200, req);
  }

  await advanceTurn(env, roomId, room, teams, req, waitUntil);
  return json({ ok: true }, 200, req);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isJudgeEligible(
  mode: JudgeMode,
  me: TlPlayer,
  hostId: string,
  activeTeamId: number | null,
  teams: TlTeam[],
  players: TlPlayer[],
): boolean {
  if (mode === "host") return me.id === hostId;
  if (mode === "vote-all") return !me.is_spectator;
  if (mode === "team-captain") {
    const capt = players.find(p => p.team_id === activeTeamId && p.is_captain);
    return !!capt && capt.id === me.id;
  }
  if (mode === "next-team-captain") {
    const sorted   = [...teams].sort((a, b) => a.sort_order - b.sort_order);
    const activeIx = sorted.findIndex(t => t.id === activeTeamId);
    if (activeIx === -1) return false;
    const nextTeam = sorted[(activeIx + 1) % sorted.length];
    const capt = players.find(p => p.team_id === nextTeam.id && p.is_captain);
    return !!capt && capt.id === me.id;
  }
  return false;
}

function isAllVoted(round: TlRound, players: TlPlayer[]): boolean {
  const voters = players.filter(p => !p.is_spectator);
  if (voters.length === 0) return false;
  const a = round.artist_votes ?? {};
  const s = round.songname_votes ?? {};
  return voters.every(p => p.id in a && p.id in s);
}

function tally(votes: Record<string, boolean> | undefined): boolean {
  if (!votes) return false;
  let yes = 0, no = 0;
  for (const v of Object.values(votes)) v ? yes++ : no++;
  return yes > no; // tie → false
}

async function maybeAutoFinalize(env: Env, round: TlRound, players: TlPlayer[]) {
  if (round.judging_finalized) return;
  if (!isAllVoted(round, players)) return;
  await updateRound(env, round.id, {
    artist_correct:    tally(round.artist_votes),
    songname_correct:  tally(round.songname_votes),
    judging_finalized: true,
  });
}

async function awardBonusIfEligible(
  env: Env,
  round: TlRound | null,
  team: TlTeam,
  roomId: string,
  tokenEconomy: "standard" | "bonus" | "shop",
): Promise<TlTeam | null> {
  if (!round || round.bonus_awarded) return null;
  // Artist Picker (and future Genre Picker) rounds earn no reward — the
  // captain chose the song, so a bonus on top would be a freebie.
  if (round.bonus_blocked) return null;
  if (round.outcome !== "correct") return null;
  if (round.artist_correct !== true || round.songname_correct !== true) return null;
  // Shop mode handles rewards per-correct-field via maybeAwardShopPoints;
  // there's no "both correct" token bonus on top of that.
  if (tokenEconomy === "shop") return null;

  // Token type depends on the mode:
  //  - standard: always Song Skipper (the original Hitster behaviour)
  //  - bonus:    random from the implemented set
  // Keep the bonus list in sync with TOKEN_CATALOG.implemented in
  // src/lib/tokens.ts.
  let type: string;
  if (tokenEconomy === "standard") {
    type = "song_skipper";
  } else {
    const earnable = ["song_skipper", "cover_reveal", "more_or_less"];
    type = earnable[Math.floor(Math.random() * earnable.length)];
  }
  await insertTeamToken(env, {
    room_id: roomId,
    team_id: team.id,
    type,
    granted_round: round.id,
    pending: true,
  });

  await updateRound(env, round.id, { bonus_awarded: true });
  // Mirror to legacy int counter for any UI still reading it.
  const nextPending = (team.tokens_pending ?? 0) + 1;
  await updateTeam(env, team.id, { tokens_pending: nextPending });
  return { ...team, tokens_pending: nextPending };
}

// Shop-mode reward: credits +1 to team.points for each correct-and-not-
// yet-pointed field on this round. Idempotent against repeated calls
// thanks to the shop_*_pointed guards. No-op in non-shop modes.
async function maybeAwardShopPoints(
  env: Env,
  round: TlRound | null,
  team: TlTeam,
  tokenEconomy: "standard" | "bonus" | "shop",
): Promise<TlTeam | null> {
  if (tokenEconomy !== "shop") return null;
  if (!round || round.outcome !== "correct") return null;
  if (round.bonus_blocked) return null;   // Artist/Genre Picker rounds earn nothing
  let pointsToAdd = 0;
  const roundUpdate: Partial<TlRound> = {};
  if (round.artist_correct === true && !round.shop_artist_pointed) {
    pointsToAdd += 1;
    roundUpdate.shop_artist_pointed = true;
  }
  if (round.songname_correct === true && !round.shop_song_pointed) {
    pointsToAdd += 1;
    roundUpdate.shop_song_pointed = true;
  }
  if (pointsToAdd === 0) return null;
  await updateRound(env, round.id, roundUpdate);
  const newPoints = (team.points ?? 0) + pointsToAdd;
  await updateTeam(env, team.id, { points: newPoints });
  console.log(`[shop] +${pointsToAdd} point(s) to team ${team.id} (now ${newPoints}) for round ${round.id}`);
  return { ...team, points: newPoints };
}

async function insertTeamToken(env: Env, row: {
  room_id: string; team_id: number; type: string;
  granted_round?: number; pending?: boolean;
}) {
  const url = `${env.SUPABASE_URL}/rest/v1/tl_team_tokens`;
  await fetch(url, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "apikey":        env.SUPABASE_SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Prefer":        "return=minimal",
    },
    body: JSON.stringify({
      room_id:       row.room_id,
      team_id:       row.team_id,
      type:          row.type,
      pending:       row.pending ?? true,
      granted_round: row.granted_round ?? null,
    }),
  });
}

async function promotePendingTokens(env: Env, teamId: number) {
  const url = `${env.SUPABASE_URL}/rest/v1/tl_team_tokens?team_id=eq.${teamId}&pending=eq.true`;
  await fetch(url, {
    method:  "PATCH",
    headers: {
      "Content-Type":  "application/json",
      "apikey":        env.SUPABASE_SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Prefer":        "return=minimal",
    },
    body: JSON.stringify({ pending: false }),
  });
}

async function lockPendingTracks(
  env: Env,
  teamId: number,
  tracks: Array<{ id: string; releaseYear: number; [k: string]: unknown }>,
) {
  const existing = await getTimeline(env, teamId);
  const newTracks = tracks.filter(t => !existing.some(e => e.track_id === t.id));
  if (newTracks.length === 0) return;
  // Apply persistent global corrections (migration 013) — a track that was
  // year-corrected in any past room locks in with the corrected year here
  // too, so the timeline orders correctly without needing to re-correct.
  const corrections = await batchLookupCorrections(env, newTracks.map(t => t.id));
  for (const track of newTracks) {
    const corrected = corrections.get(track.id) ?? null;
    const year = corrected ?? track.releaseYear;
    await insertTimelineEntry(env, {
      team_id:        teamId,
      track_id:       track.id,
      year,
      position:       0,
      track:          track as never,
      corrected_year: corrected,
    });
  }
}

async function advanceTurn(
  env: Env,
  roomId: string,
  room: Awaited<ReturnType<typeof getRoom>>,
  teams: Awaited<ReturnType<typeof getTeams>>,
  req?: Request,
  waitUntil?: WaitUntil,
) {
  if (!room) return;
  const sortedTeams = [...teams].sort((a, b) => a.sort_order - b.sort_order);
  const currentIdx  = sortedTeams.findIndex(t => t.id === room.active_team_id);
  const nextTeam    = sortedTeams[(currentIdx + 1) % sortedTeams.length];

  // Promote pending tokens — they're now ready for the team that's about to play.
  await promotePendingTokens(env, nextTeam.id);
  if ((nextTeam.tokens_pending ?? 0) > 0) {
    // Mirror to legacy int counter
    await updateTeam(env, nextTeam.id, {
      tokens:         (nextTeam.tokens ?? 0) + (nextTeam.tokens_pending ?? 0),
      tokens_pending: 0,
    });
  }

  const nextTrack = room.track_pool[room.track_cursor];
  if (!nextTrack) {
    await updateRoom(env, roomId, { status: "finished" });
    return;
  }

  const nextCorrected = await lookupCorrectedYear(env, nextTrack.id);
  const round = await createRound(env, {
    room_id:        roomId,
    team_id:        nextTeam.id,
    track:          nextTrack,
    outcome:        null,
    revealed_at:    null,
    corrected_year: nextCorrected,
  });

  // Recently-heard blacklist — every non-spectator player just heard this.
  const turnPlayers = await getPlayers(env, roomId);
  await recordPlayedTracks(
    env, roomId,
    turnPlayers.filter(p => !p.is_spectator).map(p => p.id),
    nextTrack.id,
  );

  const newCursor = room.track_cursor + 1;
  // See the matching comment in handleTurnAction — all-clients-stream
  // mode auto-starts so the host doesn't have to click play every round.
  const autoStart = (room.settings?.audioMode ?? "discord-bot") === "all-clients-stream";
  await updateRoom(env, roomId, {
    active_team_id:   nextTeam.id,
    track_cursor:     newCursor,
    current_round_id: round.id,
    playing_since:    autoStart ? Date.now() : null,
    paused_at_ms:     null,
  });

  // Background pool top-up — see maybeTopUpPool for the trigger condition.
  // Skipped if we have no request handle (e.g. internal callers).
  if (req) maybeTopUpPool(env, req, roomId, room.track_pool.length, newCursor, waitUntil);
}
