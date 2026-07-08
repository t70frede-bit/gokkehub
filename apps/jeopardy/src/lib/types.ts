// ── Session (cross-subdomain, from account.gokkehub.com/auth/me) ─────────────

export interface GokkeHubSession {
  userId:      string;
  displayName: string | null;
  email:       string | null;
  avatarUrl:   string | null;
}

// ── Question blocks ───────────────────────────────────────────────────────────

export type JpRevealMode = "off" | "silhouette" | "pixelated" | "animated";

export interface JpTextBlock {
  id:   string;
  type: "text";
  text: string;
}

export interface JpImageBlock {
  id:   string;
  type: "image";
  url:  string;               // public URL in the jp-media storage bucket
  revealMode?: JpRevealMode;  // question-side only
}

export interface JpAudioBlock {
  id:   string;
  type: "audio";
  url:  string;
  /** Playback window in seconds; trims applied at play time, file untouched. */
  trimStart?: number;
  trimEnd?:   number;
  fadeIn?:    boolean;
  fadeOut?:   boolean;
  onBuzz?:    "stop" | "fadeOut" | "continue";   // default stop
}

export interface JpVideoBlock {
  id:   string;
  type: "video";
  url:  string;
  trimStart?: number;
  trimEnd?:   number;
  fadeIn?:    boolean;
  fadeOut?:   boolean;
  onBuzz?:    "stop" | "freeze" | "continue";    // default freeze
  muted?:     boolean;                           // pair with an audio block for fine control
}

export type JpBlock = JpTextBlock | JpImageBlock | JpAudioBlock | JpVideoBlock;
export type JpMediaBlock = JpAudioBlock | JpVideoBlock;

// ── Answer modes ──────────────────────────────────────────────────────────────

export type JpAnswerMode      = "standard" | "multipleChoice" | "closestNumber" | "ranking";
export type JpBuzzDisplayMode = "disappear" | "typewriter" | "stay";
export type JpQueueMode       = "rebuzz" | "lockIn";

export interface JpMultipleChoiceConfig {
  options:      string[];   // up to 8
  correctIndex: number;
  /** true → only the fastest correct submission scores; false → all correct score. */
  firstCorrectOnly: boolean;
}

export interface JpClosestNumberConfig {
  input:   "field" | "slider";
  min?:    number;          // slider only
  max?:    number;          // slider only
  unit:    string;          // free text: Kr., %, km, …
  correct: number;
}

export interface JpRankingConfig {
  /** Items stored in the CORRECT order; shuffled on player phones. */
  items:   string[];        // up to 8
  scoring: "exact" | "partial";
}

export type JpAnswerModeConfig = JpMultipleChoiceConfig | JpClosestNumberConfig | JpRankingConfig;

// ── Power-ups & dangerous tiles ───────────────────────────────────────────────

export type JpPowerupType = "sniper" | "buffer" | "secondChance";

export const POWERUP_META: Record<JpPowerupType, { icon: string; name: string; desc: string }> = {
  sniper:       { icon: "⚡", name: "Sniper",        desc: "Permanent buzz head-start" },
  buffer:       { icon: "🛡️", name: "Buffer",        desc: "Flat reduction on wrong-answer loss" },
  secondChance: { icon: "🎯", name: "Second Chance", desc: "Answer twice per buzz" },
};

export interface JpPowerupConfig {
  enabled:   boolean;
  /** Random placement picks a filled tile within these rows (0-based, inclusive). */
  rowRange:  [number, number];
  advantageMs?:     number;  // sniper
  reductionAmount?: number;  // buffer
}

export interface JpDangerousConfig {
  buzzed: {
    enabled:  boolean;
    count:    number;              // how many Buzzed tiles per board
    rowRange: [number, number];
  };
}

/** Secret per-board tile assignments, stored server-side only (jp_room_secrets). */
export type JpSpecialTile = "powerup_sniper" | "powerup_buffer" | "powerup_secondChance" | "buzzed";
export type JpSpecialTiles = Record<string, Record<string, JpSpecialTile>>; // "board0" → tileKey → special

// ── Game config (setup wizard output, stored on jp_games.config) ─────────────

/** What shows first on the big screen: everything, text before media, or media before text. */
export type JpRevealOrder = "together" | "textFirst" | "mediaFirst";

export interface JpTileConfig {
  questionBlocks: JpBlock[];
  answerBlocks:   JpBlock[];
  answerMode:     JpAnswerMode;
  answerModeConfig?: JpAnswerModeConfig;
  buzzDisplayMode?: JpBuzzDisplayMode;   // overrides board default
  /** Staged reveal: the host triggers the second part manually. Default together. */
  revealOrder?:   JpRevealOrder;
}

