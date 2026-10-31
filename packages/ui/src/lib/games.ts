/**
 * The GokkeHub game list used by the shared header's games menu.
 * Keep in step with the catalogue in apps/web/src/App.tsx.
 */
export interface GokkeHubGame {
  name:   string;
  emoji:  string;
  url:    string;
  status: "live" | "soon";
}

export const GOKKEHUB_GAMES: GokkeHubGame[] = [
  { name: "Musix",          emoji: "🎵", url: "https://musix.gokkehub.com",        status: "live" },
  { name: "Grid Challenge", emoji: "🎯", url: "https://partybingo.gokkehub.com",   status: "live" },
  { name: "Jeopardy",       emoji: "❓", url: "https://jeopardy.gokkehub.com",     status: "live" },
  { name: "Poker",          emoji: "🃏", url: "https://poker.gokkehub.com",        status: "live" },
  { name: "Track Guess",    emoji: "🎵", url: "https://musicquiz.gokkehub.com",    status: "soon" },
  { name: "BeatRank",       emoji: "🏆", url: "https://bezzerwizzer.gokkehub.com", status: "soon" },
];

/** True when `gameUrl` is the site the browser is on now. */
export function isCurrentGame(gameUrl: string, hostname?: string | null): boolean {
  if (!hostname) return false;
  try {
    return new URL(gameUrl).hostname === hostname.toLowerCase();
  } catch {
    return false;
  }
}
