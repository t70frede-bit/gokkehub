import type { PagesFunction } from "@cloudflare/workers-types";
import type { Env } from "../../_env";
import { json, handlePreflight } from "../../_cors";
import { getRoom, getTeams, createPlayer } from "../../_supabase";

// POST /room/:id/add-member
// Host-only — creates a placeholder player row tied to a team. Intended
// for gamemaster mode where the host is the only real participant but
// wants the lobby/game UI to display the actual teammates' names for
// quick visual reference. The placeholder has no session, never connects,
// and contributes nothing to curation (no lastfm / manual_artists).
//
// The endpoint is host-only regardless of audio mode — there's no strong
// reason to restrict it to gamemaster rooms only, but the UI only surfaces
// the button there. Other modes call this at their own risk (e.g. for a
// demo).
interface AddMemberRequest {
  player_id: string;
  team_id:   number;
  name:      string;
}

export const onRequest: PagesFunction<Env> = async ({ request, params, env }) => {
  const pre = handlePreflight(request as unknown as Request);
  if (pre) return pre;
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const r      = request as unknown as Request;
  const roomId = params.id as string;

  try {
    const body = await r.json() as AddMemberRequest;
    if (!body.player_id) return json({ error: "player_id required" }, 400, r);
    if (typeof body.team_id !== "number") return json({ error: "team_id required" }, 400, r);
    const trimmed = (body.name ?? "").trim().slice(0, 30);
    if (!trimmed) return json({ error: "Name cannot be empty" }, 400, r);

    const [room, teams] = await Promise.all([
      getRoom(env, roomId),
      getTeams(env, roomId),
    ]);
    if (!room) return json({ error: "Room not found" }, 404, r);
    if (room.host_id !== body.player_id) {
      return json({ error: "Only the host can add members" }, 403, r);
    }
    if (!teams.some(t => t.id === body.team_id)) {
      return json({ error: "Team not in this room" }, 400, r);
    }

    const created = await createPlayer(env, {
      id:               crypto.randomUUID(),
      room_id:          roomId,
      team_id:          body.team_id,
      name:             trimmed,
      is_captain:       false,
      is_host:          false,
      is_spectator:     false,
      discord_id:       null,
      lastfm_username:  null,
      manual_artists:   [],
    });

    return json({ ok: true, player_id: created.id, team_id: created.team_id, name: created.name }, 200, r);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: msg }, 500, r);
  }
};
