// ── Session (cross-subdomain, from account.gokkehub.com/auth/me) ─────────────

export interface GokkeHubSession {
  userId:      string;
  displayName: string | null;
  email:       string | null;
  avatarUrl:   string | null;
}

// ── Question blocks ───────────────────────────────────────────────────────────
// MVP ships text blocks only; the union is the extension point for
// image/audio/video blocks in later passes.

export interface JpTextBlock {
  id:   string;
  type: "text";
  text: string;
}

export type JpBlock = JpTextBlock;

// ── Game config (setup wizard output, stored on jp_games.config) ─────────────

export type JpAnswerMode      = "standard" | "multipleChoice" | "closestNumber" | "ranking";
export type JpBuzzDisplayMode = "disappear" | "typewriter" | "stay";
export type JpQueueMode       = "rebuzz" | "lockIn";

export interface JpTileConfig {
  questionBlocks: JpBlock[];
  answerBlocks:   JpBlock[];
  answerMode:     JpAnswerMode;          // MVP: always "standard"
  buzzDisplayMode?: JpBuzzDisplayMode;   // overrides board default
  specialTile?:   string | null;         // MVP: always null
}

export interface JpBoardConfig {
  categories:  string[];
  rows:        number;
  pointValues: number[];
  /** Keyed "col-row", e.g. "0-0" = first category, top row. */
  tiles: Record<string, JpTileConfig>;
}

export interface JpGameConfig {
  boards: JpBoardConfig[];
  buzzer: {
    queueMode:              JpQueueMode;  // MVP: "rebuzz"
    defaultBuzzDisplayMode: JpBuzzDisplayMode;
    collectionWindowMs:     number;
  };
}

export const DEFAULT_JP_CONFIG: JpGameConfig = {
  boards: [
    {
      categories:  ["Category 1", "Category 2", "Category 3", "Category 4", "Category 5"],
      rows:        5,
      pointValues: [100, 200, 300, 400, 500],
      tiles:       {},
    },
  ],
  buzzer: {
    queueMode:              "rebuzz",
    defaultBuzzDisplayMode: "stay",
    collectionWindowMs:     300,
  },
};

// ── Rows ──────────────────────────────────────────────────────────────────────

export type JpGameStatus = "draft" | "ready" | "archived";
export type JpRoomStatus = "lobby" | "playing" | "paused" | "finished";

export interface JpGame {
  id:         string;
  host_id:    string;       // Supabase Auth user id
  title:      string;
  status:     JpGameStatus;
  config:     JpGameConfig;
  created_at: string;
  updated_at: string;
}

export interface JpActiveQuestion {
  tileKey:        string;
  buzzedBy:       number | null;   // jp_teams.id
  buzzedPlayerId: string | null;
  timerStart:     number | null;   // ms epoch, set server-side on buzz resolve
  secondChanceUsed: boolean;
}

export interface JpBoardState {
  currentBoard:       number;
  spentTiles:         string[];
  revealedCategories: number[];
  buzzersOpen:        boolean;
  buzzRound:          number;
  activeQuestion:     JpActiveQuestion | null;
}

export const INITIAL_BOARD_STATE: JpBoardState = {
  currentBoard:       0,
  spentTiles:         [],
  revealedCategories: [],
  buzzersOpen:        false,
  buzzRound:          0,
  activeQuestion:     null,
};

export interface JpRoom {
  id:          string;       // the room code
  game_id:     string;
  host_id:     string;       // host *player* id (jp_players.id), like tl_rooms
  status:      JpRoomStatus;
  board_state: JpBoardState;
  created_at:  string;
  updated_at:  string;
}

export interface JpTeam {
  id:         number;
  room_id:    string;
  name:       string;
  score:      number;
  powerup:    string | null;
  captain_id: string | null;
  sort_order: number;
}

export interface JpPlayer {
  id:        string;
  room_id:   string;
  team_id:   number | null;
  name:      string;
  user_id:   string | null;
  connected: boolean;
  joined_at: string;
}

export type JpEventType =
  | "tile_selected"
  | "buzz_win"
  | "answer_correct"
  | "answer_wrong"
  | "score_edit"
  | "game_start"
  | "game_end";

// ── Function request/response shapes ─────────────────────────────────────────

export interface CreateGameRequest  { title: string }
export interface CreateGameResponse { game_id: string }

export interface UpdateGameRequest {
  title?:  string;
  config?: JpGameConfig;
  status?: JpGameStatus;
}

export interface LaunchGameRequest  { host_name: string }
export interface LaunchGameResponse { room_id: string; player_id: string }

export interface JoinRoomRequest  { name: string }
export interface JoinRoomResponse { player_id: string; team_id: number }

export type HostAction =
  | { type: "start" }
  | { type: "reveal_category"; categoryIndex: number }
  | { type: "reveal_all_categories" }
  | { type: "select_tile"; tileKey: string }
  | { type: "open_buzzers" }              // every open starts a fresh buzz round
  | { type: "accept_answer" }
  | { type: "reject_answer" }
  | { type: "dismiss_question" }          // close tile with no winner (nobody knew it)
  | { type: "set_score"; teamId: number; score: number }
  | { type: "end_game" };

export interface HostActionRequest {
  player_id: string;                      // must match jp_rooms.host_id
  action:    HostAction;
}

export interface BuzzRequest  { player_id: string }
export interface BuzzResponse { winner_team_id: number | null; winner_player_id: string | null }
