import type { Env } from "./_env";
import type { SpotifyTrack } from "../src/lib/types";

// ── Spotify search by name + artist → SpotifyTrack ──────────────────────────
// Uses the host's OAuth access token (passed in). Returns null if no match.

interface SpotifySearchResponse {
  tracks?: {
    items: Array<{
      id:          string;
      uri:         string;
      name:        string;
      duration_ms: number;
      artists:     Array<{ name: string }>;
      album: {
        name:          string;
        release_date:  string;
        images:        Array<{ url: string; width: number }>;
      };
    }>;
  };
}

export async function searchTrackUri(
  accessToken: string,
  artist: string,
  track: string,
): Promise<SpotifyTrack | null> {
  // limit=10 so we can pick the OLDEST version of the song that matches
  // the artist + title — Spotify's relevance ranking often promotes the
  // "2018 Remaster" or "Anniversary Edition" above the original release,
  // which is wrong for a year-placement game. Of the matches that look
  // like the same song (artist matches, name shares the title prefix),
  // we take the one with the earliest release_date.
  const q = `track:${encodeURIComponent(track)}+artist:${encodeURIComponent(artist)}`;
  const url = `https://api.spotify.com/v1/search?q=${q}&type=track&limit=10`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) return null;
  let data: SpotifySearchResponse;
  try { data = await res.json(); }
  catch { return null; }
  const items = data.tracks?.items ?? [];
  if (items.length === 0) return null;

  const norm = (s: string) => s.toLowerCase().trim();
  const tName   = norm(track);
  const tArtist = norm(artist);
  // Treat an item as "the same song" if any of its artists matches the
  // target and the name either equals or starts with the target title
  // (so "Bohemian Rhapsody (2011 Remaster)" still counts).
  const matches = items.filter(it => {
    const artistOk = it.artists.some(a => norm(a.name) === tArtist);
    const n = norm(it.name);
    const nameOk = n === tName || n.startsWith(tName + " ") || n.startsWith(tName + " (");
    return artistOk && nameOk;
  });
  const pool = matches.length > 0 ? matches : [items[0]];
  // release_date is "YYYY" or "YYYY-MM-DD"; lexical compare puts older first.
  pool.sort((a, b) => a.album.release_date.localeCompare(b.album.release_date));
  const item = pool[0];

  const releaseYear = parseInt(item.album.release_date.slice(0, 4), 10);
  if (!Number.isFinite(releaseYear)) return null;
  const cover = item.album.images.sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url ?? "";

  return {
    id:          item.id,
    name:        item.name,
    artist:      item.artists[0]?.name ?? artist,
    albumName:   item.album.name,
    releaseYear,
    coverUrl:    cover,
    uri:         item.uri,
    durationMs:  item.duration_ms,
  };
}

// Light wrapper that also handles a small inter-request delay to respect rate limits.
export async function searchManyWithDelay(
  accessToken: string,
  candidates: Array<{ artist: string; track: string }>,
  perRequestDelayMs = 75,
): Promise<SpotifyTrack[]> {
  const found: SpotifyTrack[] = [];
  for (const c of candidates) {
    const hit = await searchTrackUri(accessToken, c.artist, c.track);
    if (hit) found.push(hit);
    if (perRequestDelayMs > 0) await new Promise(r => setTimeout(r, perRequestDelayMs));
  }
  return found;
}

// Used by the host-token bridge: refresh if expired, then return access token.
export async function getActiveHostToken(env: Env, refreshToken: string): Promise<string | null> {
  try {
    const res = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        "Content-Type":  "application/x-www-form-urlencoded",
        "Authorization": `Basic ${btoa(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`)}`,
      },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
    });
    if (!res.ok) return null;
    const data = await res.json() as { access_token: string };
    return data.access_token;
  } catch {
    return null;
  }
}
