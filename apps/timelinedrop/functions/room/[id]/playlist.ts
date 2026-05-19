import type { PagesFunction } from "@cloudflare/workers-types";
import { getSession } from "@gokkehub/auth/session";
import { parseSessionId } from "@gokkehub/auth/cookie";
import type { Env } from "../../_env";
import { json, handlePreflight } from "../../_cors";
import { getRoom, updateRoom, fetchPlaylistTracks, refreshSpotifyToken } from "../../_supabase";
import { searchTrackUri } from "../../_spotify";
import type { AddPlaylistResponse, SpotifyTrack } from "../../../src/lib/types";
import { STREAM_PROXY_URL, STREAM_PROXY_TOKEN } from "../../../src/lib/types";

// URL type detection. YouTube playlist URLs have list=PLxxxx; Spotify
// playlist URLs match /playlist/<id>. Order matters — a YouTube watch
// URL with &list= should NOT match the Spotify regex, so we check
// YouTube first.
const YOUTUBE_PLAYLIST_RE = /(?:youtu\.be|youtube\.com|music\.youtube\.com)\/(?:playlist\?|watch\?(?:.*&)?)?(?:.*&)?list=([A-Za-z0-9_-]{11,})/i;
const YOUTUBE_BARE_RE     = /^(?:PL|UU|LL|PU|OL|RD)[A-Za-z0-9_-]{10,}$/;
const SPOTIFY_PLAYLIST_RE = /playlist\/([A-Za-z0-9]+)/;
const SPOTIFY_BARE_RE     = /^[A-Za-z0-9]{22}$/;

type ParsedUrl =
  | { kind: "youtube";  id: string }
  | { kind: "spotify";  id: string }
  | { kind: "invalid"; }
;

function parsePlaylistUrl(raw: string): ParsedUrl {
  const t = raw.trim();
  const yt = t.match(YOUTUBE_PLAYLIST_RE);
  if (yt) return { kind: "youtube", id: yt[1] };
  if (YOUTUBE_BARE_RE.test(t)) return { kind: "youtube", id: t };
  const sp = t.match(SPOTIFY_PLAYLIST_RE);
  if (sp) return { kind: "spotify", id: sp[1] };
  if (SPOTIFY_BARE_RE.test(t)) return { kind: "spotify", id: t };
  return { kind: "invalid" };
}

