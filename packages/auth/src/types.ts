/**
 * Auth types — @gokkehub/auth/types
 * ===================================
 * Shared across all apps and /functions/ Workers.
 */

// ── Session data stored in Cloudflare KV ─────────────────────────────────────
// The cookie only ever holds the session ID — never this object directly.

export interface SessionData {
  userId:      string;        // Supabase auth.users.id
  email:       string | null;
  displayName: string | null;
  avatarUrl:   string | null;
  steamId?:    string | null; // manually-entered Steam ID for library import

  // Linked third-party accounts (populated after OAuth)
  spotify?: {
    id:           string;
    accessToken:  string;   // stored server-side only, never sent to browser
    refreshToken: string;
    expiresAt:    number;   // Unix ms
    displayName:  string | null;
    imageUrl:     string | null;
  };
  discord?: {
    id:           string;
    accessToken:  string;
    refreshToken: string;
    expiresAt:    number;
    username:     string;
    avatarUrl:    string | null;
  };
  steam?: {
    steamId:     string;
    displayName: string | null;
    avatarUrl:   string | null;
  };

  createdAt: number;   // Unix ms — when the session was created
  expiresAt: number;   // Unix ms — when the session expires (7 days)
}

// ── What the client receives (safe subset — no tokens) ───────────────────────

export interface PublicSessionData {
  userId:      string;
  email:       string | null;
  displayName: string | null;
  avatarUrl:   string | null;
  steamId?:    string | null;
  linked: {
    spotify: boolean;
    discord: boolean;
    steam:   boolean;
  };
}

// ── Cookie name — shared constant so it's never mistyped ─────────────────────

export const SESSION_COOKIE_NAME = "gh_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days
