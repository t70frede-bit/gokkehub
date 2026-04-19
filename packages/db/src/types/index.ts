/**
 * GokkeHub — Shared Database Types
 * =================================
 * TypeScript types derived directly from supabase-setup.sql.
 * Used by every app and every /functions/ Worker — import from @gokkehub/db/types.
 *
 * When you add a table or column to the SQL schema, update this file too.
 */

// ── Primitives ────────────────────────────────────────────────────────────────

export type TeamColor = "blue" | "red" | "green" | "yellow";
export type LobbyStatus = "waiting" | "playing" | "finished";
export type ChallengeType = "single" | "group" | "versus";
export type ChallengeSource = "csv" | "custom";

// ── Board challenge ID reference (stored in lobbies.board_challenge_ids) ──────

export interface BoardChallengeRef {
  id: string;           // "csv_1" or "custom_5"
  source: ChallengeSource;
}

// ── Lobby settings (stored in lobbies.settings JSONB) ─────────────────────────

export interface LobbySettings {
  boardSize:      number;          // 3–9
  versusInterval: number;          // minutes between versus rounds
  versusCount:    number;          // how many versus cells on the board
  freeSpace:      boolean;
  games:          string[];        // selected game keys, e.g. ["lol", "cs2"]
  types:          ChallengeType[];
  poolMode:       "standard" | "standard+custom" | "custom";
  teamCount:      number;          // 2–4
}

// ── Table row types ───────────────────────────────────────────────────────────

export interface Lobby {
  id:                  string;
  host_player_id:      string | null;
  status:              LobbyStatus;
  settings:            LobbySettings;
  board_challenge_ids: BoardChallengeRef[] | null;
  created_at:          string;          // ISO 8601
}

export interface Player {
  id:           string;
  lobby_id:     string;
  name:         string;
  team:         TeamColor | null;       // null = spectator
  is_host:      boolean;
  is_spectator: boolean;
  kicked:       boolean;
  user_id:      string | null;          // GokkeHub userId if signed in
  avatar_url:   string | null;          // GokkeHub avatar URL
  created_at:   string;
}

export interface CustomChallenge {
  id:          number;                  // SERIAL
  lobby_id:    string;
  player_id:   string | null;
  player_name: string | null;
  text:        string;
  type:        ChallengeType;
  game:        string;
}

export interface Claim {
  lobby_id:     string;
  challenge_id: string;                 // "csv_1" or "custom_5"
  player_id:    string | null;
  player_name:  string | null;
  team:         TeamColor;
  claimed_at:   string;
}

export interface VersusState {
  lobby_id:                string;
  active_challenge_id:     string | null;
  next_challenge_id:       string | null;
  next_versus_timestamp:   number | null;  // Unix ms
  unlocked_challenge_ids:  string[];
}

// ── Insert types (omit auto-generated fields) ─────────────────────────────────

export type LobbyInsert = Omit<Lobby, "created_at"> & { created_at?: string };
export type PlayerInsert = Omit<Player, "created_at" | "user_id" | "avatar_url"> & { created_at?: string; user_id?: string | null; avatar_url?: string | null };
export type CustomChallengeInsert = Omit<CustomChallenge, "id">;
export type ClaimInsert = Omit<Claim, "claimed_at"> & { claimed_at?: string };

// ── Supabase Database schema type (for createClient<Database>()) ──────────────

export interface Database {
  public: {
    Tables: {
      lobbies: {
        Row:    Lobby;
        Insert: LobbyInsert;
        Update: Partial<LobbyInsert>;
      };
      players: {
        Row:    Player;
        Insert: PlayerInsert;
        Update: Partial<PlayerInsert>;
      };
      custom_challenges: {
        Row:    CustomChallenge;
        Insert: CustomChallengeInsert;
        Update: Partial<CustomChallengeInsert>;
      };
      claims: {
        Row:    Claim;
        Insert: ClaimInsert;
        Update: Partial<ClaimInsert>;
      };
      versus_state: {
        Row:    VersusState;
        Insert: VersusState;
        Update: Partial<VersusState>;
      };
    };
  };
}

// ── Runtime challenge (CSV row merged with source info) ───────────────────────

export interface Challenge {
  id:     string;          // prefixed: "csv_1" or "custom_5"
  text:   string;
  type:   ChallengeType;
  game:   string;
  source: ChallengeSource;
}
