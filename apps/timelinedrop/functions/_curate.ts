import type { Env } from "./_env";
import type { TlPlayer, Difficulty, Confidence } from "../src/lib/types";
import {
  getTopArtists, getTopTracks, getRecentTracks,
  getArtistInfo, getSimilarArtists, getArtistTopTracks,
  getTopArtistsByTag, getTrackInfo,
  parsePlaycount,
  type LastfmArtistRef, type LastfmTrackRef,
} from "./_lastfm";

// ── Per-player profile ─────────────────────────────────────────────────────

export interface PlayerProfile {
  player:           TlPlayer;
  source:           "lastfm" | "manual" | "none";
  topArtistsAll:    LastfmArtistRef[];   // all-time top 50
  topArtistsRecent: LastfmArtistRef[];   // 3-month top 25
  topTracksAll:     LastfmTrackRef[];    // all-time top 50
  topTracksRecent:  LastfmTrackRef[];    // 7-day top 25
  recentTracks:     LastfmTrackRef[];    // 50 most recent
  // Quick lookups
  artistPlaycounts:     Map<string, number>; // lower-case artist name -> all-time playcount
  recentArtistCounts:   Map<string, number>; // lower-case artist name -> last 90d count
  trackPlaycounts:      Map<string, number>; // "artist:track" -> playcount
  topTrackKeys:         Set<string>;         // "artist:track" in all-time top 50
  recent7d:             Set<string>;         // "artist:track" scrobbled in last 7 days
}

// ── Build a profile for one player ─────────────────────────────────────────

function lc(s: string | undefined): string { return (s ?? "").toLowerCase().trim(); }
function trackKey(artist: string, track: string): string { return `${lc(artist)}:${lc(track)}`; }

export async function buildProfile(env: Env, player: TlPlayer): Promise<PlayerProfile> {
  const empty: PlayerProfile = {
    player, source: "none",
    topArtistsAll: [], topArtistsRecent: [], topTracksAll: [], topTracksRecent: [], recentTracks: [],
    artistPlaycounts: new Map(), recentArtistCounts: new Map(),
    trackPlaycounts: new Map(), topTrackKeys: new Set(), recent7d: new Set(),
  };

  // Manual fallback — synthesize a profile from a hand-entered list
  if (!player.lastfm_username && (player.manual_artists?.length ?? 0) > 0) {
    const profile = { ...empty, source: "manual" as const };
    for (const a of player.manual_artists) {
      profile.topArtistsAll.push({ name: a, playcount: "100" });
      profile.artistPlaycounts.set(lc(a), 100);
    }
    return profile;
  }
  if (!player.lastfm_username) return empty;

  const u = player.lastfm_username;
  // Fetch all listening data in parallel.
  const [topArtistsAll, topArtistsRecent, topTracksAll, topTracksRecent, recent] = await Promise.all([
    getTopArtists(env, u, "overall", 50),
    getTopArtists(env, u, "3month", 25),
    getTopTracks(env, u, "overall", 50),
    getTopTracks(env, u, "7day", 25),
    getRecentTracks(env, u, 50),
  ]);

  const profile: PlayerProfile = {
    ...empty,
    source: "lastfm",
    topArtistsAll, topArtistsRecent, topTracksAll, topTracksRecent, recentTracks: recent,
  };

  for (const a of topArtistsAll) profile.artistPlaycounts.set(lc(a.name), parsePlaycount(a.playcount));
  for (const a of topArtistsRecent) profile.recentArtistCounts.set(lc(a.name), parsePlaycount(a.playcount));
  for (const t of topTracksAll) {
    const aName = typeof t.artist === "string" ? t.artist : t.artist.name;
    const k = trackKey(aName, t.name);
    profile.trackPlaycounts.set(k, parsePlaycount(t.playcount));
    profile.topTrackKeys.add(k);
  }
  // Recent 7-day scrobbles → mark in recent7d
  const sevenDaysAgo = (Date.now() / 1000) - 7 * 24 * 3600;
  for (const t of recent) {
    if (!t.date) continue;
    const ts = parseInt(t.date.uts, 10);
    if (Number.isFinite(ts) && ts >= sevenDaysAgo) {
      const aName = typeof t.artist === "string" ? t.artist : t.artist.name;
      profile.recent7d.add(trackKey(aName, t.name));
    }
  }

  return profile;
}

