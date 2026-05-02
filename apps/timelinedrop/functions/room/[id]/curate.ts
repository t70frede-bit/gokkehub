import type { PagesFunction } from "@cloudflare/workers-types";
import { getSession } from "@gokkehub/auth/session";
import type { Env } from "../../_env";
import { json, handlePreflight } from "../../_cors";
import { getRoom, getPlayers, updateRoom } from "../../_supabase";
import { searchTrackUri, getActiveHostToken } from "../../_spotify";
import type { SpotifyTrack, Difficulty, TlPlayer } from "../../../src/lib/types";
import { DEFAULT_TL_SETTINGS } from "../../../src/lib/types";
import {
  buildProfile, scoreCandidate, withinBand,
  sharedTopArtists, expandViaSimilar, tracksFromArtists, hardestPoolArtists, arrangePlaylistArc,
  type Candidate, type ScoredCandidate, type PlayerProfile,
} from "../../_curate";

// POST /room/:id/curate?action=generate-batch  — initial 30 tracks
// POST /room/:id/curate?action=refill-buffer   — top-up keeping pool >= 5 ahead

// Cloudflare's free-tier limit is 50 subrequests per request. Profile fetches
// (2 per player), Spotify token refresh, Supabase reads, and per-track Spotify
// search all count. We keep the curation pool small enough to fit comfortably.
const TARGET_BATCH_SIZE = 15;
const REFILL_THRESHOLD  = 5;
const MAX_SPOTIFY_LOOKUPS = 18;     // ≤ 18 search subrequests per call
const MAX_SIMILAR_SEEDS   = 3;      // ≤ 3 similar-artist queries
const MAX_ARTIST_TRACKS   = 6;      // ≤ 6 artist-top-tracks queries
const TRACKS_PER_ARTIST   = 3;

export const onRequest: PagesFunction<Env> = async ({ request, params, env }) => {
  const pre = handlePreflight(request as unknown as Request);
  if (pre) return pre;
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const req = request as unknown as Request;
  const roomId = params.id as string;
  const action = new URL(req.url).searchParams.get("action");

  if (action === "generate-batch" || action === "refill-buffer") {
    try {
      return await handleGenerate(req, roomId, env, action === "refill-buffer");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const stack   = err instanceof Error ? err.stack : undefined;
      console.error("curate failed", message, stack);
      return json({ error: `Curation failed: ${message}` }, 500, req);
    }
  }
  return json({ error: "Unknown action" }, 400, req);
};

async function handleGenerate(req: Request, roomId: string, env: Env, isRefill: boolean) {
  const body = await req.json().catch(() => ({})) as { player_id?: string };
  const room = await getRoom(env, roomId);
  if (!room) return json({ error: "Room not found" }, 404, req);

  const players = await getPlayers(env, roomId);
  // Only host can trigger, except refill which any captain can fire (needed mid-game)
  if (!isRefill && body.player_id !== room.host_id) {
    return json({ error: "Only the host can generate the initial batch" }, 403, req);
  }

  const settings   = { ...DEFAULT_TL_SETTINGS, ...(room.settings ?? {}) };
  const difficulty = settings.difficulty;

  // Get the host's active Spotify token (needed for URI search). Without it we can't
  // surface tracks the SDK can play, so the curation aborts gracefully.
  const session = await getSession(env.SESSIONS, req);
  if (!session?.spotify?.refreshToken) {
    return json({ error: "Host needs to connect Spotify on their profile to generate tracks" }, 400, req);
  }
  const accessToken = await getActiveHostToken(env, session.spotify.refreshToken);
  if (!accessToken) return json({ error: "Could not refresh Spotify token" }, 500, req);

  // 1) Build per-player profiles
  const eligible = players.filter(p => !p.is_spectator);
  const profiles: PlayerProfile[] = [];
  for (const p of eligible) {
    profiles.push(await buildProfile(env, p));
  }

  // 2) Build candidate pool based on difficulty
  let candidates: Candidate[] = await buildCandidatePool(env, profiles, difficulty);

  // 3) Apply played-this-session filter + 14-day blacklist (if enabled)
  const alreadyInPool = new Set((room.track_pool ?? []).map(t => `${t.artist.toLowerCase()}:${t.name.toLowerCase()}`));
  candidates = candidates.filter(c => !alreadyInPool.has(`${c.artist.toLowerCase()}:${c.track.toLowerCase()}`));

  if (settings.skipRecentlyHeard) {
    const blacklist = await fetchBlacklist(env, roomId, eligible, 14);
    candidates = candidates.filter(c => !blacklist.has(`${c.artist.toLowerCase()}:${c.track.toLowerCase()}`));
  }

  // 4) Score and filter into difficulty band
  let scored: ScoredCandidate[] = candidates.map(c => scoreCandidate(profiles, c));
  let banded = scored.filter(c => withinBand(c.groupScore, difficulty));

  // 5) Pool exhaustion fallback chain: relax blacklist progressively
  if (banded.length < TARGET_BATCH_SIZE / 2 && settings.skipRecentlyHeard) {
    for (const days of [7, 3, 0]) {
      const bl = days > 0 ? await fetchBlacklist(env, roomId, eligible, days) : new Set<string>();
      const fresh = candidates.filter(c => !bl.has(`${c.artist.toLowerCase()}:${c.track.toLowerCase()}`));
      const rescored = fresh.map(c => scoreCandidate(profiles, c));
      banded = rescored.filter(c => withinBand(c.groupScore, difficulty));
      if (banded.length >= TARGET_BATCH_SIZE / 2) break;
    }
  }

  // If we still have nothing, fall back to all scored candidates regardless of band.
  if (banded.length === 0) banded = scored;

  // 6) Arrange the playlist arc
  const arranged = arrangePlaylistArc(banded, isRefill ? 15 : TARGET_BATCH_SIZE);

  // 7) Look up Spotify URIs for each candidate. Hard cap on attempts to stay
  //    under the 50-subrequest limit even on cold cache.
  const tracks: SpotifyTrack[] = [];
  const enriched: Array<SpotifyTrack & { _meta: ScoredCandidate }> = [];
  let attempts = 0;
  for (const c of arranged) {
    if (attempts >= MAX_SPOTIFY_LOOKUPS) break;
    if (tracks.length >= (isRefill ? 15 : TARGET_BATCH_SIZE)) break;
    attempts++;
    const hit = await searchTrackUri(accessToken, c.artist, c.track);
    if (hit) {
      tracks.push(hit);
      enriched.push({ ...hit, _meta: c });
    }
  }

  // 8) Append to track_pool
  const newPool = [...(room.track_pool ?? []), ...tracks];
  await updateRoom(env, roomId, { track_pool: newPool });

  return json({
    ok: true,
    added: tracks.length,
    total: newPool.length,
    warning: tracks.length < TARGET_BATCH_SIZE / 2
      ? "Running low on fresh songs that fit this difficulty. Try lowering the difficulty or unchecking 'Skip recently heard'."
      : undefined,
  }, 200, req);
}

