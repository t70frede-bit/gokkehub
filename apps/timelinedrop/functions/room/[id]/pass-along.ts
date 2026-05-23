import type { PagesFunction } from "@cloudflare/workers-types";
import type { Env } from "../../_env";
import { json, handlePreflight } from "../../_cors";
import {
  getRoom, getRound, getPlayers, getTeams, updateRoom,
} from "../../_supabase";
import { findAndUseToken } from "./round";
import type { SpotifyTrack, TlRoom, TlPlayer } from "../../../src/lib/types";

// POST /room/:id/pass-along
//   body: { round_id, player_id, action: "options" | "pick", choice_id? }
//
// Pass Along (before_pass). Two-phase mirror of Artist Picker but
// reversed — the active captain rigs what the NEXT team gets:
//
//   action=options → returns 3 upcoming pool tracks, year-only (no
//                    title/artist/cover). The captain picks blind
//                    enough that they can't pre-judge their opponents'
//                    placement, but with enough info to bias toward a
//                    decade the opponents' timeline can't easily slot.
//   action=pick    → swaps the chosen upcoming track into the slot
//                    currently at room.track_cursor (i.e. the NEXT
//                    round's track), then burns the pass_along token.
//
// Note: pool[cursor] is the upcoming round's track; pool[cursor-1] is
// the round being played. Pass Along never touches the current round.

interface PassAlongBody {
  round_id:   number;
  player_id:  string;
  action:     "options" | "pick";
  choice_id?: string;       // SpotifyTrack id, required for action=pick
}

const UPCOMING_WINDOW = 25;
const MAX_OPTIONS     = 3;

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
    const body = await req.json() as PassAlongBody;
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
      return json({ error: "Only the active team's captain can use Pass Along" }, 403, req);
    }
    if (round.id !== room.current_round_id) {
      return json({ error: "Pass Along only fires on the round you're playing" }, 409, req);
    }

    const pool   = room.track_pool ?? [];
    const cursor = room.track_cursor ?? 0;
    const upcoming = pool.slice(cursor, cursor + UPCOMING_WINDOW);

    if (action === "options") {
      if (upcoming.length === 0) {
        return json({ error: "No upcoming songs left to pass along" }, 409, req);
      }
      // Shuffle a snapshot, take up to 3 distinct tracks. Surface ONLY
      // id + releaseYear so the captain can pick a decade without
      // recognising the title.
      const shuffled = [...upcoming].sort(() => Math.random() - 0.5);
      const picks    = shuffled.slice(0, Math.min(MAX_OPTIONS, shuffled.length));
      const options  = picks.map(t => ({ id: t.id, releaseYear: t.releaseYear }));
      return json({ options }, 200, req);
    }

    // ── action === "pick" ────────────────────────────────────────────────
    const choiceId = (body.choice_id ?? "").trim();
    if (!choiceId) return json({ error: "choice_id required" }, 400, req);

    if (await teamAlreadyUsedTokenThisRound(env, round.id, activeTeam.id)) {
      return json({ error: "Your team already used a token this song" }, 409, req);
    }

    const poolIdx = pool.findIndex((t, i) => i >= cursor && t.id === choiceId);
    if (poolIdx === -1) {
      return json({ error: "That song isn't in the upcoming queue anymore" }, 409, req);
    }

    const burned = await findAndUseToken(env, activeTeam.id, "pass_along", round.id);
    if (!burned) return json({ error: "No Pass Along token available" }, 400, req);

    // Swap chosen into the next-round slot (pool[cursor]). The displaced
    // track drops back into the upcoming pool; it'll play later.
    const chosen: SpotifyTrack = pool[poolIdx];
    const newPool = [...pool];
    [newPool[cursor], newPool[poolIdx]] = [newPool[poolIdx], newPool[cursor]];
    await updateRoom(env, roomId, { track_pool: newPool });

    return json({ ok: true, token_id: burned, year: chosen.releaseYear }, 200, req);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500, req);
  }
};
