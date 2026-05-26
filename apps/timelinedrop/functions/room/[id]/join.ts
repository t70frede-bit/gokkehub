import type { PagesFunction } from "@cloudflare/workers-types";
import { getSession } from "@gokkehub/auth/session";
import type { Env } from "../../_env";
import { json, handlePreflight } from "../../_cors";
import { getRoom, getPlayers, createPlayer, getTeams } from "../../_supabase";
import type { JoinRoomRequest, JoinRoomResponse, LateJoinMode } from "../../../src/lib/types";

export const onRequest: PagesFunction<Env> = async ({ request, params, env }) => {
  const pre = handlePreflight(request as unknown as Request);
  if (pre) return pre;
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const req    = request as unknown as Request;
  const roomId = params.id as string;

  try {
    const body = await req.json() as JoinRoomRequest;
    const { name, team_id: requestedTeamId, is_spectator: requestedSpectator } = body;

    if (!name?.trim()) return json({ error: "Name required" }, 400, req);

    const room = await getRoom(env, roomId);
    if (!room) return json({ error: "Room not found" }, 404, req);
    if (room.status === "finished") return json({ error: "Game already ended" }, 409, req);

    const lateJoinMode: LateJoinMode = room.settings?.lateJoinMode ?? "open";

    // Late-join enforcement
    let forceSpectator = !!requestedSpectator;
    if (room.status === "playing") {
      if (lateJoinMode === "closed") {
        return json({ error: "The host has closed this lobby to new players." }, 403, req);
      }
      if (lateJoinMode === "spectator-only") {
        forceSpectator = true;
      }
    }

    const [players, teams] = await Promise.all([getPlayers(env, roomId), getTeams(env, roomId)]);

    let teamId: number | null = null;
    if (!forceSpectator) {
      const validTeam = teams.find(t => t.id === requestedTeamId);
      if (validTeam) {
        teamId = validTeam.id;
      } else if (requestedTeamId === null || requestedTeamId === undefined) {
        // Auto-assign to smallest team if no preference
        const counts = new Map(teams.map(t => [t.id, 0]));
        for (const p of players) {
          if (p.team_id !== null) counts.set(p.team_id, (counts.get(p.team_id) ?? 0) + 1);
        }
        const sorted = [...teams].sort((a, b) => (counts.get(a.id) ?? 0) - (counts.get(b.id) ?? 0));
        teamId = sorted[0]?.id ?? null;
      } else {
        return json({ error: "Invalid team for this room" }, 400, req);
      }
    }

    // First non-spectator joiner on a team becomes its captain.
    const teamHasCaptain = !!teamId && players.some(p => p.team_id === teamId && p.is_captain && !p.is_spectator);
    const becomeCaptain  = !forceSpectator && teamId !== null && !teamHasCaptain;

    // Pull discord id, Last.fm username, and Spotify id from session.
    const session = await getSession(env.SESSIONS, req);
    const discordId      = session?.discord?.id ?? null;
    const lastfmUsername = session?.lastfm?.username ?? null;
    const spotifyId      = session?.spotify?.id ?? null;

    const playerId = crypto.randomUUID();
    await createPlayer(env, {
      id:               playerId,
      room_id:          roomId,
      team_id:          teamId,
      name:             name.trim().slice(0, 30),
      is_captain:       becomeCaptain,
      is_host:          false,
      is_spectator:     forceSpectator,
      discord_id:       discordId,
      lastfm_username:  lastfmUsername,
      spotify_id:       spotifyId,
      manual_artists:   [],
    });

    // Stash this player's Spotify refresh token in KV so curate.ts can
    // pull their /me/top/* data when the room is in spotify-taste mode.
    // Cookie-bound session is unreadable from the curate-side request
    // (different player). Keyed per-room+player; 24h TTL matches sessions.
    if (session?.spotify?.refreshToken) {
      await env.SESSIONS.put(
        `tl:room:${roomId}:player:${playerId}:spotify`,
        session.spotify.refreshToken,
        { expirationTtl: 86400 },
      );
    }

    return json({
      player_id:    playerId,
      team_id:      teamId,
      is_spectator: forceSpectator,
    } as JoinRoomResponse, 201, req);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: msg }, 500, req);
  }
};
