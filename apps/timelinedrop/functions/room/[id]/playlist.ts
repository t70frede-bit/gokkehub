import type { PagesFunction } from "@cloudflare/workers-types";
import { getSession } from "@gokkehub/auth/session";
import { parseSessionId } from "@gokkehub/auth/cookie";
import type { Env } from "../../_env";
import { json, handlePreflight } from "../../_cors";
import { getRoom, updateRoom, fetchPlaylistTracks, refreshSpotifyToken } from "../../_supabase";
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

// Single call to the bot does the full YouTube-playlist resolve:
// fetches the items, parses each title into artist/track guesses,
// searches Spotify with client credentials, returns ready-to-use
// SpotifyTracks. Doing all of that here on Cloudflare Pages would
// blow the 50-subrequest budget for any non-trivial playlist.
interface BotResolveResponse {
  playlist_id?: string;
  item_count?:  number;
  unmatched?:   number;
  tracks?:      SpotifyTrack[];
  error?:       string;
}

async function fetchYouTubePlaylistResolve(playlistId: string): Promise<BotResolveResponse> {
  const params = new URLSearchParams({ id: playlistId });
  if (STREAM_PROXY_TOKEN) params.set("token", STREAM_PROXY_TOKEN);
  const url = `${STREAM_PROXY_URL.replace(/\/$/, "")}/playlist-resolve?${params}`;

  // Explicit 25s timeout so we never let the request linger past Cloudflare's
  // wall-clock and trigger an edge 502 — better to surface our own JSON
  // "bot proxy timed out" error than an HTML page.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  let res: Response;
  try {
    res = await fetch(url, { signal: controller.signal });
  } catch (err) {
    throw new Error(`Bot proxy unreachable: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    clearTimeout(timer);
  }

  // Read as text first so a non-JSON 5xx (e.g. openresty's branded HTML
  // 502 page when its upstream times out) still surfaces a usable error
  // body instead of crashing res.json() and falling through.
  const rawBody = await res.text().catch(() => "");
  let data: BotResolveResponse = {};
  try { data = JSON.parse(rawBody) as BotResolveResponse; } catch { /* not JSON */ }
  if (!res.ok) {
    const detail = data.error ?? (rawBody ? rawBody.slice(0, 200) : `HTTP ${res.status}`);
    throw new Error(`Bot proxy returned ${res.status}: ${detail}`);
  }
  return data;
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

    // Spotify branch needs the host's OAuth token to read their playlist
    // (Spotify search doesn't expose the playlist contents). YouTube
    // branch doesn't — the bot does its own client-credentials Spotify
    // search, so anyone can import a YouTube playlist regardless of
    // whether they have Spotify connected.
    if (parsed.kind === "spotify" && !session.spotify) {
      return json({ error: "Connect Spotify on your profile at account.gokkehub.com first to import a Spotify playlist (YouTube playlists work without it)." }, 403, req);
    }

    let imported: SpotifyTrack[] = [];
    let listName = "";

    if (parsed.kind === "spotify") {
      // session.spotify is non-null thanks to the gate above.
      let { accessToken, refreshToken, expiresAt } = session.spotify!;
      if (Date.now() > expiresAt - 60_000) {
        const refreshed = await refreshSpotifyToken(env, refreshToken);
        accessToken = refreshed.access_token;
        expiresAt   = Date.now() + refreshed.expires_in * 1000;
        const sessionId = parseSessionId(req.headers.get("Cookie"));
        if (sessionId) {
          await env.SESSIONS.put(
            sessionId,
            JSON.stringify({ ...session, spotify: { ...session.spotify!, accessToken, expiresAt } }),
            { expirationTtl: 604800 }
          );
        }
      }
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
      // YouTube branch: single call to the bot's /playlist-resolve route
      // which does playlist fetch + Spotify search + track shaping in one
      // shot. Cloudflare Pages free plan caps each request at 50
      // subrequests; running the search loop here blew it at ~15 videos.
      // The bot has no such cap, so this scales cleanly to ~200 items.
      let resolved: BotResolveResponse;
      try {
        resolved = await fetchYouTubePlaylistResolve(parsed.id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return json({ error: `Couldn't load YouTube playlist: ${msg}` }, 502, req);
      }
      imported = resolved.tracks ?? [];
      const itemCount = resolved.item_count ?? imported.length;
      const unmatched = resolved.unmatched ?? 0;
      listName = unmatched > 0
        ? `YouTube playlist (${imported.length} of ${itemCount} videos matched to Spotify)`
        : `YouTube playlist (${imported.length} videos)`;
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