export interface JpBoardConfig {
  categories:  string[];
  rows:        number;
  pointValues: number[];
  /** Keyed "col-row", e.g. "0-0" = first category, top row. */
  tiles: Record<string, JpTileConfig>;
}

export type JpBoard2Mode = "off" | "doubleUp" | "custom";

export interface JpFinalJeopardyConfig {
  enabled:        boolean;
  category:       string;
  questionBlocks: JpBlock[];
  answerBlocks:   JpBlock[];
}

export interface JpTeamsConfig {
  /** "solo" = every player is their own one-member team (the original mode). */
  mode:  "solo" | "teams";
  count: number;                       // 2–8; UI warns above 4
  /** Who may buzz on standard questions. Device questions (MC/closest/
   *  ranking/final) are ALWAYS captain-only — the team gathers around the
   *  captain's phone. That's a house rule, not a setting. */
  buzzerMode: "anyone" | "captain";
}

export interface JpGameConfig {
  teams?: JpTeamsConfig;
  boards: JpBoardConfig[];
  buzzer: {
    queueMode:              JpQueueMode;  // MVP: "rebuzz"
    defaultBuzzDisplayMode: JpBuzzDisplayMode;
    collectionWindowMs:     number;
  };
  powerups?: {
    sniper:       JpPowerupConfig;
    buffer:       JpPowerupConfig;
    secondChance: JpPowerupConfig;
  };
  dangerous?:        JpDangerousConfig;
  board2Mode?:       JpBoard2Mode;
  powerupCarryover?: "persist" | "reset";
  finalJeopardy?:    JpFinalJeopardyConfig;
}

export const DEFAULT_JP_CONFIG: JpGameConfig = {
  teams: { mode: "solo", count: 2, buzzerMode: "anyone" },
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
  powerups: {
    sniper:       { enabled: false, rowRange: [0, 1], advantageMs: 200 },
    buffer:       { enabled: false, rowRange: [2, 3], reductionAmount: 100 },
    secondChance: { enabled: false, rowRange: [3, 4] },
  },
  dangerous: {
    buzzed: { enabled: false, count: 1, rowRange: [2, 4] },
  },
  board2Mode:       "off",
  powerupCarryover: "persist",
  finalJeopardy: {
    enabled:        false,
    category:       "",
    questionBlocks: [],
    answerBlocks:   [],
  },
};

/**
 * Resolve a board by index. Board 1 in doubleUp mode is derived from board 0
 * with doubled point values (never stored). Shared by client and functions.
 */
export function getBoard(config: JpGameConfig, index: number): JpBoardConfig | null {
  if (index === 0) return config.boards[0] ?? null;
  if (index !== 1) return null;
  const mode = config.board2Mode ?? "off";
  if (mode === "custom")   return config.boards[1] ?? null;
  if (mode === "doubleUp") {
    const b = config.boards[0];
    return b ? { ...b, pointValues: b.pointValues.map(v => v * 2) } : null;
  }
  return null;
}

export function boardCount(config: JpGameConfig): number {
  return (config.board2Mode ?? "off") === "off" ? 1 : 2;
}

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
  /** Defaults to "standard" for rooms created before answer modes shipped. */
  mode?:          JpAnswerMode;
  buzzedBy:       number | null;   // jp_teams.id
  buzzedPlayerId: string | null;
  timerStart:     number | null;   // ms epoch, set server-side on buzz resolve
  secondChanceUsed: boolean;
  /** Set when this tile was a Buzzed dangerous tile (display drama). */
  special?:       "buzzed";
  /** Teams that have locked in a submission (submission modes only). */
  submittedTeamIds?: number[];
  /** Queue Lock-In: teams that answered this tile wrong and can't rebuzz it. */
  lockedOutTeamIds?: number[];
  /** Bumped by the host's replay_media action — big screen restarts clips. */
  mediaNonce?: number;
  /** Staged reveal progress: 0 = first part only, 1 = everything. */
  revealStage?: number;
}

export interface JpPowerupPrompt {
  teamId:         number;
  powerupType:    JpPowerupType;
  tileKey:        string;
  value:          number;                 // points forfeited if they claim the power-up
  currentPowerup: JpPowerupType | null;   // non-null → claiming is a swap
}

export interface JpResolutionSummary {
  tileKey: string;
  mode:    JpAnswerMode;
  /** Display-ready lines for the big screen, e.g. "Alice +300". */
  lines:   string[];
  /** Teams that scored — the first one's buzzer audio plays at the reveal. */
  winnerTeamIds?: number[];
}

export type JpFinalStage = "wager" | "question" | "judging";

