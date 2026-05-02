import type { PagesFunction } from "@cloudflare/workers-types";
import type { Env } from "../../_env";
import { json, handlePreflight } from "../../_cors";
import {
  getRoom, updateRoom, getTeams, getPlayers, getRound, updateRound,
  createRound, getTimeline, insertTimelineEntry, updateTeam,
} from "../../_supabase";
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

export const onRequest: PagesFunction<Env> = async ({ request, params, env }) => {
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
  if (action === "finalize")     return handleFinalize(req, roomId, env);
  if (action === "usetoken")     return handleUseToken(req, roomId, env);
  if (action === "turn")         return handleTurnAction(req, roomId, env);
  if (action === "propose-year") return handleProposeYear(req, roomId, env);
  if (action === "approve-year") return handleApproveYear(req, roomId, env);
  return json({ error: "Unknown action" }, 400, req);
};

// In single-screen mode the host stands in for every team's captain (so one
// device can drive the whole game). This helper centralises the check.
function actsAsCaptain(room: TlRoom, captain: TlPlayer | undefined, playerId: string): boolean {
  if (captain && captain.id === playerId) return true;
  if (room.settings?.singleScreenMode && room.host_id === playerId) return true;
  return false;
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
  const correct =
    (left_year === null || left_year <= actualYear) &&
    (right_year === null || actualYear <= right_year);

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
  }

  await updateRound(env, round_id, update);

  if (correct) {
    const teams = await getTeams(env, roomId);
    const activeTeam = teams.find(t => t.id === room.active_team_id);
    if (activeTeam) {
      await updateTeam(env, activeTeam.id, {
        pending_tracks: [...(activeTeam.pending_tracks ?? []), round.track],
      });
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

  const judgeMode: JudgeMode = (room.settings?.judgeMode ?? "team-captain") as JudgeMode;
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
  }
  // Clear the proposal either way
  await updateRound(env, round_id, {
    year_correction_proposed:      null,
    year_correction_proposed_by:   null,
    year_correction_proposed_name: null,
  } as Partial<TlRound>);
  return json({ ok: true, approved: approve }, 200, req);
}

// Update the round's corrected_year and (if already locked) the timeline entry's year too.
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
}

// ── Finalize (vote-all timer expiry) ─────────────────────────────────────────

async function handleFinalize(req: Request, roomId: string, env: Env) {
  const body = await req.json() as FinalizeJudgmentRequest;
  const { round_id } = body;

  const [room, round, players] = await Promise.all([
    getRoom(env, roomId), getRound(env, round_id), getPlayers(env, roomId),
  ]);
  if (!room || !round)            return json({ error: "Not found" }, 404, req);
  if (round.judging_finalized)    return json({ ok: true, already: true }, 200, req);
  if (round.outcome !== "correct") return json({ error: "Cannot finalize" }, 400, req);

  const judgeMode = (room.settings?.judgeMode ?? "team-captain") as JudgeMode;
  if (judgeMode !== "vote-all") return json({ error: "Only vote-all needs finalize" }, 400, req);

  // Verify the timer has actually expired (or all voters in)
  const startedAt = round.judging_started_at ? Date.parse(round.judging_started_at) : 0;
  const timerSec  = room.settings?.voteTimerSeconds ?? 20;
  const allVoted  = isAllVoted(round, players);
  const expired   = startedAt > 0 && Date.now() >= startedAt + timerSec * 1000;
  if (!allVoted && !expired) {
    return json({ error: "Timer has not expired and not all players have voted" }, 400, req);
  }

  await updateRound(env, round_id, {
    artist_correct:    tally(round.artist_votes),
    songname_correct:  tally(round.songname_votes),
    judging_finalized: true,
  });

  return json({ ok: true }, 200, req);
}

// ── Use token (mid-round skip) ───────────────────────────────────────────────

