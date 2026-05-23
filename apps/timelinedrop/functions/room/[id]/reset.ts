import type { PagesFunction } from "@cloudflare/workers-types";
import type { Env } from "../../_env";
import { json, handlePreflight } from "../../_cors";
import {
  getRoom, getTeams, updateRoom, updateTeam, req,
} from "../../_supabase";
import type { TlRound } from "../../../src/lib/types";

// Host-only endpoint that returns a finished room back to the lobby state so
// the same group can play another game without recreating the room. EndPage's
// "Play again" button calls this before navigating back to /lobby/:id.
//
// What we wipe:
//   - tl_rounds, tl_timeline, tl_team_tokens, tl_notes, tl_pings (all round-
//     and timeline-scoped state)
//   - room: status → "lobby", current_round_id/active_team_id/track cursor
//     and pool all reset
//   - teams: tokens, tokens_pending, pending_tracks all zeroed
//
// What we KEEP:
//   - tl_players (the room composition — names, captains, teams, lastfm
//     usernames)
//   - tl_teams rows (just zeroed out, not deleted)
//   - tl_played_tracks (so the recently-heard filter still avoids the songs
//     this party just heard on the very next replay)
//   - host_id, win_target, settings on tl_rooms
export const onRequest: PagesFunction<Env> = async ({ request, params, env }) => {
  const pre = handlePreflight(request as unknown as Request);
  if (pre) return pre;
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const reqW   = request as unknown as Request;
  const roomId = params.id as string;
  const body   = await reqW.json().catch(() => ({})) as { player_id?: string };

  const room = await getRoom(env, roomId);
  if (!room) return json({ error: "Room not found" }, 404, reqW);
  if (!body.player_id || room.host_id !== body.player_id) {
    return json({ error: "Only the host can reset the room" }, 403, reqW);
  }

  const teams = await getTeams(env, roomId);

  // Round IDs are needed to clean up pings/notes (those tables only key on
  // round_id, not room_id).
  const rounds = await req<TlRound>(env, "GET", "tl_rounds", `room_id=eq.${roomId}&select=id`);
  const roundIds = rounds.map(r => r.id);
  if (roundIds.length > 0) {
    const inList = roundIds.join(",");
    await req(env, "DELETE", "tl_pings", `round_id=in.(${inList})`);
    await req(env, "DELETE", "tl_notes", `round_id=in.(${inList})`);
  }

  // tl_timeline keys on team_id; collect ids for this room.
  if (teams.length > 0) {
    const teamInList = teams.map(t => t.id).join(",");
    await req(env, "DELETE", "tl_timeline",    `team_id=in.(${teamInList})`);
  }

  await req(env, "DELETE", "tl_team_tokens", `room_id=eq.${roomId}`);
  await req(env, "DELETE", "tl_shop_pings",  `room_id=eq.${roomId}`);
  await req(env, "DELETE", "tl_rounds",      `room_id=eq.${roomId}`);

  // Zero out every team's per-game state.
  for (const team of teams) {
    await updateTeam(env, team.id, {
      tokens:         0,
      tokens_pending: 0,
      pending_tracks: [],
    });
  }

  await updateRoom(env, roomId, {
    status:           "lobby",
    current_round_id: null,
    active_team_id:   null,
    track_pool:       [],
    track_cursor:     0,
    playing_since:    null,
    paused_at_ms:     null,
  });

  return json({ ok: true }, 200, reqW);
};
