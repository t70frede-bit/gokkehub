// ── Challenge ────────────────────────────────────────────────────────────────

export type ChallengeType = "single" | "group" | "versus";
export type ChallengeSource = "csv" | "custom" | "player";

export interface Challenge {
  id: string;           // "csv_1" | "custom_5" | uuid for player challenges
  text: string;
  type: ChallengeType;
  game: string;         // normalized key, e.g. "cs2"
  source: ChallengeSource;
}

// ── Teams ────────────────────────────────────────────────────────────────────

export type TeamColor = "blue" | "red" | "green" | "yellow";

export const TEAM_COLORS: TeamColor[] = ["blue", "red", "green", "yellow"];
export const TEAM_LABELS: Record<TeamColor, string> = {
  blue: "Blue", red: "Red", green: "Green", yellow: "Yellow",
};
export const TEAM_EMOJIS: Record<TeamColor, string> = {
  blue: "🔵", red: "🔴", green: "🟢", yellow: "🟡",
};

// ── Lobby ────────────────────────────────────────────────────────────────────

export type PoolMode = "standard" | "standard+custom" | "custom";
export type TeamMode = "manual" | "random";

export interface LobbySettings {
  boardWidth:      number;         // 3–9
  boardHeight:     number;         // 3–9
  winLength:       number;         // tiles in a row needed to win
  teamCount:       number;         // 2–4
  teamMode:        TeamMode;
  versusCount:     number;
  versusInterval:  number;         // minutes
  freeSpace:       boolean;
  games:           string[];       // normalized game keys
  types:           ChallengeType[];
  poolMode:        PoolMode;
}

export interface ChallengeRef {
  id: string;
  source: ChallengeSource;
}

export interface Lobby {
  id:                  string;
  host_player_id:      string;
  status:              "waiting" | "playing" | "finished";
  settings:            LobbySettings;
  board_challenge_ids: ChallengeRef[] | null;
  created_at:          string;
}

// ── Player ───────────────────────────────────────────────────────────────────

export interface Player {
  id:           string;
  lobby_id:     string;
  name:         string;
  team:         TeamColor | null;
  is_host:      boolean;
  is_spectator: boolean;
  kicked:       boolean;
  user_id:      string | null;   // GokkeHub userId if logged in
  avatar_url:   string | null;
  created_at:   string;
}

// ── Claim ────────────────────────────────────────────────────────────────────

export interface Claim {
  lobby_id:     string;
  challenge_id: string;
  player_id:    string;
  player_name:  string;
  team:         TeamColor;
  claimed_at:   string;
}

// ── Versus state ─────────────────────────────────────────────────────────────

export interface VersusState {
  lobby_id:               string;
  active_challenge_id:    string | null;
  next_challenge_id:      string | null;
  next_versus_timestamp:  number | null;
  unlocked_challenge_ids: string[];
}

// ── Custom challenges ────────────────────────────────────────────────────────

export interface CustomChallenge {
  id:          number;
  lobby_id:    string;
  player_id:   string;
  player_name: string;
  text:        string;
  type:        ChallengeType;
  game:        string;
}

// ── Player game library ───────────────────────────────────────────────────────

export type GameSource = "steam" | "discord" | "manual";

export interface PlayerGame {
  id:             string;
  user_id:        string;
  display_name:   string;
  normalized_key: string;
  source:         GameSource;
  steam_app_id:   number | null;
  is_favorite:    boolean;
}

// ── Player challenge (user-created, saved to account) ───────────────────────

export interface PlayerChallenge {
  id:           string;
  user_id:      string;
  player_name:  string;
  text:         string;
  type:         ChallengeType;
  game:         string;
  upvote_count: number;
  created_at:   string;
}

// ── GokkeHub session ─────────────────────────────────────────────────────────

export interface GokkeHubSession {
  userId:      string;
  email:       string | null;
  displayName: string | null;
  avatarUrl:   string | null;
  linked: {
    spotify: boolean;
    discord: boolean;
    steam:   boolean;
  };
}

// ── Board state ───────────────────────────────────────────────────────────────

export type SoloBoardState = Record<string, TeamColor | "">;

export interface LobbyBoardState {
  [challengeId: string]: {
    team:       TeamColor;
    playerName: string;
    playerId:   string;
  } | undefined;
}