// ── Candidate scoring ──────────────────────────────────────────────────────

export interface Candidate {
  artist:    string;
  track:     string;
}

export interface ScoredCandidate extends Candidate {
  perPlayerScores:   Map<string, number>;  // player.id -> score
  groupScore:        number;
  confidence:        Confidence;
  playersWhoKnowIt:  string[];             // discord ids (or player ids if no discord)
}

// Score: 0–100 based on artist familiarity + track familiarity for one player.
function scoreFor(profile: PlayerProfile, c: Candidate): number {
  if (profile.source === "none") return 0;
  const aLc = lc(c.artist);
  const tk  = trackKey(c.artist, c.track);

  // Artist all-time
  const apc = profile.artistPlaycounts.get(aLc) ?? 0;
  let s = 0;
  if      (apc >= 2000) s += 35;
  else if (apc >= 500)  s += 25;
  else if (apc >= 100)  s += 15;
  else if (apc >= 10)   s += 5;

  // Artist recency (3-month)
  const apr = profile.recentArtistCounts.get(aLc) ?? 0;
  if      (apr >= 50) s += 25;
  else if (apr >= 10) s += 15;
  else if (apr >= 1)  s += 5;

  // Track playcount
  const tpc = profile.trackPlaycounts.get(tk) ?? 0;
  if      (tpc >= 10) s += 30;
  else if (tpc >= 3)  s += 20;
  else if (tpc >= 1)  s += 10;

  // Bonuses
  if (profile.recent7d.has(tk))    s += 10;
  if (profile.topTrackKeys.has(tk)) s += 10;

  return Math.min(100, s);
}

export function scoreCandidate(profiles: PlayerProfile[], c: Candidate): ScoredCandidate {
  const perPlayer = new Map<string, number>();
  const knew: string[] = [];
  for (const p of profiles) {
    const s = scoreFor(p, c);
    perPlayer.set(p.player.id, s);
    if (s > 0) {
      const did = p.player.discord_id ?? p.player.id;
      knew.push(did);
    }
  }

  // Group score = simple mean (normalised to percentage of pool size)
  const totals = [...perPlayer.values()];
  const sum    = totals.reduce((a, b) => a + b, 0);
  const mean   = totals.length > 0 ? sum / totals.length : 0;

  // Fairness penalty: if one player accounts for >40% of total, subtract their excess.
  let penalty = 0;
  if (sum > 0) {
    for (const v of totals) {
      const share = v / sum;
      if (share > 0.4) penalty = Math.max(penalty, (share - 0.4) * mean);
    }
  }
  const groupScore = Math.max(0, mean - penalty);

  // Confidence label from group score
  let confidence: Confidence;
  if      (groupScore >= 65) confidence = "known";
  else if (groupScore >= 35) confidence = "likely";
  else if (groupScore >= 15) confidence = "stretch";
  else                       confidence = "wild";

  return { ...c, perPlayerScores: perPlayer, groupScore, confidence, playersWhoKnowIt: knew };
}

// ── Difficulty selection ───────────────────────────────────────────────────

export function withinBand(score: number, difficulty: Difficulty): boolean {
  switch (difficulty) {
    case "easy":    return score >= 65;
    case "medium":  return score >= 35 && score < 65;
    case "hard":    return score >= 15 && score < 35;
    case "hardest": return score < 15;
  }
}

// ── Group-level helpers ────────────────────────────────────────────────────

