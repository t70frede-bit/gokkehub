import type { PagesFunction } from "@cloudflare/workers-types";
import type { Env } from "../../_env";
import { json, handlePreflight } from "../../_cors";
import {
  getRoom, updateRoom, getTeams, getPlayers, updatePlayer,
  createRound, insertTimelineEntry,
} from "../../_supabase";

export const onRequest: PagesFunction<Env> = async ({ request, params, env }) => {
  const pre = handlePreflight(request as unknown as Request);
  if (pre) return pre;
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const req = request as unknown as Request;
  const roomId = params.id as string;
  const body = await req.json() as { player_id: string };

  const room = await getRoom(env, roomId);
  if (!room) return json({ error: "Room not found" }, 404, req);
  if (room.status !== "lobby") return json({ error: "Game already started" }, 409, req);
  if (room.host_id !== body.player_id) return json({ error: "Only the host can start" }, 403, req);

  const teams   = await getTeams(env, roomId);
  const players = await getPlayers(env, roomId);
  if (teams.length < 2) return json({ error: "Need at least 2 teams" }, 400, req);

  const pool = room.track_pool ?? [];
  // Need: 1 starter card per team + 1 first round track
  const minTracks = teams.length + 1;
  if (pool.length < minTracks) {
    return json({
      error: `Need at least ${minTracks} songs (one starting card per team + one for the first round). Add another playlist.`,
    }, 400, req);
  }

  // 1) Seed each team with one starting card so they have a year reference.
  for (let i = 0; i < teams.length; i++) {
    const seed = pool[i];
    await insertTimelineEntry(env, {
      team_id:  teams[i].id,
      track_id: seed.id,
      year:     seed.releaseYear,
      position: 0,
      track:    seed,
    });
  }

  // 2) Auto-assign a captain on any team that has none. Prefer non-spectators;
  //    fall back to including the host if they are this team's only player.
  for (const team of teams) {
    const teammates    = players.filter(p => p.team_id === team.id && !p.is_spectator);
    const hasCaptain   = teammates.some(p => p.is_captain);
    if (!hasCaptain && teammates.length > 0) {
      const nonHost  = teammates.find(p => !p.is_host);
      const fallback = nonHost ?? teammates[0];
      await updatePlayer(env, fallback.id, { is_captain: true });
    }
  }

  // 3) First round uses the next track after the starter cards.
  const firstTrack = pool[teams.length];
  const round = await createRound(env, {
    room_id:     roomId,
    team_id:     teams[0].id,
    track:       firstTrack,
    outcome:     null,
    revealed_at: null,
  });

  await updateRoom(env, roomId, {
    status:           "playing",
    active_team_id:   teams[0].id,
    track_cursor:     teams.length + 1,
    current_round_id: round.id,
  });

  return json({ ok: true, round_id: round.id }, 200, req);
};