// ── Build candidate pool by difficulty ──────────────────────────────────────

async function buildCandidatePool(env: Env, profiles: PlayerProfile[], difficulty: Difficulty): Promise<Candidate[]> {
  // Always start with all-time top tracks across all players (the "easy" pool).
  const easyPool: Candidate[] = [];
  for (const p of profiles) {
    for (const t of p.topTracksAll) {
      const aName = typeof t.artist === "string" ? t.artist : t.artist.name;
      easyPool.push({ artist: aName, track: t.name });
    }
  }

  if (difficulty === "easy") return dedupe(easyPool);

  // Medium: easy pool + tracks from a few similar artists
  if (difficulty === "medium") {
    const seeds       = sharedTopArtists(profiles, 25).slice(0, MAX_SIMILAR_SEEDS);
    const similar     = await expandViaSimilar(env, seeds, MAX_ARTIST_TRACKS);
    const similarTrks = await tracksFromArtists(env, similar.slice(0, MAX_ARTIST_TRACKS), TRACKS_PER_ARTIST);
    return dedupe([...sampleN(easyPool, 25), ...similarTrks]);
  }

  // Hard: similar artists weighted higher; exclude any track scrobbled 10+ times
  if (difficulty === "hard") {
    const seeds       = sharedTopArtists(profiles, 50).slice(0, MAX_SIMILAR_SEEDS);
    const similar     = await expandViaSimilar(env, seeds, MAX_ARTIST_TRACKS);
    const similarTrks = await tracksFromArtists(env, similar.slice(0, MAX_ARTIST_TRACKS), TRACKS_PER_ARTIST);
    const candidates  = [...sampleN(easyPool, 10), ...similarTrks];
    return dedupe(candidates).filter(c => {
      const key = `${c.artist.toLowerCase()}:${c.track.toLowerCase()}`;
      return !profiles.some(p => (p.trackPlaycounts.get(key) ?? 0) >= 10);
    });
  }

  // Hardest: unknown artists in the group's genre fingerprint
  const artists = await hardestPoolArtists(env, profiles, MAX_ARTIST_TRACKS);
  const tracks  = await tracksFromArtists(env, artists.slice(0, MAX_ARTIST_TRACKS), TRACKS_PER_ARTIST);
  return dedupe(tracks);
}

function sampleN<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return [...arr];
  const out = [...arr].sort(() => Math.random() - 0.5);
  return out.slice(0, n);
}

function dedupe(arr: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const c of arr) {
    const k = `${c.artist.toLowerCase()}:${c.track.toLowerCase()}`;
    if (seen.has(k)) continue;
    seen.add(k); out.push(c);
  }
  return out;
}

// ── Blacklist lookup ────────────────────────────────────────────────────────

async function fetchBlacklist(env: Env, roomId: string, players: TlPlayer[], days: number): Promise<Set<string>> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const ids = players.map(p => p.id);
  if (ids.length === 0) return new Set();
  const inList = ids.map(id => `"${id}"`).join(",");
  const url = `${env.SUPABASE_URL}/rest/v1/tl_played_tracks?player_id=in.(${inList})&played_at=gte.${cutoff}&select=track_id`;
  const res = await fetch(url, {
    headers: {
      apikey:        env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!res.ok) return new Set();
  const rows = await res.json() as Array<{ track_id: string }>;
  return new Set(rows.map(r => r.track_id.toLowerCase()));
}

// Refill buffer is shared logic; export so start.ts can call it directly.
export { handleGenerate };
