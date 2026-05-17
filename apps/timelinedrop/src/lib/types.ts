// ── Spotify ───────────────────────────────────────────────────────────────────

export interface SpotifyTrack {
  id:          string;
  name:        string;
  artist:      string;
  albumName:   string;
  releaseYear: number;
  coverUrl:    string;
  uri:         string;            // spotify:track:ID — required for Web Playback SDK
  durationMs?: number;            // captured from Spotify search; used by song-length timer mode
}

// ── Database rows ─────────────────────────────────────────────────────────────

export type LateJoinMode = "open" | "spectator-only" | "closed";

export type JudgeMode =
  | "team-captain"
  | "next-team-captain"
  | "host"
  | "vote-all";

export type Difficulty = "easy" | "medium" | "hard" | "hardest";
export type PlaylistMode = "as-is" | "inspiration" | "smart-filter";

// Where the round's songs come from. Group taste runs the curation engine
// against each player's Last.fm history; playlist uses tracks the host pasted
// from a Spotify playlist URL.
export type SongSource = "group-taste" | "playlist";

// How audio actually plays during a round.
// "browser"     — the host's browser runs the Spotify Web Playback SDK.
//                 Standard mode; players hear it via whatever shared audio
//                 the host has set up (Discord screen-share, in-person…).
// "discord-bot" — a Discord bot in the host's voice channel plays the track.
//                 Audio comes from YouTube (Spotify ToS forbids server-side
//                 streaming). Bot runs as a separate Node.js process — see
//                 bots/musix-discord/README.md.
// How a round's audio reaches the players.
//   browser           — host's browser runs the Spotify Web Playback SDK.
//                       Standard setup; players hear it via whatever shared
//                       audio the host has (Discord screen-share, in-person…).
//   discord-bot       — musix-discord bot in the host's voice channel.
//   all-clients-stream — every browser plays an <audio> tag pointed at the
//                       bot's HTTP audio proxy. Each player hears the song
//                       in their own browser; no Discord required.
export type AudioMode = "browser" | "discord-bot" | "all-clients-stream";

// Within all-clients-stream mode: does the host control playback for
// everyone (synchronized — clients seek to playing_since) or does each
// player control their own (independent)?
export type StreamSyncMode = "synchronized" | "independent";

// Hardcoded proxy URL — every all-clients-stream room hits the same
// public bot. No per-room override; if you fork and self-host the bot
// you'll edit this constant + redeploy. Bot must be configured WITHOUT
// STREAM_TOKEN since the client doesn't send one.
export const STREAM_PROXY_URL = "https://musix-bot.hotbear.org";

// How the turn timer behaves.
//  - "song-length" (default) — turn lasts until the song ends. Uses
//    track.durationMs when present (Spotify captures it; legacy rounds
//    without it fall back to TIMER_DEFAULT_FALLBACK_SECONDS).
//  - "fixed"       — counts down from `timerSeconds`.
//  - "none"        — no timer; captain plays at their own pace.
export type TimerMode = "song-length" | "fixed" | "none";
export const TIMER_DEFAULT_FALLBACK_SECONDS = 90;

// How teams acquire tokens.
//  - "standard" — placement + both guesses correct → grant ONE Song
//    Skipper token. Simple, classic, no randomness.
//  - "bonus" (default — current behaviour) — placement + both guesses
//    correct → grant ONE random token from the implemented set.
//  - "shop" — each correct guess (artist OR songname) credits +1 point
//    to the team. Captain spends points via /round?action=buy-token
//    to acquire specific tokens at posted costs.
export type TokenEconomy = "standard" | "bonus" | "shop";

// Per-token-type cost in shop mode. Keys MUST match TOKEN_CATALOG types
// in tokens.ts. Tunable; tiers roughly map to the Tier 1/2/3 grouping.
// Only includes tokens currently flagged implemented:true.
export const SHOP_TOKEN_COSTS: Record<string, number> = {
  cover_reveal_before: 2,
  cover_reveal:        2,
  song_skipper:        2,
  year_span_5:         3,
  more_or_less:        3,
  reference_point:     3,
  recovery:            4,
  card_remover:        4,
  force_lock:          6,
  song_limiter:        6,
};

