import type { Env } from "./_env";
import type { TlRoom, TlTeam, TlPlayer, TlRound, TlTimelineEntry, SpotifyTrack } from "../src/lib/types";

// Minimal Supabase REST client for use in Cloudflare Functions (no Node deps).

function makeHeaders(env: Env, upsert = false) {
  return {
    "Content-Type":  "application/json",
    "apikey":        env.SUPABASE_SERVICE_ROLE_KEY,
    "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Prefer":        upsert
      ? "resolution=merge-duplicates,return=representation"
      : "return=representation",
  };
}

function url(env: Env, table: string, params = "") {
  return `${env.SUPABASE_URL}/rest/v1/${table}${params ? `?${params}` : ""}`;
}

export async function req<T>(env: Env, method: string, table: string, params = "", body?: unknown, upsert = false): Promise<T[]> {
  const res = await fetch(url(env, table, params), {
    method,
    headers: makeHeaders(env, upsert),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase ${method} ${table}: ${res.status} ${text}`);
  }
  if (res.status === 204) return [] as T[];
  return res.json() as Promise<T[]>;
}

// ── Room ──────────────────────────────────────────────────────────────────────

export async function getRoom(env: Env, roomId: string): Promise<TlRoom | null> {
  const rows = await req<TlRoom>(env, "GET", "tl_rooms", `id=eq.${roomId}&select=*`);
  return rows[0] ?? null;
}

export async function createRoom(env: Env, data: Partial<TlRoom>): Promise<TlRoom> {
  const rows = await req<TlRoom>(env, "POST", "tl_rooms", "", data);
  return rows[0];
}

export async function updateRoom(env: Env, roomId: string, data: Partial<TlRoom>): Promise<void> {
  await req(env, "PATCH", "tl_rooms", `id=eq.${roomId}`, data);
}

// ── Team ──────────────────────────────────────────────────────────────────────

export async function getTeams(env: Env, roomId: string): Promise<TlTeam[]> {
  return req<TlTeam>(env, "GET", "tl_teams", `room_id=eq.${roomId}&order=sort_order.asc&select=*`);
}

export async function createTeam(env: Env, data: Partial<TlTeam>): Promise<TlTeam> {
  const rows = await req<TlTeam>(env, "POST", "tl_teams", "", data);
  return rows[0];
}

export async function updateTeam(env: Env, teamId: number, data: Partial<TlTeam>): Promise<void> {
  await req(env, "PATCH", "tl_teams", `id=eq.${teamId}`, data);
}

// ── Player ────────────────────────────────────────────────────────────────────

export async function getPlayers(env: Env, roomId: string): Promise<TlPlayer[]> {
  return req<TlPlayer>(env, "GET", "tl_players", `room_id=eq.${roomId}&select=*`);
}

export async function createPlayer(env: Env, data: Partial<TlPlayer>): Promise<TlPlayer> {
  const rows = await req<TlPlayer>(env, "POST", "tl_players", "", data);
  return rows[0];
}

export async function updatePlayer(env: Env, playerId: string, data: Partial<TlPlayer>): Promise<void> {
  await req(env, "PATCH", "tl_players", `id=eq.${playerId}`, data);
}

// ── Round ─────────────────────────────────────────────────────────────────────

export async function createRound(env: Env, data: Partial<TlRound>): Promise<TlRound> {
  const rows = await req<TlRound>(env, "POST", "tl_rounds", "", data);
  return rows[0];
}

// ── Global song-corrections (migration 013) ─────────────────────────────────
// Persistent year corrections. Latest-wins — see migration 013 comments and
// the design discussion in plan_timelinedrop_roadmap.md.

/**
 * Look up corrected years for many tracks at once. Returns a Map keyed by
 * Spotify track id. Missing entries simply aren't in the map. Empty input
 * short-circuits without an HTTP call.
 */
export async function batchLookupCorrections(
  env: Env,
  trackIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (trackIds.length === 0) return out;
  // PostgREST in.() with quoted comma-separated values. We dedupe + escape.
  const seen = new Set<string>();
  const escaped: string[] = [];
  for (const id of trackIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    // Track ids are base62 Spotify ids — no commas or quotes to worry about
    // but we quote defensively for PostgREST in.() syntax.
    escaped.push(`"${id.replace(/"/g, '\\"')}"`);
  }
  const url = `${env.SUPABASE_URL}/rest/v1/tl_song_corrections?track_id=in.(${escaped.join(",")})&select=track_id,corrected_year`;
  const res = await fetch(url, {
    headers: {
      apikey:        env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!res.ok) return out;
  const rows = await res.json() as Array<{ track_id: string; corrected_year: number }>;
  for (const r of rows) out.set(r.track_id, r.corrected_year);
  return out;
}

/**
 * Single-track convenience wrapper around batchLookupCorrections.
 */
export async function lookupCorrectedYear(env: Env, trackId: string): Promise<number | null> {
  const m = await batchLookupCorrections(env, [trackId]);
  return m.get(trackId) ?? null;
}

/**
 * UPSERT a corrected year. Latest write wins. Audit fields (sourcePlayerId
 * / sourcePlayerName) are nullable for backwards-compatibility with the
 * one host-shortcut callsite that pre-dates migration 017 — they should
 * be supplied for any new caller.
 */
export async function upsertSongCorrection(
  env: Env,
  trackId: string,
  correctedYear: number,
  sourceRoom: string,
  sourcePlayerId?: string,
  sourcePlayerName?: string,
): Promise<void> {
  try {
    const body: Record<string, unknown> = {
      track_id:       trackId,
      corrected_year: correctedYear,
      source_room:    sourceRoom,
      corrected_at:   new Date().toISOString(),
    };
    if (sourcePlayerId)   body.source_player_id   = sourcePlayerId;
    if (sourcePlayerName) body.source_player_name = sourcePlayerName;
    await req(env, "POST", "tl_song_corrections", "on_conflict=track_id", body, true);
  } catch (e) {
    // Don't block the user's correction on a global-table hiccup.
    console.warn("[musix] upsertSongCorrection failed:", e);
  }
}

// ── Accepted-answers / auto-judging (migration 016) ─────────────────────────

// Suffix markers that, when present in a "Song - <qualifier>" tail or a
// trailing "(qualifier)" / "[qualifier]" block, indicate the qualifier is a
// Spotify-catalogue label for a version/edit/feature of the same song
// rather than part of the title itself. List based on patterns scanned in
// the live Spotify catalogue.
const SONG_SUFFIX_MARKERS = /\b(remaster(ed)?|remix(es|ed)?|edit|version|mono|stereo|acoustic|demo|live|bonus|deluxe|anniversary|extended|single|album|radio|mix|recorded|re-recorded|inspired|theme|soundtrack|motion picture|movie|film|ost|expanded|explicit|clean|edition|instrumental|karaoke|reprise|interlude|outro|intro|from|with|feat|featuring|ft)\b/i;

// More conservative whitelist for the no-dash variant ("Imagine
// remastered 2010", "Hotel California Live"). Excludes risk words like
// "from"/"with"/"edition" that legitimately end real song titles.
const TRAILING_SUFFIX_NODASH = /\s+(remaster(ed)?|remix(es|ed)?|live|acoustic|demo|bonus|instrumental|karaoke|reprise|mono|stereo|mix|edit|feat|featuring|ft)\b.*$/i;

// Strip Spotify-style suffixes off a song title:
//   "Bohemian Rhapsody - Remastered 2011"        → "Bohemian Rhapsody"
//   "Don't Stop Me Now (Remastered 2011)"         → "Don't Stop Me Now"
//   "Hey Jude - From the Movie 'Yellow Submarine'"→ "Hey Jude"
//   "Stayin' Alive [Single Version]"              → "Stayin' Alive"
//   "Imagine remastered 2010"                     → "imagine"
//   "Crazy in Love (feat. Jay-Z)"                 → "crazy in love"
//   "Crazy in Love feat. Jay-Z"                   → "crazy in love"
//
// Conservative wrt real titles — the no-dash pass uses a smaller whitelist
// so "Live and Let Die" / "From This Moment On" / "Take Me With You" stay
// intact (their marker word is at the start, not the end).
function stripSongSuffix(s: string): string {
  // 1. Dash-style: strip the LAST " - <qualifier>" chunk repeatedly while
  //    the qualifier contains a known marker. Spotify's default format.
  for (let i = 0; i < 5; i++) {
    const parts = s.split(/\s+[-–—]\s+/);
    if (parts.length < 2) break;
    const last = parts[parts.length - 1];
    if (!SONG_SUFFIX_MARKERS.test(last)) break;
    s = parts.slice(0, -1).join(" - ").trim();
  }
  // 2. Paren / bracket suffixes: "(Remastered)", "[Live at Wembley]",
  //    iterated so stacked parens like "Song (Remastered) (Live)" both go.
  for (let i = 0; i < 5; i++) {
    const m = s.match(/^(.*?)\s*[([]([^()[\]]+)[)\]]\s*$/);
    if (!m) break;
    if (!SONG_SUFFIX_MARKERS.test(m[2])) break;
    s = m[1].trim();
  }
  // 3. No-dash trailing markers (user typed "imagine remastered 2010").
  //    Restricted whitelist to avoid false positives on real titles ending
  //    in "from" / "with" / "edition" / etc.
  s = s.replace(TRAILING_SUFFIX_NODASH, "").trim();
  return s;
}

/**
 * Normalize a player's guess for comparison. Same function applied on both
 * sides of any compare — accepts-table writes the result as the
 * `answer_normalized` PK component, and runtime auto-judge runs the same
 * pipeline on each incoming guess.
 *
 * Decisions:
 *  - Case + accent + punctuation insensitive (no trick spelling)
 *  - Whitespace collapsed (trailing spaces, double spaces don't matter)
 *  - stripSongSuffix() drops Spotify-style version labels (Remastered,
 *    Live, Acoustic, From the Movie, etc.) so a player typing the bare
 *    title matches the catalogue name, AND a catalogue title that already
 *    drops the suffix matches a player who types the long form. NOT
 *    applied to artist — artists matter.
 */
export function normalizeAnswer(raw: string, kind: "artist" | "songname"): string {
  let s = raw.toLowerCase().trim();
  if (kind === "songname") {
    s = stripSongSuffix(s);
  }
  s = s.normalize("NFD").replace(/[̀-ͯ]/g, "");      // strip accents
  s = s.replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();    // strip punctuation, collapse whitespace
  return s;
}

export interface AcceptedAnswerRow {
  track_id:          string;
  kind:              "artist" | "songname";
  answer_normalized: string;
  answer_original:   string;
  confirmations:     number;
}

/**
 * Fetch all accepted answers for a track (both kinds in one query). Returns
 * an empty array if the table doesn't exist yet (migration 016 not applied).
 */
export async function lookupAcceptedAnswers(env: Env, trackId: string): Promise<AcceptedAnswerRow[]> {
  try {
    const url = `${env.SUPABASE_URL}/rest/v1/tl_accepted_answers?track_id=eq.${encodeURIComponent(trackId)}&select=track_id,kind,answer_normalized,answer_original,confirmations`;
    const res = await fetch(url, {
      headers: {
        apikey:        env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    });
    if (!res.ok) return [];
    return (await res.json()) as AcceptedAnswerRow[];
  } catch {
    return [];
  }
}

const ACCEPTED_SOFT_CAP_PER_KIND = 20;

/**
 * Record a positively-judged guess so future games auto-judge it. Skips
 * empty guesses, normalises both sides, and applies a soft per-(track,kind)
 * cap to keep the table from bloating on rooms with very lenient judges.
 *
 * If the row already exists: bump `confirmations` and update
 * last_confirmed_at + last_confirmed_by_*. If it doesn't exist and we're
 * under the cap: insert. If we're at the cap and the row doesn't exist:
 * skip — the cheaper fallback is "do nothing", which still lets canonical
 * matches keep auto-judging.
 */
export async function recordAcceptedAnswer(
  env: Env,
  args: {
    trackId:    string;
    kind:       "artist" | "songname";
    rawGuess:   string;
    playerId:   string;
    playerName: string;
    sourceRoom: string;
  },
): Promise<void> {
  const normalized = normalizeAnswer(args.rawGuess, args.kind);
  if (!normalized) return; // empty after normalization → not a guess
  const now = new Date().toISOString();
  try {
    // Look up existing row to decide upsert vs bump vs skip-on-cap.
    const existing = await lookupAcceptedAnswers(env, args.trackId);
    const sameKind = existing.filter(r => r.kind === args.kind);
    const match = sameKind.find(r => r.answer_normalized === normalized);

    if (match) {
      // Bump confirmations + last_confirmed_*. PATCH (not upsert) avoids
      // overwriting source_player_id / first_added_at, which should stick
      // to the original creator.
      const patchUrl = `${env.SUPABASE_URL}/rest/v1/tl_accepted_answers?track_id=eq.${encodeURIComponent(args.trackId)}&kind=eq.${args.kind}&answer_normalized=eq.${encodeURIComponent(normalized)}`;
      await fetch(patchUrl, {
        method: "PATCH",
        headers: {
          "Content-Type":  "application/json",
          "apikey":        env.SUPABASE_SERVICE_ROLE_KEY,
          "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          "Prefer":        "return=minimal",
        },
        body: JSON.stringify({
          confirmations:          match.confirmations + 1,
          last_confirmed_at:      now,
          last_confirmed_by_id:   args.playerId,
          last_confirmed_by_name: args.playerName,
        }),
      });
      return;
    }

    if (sameKind.length >= ACCEPTED_SOFT_CAP_PER_KIND) {
      console.warn(`[accepted] soft cap reached for ${args.trackId}/${args.kind}; skipping new entry "${args.rawGuess}"`);
      return;
    }

    await req(env, "POST", "tl_accepted_answers", "", {
      track_id:               args.trackId,
      kind:                   args.kind,
      answer_normalized:      normalized,
      answer_original:        args.rawGuess.trim(),
      confirmations:          1,
      first_added_at:         now,
      last_confirmed_at:      now,
      source_player_id:       args.playerId,
      source_player_name:     args.playerName,
      last_confirmed_by_id:   args.playerId,
      last_confirmed_by_name: args.playerName,
      source_room:            args.sourceRoom,
    }, true);
    console.log(`[accepted] added "${args.rawGuess}" → "${normalized}" (${args.kind}) for ${args.trackId} by ${args.playerName}`);
  } catch (e) {
    // Same posture as upsertSongCorrection — don't block the user.
    console.warn("[accepted] recordAcceptedAnswer failed:", e);
  }
}

/**
 * Check whether a guess is auto-judgeable as correct. Compares the
 * normalized guess against the canonical track field AND every stored
 * accepted answer. Returns the match source on hit (so the caller can
 * log it), or null on miss.
 */
export function autoJudgeGuess(
  rawGuess: string,
  kind: "artist" | "songname",
  canonical: string,
  accepted: AcceptedAnswerRow[],
): { matched: "canonical" | "stored"; storedConfirmations?: number } | null {
  const normalized = normalizeAnswer(rawGuess, kind);
  if (!normalized) return null;
  if (normalized === normalizeAnswer(canonical, kind)) {
    return { matched: "canonical" };
  }
  const hit = accepted.find(r => r.kind === kind && r.answer_normalized === normalized);
  if (hit) return { matched: "stored", storedConfirmations: hit.confirmations };
  return null;
}

/**
 * Record that every non-spectator player just heard a track. Drives the
 * "Skip recently heard" filter in curate.ts — without this, the blacklist
 * is always empty so the same songs keep coming back. Failures are swallowed
 * so a transient Supabase hiccup never blocks a round from starting.
 */
export async function recordPlayedTracks(
  env: Env,
  roomId: string,
  playerIds: string[],
  trackId: string,
): Promise<void> {
  if (playerIds.length === 0 || !trackId) return;
  const rows = playerIds.map(player_id => ({
    room_id: roomId,
    player_id,
    track_id: trackId,
  }));
  try {
    await req(env, "POST", "tl_played_tracks", "", rows);
  } catch (e) {
    console.error("[musix] recordPlayedTracks failed:", e);
  }
}

export async function getRound(env: Env, roundId: number): Promise<TlRound | null> {
  const rows = await req<TlRound>(env, "GET", "tl_rounds", `id=eq.${roundId}&select=*`);
  return rows[0] ?? null;
}

export async function updateRound(env: Env, roundId: number, data: Partial<TlRound>): Promise<void> {
  await req(env, "PATCH", "tl_rounds", `id=eq.${roundId}`, data);
}

// ── Timeline ──────────────────────────────────────────────────────────────────

export async function getTimeline(env: Env, teamId: number): Promise<TlTimelineEntry[]> {
  return req<TlTimelineEntry>(env, "GET", "tl_timeline", `team_id=eq.${teamId}&order=position.asc&select=*`);
}

export async function insertTimelineEntry(env: Env, data: TlTimelineEntry): Promise<void> {
  // Recalculate positions: insert sorted by year, shift others up
  const existing = await getTimeline(env, data.team_id);
  const all = [...existing, data].sort((a, b) => a.year - b.year);
  // Upsert all with corrected positions
  for (let i = 0; i < all.length; i++) {
    await req(env, "POST", "tl_timeline", "on_conflict=team_id,track_id", { ...all[i], position: i }, true);
  }
}

// ── Spotify token refresh ─────────────────────────────────────────────────────

export async function refreshSpotifyToken(
  env: Env,
  refreshToken: string
): Promise<{ access_token: string; expires_in: number }> {
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type":  "application/x-www-form-urlencoded",
      "Authorization": `Basic ${btoa(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`)}`,
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
  });
  if (!res.ok) throw new Error(`Spotify token refresh failed: ${res.status}`);
  return res.json() as Promise<{ access_token: string; expires_in: number }>;
}

export async function getClientCredentialsToken(env: Env): Promise<string> {
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type":  "application/x-www-form-urlencoded",
      "Authorization": `Basic ${btoa(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`)}`,
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Spotify client credentials failed: ${res.status} ${body}`);
  }
  const data = await res.json() as { access_token: string };
  return data.access_token;
}

// ── Spotify playlist fetch ────────────────────────────────────────────────────

interface SpotifyTrackObject {
  id: string;
  name: string;
  uri: string;
  duration_ms: number;
  artists: Array<{ name: string }>;
  album: {
    name: string;
    release_date: string;
    images: Array<{ url: string; width: number }>;
  };
}

interface SpotifyPlaylistItem {
  // `item` is the current field; `track` is the deprecated alias — accept both
  item:  SpotifyTrackObject | null;
  track: SpotifyTrackObject | null;
}

function parseItems(items: SpotifyPlaylistItem[]): SpotifyTrack[] {
  const out: SpotifyTrack[] = [];
  for (const entry of items) {
    const t = entry.item ?? entry.track;   // prefer new `item` field, fall back to deprecated `track`
    if (!t || !t.id || !t.uri) continue;
    const releaseYear = parseInt(t.album.release_date.slice(0, 4), 10);
    if (isNaN(releaseYear)) continue;
    const cover = t.album.images.sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url ?? "";
    out.push({
      id:          t.id,
      name:        t.name,
      artist:      t.artists[0]?.name ?? "Unknown",
      albumName:   t.album.name,
      releaseYear,
      coverUrl:    cover,
      uri:         t.uri,
      durationMs:  t.duration_ms,
    });
  }
  return out;
}

export async function fetchPlaylistTracks(
  env: Env,
  playlistId: string,
  accessToken?: string
): Promise<SpotifyTrack[]> {
  if (!accessToken) accessToken = await getClientCredentialsToken(env);

  let nextUrl: string | null =
    `https://api.spotify.com/v1/playlists/${playlistId}/items?limit=50&additional_types=track`;

  const tracks: SpotifyTrack[] = [];

  while (nextUrl) {
    const res = await fetch(nextUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Spotify playlist fetch: ${res.status} — ${body}`);
    }
    const page = await res.json() as { next: string | null; items: SpotifyPlaylistItem[] };
    tracks.push(...parseItems(page.items ?? []));
    nextUrl = page.next;
  }

  return tracks;
}
