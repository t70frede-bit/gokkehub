import type { Env } from "./_env";
import type { SpotifyTrack } from "../src/lib/types";

// Album-name markers that flag a Spotify entry as a re-release rather
// than the canonical original — these albums carry the RE-RELEASE date,
// not the song's actual release year, so they break the year-placement
// game. We drop tracks whose oldest matching album still trips this
// pattern. False positives (an album literally named "Anniversary") are
// rare and the candidate just gets skipped — curation has plenty more.
const ALBUM_REMASTER_MARKER =
  /\b(remaster(ed)?|anniversary( edition)?|deluxe( edition)?|re-?recorded|expanded edition|special edition)\b/i;

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

  // Skip if even the OLDEST match is a re-release — the year would be
  // wrong by potentially decades. With ~16k candidate tracks in a
  // typical curation pool, dropping one is cheaper than serving a wrong
  // year. (Tracks where a non-remaster version exists already won —
  // the localeCompare sort surfaces it ahead of any "2011 Remaster".)
  if (item.album.name && ALBUM_REMASTER_MARKER.test(item.album.name)) {
    return null;
  }

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

// ── iTunes cover-art lookup ────────────────────────────────────────────────
// Free, no-auth Apple endpoint that returns track metadata + a small
// (100×100) artwork URL. We bump the size by string-substitution to get
// a higher-res variant (Apple's CDN serves whatever size you ask for).
// Used to fill in cover art for catalog playlists when the host has no
// Spotify session — without Spotify search we have no other URL source.
//
// Subrequest budget: 1 per track. Caller should cap to leave headroom
// for the room read + pool write.

export async function lookupItunesCover(
  artist: string,
  title:  string,
): Promise<string | null> {
  const q = encodeURIComponent(`${artist} ${title}`.slice(0, 80));
  const url = `https://itunes.apple.com/search?term=${q}&entity=song&limit=1&media=music`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": "musix-gokkehub/1.0" } });
    if (!res.ok) return null;
    const data = await res.json() as {
      resultCount?: number;
      results?: Array<{ artworkUrl100?: string }>;
    };
    const raw = data.results?.[0]?.artworkUrl100;
    if (!raw) return null;
    // Bump resolution from 100×100 to 300×300 — Apple's CDN serves
    // arbitrary sizes via the URL pattern, no extra request.
    return raw.replace(/\/100x100bb\.(jpg|png)$/i, "/300x300bb.$1");
  } catch {
    return null;
  }
}

// ── /me endpoints (user-scoped) ─────────────────────────────────────────────
// These power the "spotify-taste" curation source: each player's own top
// artists / tracks / recently-played feed the candidate pool. They require
// the PLAYER's access token (not the host's), so the caller must resolve
// the per-player token before invoking.

export interface SpotifyTopArtist {
  id:     string;
  name:   string;
  genres: string[];
}

export interface SpotifyTopTrack {
  id:      string;
  name:    string;
  artists: Array<{ id: string; name: string }>;
}

type TopRange = "short_term" | "medium_term" | "long_term";

export async function getMyTopArtists(
  accessToken: string,
  range:       TopRange,
  limit       = 50,
): Promise<SpotifyTopArtist[]> {
  const url = `https://api.spotify.com/v1/me/top/artists?time_range=${range}&limit=${Math.min(limit, 50)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    // Most common cause is missing the `user-top-read` OAuth scope —
    // logged loudly so a "spotify-taste produces empty pool" report
    // points at the scope grant rather than mysterious silence.
    console.warn(`[spotify] /me/top/artists ${res.status} ${res.statusText} — likely missing user-top-read scope`);
    return [];
  }
  const data = await res.json().catch(() => null) as { items?: SpotifyTopArtist[] } | null;
  return data?.items ?? [];
}

export async function getMyTopTracks(
  accessToken: string,
  range:       TopRange,
  limit       = 50,
): Promise<SpotifyTopTrack[]> {
  const url = `https://api.spotify.com/v1/me/top/tracks?time_range=${range}&limit=${Math.min(limit, 50)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    console.warn(`[spotify] /me/top/tracks ${res.status} ${res.statusText} — likely missing user-top-read scope`);
    return [];
  }
  const data = await res.json().catch(() => null) as { items?: SpotifyTopTrack[] } | null;
  return data?.items ?? [];
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
