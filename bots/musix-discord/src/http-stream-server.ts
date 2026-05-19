// HTTP audio proxy — serves yt-dlp audio bytes to browser clients in the
// musix "all-clients-stream" audio mode. Runs alongside the Discord client
// in the same process; shares the yt-dlp binary and spawn helper.
//
// Routes:
//   GET /health                       → 200 "ok"
//   GET /stream/:videoId              → audio bytes (yt-dlp bestaudio)
//   GET /stream/:videoId?seek=N       → start N seconds in
//   GET /stream/:videoId?token=X      → required if STREAM_TOKEN is set
//
// Auth: optional shared-secret via STREAM_TOKEN env var. If set, requests
// must include the same value as ?token=… (or the X-Stream-Token header).
// Defaults to no auth — set the env var to lock the endpoint down to
// just the timelinedrop clients.
//
// CORS: defaults allow https://musix.gokkehub.com plus local dev origins.
// Override via STREAM_CORS env (comma-separated list, or "*" for any).

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { spawnYtDlpAudioStream, resolveTrack, getPlaylistItems, extractPlaylistId } from "./resolver.js";
import { resolvePlaylistItems } from "./spotify-search.js";

const HTTP_PORT     = parseInt(process.env.PORT ?? "8081", 10);
const STREAM_TOKEN  = process.env.STREAM_TOKEN ?? "";

// Pre-shared token baked into the timelinedrop client. Always accepted
// regardless of what STREAM_TOKEN is set to (or whether it's set at
// all). Lets the official deployment work without operators having to
// keep their env in sync with the site. Rotate by changing this value
// here AND in apps/timelinedrop/src/lib/types.ts → STREAM_PROXY_TOKEN,
// then redeploying both.
const HARDCODED_CLIENT_TOKEN = "R7I4v_bGI1NH359tHg11UgPIv-nv1Jb2evfe7-S6Z_c";

// Normalize origins so trailing slashes / case don't cause spurious
// CORS mismatches. Browsers send "https://musix.gokkehub.com"
// without a trailing slash; operators sometimes paste their env with
// "https://musix.gokkehub.com/" — strict compare would 403 forever.
function normalizeOrigin(o: string): string {
  return o.trim().replace(/\/+$/, "").toLowerCase();
}
const ALLOWED_ORIGINS = (process.env.STREAM_CORS ?? "https://musix.gokkehub.com,http://localhost:5173,http://localhost:3000")
  .split(",")
  .map(normalizeOrigin)
  .filter(Boolean);

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

function corsHeaders(originHeader: string | undefined): Record<string, string> {
  const requested = normalizeOrigin(originHeader ?? "");
  let allow: string;
  if (ALLOWED_ORIGINS.includes("*")) {
    allow = "*";
  } else if (requested && ALLOWED_ORIGINS.includes(requested)) {
    // Echo the *requested* origin exactly (no trailing slash) so the
    // browser sees a literal match. Spec requires byte-equal compare.
    allow = requested;
  } else {
    // Fall back to the first allowed origin — typically the prod
    // domain. Helps when the request didn't include an Origin header
    // (Safari, server-side fetches) but still serves the right host
    // for browser flows.
    allow = ALLOWED_ORIGINS[0] ?? "";
  }
  return {
    "Access-Control-Allow-Origin":  allow,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Range, X-Stream-Token",
    "Vary":                          "Origin",
  };
}

function checkToken(req: IncomingMessage, url: URL): boolean {
  const fromQuery  = url.searchParams.get("token");
  const fromHeader = req.headers["x-stream-token"];
  // Hardcoded client token always passes — the official site sends it
  // so audio works regardless of operator env.
  if (fromQuery === HARDCODED_CLIENT_TOKEN || fromHeader === HARDCODED_CLIENT_TOKEN) return true;
  // If operator hasn't set STREAM_TOKEN, no further check needed.
  if (!STREAM_TOKEN) return true;
  return fromQuery === STREAM_TOKEN || fromHeader === STREAM_TOKEN;
}

