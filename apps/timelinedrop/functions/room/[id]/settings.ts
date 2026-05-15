import type { PagesFunction } from "@cloudflare/workers-types";
import type { Env } from "../../_env";
import { json, handlePreflight } from "../../_cors";
import { getRoom, updateRoom } from "../../_supabase";
import type { TlRoomSettings, UpdateSettingsRequest } from "../../../src/lib/types";

function sanitize(input: unknown): TlRoomSettings {
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
  if (s.songSource === "group-taste" || s.songSource === "playlist") {
    out.songSource = s.songSource;
  }
  if (s.audioMode === "browser" || s.audioMode === "discord-bot") {
    out.audioMode = s.audioMode;
  }
  if (s.timerMode === "song-length" || s.timerMode === "fixed" || s.timerMode === "none") {
    out.timerMode = s.timerMode;
  }
  if (typeof s.timerSeconds === "number" && s.timerSeconds >= 10 && s.timerSeconds <= 600) {
    out.timerSeconds = Math.round(s.timerSeconds);
  }
  return out;
}

export const onRequest: PagesFunction<Env> = async ({ request, params, env }) => {
  const pre = handlePreflight(request as unknown as Request);
  if (pre) return pre;
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const req    = request as unknown as Request;
  const roomId = params.id as string;

  try {
    const body = await req.json() as UpdateSettingsRequest;
    if (!body.player_id) return json({ error: "player_id required" }, 400, req);

    const room = await getRoom(env, roomId);
    if (!room) return json({ error: "Room not found" }, 404, req);
    if (room.host_id !== body.player_id) return json({ error: "Only the host can change settings" }, 403, req);

    const merged: TlRoomSettings = { ...(room.settings ?? {}), ...sanitize(body.settings) };
    await updateRoom(env, roomId, { settings: merged });
    return json({ ok: true, settings: merged }, 200, req);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: msg }, 500, req);
  }
};
