import type { PagesFunction } from "@cloudflare/workers-types";
import { getSession } from "@gokkehub/auth/session";
import type { Env } from "../_env";
import { json, handlePreflight } from "../_cors";
import { createRoom, createTeam, createPlayer } from "../_supabase";
import type { CreateRoomRequest, CreateRoomResponse, TlRoomSettings } from "../../src/lib/types";

// Room codes are 4 alphanumeric chars (36^4 ≈ 1.7M combos, plenty for
// concurrent rooms at this scale and shorter to read out loud). Older
// rooms with 6-char codes keep working — the join lookup matches by
// exact id regardless of length.
function randomId(len = 4): string {
  return Math.random().toString(36).slice(2, 2 + len).toUpperCase();
}

// Sanitize unknown settings input. Keep in lock-step with the matching
// sanitizer in functions/room/[id]/settings.ts — they share the same
// allowed value set. Anything unknown is dropped silently.
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
  if (typeof s.singleScreenMode === "boolean")  out.singleScreenMode  = s.singleScreenMode;
  if (typeof s.gamemasterMode === "boolean")    out.gamemasterMode    = s.gamemasterMode;
  if (s.songSource === "group-taste" || s.songSource === "playlist") {
    out.songSource = s.songSource;
  }
  if (s.audioMode === "browser" || s.audioMode === "discord-bot" || s.audioMode === "all-clients-stream") {
    out.audioMode = s.audioMode;
  }
  if (s.timerMode === "song-length" || s.timerMode === "fixed" || s.timerMode === "none") {
    out.timerMode = s.timerMode;
  }
  if (typeof s.timerSeconds === "number" && s.timerSeconds >= 10 && s.timerSeconds <= 600) {
    out.timerSeconds = Math.round(s.timerSeconds);
  }
  if (s.tokenEconomy === "standard" || s.tokenEconomy === "bonus" || s.tokenEconomy === "shop") {
    out.tokenEconomy = s.tokenEconomy;
  }
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
      team_colors = [],
      host_team,
      is_spectator = false,
      role,
      settings,
    } = body;
    const ALLOWED_COLORS = new Set(["red", "blue", "green", "yellow"]);

    if (!name?.trim()) return json({ error: "Name required" }, 400, req);

    const session  = await getSession(env.SESSIONS, req);
    const roomId   = randomId();
    const playerId = crypto.randomUUID();
    const sanitized = sanitizeSettings(settings);

    // Role mapping. New clients send `role`; old clients send is_spectator/host_team.
    // - player:     joins a team, is_captain becomes true for that team
    // - dj/spectator: not on a team, is_spectator = true
    // - gamemaster: not on a team, is_spectator = true, but flips
    //   settings.gamemasterMode so the room hides multi-player surfaces
    //   and the host can act as captain for every team (round.ts).
    let effectiveIsSpectator = is_spectator;
    let effectiveHostTeam    = host_team;
    if (role === "player") {
      effectiveIsSpectator = false;
    } else if (role === "dj" || role === "spectator") {
      effectiveIsSpectator = true;
      effectiveHostTeam    = null;
    } else if (role === "gamemaster") {
      effectiveIsSpectator = true;
      effectiveHostTeam    = null;
      sanitized.gamemasterMode = true;
    }

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

    // Resolve each team's colour. If two requested colours collide,
    // bump the later one to the first unused palette slot — clients
    // already skip duplicates when cycling, but a hand-crafted request
    // could still slip a dup through, so this is defence-in-depth.
    const PALETTE_ORDER = ["red", "blue", "green", "yellow"];
    const usedColors = new Set<string>();
    const resolvedColors: (string | null)[] = [];
    for (let i = 0; i < team_names.length; i++) {
      const requested = team_colors[i];
      let color: string | null = typeof requested === "string" && ALLOWED_COLORS.has(requested) ? requested : null;
      if (color && usedColors.has(color)) {
        color = PALETTE_ORDER.find(c => !usedColors.has(c)) ?? null;
      }
      if (color) usedColors.add(color);
      resolvedColors.push(color);
    }

    const teams = [];
    for (let i = 0; i < team_names.length; i++) {
      const t = await createTeam(env, {
        room_id:        roomId,
        name:           team_names[i],
        tokens:         0,
        pending_tracks: [],
        sort_order:     i,
        color:          resolvedColors[i],
      });
      teams.push(t);
    }

    let hostTeamId: number | null = null;
    if (!effectiveIsSpectator && typeof effectiveHostTeam === "number" && effectiveHostTeam >= 0 && effectiveHostTeam < teams.length) {
      hostTeamId = teams[effectiveHostTeam].id;
    }

    await createPlayer(env, {
      id:               playerId,
      room_id:          roomId,
      team_id:          hostTeamId,
      name:             name.trim().slice(0, 30),
      // Host becomes captain of their team by default (first joiner on the team).
      is_captain:       !effectiveIsSpectator && hostTeamId !== null,
      is_host:          true,
      is_spectator:     effectiveIsSpectator,
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