async function handleStream(
  req: IncomingMessage,
  res: ServerResponse,
  videoId: string,
  seekSec: number,
) {
  let killed = false;
  let kill = () => { killed = true; };
  // Close the yt-dlp subprocess if the client disconnects early — otherwise
  // we'd keep downloading after the audio tag is destroyed.
  req.on("close", () => kill());
  res.on("close", () => kill());

  try {
    const { stdout, kill: realKill } = await spawnYtDlpAudioStream(videoId, { seekSec });
    if (killed) { realKill(); return; }
    kill = realKill;

    // application/octet-stream is the safe default — yt-dlp's bestaudio
    // can be webm/opus or m4a/aac depending on what YouTube serves for
    // the track. Browsers happily play both via <audio> when the
    // Content-Type is generic; an explicit audio/webm would be wrong
    // ~half the time.
    res.writeHead(200, {
      "Content-Type":  "application/octet-stream",
      "Cache-Control": "no-store",
      ...corsHeaders(req.headers.origin),
    });
    stdout.on("error", () => { try { res.end(); } catch { /* already closed */ } });
    stdout.pipe(res);
  } catch (err) {
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "text/plain", ...corsHeaders(req.headers.origin) });
      res.end(`Stream failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

export function startHttpStreamServer(): void {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${HTTP_PORT}`);

    // CORS preflight
    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders(req.headers.origin));
      res.end();
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { "Content-Type": "text/plain", ...corsHeaders(req.headers.origin) });
      res.end("Method not allowed");
      return;
    }

    if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "text/plain", ...corsHeaders(req.headers.origin) });
      res.end("ok");
      return;
    }

    if (url.pathname.startsWith("/stream/")) {
      const videoId = url.pathname.slice("/stream/".length).split("/")[0];
      if (!VIDEO_ID_RE.test(videoId)) {
        res.writeHead(400, { "Content-Type": "text/plain", ...corsHeaders(req.headers.origin) });
        res.end("Invalid video id");
        return;
      }
      if (!checkToken(req, url)) {
        res.writeHead(401, { "Content-Type": "text/plain", ...corsHeaders(req.headers.origin) });
        res.end("Unauthorized");
        return;
      }
      const seekSec = Math.max(0, parseInt(url.searchParams.get("seek") ?? "0", 10) || 0);
      console.log(`[http] /stream/${videoId} seek=${seekSec} from ${req.headers.origin ?? "?"}`);
      // HEAD: respond with headers only — useful for client liveness checks.
      if (req.method === "HEAD") {
        res.writeHead(200, {
          "Content-Type":  "application/octet-stream",
          "Cache-Control": "no-store",
          ...corsHeaders(req.headers.origin),
        });
        res.end();
        return;
      }
      await handleStream(req, res, videoId, seekSec);
      return;
    }

    // /stream-track — resolve by Spotify track info, then stream. Used by
    // the all-clients-stream audio mode: no Discord bot is in voice, so
    // nothing has stamped a videoId on the round yet. Clients pass the
    // Spotify track they already have via realtime, the bot resolves
    // (cache-hit on repeats), then streams the same yt-dlp output.
    //
    // ?video_id=X shortcut: if the track was imported from a YouTube
    // playlist it already knows its source video. Skipping resolveTrack
    // saves a search and guarantees we stream the exact curated video.
    if (url.pathname === "/stream-track") {
      if (!checkToken(req, url)) {
        res.writeHead(401, { "Content-Type": "text/plain", ...corsHeaders(req.headers.origin) });
        res.end("Unauthorized");
        return;
      }
      const seekSec   = Math.max(0, parseInt(url.searchParams.get("seek") ?? "0", 10) || 0);

      // Direct video_id path — bypass YouTube search entirely.
      const directVideoId = url.searchParams.get("video_id");
      if (directVideoId && VIDEO_ID_RE.test(directVideoId)) {
        console.log(`[http] /stream-track video_id=${directVideoId} seek=${seekSec}`);
        if (req.method === "HEAD") {
          res.writeHead(200, {
            "Content-Type":  "application/octet-stream",
            "Cache-Control": "no-store",
            ...corsHeaders(req.headers.origin),
          });
          res.end();
          return;
        }
        await handleStream(req, res, directVideoId, seekSec);
        return;
      }

      const spotifyId = url.searchParams.get("spotify_id") ?? "";
      const name      = url.searchParams.get("name")       ?? "";
      const artist    = url.searchParams.get("artist")     ?? "";
      if (!spotifyId || !name) {
        res.writeHead(400, { "Content-Type": "text/plain", ...corsHeaders(req.headers.origin) });
        res.end("spotify_id and name required (or video_id)");
        return;
      }
      const resolved = await resolveTrack({ id: spotifyId, name, artists: artist ? [artist] : [] });
      if (!resolved) {
        res.writeHead(404, { "Content-Type": "text/plain", ...corsHeaders(req.headers.origin) });
        res.end("Couldn't resolve track to a YouTube video");
        return;
      }
      console.log(`[http] /stream-track ${spotifyId} → ${resolved.videoId} seek=${seekSec}`);
      if (req.method === "HEAD") {
        res.writeHead(200, {
          "Content-Type":  "application/octet-stream",
          "Cache-Control": "no-store",
          ...corsHeaders(req.headers.origin),
        });
        res.end();
        return;
      }
      await handleStream(req, res, resolved.videoId, seekSec);
      return;
    }

    // /playlist-resolve — full end-to-end YouTube playlist → SpotifyTrack[]
    // resolution. Called by the Pages /room/:id/playlist function so the
    // Spotify search loop runs on the bot (no subrequest cap) instead of
    // on Cloudflare Pages (50/request). Uses Spotify client-credentials
    // auth — no user OAuth token required, so hosts without a Spotify
    // account can still import YouTube playlists.
    if (url.pathname === "/playlist-resolve") {
      if (!checkToken(req, url)) {
        res.writeHead(401, { "Content-Type": "text/plain", ...corsHeaders(req.headers.origin) });
        res.end("Unauthorized");
        return;
      }
      const id = url.searchParams.get("id") ?? "";
      const playlistId = extractPlaylistId(id);
      if (!playlistId) {
        res.writeHead(400, { "Content-Type": "application/json", ...corsHeaders(req.headers.origin) });
        res.end(JSON.stringify({ error: "Invalid playlist id or URL" }));
        return;
      }
      console.log(`[http] /playlist-resolve ${playlistId}`);
      try {
        const items  = await getPlaylistItems(playlistId);
        if (items.length === 0) {
          res.writeHead(404, { "Content-Type": "application/json", ...corsHeaders(req.headers.origin) });
          res.end(JSON.stringify({ error: "YouTube playlist is empty or unavailable" }));
          return;
        }
        const tracks = await resolvePlaylistItems(items);
        res.writeHead(200, { "Content-Type": "application/json", ...corsHeaders(req.headers.origin) });
        res.end(JSON.stringify({
          playlist_id: playlistId,
          item_count:  items.length,
          tracks,                            // mapped SpotifyTracks ready to drop into track_pool
          unmatched:   items.length - tracks.length,
        }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        res.writeHead(502, { "Content-Type": "application/json", ...corsHeaders(req.headers.origin) });
        res.end(JSON.stringify({ error: msg }));
      }
      return;
    }

    // /playlist-items — fetch a YouTube playlist's items. Called by the
    // Pages function during /room/:id/playlist when the host pastes a
    // YouTube playlist URL. Returns the same JSON regardless of method;
    // we only support GET to keep the route stateless.
    if (url.pathname === "/playlist-items") {
      if (!checkToken(req, url)) {
        res.writeHead(401, { "Content-Type": "text/plain", ...corsHeaders(req.headers.origin) });
        res.end("Unauthorized");
        return;
      }
      const id = url.searchParams.get("id") ?? "";
      const playlistId = extractPlaylistId(id);
      if (!playlistId) {
        res.writeHead(400, { "Content-Type": "application/json", ...corsHeaders(req.headers.origin) });
        res.end(JSON.stringify({ error: "Invalid playlist id or URL" }));
        return;
      }
      console.log(`[http] /playlist-items ${playlistId}`);
      try {
        const items = await getPlaylistItems(playlistId);
        res.writeHead(200, { "Content-Type": "application/json", ...corsHeaders(req.headers.origin) });
        res.end(JSON.stringify({ playlist_id: playlistId, items }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        res.writeHead(502, { "Content-Type": "application/json", ...corsHeaders(req.headers.origin) });
        res.end(JSON.stringify({ error: msg }));
      }
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain", ...corsHeaders(req.headers.origin) });
    res.end("Not found");
  });

  server.listen(HTTP_PORT, "0.0.0.0", () => {
    console.log(`[http] audio proxy listening on :${HTTP_PORT}${STREAM_TOKEN ? " (operator token + hardcoded client token)" : " (hardcoded client token only)"}`);
    console.log(`[http] CORS allow: ${ALLOWED_ORIGINS.join(", ")}`);
  });
}
