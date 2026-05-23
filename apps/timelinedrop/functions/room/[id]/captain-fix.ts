import type { PagesFunction } from "@cloudflare/workers-types";
import type { Env } from "../../_env";
import { json, handlePreflight } from "../../_cors";
import {
  getRoom, getPlayers, getTeams, getTimeline,
  insertTimelineEntry, updateTeam,
} from "../../_supabase";
import type { SpotifyTrack, TlTimelineEntry } from "../../../src/lib/types";

// POST /room/:id/captain-fix
//
// Captain-of-active-team only. Powerful "this round went wrong, let me
// fix the timeline" operations — adding a card, removing one, changing
// its year, or flipping lock ↔ pending. Equivalent to /dev for the
// captain, scoped to their own team.
//
// Auth model: the active team's captain (gamemaster host stands in).
// We don't allow other teams' captains to edit other teams' cards
// since that's an opening for sabotage.

interface Body {
  player_id: string;
  action:    "add-card" | "remove-card" | "adjust-year" | "to-pending" | "to-locked";
  // add-card
  year?:     number;
  name?:     string;
  artist?:   string;
  // remove-card / adjust-year / to-pending / to-locked
  track_id?: string;
}

function actsAsCaptain(
  room: { host_id: string; settings?: { gamemasterMode?: boolean; singleScreenMode?: boolean } },
  captain: { id: string } | undefined,
  playerId: string,
): boolean {
  if (captain && captain.id === playerId) return true;
  const gamemastering = !!(room.settings?.gamemasterMode || room.settings?.singleScreenMode);
  if (gamemastering && room.host_id === playerId) return true;
  return false;
}

async function reposition(env: Env, teamId: number): Promise<void> {
  // Pull, sort by year, write positions back. Mirrors insertTimelineEntry's
  // tail behaviour but without inserting a row.
  const entries = await getTimeline(env, teamId);
  entries.sort((a, b) => (a.corrected_year ?? a.year) - (b.corrected_year ?? b.year));
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].position === i) continue;
    const url = `${env.SUPABASE_URL}/rest/v1/tl_timeline?team_id=eq.${teamId}&track_id=eq.${encodeURIComponent(entries[i].track_id)}`;
    await fetch(url, {
      method:  "PATCH",
      headers: {
        "Content-Type":  "application/json",
        "apikey":        env.SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Prefer":        "return=minimal",
      },
      body: JSON.stringify({ position: i }),
    });
  }
}