async function handleUseToken(req: Request, roomId: string, env: Env) {
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
  if (activeTeam.tokens <= 0) {
    return json({ error: "No ready tokens available" }, 400, req);
  }

  // Lock pending tracks, deduct token, mark this round as a no-op skip, advance turn.
  await lockPendingTracks(env, activeTeam.id,
    (activeTeam.pending_tracks ?? []) as Array<{ id: string; releaseYear: number; [k: string]: unknown }>);
  await updateTeam(env, activeTeam.id, {
    tokens:         activeTeam.tokens - 1,
    pending_tracks: [],
  });
  // Mark round as resolved (no outcome — counted as skip)
  await updateRound(env, round.id, {
    outcome:     "incorrect", // not awarded; treat as turn end without a placement
    revealed_at: new Date().toISOString(),
  });

  // Win check
  const timeline = await getTimeline(env, activeTeam.id);
  if (timeline.length >= room.win_target) {
    await updateRoom(env, roomId, { status: "finished" });
    return json({ ok: true, winner: activeTeam.id }, 200, req);
  }

  await advanceTurn(env, roomId, room, teams);
  return json({ ok: true }, 200, req);
}

// ── Turn action (stop | next) ────────────────────────────────────────────────

async function handleTurnAction(req: Request, roomId: string, env: Env) {
  const body = await req.json() as TurnActionRequest & { player_id: string };
  const { action, player_id } = body;

  const [room, teams, players] = await Promise.all([
    getRoom(env, roomId), getTeams(env, roomId), getPlayers(env, roomId),
  ]);
  if (!room) return json({ error: "Room not found" }, 404, req);

  let activeTeam = teams.find(t => t.id === room.active_team_id);
  if (!activeTeam) return json({ error: "No active team" }, 400, req);

  const captain = players.find(p => p.team_id === activeTeam.id && p.is_captain);
  if (!actsAsCaptain(room, captain, player_id)) {
    return json({ error: "Only the team captain can act" }, 403, req);
  }

  // Award token bonus on the round being closed if eligible (idempotent).
  const currentRound = room.current_round_id ? await getRound(env, room.current_round_id) : null;
  activeTeam = await awardBonusIfEligible(env, currentRound, activeTeam) ?? activeTeam;

  if (action === "next") {
    const nextTrack = room.track_pool[room.track_cursor];
    if (!nextTrack) return json({ error: "No more tracks" }, 400, req);

    const round = await createRound(env, {
      room_id:     roomId,
      team_id:     activeTeam.id,
      track:       nextTrack,
      outcome:     null,
      revealed_at: null,
    });
    await updateRoom(env, roomId, {
      track_cursor:     room.track_cursor + 1,
      current_round_id: round.id,
      playing_since:    null,
      paused_at_ms:     null,
    });
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

  await advanceTurn(env, roomId, room, teams);
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
): Promise<TlTeam | null> {
  if (!round || round.bonus_awarded) return null;
  if (round.outcome !== "correct") return null;
  if (round.artist_correct !== true || round.songname_correct !== true) return null;

  // Token earned this turn — pending until the team's NEXT turn starts.
  const nextPending = (team.tokens_pending ?? 0) + 1;
  await updateTeam(env, team.id, { tokens_pending: nextPending });
  await updateRound(env, round.id, { bonus_awarded: true });
  return { ...team, tokens_pending: nextPending };
}

async function lockPendingTracks(
  env: Env,
  teamId: number,
  tracks: Array<{ id: string; releaseYear: number; [k: string]: unknown }>,
) {
  const existing = await getTimeline(env, teamId);
  for (const track of tracks) {
    if (existing.some(e => e.track_id === track.id)) continue;
    await insertTimelineEntry(env, {
      team_id:  teamId,
      track_id: track.id,
      year:     track.releaseYear,
      position: 0,
      track:    track as never,
    });
  }
}

async function advanceTurn(
  env: Env,
  roomId: string,
  room: Awaited<ReturnType<typeof getRoom>>,
  teams: Awaited<ReturnType<typeof getTeams>>,
) {
  if (!room) return;
  const sortedTeams = [...teams].sort((a, b) => a.sort_order - b.sort_order);
  const currentIdx  = sortedTeams.findIndex(t => t.id === room.active_team_id);
  const nextTeam    = sortedTeams[(currentIdx + 1) % sortedTeams.length];

  // Promote pending tokens — they're now ready for the team that's about to play.
  if ((nextTeam.tokens_pending ?? 0) > 0) {
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

  const round = await createRound(env, {
    room_id:     roomId,
    team_id:     nextTeam.id,
    track:       nextTrack,
    outcome:     null,
    revealed_at: null,
  });

  await updateRoom(env, roomId, {
    active_team_id:   nextTeam.id,
    track_cursor:     room.track_cursor + 1,
    current_round_id: round.id,
    playing_since:    null,
    paused_at_ms:     null,
  });
}