export interface TlRoomSettings {
  lateJoinMode?:       LateJoinMode;
  streamerMode?:       boolean;
  hideSpectators?:     boolean;
  teamSwapEnabled?:    boolean;
  judgeMode?:          JudgeMode;
  voteTimerSeconds?:   number;
  difficulty?:         Difficulty;
  /** @deprecated kept for back-compat — UI no longer surfaces this. */
  playlistMode?:       PlaylistMode;
  skipRecentlyHeard?:  boolean;       // 14-day blacklist toggle
  singleScreenMode?:   boolean;       // host plays for every team on one device
  songSource?:         SongSource;    // group-taste (default) | playlist
  audioMode?:          AudioMode;     // browser (default) | discord-bot
  timerMode?:          TimerMode;     // song-length (default) | fixed | none
  timerSeconds?:       number;        // used when timerMode === "fixed"
  tokenEconomy?:       TokenEconomy;  // bonus (default) | standard | shop
  // All-clients-stream sync sub-mode. URL + token are hardcoded
  // (STREAM_PROXY_URL above) since there's one public bot deployment.
  streamSyncMode?:     StreamSyncMode; // synchronized (default) | independent
}

export const DEFAULT_TL_SETTINGS: Required<TlRoomSettings> = {
  lateJoinMode:      "open",
  streamerMode:      false,
  hideSpectators:    false,
  teamSwapEnabled:   false,
  judgeMode:         "team-captain",
  voteTimerSeconds:  20,
  difficulty:        "medium",
  playlistMode:      "as-is",
  skipRecentlyHeard: true,
  singleScreenMode:  false,
  songSource:        "group-taste",
  audioMode:         "browser",
  timerMode:         "song-length",
  timerSeconds:      120,
  tokenEconomy:      "bonus",
  streamSyncMode:    "synchronized",
};

export interface TlRoom {
  id:               string;       // 6-char code
  host_id:          string;
  /** SESSIONS KV id of the host (set on Start). Used by the curation engine
   *  to load the host's Spotify creds during background top-ups triggered
   *  from a non-host request. */
  host_session_id?: string | null;
  status:           "lobby" | "playing" | "finished";
  win_target:       number;
  active_team_id:   number | null;
  track_pool:       SpotifyTrack[];
  track_cursor:     number;
  current_round_id: number | null;
  playing_since:    number | null; // epoch ms when Web Playback SDK started
  paused_at_ms:     number | null; // ms offset in track when paused
  settings:         TlRoomSettings;
  created_at:       string;
}

export interface TlTeam {
  id:             number;
  room_id:        string;
  name:           string;
  tokens:         number;            // ready-to-use tokens
  tokens_pending: number;            // earned this turn; promote to tokens when team's next turn begins
  pending_tracks: SpotifyTrack[];    // cards earned this turn, not yet locked
  sort_order:     number;
  points:         number;            // shop currency; ignored in "standard" / "bonus" modes
}

export interface TlPlayer {
  id:               string;
  room_id:          string;
  team_id:          number | null;
  name:             string;
  is_captain:       boolean;
  is_host:          boolean;
  is_spectator:     boolean;
  discord_id:       string | null;
  lastfm_username:  string | null;
  manual_artists:   string[];      // fallback when no Last.fm
  joined_at:        string;
}

export type Confidence = "known" | "likely" | "stretch" | "wild";

export interface TlTeamToken {
  id:             number;
  room_id:        string;
  team_id:        number;
  type:           string;       // TokenType from lib/tokens.ts
  granted_at:     string;
  granted_round:  number | null;
  used_at:        string | null;
  used_round:     number | null;
  pending:        boolean;      // earned this turn, ready when team plays next
}

