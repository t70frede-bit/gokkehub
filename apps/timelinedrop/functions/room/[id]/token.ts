import type { PagesFunction } from "@cloudflare/workers-types";
import type { Env } from "../../_env";
import { json, handlePreflight } from "../../_cors";
import { getRoom, getRound, getPlayers, getTeams, updateRound } from "../../_supabase";

// POST /room/:id/token
// Body: { round_id, player_id, type, payload? }
//   type ∈ "cover_reveal" | "more_or_less" | "recovery_arm"
// Each effect mutates one or two columns on the active round and burns the
// token. More complex effects (steal_by_year, force_lock, etc) will land in
// follow-up commits.

interface UseBody {
  round_id:  number;
  player_id: string;
  type:      string;
  payload?:  Record<string, unknown>;
}

const ALLOWED_TYPES = new Set([
  "cover_reveal",
  "more_or_less",
  "recovery_arm",
]);

export const onRequest: PagesFunction<Env> = async ({ request, params, env }) => {
  const pre = handlePreflight(request as unknown as Request);
  if (pre) return pre;
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const req    = request as unknown as Request;
  const roomId = params.id as string;

  try {
    const body = await req.json() as UseBody;
    const { round_id, player_id, type, payload } = body;

    if (!ALLOWED_TYPES.has(type)) {
      return json({ error: `Unsupported token type: ${type}` }, 400, req);
    }

    const [room, round, players, teams] = await Promise.all([
      getRoom(env, roomId), getRound(env, round_id),
      getPlayers(env, roomId), getTeams(env, roomId),
    ]);
    if (!room || !round) return json({ error: "Not found" }, 404, req);

    const activeTeam = teams.find(t => t.id === room.active_team_id);
    if (!activeTeam) return json({ error: "No active team" }, 400, req);

    const captain = players.find(p => p.team_id === activeTeam.id && p.is_captain);
    const isCaptain = !!captain && captain.id === player_id;
    const isHostBypass = !!room.settings?.singleScreenMode && room.host_id === player_id;
    if (!isCaptain && !isHostBypass) {
      return json({ error: "Only the captain can use a token" }, 403, req);
    }

    // One-token-per-song rule: reject if any token has already been burned
    // against this round id, regardless of type.
    if (await tokenAlreadyUsedThisRound(env, round.id)) {
      return json({ error: "Only one token may be used per song" }, 409, req);
    }

    // Map UI type → token type stored in tl_team_tokens.
    // (recovery_arm uses a recovery token; the actual save fires when a wrong
    // placement settles — handled in round.ts.)
    const tokenType =
      type === "recovery_arm" ? "recovery" :
      type === "cover_reveal" ? "cover_reveal" :
      type === "more_or_less" ? "more_or_less" :
      type;

    // Find + mark used.
    const burned = await findAndUseToken(env, activeTeam.id, tokenType, round.id);
    if (!burned) return json({ error: `No ${tokenType} token available` }, 400, req);

    // Apply the effect.
    if (type === "cover_reveal") {
      await updateRound(env, round.id, { cover_revealed: true });
    } else if (type === "more_or_less") {
      const cardId = typeof payload?.card_id === "string" ? payload.card_id : null;
      if (!cardId) return json({ error: "card_id required" }, 400, req);
      await updateRound(env, round.id, { more_or_less_card_id: cardId });
    } else if (type === "recovery_arm") {
      await updateRound(env, round.id, { recovery_armed: true });
    }

    return json({ ok: true, token_id: burned }, 200, req);
  } catch (err: unknown) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500, req);
  }
};

async function tokenAlreadyUsedThisRound(env: Env, roundId: number): Promise<boolean> {
  const url = `${env.SUPABASE_URL}/rest/v1/tl_team_tokens?used_round=eq.${roundId}&select=id&limit=1`;
  const res = await fetch(url, {
    headers: {
      apikey:        env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!res.ok) return false;
  const rows = await res.json() as Array<{ id: number }>;
  return rows.length > 0;
}

async function findAndUseToken(
  env: Env, teamId: number, type: string, roundId: number,
): Promise<number | null> {
  const lookupUrl = `${env.SUPABASE_URL}/rest/v1/tl_team_tokens?team_id=eq.${teamId}&type=eq.${encodeURIComponent(type)}&used_at=is.null&pending=eq.false&select=id&limit=1`;
  const lookup = await fetch(lookupUrl, {
    headers: {
      "apikey":        env.SUPABASE_SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!lookup.ok) return null;
  const rows = await lookup.json() as Array<{ id: number }>;
  if (rows.length === 0) return null;
  const id = rows[0].id;

  const updateUrl = `${env.SUPABASE_URL}/rest/v1/tl_team_tokens?id=eq.${id}`;
  await fetch(updateUrl, {
    method: "PATCH",
    headers: {
      "Content-Type":  "application/json",
      "apikey":        env.SUPABASE_SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Prefer":        "return=minimal",
    },
    body: JSON.stringify({
      used_at:    new Date().toISOString(),
      used_round: roundId,
    }),
  });
  return id;
}