// Returns the artists shared (above some threshold) across the group's all-time top.
export function sharedTopArtists(profiles: PlayerProfile[], topN: number): string[] {
  const counts = new Map<string, number>();
  for (const p of profiles) {
    for (const a of p.topArtistsAll.slice(0, topN)) {
      const k = lc(a.name);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);
}

// Top tags across the group's top artists — used as the genre fingerprint for HARDEST mode.
export async function groupGenreFingerprint(env: Env, profiles: PlayerProfile[], k = 5): Promise<string[]> {
  const tagCounts = new Map<string, number>();
  // Aggregate top-3 tags from each player's top 10 artists
  for (const p of profiles) {
    for (const a of p.topArtistsAll.slice(0, 10)) {
      const info = await getArtistInfo(env, a.name);
      const tags = info?.tags?.tag?.slice(0, 3) ?? [];
      for (const t of tags) {
        const tk = lc(t.name);
        if (!tk) continue;
        tagCounts.set(tk, (tagCounts.get(tk) ?? 0) + 1);
      }
    }
  }
  return [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([tag]) => tag);
}

// ── Final track ordering: warm-up, middle, finish strong ───────────────────

export function arrangePlaylistArc(scored: ScoredCandidate[], target: number): ScoredCandidate[] {
  if (scored.length === 0) return [];
  const sorted = [...scored].sort((a, b) => b.groupScore - a.groupScore);
  const slice  = sorted.slice(0, target);
  if (slice.length <= 4) return slice;

  // 2 highest at start, 2 mid at end, the rest shuffled in the middle.
  const start  = slice.slice(0, 2);
  const middle = slice.slice(2, slice.length - 2);
  const finish = slice.slice(slice.length - 2);

  // Move the 2 mid-score (around the median) to the end for "finish strong but not the top"
  const byScoreAsc = [...middle].sort((a, b) => a.groupScore - b.groupScore);
  const medianStart = Math.floor(byScoreAsc.length / 2) - 1;
  const midPair = byScoreAsc.slice(Math.max(0, medianStart), Math.max(0, medianStart) + 2);

  // Remove midPair from middle
  const midPairSet = new Set(midPair);
  const middleShuffled = [...middle].filter(c => !midPairSet.has(c)).sort(() => Math.random() - 0.5);

  return [...start, ...middleShuffled, ...midPair, ...finish.slice(0, 0)];
}

// Wider search than scoring: take similar artists from shared favourites.
export async function expandViaSimilar(env: Env, seedArtists: string[], limit = 30): Promise<string[]> {
  const out = new Set<string>();
  for (const seed of seedArtists.slice(0, 10)) {
    const sim = await getSimilarArtists(env, seed, 10);
    for (const s of sim) out.add(s.name);
    if (out.size >= limit * 2) break;
  }
  return [...out].slice(0, limit * 2);
}

// Pull tracks for a list of artist names (top tracks each).
export async function tracksFromArtists(env: Env, artists: string[], perArtist = 5): Promise<Candidate[]> {
  const out: Candidate[] = [];
  for (const a of artists) {
    const tracks = await getArtistTopTracks(env, a, perArtist);
    for (const t of tracks) {
      const aName = typeof t.artist === "string" ? t.artist : t.artist.name;
      out.push({ artist: aName, track: t.name });
    }
  }
  return out;
}

// Hardest mode pool: artists from top tags, excluding any player's known artists.
export async function hardestPoolArtists(env: Env, profiles: PlayerProfile[], maxArtists = 50): Promise<string[]> {
  const tags = await groupGenreFingerprint(env, profiles, 4);
  const knownSet = new Set<string>();
  for (const p of profiles) {
    for (const a of p.topArtistsAll) knownSet.add(lc(a.name));
  }
  const out = new Set<string>();
  for (const tag of tags) {
    const artists = await getTopArtistsByTag(env, tag, maxArtists);
    for (const a of artists) {
      if (!knownSet.has(lc(a.name))) out.add(a.name);
      if (out.size >= maxArtists) break;
    }
    if (out.size >= maxArtists) break;
  }
  return [...out];
}

// Per-track Last.fm play count refinement (optional — slower; only call for finalists).
export async function refineWithTrackInfo(env: Env, profiles: PlayerProfile[], candidates: ScoredCandidate[], maxLookups: number): Promise<ScoredCandidate[]> {
  let lookups = 0;
  for (const c of candidates) {
    if (lookups >= maxLookups) break;
    for (const p of profiles) {
      if (p.source !== "lastfm") continue;
      const info = await getTrackInfo(env, c.artist, c.track, p.player.lastfm_username!);
      const upc  = parsePlaycount(info?.userplaycount);
      if (upc > 0) {
        // Bump this player's score: convert raw upc into bonus and re-score
        const bonus = upc >= 10 ? 30 : upc >= 3 ? 20 : 10;
        const prev  = c.perPlayerScores.get(p.player.id) ?? 0;
        c.perPlayerScores.set(p.player.id, Math.min(100, prev + bonus));
      }
      lookups++;
      if (lookups >= maxLookups) break;
    }
    // Recompute group score with refined per-player numbers
    const totals = [...c.perPlayerScores.values()];
    const sum    = totals.reduce((a, b) => a + b, 0);
    c.groupScore = totals.length > 0 ? sum / totals.length : 0;
  }
  return candidates;
}