export interface TlRound {
  id:                  number;
  room_id:             string;
  team_id:             number;
  track:               SpotifyTrack;
  left_year:           number | null;
  right_year:          number | null;
  staged_left_year:    number | null;
  staged_right_year:   number | null;
  outcome:             "correct" | "incorrect" | null;
  // Token-state flags (migration 009 + 012)
  skipped:             boolean;
  cover_revealed:      boolean;
  year_tolerance:      number;
  more_or_less_card_id: string | null;
  recovery_armed:      boolean;
  /** Force Lock — when true the active team can't trigger "next" after a
   *  correct placement; their turn ends after this song. Set by an opposing
   *  captain spending a force_lock token. */
  force_locked:        boolean;
  /** Song Limiter (migration 014) — when set, the host's audio player
   *  auto-pauses once positionMs exceeds this many seconds. Played by an
   *  opposing captain via song_limiter token. */
  song_limit_seconds:  number | null;
  artist_guess:        string | null;
  songname_guess:      string | null;
  artist_correct:      boolean | null;
  songname_correct:    boolean | null;
  artist_votes:        Record<string, boolean>;
  songname_votes:      Record<string, boolean>;
  judging_started_at:  string | null;
  judging_finalized:   boolean;
  bonus_awarded:       boolean;
  revealed_at:         string | null;
  // Curation enrichment (populated when track was generated by the curation engine)
  familiarity_score:   number | null;
  confidence:          Confidence | null;
  players_who_know_it: string[];   // discord ids
  lastfm_name:         string | null;
  artist_name:         string | null;
  // Year correction flow (any player can propose; host approves; on approval
  // corrected_year overrides track.releaseYear for placement & timeline)
  corrected_year:                 number | null;
  year_correction_proposed:       number | null;
  year_correction_proposed_by:    string | null;
  year_correction_proposed_name:  string | null;
  // YouTube-version-bad flow (migration 015). The bot writes bot_video_id
  // when it starts streaming the round. Anyone can flag the video as
  // wrong/bad — proposed_* fields capture who. Host approves → approved
  // flips, the bot calls reportVideo() against the global blacklist
  // table, and Redo button appears. Host clicks Redo → redo_requested_at
  // stamps, server resets round state, bot re-resolves with the bad
  // video now blacklisted and plays the next-best match.
  bot_video_id:                   string | null;
  video_report_proposed:          boolean;
  video_report_proposed_by:       string | null;
  video_report_proposed_name:     string | null;
  video_report_approved:          boolean;
  redo_requested_at:              string | null; // ISO timestamp
  // Shop-mode idempotency guards (migration 018). When tokenEconomy ===
  // "shop", flipping artist_correct/songname_correct to true credits +1
  // point to the team; the flag below stops re-credits if the field
  // gets re-judged or the realtime echo replays.
  shop_artist_pointed:            boolean;
  shop_song_pointed:              boolean;
}

export interface StageRequest {
  round_id:          number;
  player_id:         string;
  staged_left_year:  number | null;
  staged_right_year: number | null;
}

export interface TlTimelineEntry {
  team_id:        number;
  track_id:       string;
  year:           number;             // year used for ordering — Spotify default or corrected
  position:       number;
  track:          SpotifyTrack;
  corrected_year: number | null;      // host-approved correction, if any
}

export interface TlPing {
  id:          number;
  round_id:    number;
  player_id:   string;
  player_name: string;
  year:        number;
  created_at:  string;
}

export interface TlNote {
  id:          number;
  round_id:    number;
  player_id:   string;
  player_name: string;
  content:     string;
  /** Migration 010 — "free" is legacy chat; "song"/"artist" are structured
   *  suggestions for the captain's guess inputs; "reference" is a system
   *  note from the Reference Point token surfacing a same-year hint. */
  kind:        "free" | "song" | "artist" | "reference";
  created_at:  string;
}

// ── Aggregated game state (built client-side from subscriptions) ──────────────

/**
 * Transient event: a team just activated a token. All clients in the room see
 * the same TokenActivation arrive via realtime, which drives the full-screen
 * flip animation. `tokenId` is the tl_team_tokens row id and doubles as a
 * dedupe key so the same row never animates twice.
 */
export interface TokenActivation {
  tokenId:     number;
  tokenType:   string;   // TokenType from lib/tokens.ts
  teamId:      number;
  triggeredAt: number;   // epoch ms, for UI sequencing
}

