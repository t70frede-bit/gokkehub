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
import { spawnYtDlpAudioStream } from "./resolver.js";

const HTTP_PORT     = parseInt(process.env.PORT ?? "8080", 10);
const STREAM_TOKEN  = process.env.STREAM_TOKEN ?? "";
const ALLOWED_ORIGINS = (process.env.STREAM_CORS ?? "https://musix.gokkehub.com,http://localhost:5173,http://localhost:3000").split(",").map(s => s.trim());

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

function corsHeaders(originHeader: string | undefined): Record<string, string> {
  const origin = originHeader ?? "";
  const allow =
    ALLOWED_ORIGINS.includes("*") ? "*" :
    ALLOWED_ORIGINS.includes(origin) ? origin :
    ALLOWED_ORIGINS[0] ?? "";
  return {
    "Access-Control-Allow-Origin":  allow,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Range, X-Stream-Token",
    "Vary":                          "Origin",
  };
}

function checkToken(req: IncomingMessage, url: URL): boolean {
  if (!STREAM_TOKEN) return true;
  const fromQuery  = url.searchParams.get("token");
  const fromHeader = req.headers["x-stream-token"];
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

    res.writeHead(404, { "Content-Type": "text/plain", ...corsHeaders(req.headers.origin) });
    res.end("Not found");
  });

  server.listen(HTTP_PORT, "0.0.0.0", () => {
    console.log(`[http] audio proxy listening on :${HTTP_PORT}${STREAM_TOKEN ? " (token required)" : " (no token)"}`);
    console.log(`[http] CORS allow: ${ALLOWED_ORIGINS.join(", ")}`);
  });
}
