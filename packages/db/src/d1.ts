/**
 * Cloudflare D1 query helpers — @gokkehub/db/d1
 * ===============================================
 * Thin wrappers around the D1 binding that enforce:
 *   - Parameterised statements (never string-concat user input into SQL)
 *   - Typed return values using the shared DB types
 *
 * The `DB` binding is injected by the Workers runtime from wrangler.toml.
 * Import this only in /functions/ (server-side Workers code).
 *
 * Usage:
 *   import { getLobby, getPlayers } from "@gokkehub/db/d1";
 *   const lobby = await getLobby(env.DB, lobbyId);
 */

import type {
  Lobby,
  Player,
  Claim,
  CustomChallenge,
  VersusState,
  LobbyInsert,
  PlayerInsert,
  ClaimInsert,
  CustomChallengeInsert,
} from "./types/index.ts";

// D1Database type from the Workers runtime
type D1 = D1Database;

// ── Lobbies ───────────────────────────────────────────────────────────────────

export async function getLobby(db: D1, id: string): Promise<Lobby | null> {
  return db
    .prepare("SELECT * FROM lobbies WHERE id = ?")
    .bind(id)
    .first<Lobby>();
}

export async function insertLobby(db: D1, lobby: LobbyInsert): Promise<void> {
  await db
    .prepare(
      `INSERT INTO lobbies (id, host_player_id, status, settings, board_challenge_ids)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(
      lobby.id,
      lobby.host_player_id,
      lobby.status,
      JSON.stringify(lobby.settings),
      lobby.board_challenge_ids ? JSON.stringify(lobby.board_challenge_ids) : null,
    )
    .run();
}

export async function updateLobbyStatus(
  db: D1,
  id: string,
  status: Lobby["status"],
): Promise<void> {
  await db
    .prepare("UPDATE lobbies SET status = ? WHERE id = ?")
    .bind(status, id)
    .run();
}

// ── Players ───────────────────────────────────────────────────────────────────

export async function getPlayer(db: D1, id: string): Promise<Player | null> {
  return db
    .prepare("SELECT * FROM players WHERE id = ?")
    .bind(id)
    .first<Player>();
}

export async function getPlayersInLobby(
  db: D1,
  lobbyId: string,
): Promise<Player[]> {
  const result = await db
    .prepare(
      "SELECT * FROM players WHERE lobby_id = ? AND kicked = FALSE ORDER BY created_at ASC",
    )
    .bind(lobbyId)
    .all<Player>();
  return result.results;
}

export async function insertPlayer(
  db: D1,
  player: PlayerInsert,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO players (id, lobby_id, name, team, is_host, is_spectator, kicked)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      player.id,
      player.lobby_id,
      player.name,
      player.team,
      player.is_host ? 1 : 0,
      player.is_spectator ? 1 : 0,
      0,
    )
    .run();
}

export async function kickPlayer(db: D1, playerId: string): Promise<void> {
  await db
    .prepare("UPDATE players SET kicked = TRUE WHERE id = ?")
    .bind(playerId)
    .run();
}

// ── Claims ────────────────────────────────────────────────────────────────────

export async function getClaimsForLobby(
  db: D1,
  lobbyId: string,
): Promise<Claim[]> {
  const result = await db
    .prepare(
      "SELECT * FROM claims WHERE lobby_id = ? ORDER BY claimed_at ASC",
    )
    .bind(lobbyId)
    .all<Claim>();
  return result.results;
}

export async function upsertClaim(db: D1, claim: ClaimInsert): Promise<void> {
  await db
    .prepare(
      `INSERT INTO claims (lobby_id, challenge_id, player_id, player_name, team)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (lobby_id, challenge_id) DO UPDATE SET
         player_id   = excluded.player_id,
         player_name = excluded.player_name,
         team        = excluded.team,
         claimed_at  = CURRENT_TIMESTAMP`,
    )
    .bind(
      claim.lobby_id,
      claim.challenge_id,
      claim.player_id,
      claim.player_name,
      claim.team,
    )
    .run();
}

export async function deleteClaim(
  db: D1,
  lobbyId: string,
  challengeId: string,
): Promise<void> {
  await db
    .prepare(
      "DELETE FROM claims WHERE lobby_id = ? AND challenge_id = ?",
    )
    .bind(lobbyId, challengeId)
    .run();
}

// ── Custom challenges ─────────────────────────────────────────────────────────

export async function getCustomChallenges(
  db: D1,
  lobbyId: string,
): Promise<CustomChallenge[]> {
  const result = await db
    .prepare(
      "SELECT * FROM custom_challenges WHERE lobby_id = ? ORDER BY id ASC",
    )
    .bind(lobbyId)
    .all<CustomChallenge>();
  return result.results;
}

export async function insertCustomChallenge(
  db: D1,
  challenge: CustomChallengeInsert,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO custom_challenges (lobby_id, player_id, player_name, text, type, game)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      challenge.lobby_id,
      challenge.player_id,
      challenge.player_name,
      challenge.text,
      challenge.type,
      challenge.game,
    )
    .run();
}

export async function deleteCustomChallenge(
  db: D1,
  id: number,
): Promise<void> {
  await db
    .prepare("DELETE FROM custom_challenges WHERE id = ?")
    .bind(id)
    .run();
}

// ── Versus state ──────────────────────────────────────────────────────────────

export async function getVersusState(
  db: D1,
  lobbyId: string,
): Promise<VersusState | null> {
  return db
    .prepare("SELECT * FROM versus_state WHERE lobby_id = ?")
    .bind(lobbyId)
    .first<VersusState>();
}

export async function upsertVersusState(
  db: D1,
  state: VersusState,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO versus_state
         (lobby_id, active_challenge_id, next_challenge_id, next_versus_timestamp, unlocked_challenge_ids)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (lobby_id) DO UPDATE SET
         active_challenge_id    = excluded.active_challenge_id,
         next_challenge_id      = excluded.next_challenge_id,
         next_versus_timestamp  = excluded.next_versus_timestamp,
         unlocked_challenge_ids = excluded.unlocked_challenge_ids`,
    )
    .bind(
      state.lobby_id,
      state.active_challenge_id,
      state.next_challenge_id,
      state.next_versus_timestamp,
      JSON.stringify(state.unlocked_challenge_ids),
    )
    .run();
}
