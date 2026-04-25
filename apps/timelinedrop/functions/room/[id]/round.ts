import type { PagesFunction } from "@cloudflare/workers-types";
import type { Env } from "../../_env";
import { json, handlePreflight } from "../../_cors";
import {
  getRoom, updateRoom, getTeams, getPlayers, getRound, updateRound,
  createRound, getTimeline, insertTimelineEntry, updateTeam,
} from "../../_supabase";
import type { PlacementRequest, TurnActionRequest } from "../../../src/lib/types";

// POST /room/:id/round  — two sub-actions via ?action= query param
//   ?action=place  — captain submits placement (left_year / right_year)
//   ?action=turn   — after correct placement: stop | token | next

export const onRequest: PagesFunction<Env> = async ({ request, params, env }) => {
  const pre = handlePreflight(request as unknown as Request);
  if (pre) return pre;
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const req = request as unknown as Request;
  const roomId = params.id as string;
  const action = new URL(req.url).searchParams.get("action");

  if (action === "place") return handlePlace(req, roomId, env);
  if (action === "turn")  return handleTurnAction(req, roomId, env);
  return json({ error: "Unknown action" }, 400, req);
};

// ── Place ─────────────────────────────────────────────────────────────────────

async function handlePlace(req: Request, roomId: string, env: Env) {
  const body = await req.json() as PlacementRequest & { player_id: string };
  const { round_id, left_year, right_year, player_id } = body;

  const [room, round, players] = await Promise.all([getRoom(env, roomId), getRound(env, round_id), getPlayers(env, roomId)]);
  if (!room || !round) return json({ error: "Not found" }, 404, req);
  if (round.outcome !== null) return json({ error: "Round already resolved" }, 409, req);

  const captain = players.find(p => p.team_id === room.active_team_id && p.is_captain);
  if (captain && captain.id !== player_id) return json({ error: "Only the team captain can place" }, 403, req);

  const actualYear = round.track.releaseYear;
  const correct =
    (left_year === null || left_year <= actualYear) &&
    (right_year === null || actualYear <= right_year);

  const outcome = correct ? "correct" : "incorrect";
  await updateRound(env, round_id, {
    outcome,
    left_year:   left_year ?? undefined,
    right_year:  right_year ?? undefined,
    revealed_at: new Date().toISOString(),
  });

  if (correct) {
    // Add track to team's pending pile
    const teams = await getTeams(env, roomId);
    const activeTeam = teams.find(t => t.id === room.active_team_id);
    if (activeTeam) {
      await updateTeam(env, activeTeam.id, {
        pending_tracks: [...(activeTeam.pending_tracks ?? []), round.track],
      });
    }
  } else {
    // Wrong: clear pending tracks and end turn
    const teams = await getTeams(env, roomId);
    const activeTeam = teams.find(t => t.id === room.active_team_id);
    if (activeTeam) {
      await updateTeam(env, activeTeam.id, { pending_tracks: [] });
    }
    await advanceTurn(env, roomId, room, teams);
  }

  return json({ outcome, actual_year: actualYear }, 200, req);
}

// ── Turn action ───────────────────────────────────────────────────────────────

async function handleTurnAction(req: Request, roomId: string, env: Env) {
  const body = await req.json() as TurnActionRequest & { player_id: string };
  const { action, player_id } = body;

  const [room, teams, players] = await Promise.all([getRoom(env, roomId), getTeams(env, roomId), getPlayers(env, roomId)]);
  if (!room) return json({ error: "Room not found" }, 404, req);

  const activeTeam = teams.find(t => t.id === room.active_team_id);
  if (!activeTeam) return json({ error: "No active team" }, 400, req);

  const captain = players.find(p => p.team_id === activeTeam.id && p.is_captain);
  if (captain && captain.id !== player_id) return json({ error: "Only the team captain can act" }, 403, req);

  if (action === "next") {
    // Continue turn — create a new round with the next track
    const nextTrack = room.track_pool[room.track_cursor];
    if (!nextTrack) return json({ error: "No more tracks" }, 400, req);

    const round = await createRound(env, {
      room_id:  roomId,
      team_id:  activeTeam.id,
      track:    nextTrack,
      outcome:  null,
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

  // stop or token — lock pending tracks into timeline
  await lockPendingTracks(env, activeTeam.id, (activeTeam.pending_tracks ?? []) as Array<{ id: string; releaseYear: number; [k: string]: unknown }>);

  if (action === "token") {
    if (activeTeam.tokens <= 0) return json({ error: "No tokens left" }, 400, req);
    await updateTeam(env, activeTeam.id, {
      tokens:         activeTeam.tokens - 1,
      pending_tracks: [],
    });
  } else {
    await updateTeam(env, activeTeam.id, { pending_tracks: [] });
  }

  // Check win condition
  const timeline = await getTimeline(env, activeTeam.id);
  const lockedCount = timeline.length;
  if (lockedCount >= room.win_target) {
    await updateRoom(env, roomId, { status: "finished" });
    return json({ ok: true, winner: activeTeam.id }, 200, req);
  }

  await advanceTurn(env, roomId, room, teams);
  return json({ ok: true }, 200, req);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function lockPendingTracks(env: Env, teamId: number, tracks: Array<{ id: string; releaseYear: number; [k: string]: unknown }>) {
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

async function advanceTurn(env: Env, roomId: string, room: Awaited<ReturnType<typeof getRoom>>, teams: Awaited<ReturnType<typeof getTeams>>) {
  if (!room) return;
  const sortedTeams = [...teams].sort((a, b) => a.sort_order - b.sort_order);
  const currentIdx = sortedTeams.findIndex(t => t.id === room.active_team_id);
  const nextTeam = sortedTeams[(currentIdx + 1) % sortedTeams.length];

  const nextTrack = room.track_pool[room.track_cursor];
  if (!nextTrack) {
    await updateRoom(env, roomId, { status: "finished" });
    return;
  }

  const round = await createRound(env, {
    room_id:  roomId,
    team_id:  nextTeam.id,
    track:    nextTrack,
    outcome:  null,
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