export const onRequest: PagesFunction<Env> = async ({ request, params, env }) => {
  const pre = handlePreflight(request as unknown as Request);
  if (pre) return pre;
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const req    = request as unknown as Request;
  const roomId = params.id as string;

  try {
    const body = await req.json() as Body;
    if (!body.player_id || !body.action) {
      return json({ error: "player_id and action required" }, 400, req);
    }

    const [room, players, teams] = await Promise.all([
      getRoom(env, roomId),
      getPlayers(env, roomId),
      getTeams(env, roomId),
    ]);
    if (!room) return json({ error: "Room not found" }, 404, req);

    const activeTeam = teams.find(t => t.id === room.active_team_id);
    if (!activeTeam) return json({ error: "No active team" }, 400, req);

    const captain = players.find(p => p.team_id === activeTeam.id && p.is_captain);
    if (!actsAsCaptain(room, captain, body.player_id)) {
      return json({ error: "Only the active team's captain can fix cards" }, 403, req);
    }

    const teamId = activeTeam.id;

    if (body.action === "add-card") {
      const year = body.year;
      if (!Number.isInteger(year) || year! < 1900 || year! > 2100) {
        return json({ error: "year must be an integer 1900–2100" }, 400, req);
      }
      const trackName = (body.name ?? "Added card").slice(0, 80);
      const artist    = (body.artist ?? "—").slice(0, 80);
      const trackId   = `captain-${crypto.randomUUID()}`;
      const track: SpotifyTrack = {
        id:          trackId,
        name:        trackName,
        artist,
        releaseYear: year!,
        coverUrl:    "",
        durationMs:  0,
      } as SpotifyTrack;
      const entry: TlTimelineEntry = {
        team_id:        teamId,
        track_id:       trackId,
        year:           year!,
        position:       0,           // insertTimelineEntry recomputes
        track,
        corrected_year: null,
      };
      await insertTimelineEntry(env, entry);
      return json({ ok: true, track_id: trackId }, 200, req);
    }

    if (body.action === "remove-card") {
      const trackId = body.track_id;
      if (!trackId) return json({ error: "track_id required" }, 400, req);
      const url = `${env.SUPABASE_URL}/rest/v1/tl_timeline?team_id=eq.${teamId}&track_id=eq.${encodeURIComponent(trackId)}`;
      const res = await fetch(url, {
        method:  "DELETE",
        headers: {
          "apikey":        env.SUPABASE_SERVICE_ROLE_KEY,
          "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          "Prefer":        "return=minimal",
        },
      });
      if (!res.ok) return json({ error: `Delete failed: ${res.status}` }, 500, req);
      await reposition(env, teamId);
      return json({ ok: true }, 200, req);
    }

    if (body.action === "adjust-year") {
      const trackId = body.track_id;
      const year    = body.year;
      if (!trackId) return json({ error: "track_id required" }, 400, req);
      if (!Number.isInteger(year) || year! < 1900 || year! > 2100) {
        return json({ error: "year must be an integer 1900–2100" }, 400, req);
      }
      const url = `${env.SUPABASE_URL}/rest/v1/tl_timeline?team_id=eq.${teamId}&track_id=eq.${encodeURIComponent(trackId)}`;
      const res = await fetch(url, {
        method:  "PATCH",
        headers: {
          "Content-Type":  "application/json",
          "apikey":        env.SUPABASE_SERVICE_ROLE_KEY,
          "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          "Prefer":        "return=minimal",
        },
        body: JSON.stringify({ year, corrected_year: year }),
      });
      if (!res.ok) return json({ error: `Update failed: ${res.status}` }, 500, req);
      await reposition(env, teamId);
      return json({ ok: true }, 200, req);
    }

    if (body.action === "to-pending") {
      const trackId = body.track_id;
      if (!trackId) return json({ error: "track_id required" }, 400, req);
      const tl = await getTimeline(env, teamId);
      const entry = tl.find(e => e.track_id === trackId);
      if (!entry) return json({ error: "Card not on timeline" }, 404, req);
      const delUrl = `${env.SUPABASE_URL}/rest/v1/tl_timeline?team_id=eq.${teamId}&track_id=eq.${encodeURIComponent(trackId)}`;
      const delRes = await fetch(delUrl, {
        method:  "DELETE",
        headers: {
          "apikey":        env.SUPABASE_SERVICE_ROLE_KEY,
          "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          "Prefer":        "return=minimal",
        },
      });
      if (!delRes.ok) return json({ error: `Delete failed: ${delRes.status}` }, 500, req);
      const pending = (activeTeam.pending_tracks ?? []) as SpotifyTrack[];
      // Update releaseYear to reflect any prior correction so the rail
      // doesn't snap back to the Spotify default.
      const track: SpotifyTrack = { ...entry.track, releaseYear: entry.corrected_year ?? entry.year };
      const next = pending.some(p => p.id === trackId) ? pending : [...pending, track];
      await updateTeam(env, teamId, { pending_tracks: next as never });
      await reposition(env, teamId);
      return json({ ok: true }, 200, req);
    }

    if (body.action === "to-locked") {
      const trackId = body.track_id;
      if (!trackId) return json({ error: "track_id required" }, 400, req);
      const pending = (activeTeam.pending_tracks ?? []) as SpotifyTrack[];
      const track = pending.find(p => p.id === trackId);
      if (!track) return json({ error: "Card not pending" }, 404, req);
      // Remove from pending first, then insert into timeline. If insert
      // fails the card is in neither place — but the user can re-add via
      // add-card, and we'd rather not leave duplicates.
      await updateTeam(env, teamId, {
        pending_tracks: pending.filter(p => p.id !== trackId) as never,
      });
      const entry: TlTimelineEntry = {
        team_id:        teamId,
        track_id:       trackId,
        year:           track.releaseYear,
        position:       0,
        track,
        corrected_year: null,
      };
      await insertTimelineEntry(env, entry);
      return json({ ok: true }, 200, req);
    }

    return json({ error: "Unknown action" }, 400, req);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500, req);
  }
};
