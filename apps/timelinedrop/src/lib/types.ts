// ── Spotify ───────────────────────────────────────────────────────────────────

export interface SpotifyTrack {
  id:          string;
  name:        string;
  artist:      string;
  albumName:   string;
  releaseYear: number;
  coverUrl:    string;
  uri:         string; // spotify:track:ID — required for Web Playback SDK
}

// ── Database rows ─────────────────────────────────────────────────────────────

export interface TlRoom {
  id:               string;       // 6-char code
  host_id:          string;
  status:           "lobby" | "playing" | "finished";
  win_target:       number;
  active_team_id:   number | null;
  track_pool:       SpotifyTrack[];
  track_cursor:     number;
  current_round_id: number | null;
  playing_since:    number | null; // epoch ms when Web Playback SDK started
  paused_at_ms:     number | null; // ms offset in track when paused
  created_at:       string;
}

export interface TlTeam {
  id:             number;
  room_id:        string;
  name:           string;
  tokens:         number;
  pending_tracks: SpotifyTrack[]; // earned this turn, not yet locked
  sort_order:     number;
}

export interface TlPlayer {
  id:         string;
  room_id:    string;
  team_id:    number | null;
  name:       string;
  is_captain: boolean;
  is_host:    boolean;
  joined_at:  string;
}

export interface TlRound {
  id:          number;
  room_id:     string;
  team_id:     number;
  track:       SpotifyTrack;
  left_year:   number | null; // year of timeline card to the left of placement
  right_year:  number | null; // year of timeline card to the right of placement
  outcome:     "correct" | "incorrect" | null;
  revealed_at: string | null;
}

export interface TlTimelineEntry {
  team_id:  number;
  track_id: string;
  year:     number;
  position: number;
  track:    SpotifyTrack;
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
  created_at:  string;
}

// ── Aggregated game state (built client-side from subscriptions) ──────────────

export interface GameState {
  room:         TlRoom;
  teams:        TlTeam[];
  players:      TlPlayer[];
  round:        TlRound | null;
  timelines:    Record<number, TlTimelineEntry[]>; // teamId → sorted entries
  notes:        TlNote[];
  pings:        TlPing[];
  myPlayer:     TlPlayer | null;
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
  userId:      string;
  displayName: string | null;
  email:       string | null;
  avatarUrl:   string | null;
  spotify?: {
    id:           string;
    accessToken:  string;
    refreshToken: string;
    expiresAt:    number;
    displayName:  string | null;
  } | null;
}

// ── Function request/response shapes ─────────────────────────────────────────

export interface CreateRoomRequest {
  name:       string; // host's display name if not logged in
  win_target: number;
  team_names: string[];
}

export interface CreateRoomResponse {
  room_id:   string;
  player_id: string;
}

export interface JoinRoomRequest {
  name: string;
}

export interface JoinRoomResponse {
  player_id: string;
  team_id:   number | null;
}

export interface AddPlaylistRequest {
  name:   string;
  tracks: SpotifyTrack[];
}

export interface AddPlaylistResponse {
  added:  number;
  total:  number;
  name:   string;
}

export interface PlacementRequest {
  round_id:   number;
  left_year:  number | null;
  right_year: number | null;
}

export interface PlacementResponse {
  outcome:    "correct" | "incorrect";
  actual_year: number;
}

export interface TurnActionRequest {
  action: "stop" | "token" | "next";
}