// Strip noise that YouTube uploaders pile onto video titles before we
// try to match them against Spotify. "Bohemian Rhapsody (Official Music
// Video) [HD]" → "Bohemian Rhapsody".
function cleanYouTubeTitle(s: string): string {
  return s
    .replace(/\s*\([^)]*(?:official|video|audio|music|lyrics?|hd|4k|remastered?|mv)[^)]*\)/gi, "")
    .replace(/\s*\[[^\]]*(?:official|video|audio|music|lyrics?|hd|4k|remastered?|mv)[^\]]*\]/gi, "")
    .replace(/\s*[-–—|]\s*(?:official|video|audio|music|lyric|hd|4k|mv).*$/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Try to split a YouTube title into (artist, track). Most uploads use
// "Artist - Title" or "Title - Artist"; channels named after the artist
// usually use the former and just put the title alone. We try both
// orderings and let the Spotify search confirm the right one.
interface ArtistTrackGuess { artist: string; track: string }
function guessArtistTrack(title: string, channel: string): ArtistTrackGuess[] {
  const cleaned = cleanYouTubeTitle(title);
  const guesses: ArtistTrackGuess[] = [];
  // Common separator dashes; pick the FIRST occurrence so "Foo - Bar - Baz"
  // splits as artist="Foo", track="Bar - Baz".
  const dashSplit = cleaned.split(/\s+[-–—]\s+/);
  if (dashSplit.length >= 2) {
    const first = dashSplit[0].trim();
    const rest  = dashSplit.slice(1).join(" - ").trim();
    if (first && rest) {
      guesses.push({ artist: first, track: rest });
      guesses.push({ artist: rest,  track: first });
    }
  }
  // Channel-as-artist fallback. Often the channel name has " - Topic"
  // suffix on auto-generated channels — strip it.
  const ch = channel.replace(/\s*-\s*Topic\s*$/i, "").trim();
  if (ch) guesses.push({ artist: ch, track: cleaned });
  // Last resort — just the cleaned title as the track, blank artist.
  // searchTrackUri can still hit on the bare track name in many cases.
  guesses.push({ artist: "", track: cleaned });
  // De-dup
  const seen = new Set<string>();
  return guesses.filter(g => {
    const k = `${g.artist.toLowerCase()}::${g.track.toLowerCase()}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

interface BotPlaylistItem { videoId: string; title: string; channel: string; durationSec: number }
interface BotPlaylistResponse { playlist_id?: string; items?: BotPlaylistItem[]; error?: string }

async function fetchYouTubePlaylistItems(playlistId: string): Promise<BotPlaylistItem[]> {
  const params = new URLSearchParams({ id: playlistId });
  if (STREAM_PROXY_TOKEN) params.set("token", STREAM_PROXY_TOKEN);
  const url = `${STREAM_PROXY_URL.replace(/\/$/, "")}/playlist-items?${params}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Bot proxy returned ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json() as BotPlaylistResponse;
  if (data.error) throw new Error(data.error);
  return data.items ?? [];
}

export const onRequest: PagesFunction<Env> = async ({ request, params, env }) => {
  const pre = handlePreflight(request as unknown as Request);
  if (pre) return pre;
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const req    = request as unknown as Request;
  const roomId = params.id as string;

  try {
    const session = await getSession(env.SESSIONS, req);
    if (!session) return json({ error: "Not authenticated — sign in first" }, 401, req);

    if (!session.spotify) {
      return json({ error: "Connect Spotify on your profile at account.gokkehub.com first" }, 403, req);
    }

    const room = await getRoom(env, roomId);
    if (!room) return json({ error: "Room not found" }, 404, req);

    const storedPlayerId = await env.SESSIONS.get(`tl:${roomId}:player`);
    if (storedPlayerId && room.host_id !== storedPlayerId) {
      return json({ error: "Only the host can add playlists" }, 403, req);
    }

    const body = await req.json() as { url: string };
    const { url } = body;
    if (!url?.trim()) return json({ error: "Playlist URL required" }, 400, req);

    const parsed = parsePlaylistUrl(url);
    if (parsed.kind === "invalid") {
      return json({ error: "Couldn't recognise this URL as a Spotify or YouTube playlist" }, 400, req);
    }

    // Refresh Spotify token if needed — both branches need it. The YouTube
    // branch uses it to search Spotify for each video's matched track;
    // the Spotify branch uses it to read the playlist directly.
    let { accessToken, refreshToken, expiresAt } = session.spotify;
    if (Date.now() > expiresAt - 60_000) {
      const refreshed = await refreshSpotifyToken(env, refreshToken);
      accessToken = refreshed.access_token;
      expiresAt   = Date.now() + refreshed.expires_in * 1000;
      const sessionId = parseSessionId(req.headers.get("Cookie"));
      if (sessionId) {
        await env.SESSIONS.put(
          sessionId,
          JSON.stringify({ ...session, spotify: { ...session.spotify, accessToken, expiresAt } }),
          { expirationTtl: 604800 }
        );
      }
    }

    let imported: SpotifyTrack[] = [];
    let listName = "";

    if (parsed.kind === "spotify") {
      const playlistId = parsed.id;
      // Fetch playlist name
      const metaRes = await fetch(
        `https://api.spotify.com/v1/playlists/${playlistId}?fields=name`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (!metaRes.ok) {
        const status = metaRes.status;
        if (status === 404) return json({ error: "Playlist not found. Make sure the URL is correct and the playlist is public." }, 400, req);
        if (status === 403) return json({ error: "Playlist access denied. While Musix is in Spotify development mode, you can only add playlists you personally created on Spotify (not playlists owned by others)." }, 400, req);
        return json({ error: `Spotify error ${status} fetching playlist` }, 502, req);
      }
      listName = (await metaRes.json() as { name: string }).name;
      imported = await fetchPlaylistTracks(env, playlistId, accessToken);
    } else {
      // YouTube branch: ask the bot's HTTP proxy for the playlist items,
      // then map each video → Spotify track via Spotify search. Tracks
      // we can't map to Spotify are silently dropped (game's playback
      // paths all assume a Spotify track exists).
      let items: BotPlaylistItem[];
      try {
        items = await fetchYouTubePlaylistItems(parsed.id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return json({ error: `Couldn't load YouTube playlist: ${msg}` }, 502, req);
      }
      if (items.length === 0) {
        return json({ error: "YouTube playlist is empty or unavailable" }, 400, req);
      }
      listName = `YouTube playlist (${items.length} videos)`;

      // Search Spotify for each item. Sequential to respect Spotify's
      // rate limit; small inter-call delay matches searchManyWithDelay.
      const seen = new Set<string>();
      for (const item of items) {
        const guesses = guessArtistTrack(item.title, item.channel);
        let hit: SpotifyTrack | null = null;
        for (const g of guesses) {
          hit = await searchTrackUri(accessToken, g.artist, g.track);
          if (hit) break;
        }
        if (!hit) continue;
        if (seen.has(hit.id)) continue;
        seen.add(hit.id);
        imported.push({ ...hit, youtubeVideoId: item.videoId });
        // Light pacing — 60 calls/min keeps us well under Spotify's limits.
        await new Promise(r => setTimeout(r, 60));
      }
    }

    if (imported.length === 0) {
      return json({ error: "No tracks could be matched to Spotify" }, 400, req);
    }

    const existingIds = new Set((room.track_pool ?? []).map(t => t.id));
    const unique      = imported.filter(t => !existingIds.has(t.id));
    const merged      = [...(room.track_pool ?? []), ...unique];
    for (let i = merged.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [merged[i], merged[j]] = [merged[j], merged[i]];
    }

    await updateRoom(env, roomId, { track_pool: merged });

    return json({ added: unique.length, total: merged.length, name: listName } as AddPlaylistResponse, 200, req);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const friendlyMsg = msg.includes("403")
      ? "Playlist access denied. While Musix is in Spotify development mode, you can only add playlists you personally created on Spotify."
      : msg;
    return json({ error: friendlyMsg }, 500, req);
  }
};
