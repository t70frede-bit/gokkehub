import type { PagesFunction } from "@cloudflare/workers-types";
import { getSession } from "@gokkehub/auth/session";
import type { Env } from "../../_env";
import { json, handlePreflight } from "../../_cors";
import { getRoom, getPlayers, updateRoom, batchLookupCorrections } from "../../_supabase";
import { searchTrackUri, getActiveHostToken } from "../../_spotify";
import type { SpotifyTrack, Difficulty, TlPlayer } from "../../../src/lib/types";
import { DEFAULT_TL_SETTINGS } from "../../../src/lib/types";
import {
  buildProfile, buildSpotifyProfile, scoreCandidate,
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

  // Get the host's active Spotify token (needed for URI search). For host-
  // triggered actions we read from the request cookie; for background top-
  // ups triggered by a non-host player we fall back to the host_session_id
  // persisted on the room (migration 011). Without either we can't surface
  // tracks the SDK can play, so the curation aborts gracefully.
  const requestSession = await getSession(env.SESSIONS, req);
  let refreshToken = requestSession?.spotify?.refreshToken;
  if (!refreshToken && room.host_session_id) {
    const raw = await env.SESSIONS.get(room.host_session_id);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { spotify?: { refreshToken?: string } };
        refreshToken = parsed.spotify?.refreshToken;
      } catch { /* malformed session JSON — ignore */ }
    }
  }
  if (!refreshToken) {
    return json({ error: "Host needs to connect Spotify on their profile to generate tracks" }, 400, req);
  }
  const accessToken = await getActiveHostToken(env, refreshToken);
  if (!accessToken) return json({ error: "Could not refresh Spotify token" }, 500, req);

  // 1) Build per-player profiles. Source switch: songSource picks which
  // listening-history backend feeds the pool. "spotify-taste" pulls each
  // player's own Spotify /me/top/* data + uses Last.fm only for the
  // similar-artists adjacency leap; "group-taste" stays on Last.fm
  // user.getTop* end-to-end (legacy path).
  const eligible = players.filter(p => !p.is_spectator);
  const profiles: PlayerProfile[] = [];
  if (settings.songSource === "spotify-taste") {
    // Caller (host or background top-up agent) — pass their refresh
    // token directly as the most reliable host-profile source. Falls
    // back to room.host_session_id-via-KV if not present.
    const hostFallback = {
      hostId:           room.host_id,
      hostRefreshToken: refreshToken,
      hostSessionId:    room.host_session_id,
    };
    for (const p of eligible) {
      profiles.push(await buildSpotifyProfile(env, p, roomId, hostFallback));
    }
  } else {
    for (const p of eligible) {
      profiles.push(await buildProfile(env, p));
    }
  }

  // 2) Build candidate pool based on difficulty
  let candidates: Candidate[] = await buildCandidatePool(env, profiles, difficulty);

  // 3) Coarse pre-filter: dedupe against the existing pool by artist:track slug.
  //    This is a within-curation safeguard; the recently-heard blacklist is
  //    applied later, against Spotify IDs (the only key the played-tracks
  //    table actually stores).
  const alreadyInPool = new Set((room.track_pool ?? []).map(t => `${t.artist.toLowerCase()}:${t.name.toLowerCase()}`));
  candidates = candidates.filter(c => !alreadyInPool.has(`${c.artist.toLowerCase()}:${c.track.toLowerCase()}`));

  // 4) Score for ranking only — the candidate POOL already encodes difficulty
  //    (see buildCandidatePool). The previous score-band filter was a no-op for
  //    single-taste groups because scores cluster bimodally (~70 for known,
  //    0 for unknown), leaving the medium/hard bands empty and the fallback
  //    served back the highest-scoring tracks (your top hits).
  const scored: ScoredCandidate[] = candidates.map(c => scoreCandidate(profiles, c));

  // 5) Arrange the playlist arc
  const arranged = arrangePlaylistArc(scored, isRefill ? 15 : TARGET_BATCH_SIZE);

  // 6) Fetch the recently-heard blacklist if enabled. tl_played_tracks stores
  //    Spotify track IDs, so the blacklist is a Set<spotify_id> and we apply
  //    it in the lookup loop below (after searchTrackUri returns the ID).
  //    If the result comes up short, we relax the window in-place rather
  //    than re-doing the lookup loop.
  const blacklist14d = settings.skipRecentlyHeard
    ? await fetchBlacklist(env, roomId, eligible, 14)
    : new Set<string>();
  const blacklist3d  = settings.skipRecentlyHeard && blacklist14d.size > 0
    ? await fetchBlacklist(env, roomId, eligible, 3)
    : new Set<string>();

  // 7) Look up Spotify URIs for each candidate. Hard cap on attempts to stay
  //    under the 50-subrequest limit even on cold cache. Year-diversity guard
  //    skips candidates whose release year already has MAX_PER_YEAR matches in
  //    this batch — players were complaining the captain kept hearing songs
  //    from "the current year" because top-tracks data is recency-skewed.
  const MAX_PER_YEAR = 2;
  const targetSize   = isRefill ? 15 : TARGET_BATCH_SIZE;
  // Seed the year tally with whatever's already in track_pool so we don't
  // pile up consecutive Refill batches on the same year either.
  const yearCount = new Map<number, number>();
  for (const t of (room.track_pool ?? [])) {
    yearCount.set(t.releaseYear, (yearCount.get(t.releaseYear) ?? 0) + 1);
  }

  const tracks: SpotifyTrack[] = [];
  const enriched: Array<SpotifyTrack & { _meta: ScoredCandidate }> = [];
  // Candidates that survived Spotify lookup but were dropped by the 14-day
  // blacklist. We keep them around as a relaxation tier — if the main loop
  // ends short we'll re-admit them (least-recently-heard first, approximated
  // by the 3-day filter).
  const skippedRecent: Array<SpotifyTrack & { _meta: ScoredCandidate }> = [];
  let attempts = 0;
  for (const c of arranged) {
    if (attempts >= MAX_SPOTIFY_LOOKUPS) break;
    if (tracks.length >= targetSize) break;
    attempts++;
    const hit = await searchTrackUri(accessToken, c.artist, c.track);
    if (!hit) continue;
    if ((yearCount.get(hit.releaseYear) ?? 0) >= MAX_PER_YEAR) continue;
    if (blacklist14d.has(hit.id)) {
      skippedRecent.push({ ...hit, _meta: c });
      continue;
    }
    tracks.push(hit);
    enriched.push({ ...hit, _meta: c });
    yearCount.set(hit.releaseYear, (yearCount.get(hit.releaseYear) ?? 0) + 1);
  }

  // 8) Relaxation: if we're below half-target, re-admit blacklisted tracks
  //    that weren't heard in the last 3 days. Costs no extra subrequests.
  if (tracks.length < targetSize / 2 && skippedRecent.length > 0) {
    for (const s of skippedRecent) {
      if (tracks.length >= targetSize) break;
      if (blacklist3d.has(s.id)) continue;
      if ((yearCount.get(s.releaseYear) ?? 0) >= MAX_PER_YEAR) continue;
      const { _meta, ...track } = s;
      tracks.push(track);
      enriched.push(s);
      yearCount.set(track.releaseYear, (yearCount.get(track.releaseYear) ?? 0) + 1);
    }
  }
  // Final relaxation — admit everything remaining (still capped by targetSize).
  if (tracks.length < targetSize / 2 && skippedRecent.length > 0) {
    for (const s of skippedRecent) {
      if (tracks.length >= targetSize) break;
      if (enriched.some(e => e.id === s.id)) continue;
      if ((yearCount.get(s.releaseYear) ?? 0) >= MAX_PER_YEAR) continue;
      const { _meta, ...track } = s;
      tracks.push(track);
      enriched.push(s);
      yearCount.set(track.releaseYear, (yearCount.get(track.releaseYear) ?? 0) + 1);
    }
  }

  // 9) Apply persistent global year corrections (migration 013) — a track
  // that's been year-corrected in any past room gets its releaseYear
  // overwritten right here, so the pool stores the corrected year and
  // every downstream consumer (UI, placement check, timeline ordering)
  // sees the right number.
  if (tracks.length > 0) {
    const corrections = await batchLookupCorrections(env, tracks.map(t => t.id));
    for (const t of tracks) {
      const c = corrections.get(t.id);
      if (typeof c === "number" && c !== t.releaseYear) {
        t.releaseYear = c;
      }
    }
  }

  // 10) Append to track_pool
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
// Each difficulty owns a slice of each player's top-50 tracks. This guarantees
// medium/hard *can't* fall back to "your top hits" because those tracks aren't
// in the pool — solving the bimodal-score problem for single-taste groups.

