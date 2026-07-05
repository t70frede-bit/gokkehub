import type { Env } from "./_env";
import type { JpGame, JpRoom, JpTeam, JpPlayer, JpEventType } from "../src/lib/types";

// Minimal Supabase REST client for use in Cloudflare Functions (no Node deps).
// Same pattern as timelinedrop/functions/_supabase.ts.

function makeHeaders(env: Env) {
  return {
    "Content-Type":  "application/json",
    "apikey":        env.SUPABASE_SERVICE_ROLE_KEY,
    "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Prefer":        "return=representation",
  };
}

function url(env: Env, table: string, params = "") {
  return `${env.SUPABASE_URL}/rest/v1/${table}${params ? `?${params}` : ""}`;
}

export async function req<T>(env: Env, method: string, table: string, params = "", body?: unknown): Promise<T[]> {
  const res = await fetch(url(env, table, params), {
    method,
    headers: makeHeaders(env),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase ${method} ${table}: ${res.status} ${text}`);
  }
  if (res.status === 204) return [] as T[];
  return res.json() as Promise<T[]>;
}

export async function rpc<T>(env: Env, fn: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method:  "POST",
    headers: makeHeaders(env),
    body:    JSON.stringify(args),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase RPC ${fn}: ${res.status} ${text}`);
  }
  return res.json() as Promise<T>;
}

// ── Games ─────────────────────────────────────────────────────────────────────

export async function getGame(env: Env, gameId: string): Promise<JpGame | null> {
  const rows = await req<JpGame>(env, "GET", "jp_games", `id=eq.${gameId}&select=*`);
  return rows[0] ?? null;
}

export async function createGame(env: Env, data: Partial<JpGame>): Promise<JpGame> {
  const rows = await req<JpGame>(env, "POST", "jp_games", "", data);
  return rows[0];
}

export async function updateGame(env: Env, gameId: string, data: Partial<JpGame>): Promise<void> {
  await req(env, "PATCH", "jp_games", `id=eq.${gameId}`, { ...data, updated_at: new Date().toISOString() });
}

// ── Rooms ─────────────────────────────────────────────────────────────────────

export async function getRoom(env: Env, roomId: string): Promise<JpRoom | null> {
  const rows = await req<JpRoom>(env, "GET", "jp_rooms", `id=eq.${roomId}&select=*`);
  return rows[0] ?? null;
}

export async function createRoom(env: Env, data: Partial<JpRoom>): Promise<JpRoom> {
  const rows = await req<JpRoom>(env, "POST", "jp_rooms", "", data);
  return rows[0];
}

export async function updateRoom(env: Env, roomId: string, data: Partial<JpRoom>): Promise<void> {
  await req(env, "PATCH", "jp_rooms", `id=eq.${roomId}`, { ...data, updated_at: new Date().toISOString() });
}

// ── Teams ─────────────────────────────────────────────────────────────────────

export async function getTeams(env: Env, roomId: string): Promise<JpTeam[]> {
  return req<JpTeam>(env, "GET", "jp_teams", `room_id=eq.${roomId}&order=sort_order.asc&select=*`);
}

export async function createTeam(env: Env, data: Partial<JpTeam>): Promise<JpTeam> {
  const rows = await req<JpTeam>(env, "POST", "jp_teams", "", data);
  return rows[0];
}

export async function updateTeam(env: Env, teamId: number, data: Partial<JpTeam>): Promise<void> {
  await req(env, "PATCH", "jp_teams", `id=eq.${teamId}`, data);
}

// ── Players ───────────────────────────────────────────────────────────────────

export async function getPlayers(env: Env, roomId: string): Promise<JpPlayer[]> {
  return req<JpPlayer>(env, "GET", "jp_players", `room_id=eq.${roomId}&select=*`);
}

export async function getPlayer(env: Env, playerId: string): Promise<JpPlayer | null> {
  const rows = await req<JpPlayer>(env, "GET", "jp_players", `id=eq.${playerId}&select=*`);
  return rows[0] ?? null;
}

export async function createPlayer(env: Env, data: Partial<JpPlayer>): Promise<JpPlayer> {
  const rows = await req<JpPlayer>(env, "POST", "jp_players", "", data);
  return rows[0];
}

// ── Events ────────────────────────────────────────────────────────────────────

export async function logEvent(
  env: Env,
  roomId: string,
  eventType: JpEventType,
  fields: { team_id?: number | null; player_id?: string | null; payload?: unknown } = {}
): Promise<void> {
  await req(env, "POST", "jp_game_events", "", {
    room_id:    roomId,
    event_type: eventType,
    team_id:    fields.team_id ?? null,
    player_id:  fields.player_id ?? null,
    payload:    fields.payload ?? null,
  });
}