export interface GameState {
  room:             TlRoom;
  teams:            TlTeam[];
  players:          TlPlayer[];
  round:            TlRound | null;
  timelines:        Record<number, TlTimelineEntry[]>; // teamId → sorted entries
  notes:            TlNote[];
  pings:            TlPing[];
  tokens:           Record<number, TlTeamToken[]>; // teamId → tokens (granted, not yet used)
  myPlayer:         TlPlayer | null;
  tokenActivation:  TokenActivation | null;       // most recent activation; cleared by consumer
}

// ── WebRTC signaling messages (sent via Supabase Broadcast) ──────────────────

export type WrtcMessage =
  | { type: "want-audio";  from: string }
  | { type: "offer";       from: string; to: string; sdp: RTCSessionDescriptionInit }
  | { type: "answer";      from: string; to: string; sdp: RTCSessionDescriptionInit }
  | { type: "ice";         from: string; to: string; candidate: RTCIceCandidateInit }
  | { type: "audio-ready" }
  | { type: "audio-gone"  };

// ── Session (from account.gokkehub.com) ──────────────────────────────────────

export interface GokkeHubSession {
  userId:          string;
  displayName:     string | null;
  email:           string | null;
  avatarUrl:       string | null;
  lastfmUsername?: string | null;
  spotify?: {
    id:           string;
    accessToken:  string;
    refreshToken: string;
    expiresAt:    number;
    displayName:  string | null;
  } | null;
  discord?: {
    id: string;
  } | null;
}

// ── Function request/response shapes ─────────────────────────────────────────

export interface CreateRoomRequest {
  name:          string; // host's display name if not logged in
  win_target:    number;
  team_names:    string[];
  host_team?:    number | null; // 0-based index into team_names; null/undefined → DJ-only spectator
  is_spectator?: boolean;       // host joins as DJ-only spectator
  settings?:     TlRoomSettings;
}

export interface CreateRoomResponse {
  room_id:   string;
  player_id: string;
}

export interface JoinRoomRequest {
  name:          string;
  team_id?:      number | null;
  is_spectator?: boolean;
}

export interface JoinRoomResponse {
  player_id:    string;
  team_id:      number | null;
  is_spectator: boolean;
}

export interface UpdateSettingsRequest {
  player_id: string;
  settings:  TlRoomSettings;
}

export interface KickPlayerRequest {
  player_id: string; // host's id
  target_id: string; // player to kick
}

export interface ChangeTeamRequest {
  player_id: string; // caller (and target — players move themselves)
  team_id:   number | null; // null → spectator
}

export interface AddPlaylistRequest {
  url: string;
}

export interface AddPlaylistResponse {
  added:  number;
  total:  number;
  name:   string;
}

export interface PlacementRequest {
  round_id:        number;
  left_year:       number | null;
  right_year:      number | null;
  artist_guess?:   string;  // optional; provided when captain confirms guess together with placement
  songname_guess?: string;
}

export interface PlacementResponse {
  outcome:    "correct" | "incorrect";
  actual_year: number;
}

export interface TurnActionRequest {
  action: "stop" | "token" | "next";
}

export interface GuessRequest {
  round_id:        number;
  player_id:       string;
  artist_guess:    string;
  songname_guess:  string;
}

export interface JudgeRequest {
  round_id:  number;
  player_id: string;
  kind:      "artist" | "songname" | "combined";
  verdict:   boolean;
}

export interface ProposeYearCorrectionRequest {
  round_id:  number;
  player_id: string;
  year:      number;
}

export interface ApproveYearCorrectionRequest {
  round_id:  number;
  player_id: string;     // host
  approve:   boolean;
}

export interface DismissPingRequest {
  ping_id:   number;
  player_id: string;     // captain or host
}

export interface FinalizeJudgmentRequest {
  round_id:  number;
  player_id: string;  // any player can request finalize after timer
}

export interface UseTokenRequest {
  round_id:  number;
  player_id: string;  // captain only
}
