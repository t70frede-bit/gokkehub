// Spotify client-credentials search for YouTube-playlist imports.
//
// Why client credentials: the bot needs to map YouTube video titles to
// Spotify tracks without any specific user's OAuth token. Spotify's
// /v1/search endpoint accepts client-credentials tokens (no user data
// required), so the bot can do unlimited searches with its own creds.
// This was previously done in the Cloudflare Pages /playlist function,
// but that hit the 50-subrequest cap on any playlist >~15 videos.
//
// Token cache: client credentials tokens are valid for ~1 hour. We
// fetch lazily and cache in-process; refresh on 401 from search.

interface ClientCredsToken { accessToken: string; expiresAt: number }
let tokenCache: ClientCredsToken | null = null;

async function getClientCredentialsToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt - 30_000) {
    return tokenCache.accessToken;
  }
  const clientId     = process.env.SPOTIFY_CLIENT_ID ?? "";
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET ?? "";
  if (!clientId || !clientSecret) {
    throw new Error("Spotify search isn't configured — SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET must be set in the bot's .env (copy them from the matching Cloudflare Pages env vars).");
  }
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method:  "POST",
    headers: {
      "Content-Type":  "application/x-www-form-urlencoded",
      "Authorization": `Basic ${auth}`,
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Spotify client-credentials failed: ${res.status} ${body.slice(0, 200)}`);
  }
  const data = await res.json() as { access_token: string; expires_in: number };
  tokenCache = {
    accessToken: data.access_token,
    expiresAt:   Date.now() + data.expires_in * 1000,
  };
  return data.access_token;
}

// SpotifyTrack shape mirrors apps/timelinedrop/src/lib/types.ts — kept
// local so the bot doesn't need to share types with the web app. The
// /playlist-resolve route returns this shape and the Pages function
// stores it as-is in tl_rooms.track_pool.
export interface ResolvedSpotifyTrack {
  id:               string;
  name:             string;
  artist:           string;
  albumName:        string;
  releaseYear:      number;
  coverUrl:         string;
  uri:              string;
  durationMs:       number;
  youtubeVideoId:   string;   // always populated by the YouTube-playlist resolver
}

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

// Mirrors apps/timelinedrop/functions/_spotify.ts → searchTrackUri. Picks
// the OLDEST item with a matching artist + title prefix so remasters
// don't shadow the original release.
export async function searchSpotifyForTrack(
  artist: string,
  track:  string,
): Promise<Omit<ResolvedSpotifyTrack, "youtubeVideoId"> | null> {
  if (!track.trim()) return null;
  const accessToken = await getClientCredentialsToken().catch(err => {
    // Surface configuration errors to the caller; transient 401s get
    // handled inside (cache invalidated, retried on next call).
    throw err;
  });
  const q = artist
    ? `track:${encodeURIComponent(track)}+artist:${encodeURIComponent(artist)}`
    : encodeURIComponent(track);
  const url = `https://api.spotify.com/v1/search?q=${q}&type=track&limit=10`;
  let res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (res.status === 401) {
    // Token expired between caching and use — drop the cache and retry once.
    tokenCache = null;
    const fresh = await getClientCredentialsToken();
    res = await fetch(url, { headers: { Authorization: `Bearer ${fresh}` } });
  }
  if (!res.ok) return null;
  let data: SpotifySearchResponse;
  try { data = await res.json() as SpotifySearchResponse; }
  catch { return null; }
  const items = data.tracks?.items ?? [];
  if (items.length === 0) return null;

  const norm = (s: string) => s.toLowerCase().trim();
  const tName   = norm(track);
  const tArtist = norm(artist);
  const matches = items.filter(it => {
    const artistOk = !tArtist || it.artists.some(a => norm(a.name) === tArtist);
    const n = norm(it.name);
    const nameOk = n === tName || n.startsWith(`${tName} `) || n.startsWith(`${tName} (`);
    return artistOk && nameOk;
  });
  const pool = matches.length > 0 ? matches : [items[0]];
  pool.sort((a, b) => a.album.release_date.localeCompare(b.album.release_date));
  const item = pool[0];

  const releaseYear = parseInt(item.album.release_date.slice(0, 4), 10);
  if (!Number.isFinite(releaseYear)) return null;
  const cover = [...item.album.images].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url ?? "";

  return {
    id:         item.id,
    name:       item.name,
    artist:     item.artists[0]?.name ?? artist,
    albumName:  item.album.name,
    releaseYear,
    coverUrl:   cover,
    uri:        item.uri,
    durationMs: item.duration_ms,
  };
}

// Title-parsing utilities — duplicated from the Pages-side equivalent so
// the bot can resolve playlist videos end-to-end without sending the
// title parsing back over the wire.

function cleanYouTubeTitle(s: string): string {
  return s
    .replace(/\s*\([^)]*(?:official|video|audio|music|lyrics?|hd|4k|remastered?|mv)[^)]*\)/gi, "")
    .replace(/\s*\[[^\]]*(?:official|video|audio|music|lyrics?|hd|4k|remastered?|mv)[^\]]*\]/gi, "")
    .replace(/\s*[-–—|]\s*(?:official|video|audio|music|lyric|hd|4k|mv).*$/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

interface ArtistTrackGuess { artist: string; track: string }

function guessArtistTrack(title: string, channel: string): ArtistTrackGuess[] {
  const cleaned = cleanYouTubeTitle(title);
  const guesses: ArtistTrackGuess[] = [];
  const dashSplit = cleaned.split(/\s+[-–—]\s+/);
  if (dashSplit.length >= 2) {
    const first = dashSplit[0].trim();
    const rest  = dashSplit.slice(1).join(" - ").trim();
    if (first && rest) {
      guesses.push({ artist: first, track: rest });
      guesses.push({ artist: rest,  track: first });
    }
  }
  const ch = channel.replace(/\s*-\s*Topic\s*$/i, "").trim();
  if (ch) guesses.push({ artist: ch, track: cleaned });
  guesses.push({ artist: "", track: cleaned });
  const seen = new Set<string>();
  return guesses.filter(g => {
    const k = `${g.artist.toLowerCase()}::${g.track.toLowerCase()}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

interface PlaylistItem { videoId: string; title: string; channel: string; durationSec: number }

// Resolve every video in a YouTube playlist's item list into a Spotify
// track. Tries the artist-track guesses in order until one matches; if
// none does, the video is dropped from the output.
export async function resolvePlaylistItems(items: PlaylistItem[]): Promise<ResolvedSpotifyTrack[]> {
  const out: ResolvedSpotifyTrack[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const guesses = guessArtistTrack(item.title, item.channel);
    let hit: Awaited<ReturnType<typeof searchSpotifyForTrack>> = null;
    for (const g of guesses) {
      hit = await searchSpotifyForTrack(g.artist, g.track);
      if (hit) break;
    }
    if (!hit) continue;
    if (seen.has(hit.id)) continue;
    seen.add(hit.id);
    out.push({ ...hit, youtubeVideoId: item.videoId });
    // Light pacing — Spotify allows ~100 search calls/min on a single
    // token; 60ms ≈ 16 calls/sec keeps us well under that.
    await new Promise(r => setTimeout(r, 60));
  }
  return out;
}
