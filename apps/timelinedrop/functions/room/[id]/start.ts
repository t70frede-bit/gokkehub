import type { PagesFunction } from "@cloudflare/workers-types";
import type { Env } from "../../_env";
import { json, handlePreflight } from "../../_cors";
import { getRoom, updateRoom, getTeams, createRound } from "../../_supabase";

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
  if ((room.track_pool ?? []).length < 5) return json({ error: "Add at least 5 songs before starting" }, 400, req);

  const teams = await getTeams(env, roomId);
  if (teams.length < 2) return json({ error: "Need at least 2 teams" }, 400, req);

  const firstTeam  = teams[0];
  const firstTrack = room.track_pool[0];
  if (!firstTrack) return json({ error: "Track pool is empty" }, 400, req);

  const round = await createRound(env, {
    room_id:  roomId,
    team_id:  firstTeam.id,
    track:    firstTrack,
    outcome:  null,
    revealed_at: null,
  });

  await updateRoom(env, roomId, {
    status:           "playing",
    active_team_id:   firstTeam.id,
    track_cursor:     1,
    current_round_id: round.id,
  });

  return json({ ok: true, round_id: round.id }, 200, req);
};
