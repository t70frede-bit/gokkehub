import type { PagesFunction } from "@cloudflare/workers-types";
import type { Env } from "../../_env";
import { json, handlePreflight } from "../../_cors";
import {
  getRoom, getRound, getPlayers, getTeams,
  updateRoom, updateRound, lookupCorrectedYear,
} from "../../_supabase";
import { findAndUseToken } from "./round";
import type { SpotifyTrack, TlRoom, TlPlayer } from "../../../src/lib/types";

// POST /room/:id/picker
//   body: { round_id, player_id, action: "options" | "pick", choice? }
//
// Artist Picker token (before_song). Two-phase:
//   action=options → returns up to 3 distinct artists drawn from the
//                    team's UPCOMING pool tracks (excludes the current
//                    round's own track so it doesn't leak the answer).
//                    Does NOT burn the token.
//   action=pick    → swaps an upcoming pool track by the chosen artist
//                    into the current round, marks the round bonus_blocked
//                    (no reward for a song you chose), and burns the token.
//
// Pool-based by design: no Last.fm/Spotify calls at pick time, so it's
// fast and can't fail on an external API. The 3 options are limited to
// artists already in the curated pool, which keeps them on-taste anyway.

interface PickerBody {
  round_id:  number;
  player_id: string;
  action:    "options" | "pick";
  choice?:   string;       // artist name (display form), required for action=pick
}

// How many upcoming pool tracks to scan for candidate artists.
const UPCOMING_WINDOW = 25;
const MAX_OPTIONS     = 3;

function lc(s: string): string { return s.toLowerCase().trim(); }

function actsAsCaptain(room: TlRoom, captain: TlPlayer | undefined, playerId: string): boolean {
  if (captain && captain.id === playerId) return true;
  if ((room.settings?.gamemasterMode || room.settings?.singleScreenMode) && room.host_id === playerId) return true;
  return false;
}

async function teamAlreadyUsedTokenThisRound(env: Env, roundId: number, teamId: number): Promise<boolean> {
  const url = `${env.SUPABASE_URL}/rest/v1/tl_team_tokens?used_round=eq.${roundId}&team_id=eq.${teamId}&select=id&limit=1`;
  const res = await fetch(url, {
    headers: {
      apikey:        env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!res.ok) return false;
  return ((await res.json()) as unknown[]).length > 0;
}

export const onRequest: PagesFunction<Env> = async ({ request, params, env }) => {
  const pre = handlePreflight(request as unknown as Request);
  if (pre) return pre;
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const req    = request as unknown as Request;
  const roomId = params.id as string;

  try {
    const body = await req.json() as PickerBody;
    const { round_id, player_id, action } = body;

    const [room, round, players, teams] = await Promise.all([
      getRoom(env, roomId), getRound(env, round_id),
      getPlayers(env, roomId), getTeams(env, roomId),
    ]);
    if (!room || !round) return json({ error: "Not found" }, 404, req);

    const activeTeam = teams.find(t => t.id === room.active_team_id);
    if (!activeTeam) return json({ error: "No active team" }, 400, req);

    const captain = players.find(p => p.team_id === activeTeam.id && p.is_captain);
    if (!actsAsCaptain(room, captain, player_id)) {
      return json({ error: "Only the active team's captain can use Artist Picker" }, 403, req);
    }

    // before_song phase: this must be the current round, not yet placed, and
    // audio not yet rolling. Once the song plays it's too late to swap.
    if (round.id !== room.current_round_id || round.outcome !== null) {
      return json({ error: "Artist Picker only works on the song you're about to play" }, 409, req);
    }
    if (room.playing_since !== null) {
      return json({ error: "Too late — the song is already playing" }, 409, req);
    }

    const pool   = room.track_pool ?? [];
    const cursor = room.track_cursor ?? 0;
    const curIdx = cursor - 1;                 // current round's track slot
    const upcoming = pool.slice(cursor);       // strictly future tracks

    // Distinct artists in the upcoming window (excludes the current track,
    // so the option list never reveals what's queued right now).
    const seen = new Set<string>();
    const distinctArtists: string[] = [];
    for (const t of upcoming.slice(0, UPCOMING_WINDOW)) {
      const key = lc(t.artist);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      distinctArtists.push(t.artist);
    }

    if (action === "options") {
      if (distinctArtists.length === 0) {
        return json({ error: "No upcoming songs to pick an artist from" }, 409, req);
      }
      // Shuffle, take up to 3.
      const shuffled = [...distinctArtists].sort(() => Math.random() - 0.5);
      return json({ options: shuffled.slice(0, MAX_OPTIONS) }, 200, req);
    }

    // ── action === "pick" ────────────────────────────────────────────────
    const choice = (body.choice ?? "").trim();
    if (!choice) return json({ error: "choice (artist) required" }, 400, req);

    // Enforce the per-team one-token-per-song rule here (options is exempt).
    if (await teamAlreadyUsedTokenThisRound(env, round.id, activeTeam.id)) {
      return json({ error: "Your team already used a token this song" }, 409, req);
    }

    // Find an upcoming track by the chosen artist.
    const choiceLc = lc(choice);
    const poolIdx  = pool.findIndex((t, i) => i >= cursor && lc(t.artist) === choiceLc);
    if (poolIdx === -1) {
      return json({ error: "That artist isn't in the upcoming songs anymore" }, 409, req);
    }
    if (curIdx < 0) {
      return json({ error: "No current round track to replace" }, 409, req);
    }

    // Burn the token first — everything after this is local state, so it
    // won't fail and strand a consumed token.
    const burned = await findAndUseToken(env, activeTeam.id, "artist_picker", round.id);
    if (!burned) return json({ error: "No Artist Picker token available" }, 400, req);

    // Swap the chosen upcoming track into the current slot; the original
    // current track drops back into the upcoming pool to play later.
    const chosen: SpotifyTrack = pool[poolIdx];
    const newPool = [...pool];
    [newPool[curIdx], newPool[poolIdx]] = [newPool[poolIdx], newPool[curIdx]];
    await updateRoom(env, roomId, { track_pool: newPool });

    const corrected = await lookupCorrectedYear(env, chosen.id);
    await updateRound(env, round.id, {
      track:          chosen as never,
      corrected_year: corrected,
      bonus_blocked:  true,
      // Reset any pre-placement display state carried from the old track.
      cover_revealed: false,
    });

    return json({ ok: true, token_id: burned, artist: chosen.artist }, 200, req);
  } catch (err: unknown) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500, req);
  }
};