function tracksInRange(profile: PlayerProfile, fromRank: number, toRank: number): Candidate[] {
  return profile.topTracksAll.slice(fromRank, toRank).map(t => ({
    artist: typeof t.artist === "string" ? t.artist : t.artist.name,
    track:  t.name,
  }));
}

async function buildCandidatePool(env: Env, profiles: PlayerProfile[], difficulty: Difficulty): Promise<Candidate[]> {
  // Easy: every player's top 0-15. The mainstream / "obvious" hits.
  if (difficulty === "easy") {
    const pool: Candidate[] = [];
    for (const p of profiles) pool.push(...tracksInRange(p, 0, 15));
    return dedupe(pool);
  }

  // Medium: each player's top 16-35 (their less-obvious favourites) + a small
  // dose of similar-artist tracks. No top-15 hits; difficulty is real.
  if (difficulty === "medium") {
    const fromTop: Candidate[] = [];
    for (const p of profiles) fromTop.push(...tracksInRange(p, 15, 35));
    const seeds       = sharedTopArtists(profiles, 25).slice(0, MAX_SIMILAR_SEEDS);
    const similar     = await expandViaSimilar(env, seeds, MAX_ARTIST_TRACKS);
    const similarTrks = await tracksFromArtists(env, similar.slice(0, MAX_ARTIST_TRACKS), TRACKS_PER_ARTIST);
    return dedupe([...fromTop, ...similarTrks]);
  }

  // Hard: each player's top 36-50 (deep cuts) + similar artists, exclude any
  // track they've played 10+ times.
  if (difficulty === "hard") {
    const fromTop: Candidate[] = [];
    for (const p of profiles) fromTop.push(...tracksInRange(p, 35, 50));
    const seeds       = sharedTopArtists(profiles, 50).slice(0, MAX_SIMILAR_SEEDS);
    const similar     = await expandViaSimilar(env, seeds, MAX_ARTIST_TRACKS);
    const similarTrks = await tracksFromArtists(env, similar.slice(0, MAX_ARTIST_TRACKS), TRACKS_PER_ARTIST);
    return dedupe([...fromTop, ...similarTrks]).filter(c => {
      const key = `${c.artist.toLowerCase()}:${c.track.toLowerCase()}`;
      return !profiles.some(p => (p.trackPlaycounts.get(key) ?? 0) >= 10);
    });
  }

  // Hardest: unknown artists in the group's genre fingerprint, no top tracks.
  const artists = await hardestPoolArtists(env, profiles, MAX_ARTIST_TRACKS);
  const tracks  = await tracksFromArtists(env, artists.slice(0, MAX_ARTIST_TRACKS), TRACKS_PER_ARTIST);
  return dedupe(tracks);
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
  // Spotify IDs are case-sensitive opaque base62 strings — compare as-is.
  return new Set(rows.map(r => r.track_id));
}

// Refill buffer is shared logic; export so start.ts can call it directly.
export { handleGenerate };
