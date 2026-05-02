import type { PagesFunction } from "@cloudflare/workers-types";
import { getSession } from "@gokkehub/auth/session";
import type { Env } from "../_env";
import { json, handlePreflight } from "../_cors";
import { createRoom, createTeam, createPlayer } from "../_supabase";
import type { CreateRoomRequest, CreateRoomResponse, TlRoomSettings } from "../../src/lib/types";

function randomId(len = 6): string {
  return Math.random().toString(36).slice(2, 2 + len).toUpperCase();
}

function sanitizeSettings(input: unknown): TlRoomSettings {
  const out: TlRoomSettings = {};
  if (!input || typeof input !== "object") return out;
  const s = input as Record<string, unknown>;
  if (s.lateJoinMode === "open" || s.lateJoinMode === "spectator-only" || s.lateJoinMode === "closed") {
    out.lateJoinMode = s.lateJoinMode;
  }
  if (typeof s.streamerMode === "boolean")    out.streamerMode    = s.streamerMode;
  if (typeof s.hideSpectators === "boolean")  out.hideSpectators  = s.hideSpectators;
  if (typeof s.teamSwapEnabled === "boolean") out.teamSwapEnabled = s.teamSwapEnabled;
  if (s.judgeMode === "team-captain"      || s.judgeMode === "next-team-captain"
      || s.judgeMode === "host"           || s.judgeMode === "vote-all") {
    out.judgeMode = s.judgeMode;
  }
  if (typeof s.voteTimerSeconds === "number" && s.voteTimerSeconds >= 5 && s.voteTimerSeconds <= 120) {
    out.voteTimerSeconds = Math.round(s.voteTimerSeconds);
  }
  if (s.difficulty === "easy" || s.difficulty === "medium" || s.difficulty === "hard" || s.difficulty === "hardest") {
    out.difficulty = s.difficulty;
  }
  if (s.playlistMode === "as-is" || s.playlistMode === "inspiration" || s.playlistMode === "smart-filter") {
    out.playlistMode = s.playlistMode;
  }
  if (typeof s.skipRecentlyHeard === "boolean") out.skipRecentlyHeard = s.skipRecentlyHeard;
  return out;
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  const pre = handlePreflight(request as unknown as Request);
  if (pre) return pre;
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const req = request as unknown as Request;

  try {
    const body = await req.json() as CreateRoomRequest;
    const {
      name,
      win_target = 10,
      team_names = ["Team Red", "Team Blue"],
      host_team,
      is_spectator = false,
      settings,
    } = body;

    if (!name?.trim()) return json({ error: "Name required" }, 400, req);

    const session  = await getSession(env.SESSIONS, req);
    const roomId   = randomId(6);
    const playerId = crypto.randomUUID();
    const sanitized = sanitizeSettings(settings);

    await createRoom(env, {
      id:               roomId,
      host_id:          playerId,
      status:           "lobby",
      win_target,
      active_team_id:   null,
      track_pool:       [],
      track_cursor:     0,
      current_round_id: null,
      playing_since:    null,
      paused_at_ms:     null,
      settings:         sanitized,
    });

    const teams = [];
    for (let i = 0; i < team_names.length; i++) {
      const t = await createTeam(env, {
        room_id:        roomId,
        name:           team_names[i],
        tokens:         2,
        pending_tracks: [],
        sort_order:     i,
      });
      teams.push(t);
    }

    let hostTeamId: number | null = null;
    if (!is_spectator && typeof host_team === "number" && host_team >= 0 && host_team < teams.length) {
      hostTeamId = teams[host_team].id;
    }

    await createPlayer(env, {
      id:               playerId,
      room_id:          roomId,
      team_id:          hostTeamId,
      name:             name.trim().slice(0, 30),
      // Host becomes captain of their team by default (first joiner on the team).
      is_captain:       !is_spectator && hostTeamId !== null,
      is_host:          true,
      is_spectator:     !!is_spectator,
      discord_id:       session?.discord?.id ?? null,
      lastfm_username:  session?.lastfm?.username ?? null,
      manual_artists:   [],
    });

    if (session) {
      await env.SESSIONS.put(`tl:${roomId}:player`, playerId, { expirationTtl: 86400 });
    }

    return json({ room_id: roomId, player_id: playerId } as CreateRoomResponse, 201, req);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: msg }, 500, req);
  }
};