export interface JpFinalState {
  stage:            JpFinalStage;
  category:         string;
  submittedTeamIds: number[];
  /** Filled as the host judges — drives the big-screen reveal. */
  revealed: Record<number, { answer: string; wager: number; correct: boolean }>;
}

export interface JpBoardState {
  currentBoard:       number;
  spentTiles:         string[];
  revealedCategories: number[];
  buzzersOpen:        boolean;   // doubles as "submissions open" in submission modes
  buzzRound:          number;
  activeQuestion:     JpActiveQuestion | null;
  powerupPrompt?:     JpPowerupPrompt | null;
  lastResolution?:    JpResolutionSummary | null;
  /** Between-boards scoreboard is showing. */
  interlude?:         boolean;
  final?:             JpFinalState | null;
}

export const INITIAL_BOARD_STATE: JpBoardState = {
  currentBoard:       0,
  spentTiles:         [],
  revealedCategories: [],
  buzzersOpen:        false,
  buzzRound:          0,
  activeQuestion:     null,
  powerupPrompt:      null,
  lastResolution:     null,
  interlude:          false,
  final:              null,
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
  powerup:    JpPowerupType | null;
  captain_id: string | null;
  sort_order: number;
}

export interface JpPlayer {
  id:        string;
  room_id:   string;
  team_id:   number | null;
  name:      string;
  user_id:   string | null;
  /** Profile buzzer sound snapshot: "preset:<id>" or an uploaded-clip URL. */
  buzzer_sound?: string | null;
  connected: boolean;
  joined_at: string;
}

export type JpEventType =
  | "tile_selected"
  | "buzz_win"
  | "answer_correct"
  | "answer_wrong"
  | "powerup_claimed"
  | "powerup_swapped"
  | "powerup_declined"
  | "score_edit"
  | "board_advance"
  | "final_started"
  | "final_judged"
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

export interface JoinRoomRequest  { name: string; team_id?: number | null }
export interface JoinRoomResponse { player_id: string; team_id: number }

export type HostAction =
  | { type: "start" }
  | { type: "reveal_category"; categoryIndex: number }
  | { type: "reveal_all_categories" }
  | { type: "select_tile"; tileKey: string; pickerTeamId?: number }
  | { type: "open_buzzers" }              // every open starts a fresh buzz round
  | { type: "replay_media" }              // restart the question's audio/video clip
  | { type: "reveal_rest" }               // staged reveal: show the held-back part (buzzers stay closed)
  | { type: "reveal_and_open" }           // reveal held-back part AND open buzzers in one step
  | { type: "accept_answer" }
  | { type: "reject_answer" }
  | { type: "dismiss_question" }          // close tile with no winner (nobody knew it)
  | { type: "resolve_submissions" }       // grade MC / closest / ranking submissions
  | { type: "force_powerup_choice"; choice: "points" | "powerup" }
  | { type: "advance_board" }             // show interlude scoreboard, move to board 2
  | { type: "continue_board" }            // dismiss interlude
  | { type: "start_final" }
  | { type: "final_reveal_question" }
  | { type: "final_judge"; teamId: number; correct: boolean }
  | { type: "set_score"; teamId: number; score: number }
  | { type: "assign_player"; playerId: string; teamId: number }
  | { type: "set_captain"; playerId: string }
  | { type: "shuffle_teams" }
  | { type: "rename_team"; teamId: number; name: string }
  | { type: "end_game" }
  | { type: "rematch" };                  // finished room → back to lobby, fresh state

export interface JpGameEvent {
  id:         number;
  room_id:    string;
  event_type: JpEventType;
  team_id:    number | null;
  player_id:  string | null;
  payload:    Record<string, unknown> | null;
  created_at: string;
}

export interface HostActionRequest {
  player_id: string;                      // must match jp_rooms.host_id
  action:    HostAction;
}

export interface BuzzRequest  { player_id: string }
export interface BuzzResponse { winner_team_id: number | null; winner_player_id: string | null }

/** Submissions: tile answers and Final Jeopardy wagers/answers. */
export type JpSubmissionKind = "answer" | "final_wager" | "final_answer";

export interface SubmitRequest {
  player_id: string;
  kind:      JpSubmissionKind;
  /** MC: option index (original order). Closest: number. Ranking: item indices in chosen order. Final: wager number / answer string. */
  value:     number | number[] | string;
}

export interface PowerupChoiceRequest { player_id: string; choice: "points" | "powerup" }

export interface JpSubmissionRow {
  team_id:    number;
  player_id:  string;
  kind:       JpSubmissionKind;
  payload:    { value: number | number[] | string };
  created_at: string;
}

export interface UploadResponse { url: string }
