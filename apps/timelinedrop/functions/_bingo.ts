import type { Env } from "./_env";
import { json } from "./_cors";
import {
  req, updateRoom, updatePlayer, createRound, recordPlayedTracks,
  lookupAcceptedAnswers, gradeSearchPick,
} from "./_supabase";
import { generateBoard, trackHasWord, hasWon } from "../src/lib/bingo";
import type {
  TlRoom, TlTeam, TlPlayer, TlRound, TlRoomSettings, TlBingoBoard, TlBingoMark,
  BingoCheckMode, BingoWinMode, SearchPickPayload, SpotifyTrack,
} from "../src/lib/types";

// Server side of Music Bingo (settings.gameMode === "bingo").
//
// Songs play through tl_rounds exactly like the timeline game — one row per
// song — so the Spotify SDK, all-clients-stream and the Discord bot all
// work without knowing bingo exists. Bingo plays the pool IN ORDER:
// track #N is track_pool[N-1], room.track_cursor counts tracks played, and
// each round carries its bingo_track_no so ticks can be checked against
// the right song even if the pool is later edited.

/** Fewest songs a bingo game can start with. */
export const BINGO_MIN_TRACKS = 10;
/** Boards are built from the first N songs of the pool only. Bingo plays
 *  the pool in order, so a word from song #180 would sit dead on the board
 *  for an hour; capping keeps every square reachable within a game. */
export const BINGO_BOARD_POOL_CAP = 60;
export const BINGO_MAX_TEAMS = 8;

export function sanitizeBingoSettings(s: Record<string, unknown>, out: TlRoomSettings): void {
  if (s.gameMode === "timeline" || s.gameMode === "bingo") out.gameMode = s.gameMode;
  if (typeof s.bingoSize === "number" && s.bingoSize >= 3 && s.bingoSize <= 5) {
    out.bingoSize = Math.round(s.bingoSize);
  }
  if (s.bingoCheckMode === "off" || s.bingoCheckMode === "track" || s.bingoCheckMode === "search") {
    out.bingoCheckMode = s.bingoCheckMode;
  }
  if (s.bingoWordMatch === "whole" || s.bingoWordMatch === "partial") out.bingoWordMatch = s.bingoWordMatch;
  if (s.bingoWinMode === "line" || s.bingoWinMode === "two-lines" || s.bingoWinMode === "full") {
    out.bingoWinMode = s.bingoWinMode;
  }
  // 0 = full song; otherwise 10 s – 10 min.
  if (typeof s.bingoClipSeconds === "number"
      && (s.bingoClipSeconds === 0 || (s.bingoClipSeconds >= 10 && s.bingoClipSeconds <= 600))) {
    out.bingoClipSeconds = Math.round(s.bingoClipSeconds);
  }
  if (typeof s.bingoHostOnlyAudio === "boolean") out.bingoHostOnlyAudio = s.bingoHostOnlyAudio;
}

export function isBingo(room: Pick<TlRoom, "settings">): boolean {
  return room.settings?.gameMode === "bingo";
}

function bingoSize(room: TlRoom): number {
  const n = room.settings?.bingoSize ?? 5;
  return n >= 3 && n <= 5 ? n : 5;
}
function checkMode(room: TlRoom): BingoCheckMode {
  return room.settings?.bingoCheckMode ?? "track";
}
function winMode(room: TlRoom): BingoWinMode {
  return room.settings?.bingoWinMode ?? "line";
}
function clipSeconds(room: TlRoom): number {
  return room.settings?.bingoClipSeconds ?? 30;
}

// ── Start ───────────────────────────────────────────────────────────────────

/** Called by start.ts once the pool is ready. Builds one board per team,
 *  makes sure every team has a captain, and plays track #1. */
export async function startBingo(
  env: Env, request: Request, room: TlRoom, teams: TlTeam[], players: TlPlayer[], pool: SpotifyTrack[],
): Promise<Response> {
  if (teams.length < 1) return json({ error: "Need at least one team" }, 400, request);
  if (pool.length < BINGO_MIN_TRACKS) {
    return json({ error: `Bingo needs at least ${BINGO_MIN_TRACKS} songs. Add a playlist first.` }, 400, request);
  }

  const size = bingoSize(room);
  const boardPool = pool.slice(0, BINGO_BOARD_POOL_CAP);
  const boards: Array<Pick<TlBingoBoard, "team_id" | "room_id" | "size" | "words">> = [];
  for (const team of teams) {
    const words = generateBoard(boardPool, size);
    if (!words) {
      return json({
        error: `These songs don't have enough different words for a ${size}×${size} board. Add more songs or pick a smaller board.`,
      }, 400, request);
    }
    boards.push({ team_id: team.id, room_id: room.id, size, words });
  }

  // A previous game in this room may have left boards behind if reset
  // didn't run; start clean.
  await req(env, "DELETE", "tl_bingo_marks",  `room_id=eq.${room.id}`);
  await req(env, "DELETE", "tl_bingo_boards", `room_id=eq.${room.id}`);
  await req(env, "POST",   "tl_bingo_boards", "", boards);

  // Same captain auto-assignment as the timeline game: a shared board
  // needs someone to confirm ticks.
  for (const team of teams) {
    const teammates = players.filter(p => p.team_id === team.id && !p.is_spectator);
    if (teammates.length > 0 && !teammates.some(p => p.is_captain)) {
      await updatePlayer(env, (teammates.find(p => !p.is_host) ?? teammates[0]).id, { is_captain: true });
    }
  }

  const round = await playTrack(env, room, teams, players, pool, 0);
  await updateRoom(env, room.id, { status: "playing", active_team_id: teams[0].id });
  return json({ ok: true, round_id: round.id }, 200, request);
}

/** Create the round for pool[index] (track #index+1) and point the room at it. */
async function playTrack(
  env: Env, room: TlRoom, teams: TlTeam[], players: TlPlayer[], pool: SpotifyTrack[], index: number,
): Promise<TlRound> {
  const track = pool[index];
  const clip = clipSeconds(room);
  const round = await createRound(env, {
    room_id:            room.id,
    // tl_rounds.team_id is NOT NULL; bingo songs belong to everyone.
    team_id:            teams[0].id,
    track,
    outcome:            null,
    revealed_at:        null,
    bingo_track_no:     index + 1,
    // The Discord bot and the browser players already honour
    // song_limit_seconds by pausing, so a clip ends even if the host's tab
    // (which drives auto-advance) is asleep.
    song_limit_seconds: clip > 0 ? clip : null,
  });
  await recordPlayedTracks(env, room.id, players.filter(p => !p.is_spectator).map(p => p.id), track.id);
  // all-clients-stream has nobody else to stamp playing_since; the Spotify
  // SDK and the bot stamp it themselves when audio actually starts.
  const autoStart = (room.settings?.audioMode ?? "browser") === "all-clients-stream";
  await updateRoom(env, room.id, {
    current_round_id: round.id,
    track_cursor:     index + 1,
    playing_since:    autoStart ? Date.now() : null,
    paused_at_ms:     null,
  });
  return round;
}

// ── Actions ─────────────────────────────────────────────────────────────────

export interface BingoBody {
  player_id?:         string;
  team_id?:           number;
  cell?:              number;
  track_no?:          number | null;
  pick?:              SearchPickPayload | null;
  mark_id?:           number;
  expected_track_no?: number;
  name?:              string;
}

type Ctx = { env: Env; request: Request; room: TlRoom; body: BingoBody; player: TlPlayer };

export async function handleBingoAction(env: Env, request: Request, room: TlRoom, action: string, body: BingoBody): Promise<Response> {
  if (!isBingo(room)) return json({ error: "This room isn't playing bingo" }, 400, request);
  if (!body.player_id) return json({ error: "player_id required" }, 400, request);
  const players = await req<TlPlayer>(env, "GET", "tl_players", `room_id=eq.${room.id}&select=*`);
  const player = players.find(p => p.id === body.player_id);
  if (!player) return json({ error: "You're not in this room" }, 403, request);
  const ctx: Ctx = { env, request, room, body, player };

  if (action === "add-team") return addTeam(ctx);
  if (room.status !== "playing") return json({ error: "The game isn't running" }, 409, request);
  switch (action) {
    case "next":    return nextTrack(ctx, players);
    case "end":     return endGame(ctx);
    case "suggest": return suggest(ctx);
    case "confirm": return confirm(ctx);
    case "dismiss": return dismiss(ctx);
    case "unmark":  return unmark(ctx);
    default:        return json({ error: `Unknown action ${action}` }, 400, request);
  }
}

const isHostish = (c: Ctx) => c.room.host_id === c.player.id;
const gamemastering = (room: TlRoom) => !!(room.settings?.gamemasterMode || room.settings?.singleScreenMode);

/** Captain of the team, or the host standing in for every captain in
 *  gamemaster mode (mirrors actsAsCaptain in round.ts). */
function canConfirmFor(c: Ctx, teamId: number): boolean {
  if (c.player.team_id === teamId && c.player.is_captain) return true;
  return gamemastering(c.room) && isHostish(c);
}

async function getBoard(env: Env, teamId: number): Promise<TlBingoBoard | null> {
  const rows = await req<TlBingoBoard>(env, "GET", "tl_bingo_boards", `team_id=eq.${teamId}&select=*`);
  return rows[0] ?? null;
}

async function addTeam(c: Ctx): Promise<Response> {
  if (!isHostish(c)) return json({ error: "Only the host can add teams" }, 403, c.request);
  if (c.room.status !== "lobby") return json({ error: "Teams can only be added in the lobby" }, 409, c.request);
  const teams = await req<TlTeam>(c.env, "GET", "tl_teams", `room_id=eq.${c.room.id}&select=id,sort_order`);
  if (teams.length >= BINGO_MAX_TEAMS) return json({ error: `Bingo rooms can have up to ${BINGO_MAX_TEAMS} teams` }, 400, c.request);
  const sortOrder = teams.reduce((m, t) => Math.max(m, t.sort_order), -1) + 1;
  const name = (c.body.name ?? "").trim().slice(0, 30) || `Team ${sortOrder + 1}`;
  await req(c.env, "POST", "tl_teams", "", { room_id: c.room.id, name, tokens: 0, pending_tracks: [], sort_order: sortOrder });
  return json({ ok: true }, 200, c.request);
}

async function nextTrack(c: Ctx, players: TlPlayer[]): Promise<Response> {
  if (!isHostish(c)) return json({ error: "Only the host can change the song" }, 403, c.request);
  // Auto-advance fires from the host's timer; a duplicate tab or a retry
  // must not skip two songs. The client sends the track it saw playing.
  const cursor = c.room.track_cursor ?? 0;
  if (typeof c.body.expected_track_no === "number" && c.body.expected_track_no !== cursor) {
    return json({ ok: true, skipped: true }, 200, c.request);
  }
  const pool = c.room.track_pool ?? [];
  if (cursor >= pool.length) return json({ ok: true, done: true }, 200, c.request);
  const teams = await req<TlTeam>(c.env, "GET", "tl_teams", `room_id=eq.${c.room.id}&order=sort_order.asc&select=*`);
  const round = await playTrack(c.env, c.room, teams, players, pool, cursor);
  return json({ ok: true, round_id: round.id, track_no: cursor + 1 }, 200, c.request);
}

async function endGame(c: Ctx): Promise<Response> {
  if (!isHostish(c)) return json({ error: "Only the host can end the game" }, 403, c.request);
  await updateRoom(c.env, c.room.id, { status: "finished", playing_since: null });
  return json({ ok: true }, 200, c.request);
}

/** Shape checks shared by suggest and confirm. Returns an error message or
 *  null. Deliberately does NOT check the answer — a suggestion must not
 *  leak whether a word is in a track. */
function validateTick(c: Ctx, board: TlBingoBoard, needTrack: boolean, needPick: boolean): string | null {
  const { cell, track_no, pick } = c.body;
  if (typeof cell !== "number" || cell < 0 || cell >= board.size * board.size) return "Unknown square";
  const played = c.room.track_cursor ?? 0;
  if (track_no != null && (!Number.isInteger(track_no) || track_no < 1 || track_no > played)) {
    return `Pick a track between 1 and ${played}`;
  }
  if (needTrack && track_no == null) return "Pick which track the word was in";
  if (needPick && !(pick && typeof pick.title === "string" && typeof pick.artist === "string")) {
    return "Search for the song first";
  }
  return null;
}

function cleanPick(p: SearchPickPayload | null | undefined): SearchPickPayload | null {
  if (!p) return null;
  return {
    ...(typeof p.spotifyId === "string" ? { spotifyId: p.spotifyId.slice(0, 64) } : {}),
    title:  String(p.title).slice(0, 200),
    artist: String(p.artist).slice(0, 200),
  };
}

async function suggest(c: Ctx): Promise<Response> {
  const teamId = c.player.team_id;
  if (teamId == null || c.player.is_spectator) return json({ error: "Join a team to suggest" }, 403, c.request);
  const board = await getBoard(c.env, teamId);
  if (!board) return json({ error: "No board for your team" }, 404, c.request);
  const mode = checkMode(c.room);
  const err = validateTick(c, board, mode !== "off", mode === "search");
  if (err) return json({ error: err }, 400, c.request);
  // One live suggestion per player per square — a new one replaces theirs.
  await req(c.env, "DELETE", "tl_bingo_marks",
    `team_id=eq.${teamId}&cell=eq.${c.body.cell}&player_id=eq.${encodeURIComponent(c.player.id)}&state=eq.suggested`);
  await req(c.env, "POST", "tl_bingo_marks", "", {
    room_id: c.room.id, team_id: teamId, cell: c.body.cell, state: "suggested",
    track_no: c.body.track_no ?? null, pick: cleanPick(c.body.pick),
    player_id: c.player.id, player_name: c.player.name,
  });
  return json({ ok: true }, 200, c.request);
}

/** Check a tick against the room's check mode. Returns null when it
 *  counts, or the reason it doesn't. */
async function checkTick(c: Ctx, word: string): Promise<string | null> {
  const mode = checkMode(c.room);
  if (mode === "off") return null;
  const rounds = await req<TlRound>(c.env, "GET", "tl_rounds",
    `room_id=eq.${c.room.id}&bingo_track_no=eq.${c.body.track_no}&select=track&limit=1`);
  const track = rounds[0]?.track;
  if (!track) return `Track #${c.body.track_no} hasn't played`;
  if (!trackHasWord(track, word, c.room.settings?.bingoWordMatch ?? "partial")) {
    return `"${word}" isn't in track #${c.body.track_no}`;
  }
  if (mode === "search") {
    const pick = cleanPick(c.body.pick)!;
    const accepted = await lookupAcceptedAnswers(c.env, track.id);
    const grade = gradeSearchPick(pick, track.id, track.name, track.artist, accepted);
    if (!(grade.artistCorrect && grade.songnameCorrect)) {
      return `"${pick.title}" by ${pick.artist} isn't track #${c.body.track_no}`;
    }
  }
  return null;
}

async function confirm(c: Ctx): Promise<Response> {
  const teamId = typeof c.body.team_id === "number" ? c.body.team_id : c.player.team_id;
  if (teamId == null) return json({ error: "Which team?" }, 400, c.request);
  if (!canConfirmFor(c, teamId)) return json({ error: "Only the captain can cross words off" }, 403, c.request);

  // Confirming a teammate's suggestion: take its track/pick unless the
  // captain overrode them.
  if (typeof c.body.mark_id === "number") {
    const rows = await req<TlBingoMark>(c.env, "GET", "tl_bingo_marks",
      `id=eq.${c.body.mark_id}&team_id=eq.${teamId}&state=eq.suggested&select=*`);
    const s = rows[0];
    if (!s) return json({ error: "That suggestion is gone" }, 404, c.request);
    c.body.cell     = s.cell;
    c.body.track_no = c.body.track_no ?? s.track_no;
    c.body.pick     = c.body.pick ?? s.pick;
  }

  const board = await getBoard(c.env, teamId);
  if (!board) return json({ error: "No board for this team" }, 404, c.request);
  const mode = checkMode(c.room);
  const err = validateTick(c, board, mode !== "off", mode === "search");
  if (err) return json({ error: err }, 400, c.request);
  const cell = c.body.cell!;
  const word = board.words[cell];

  const markBase = {
    room_id: c.room.id, team_id: teamId, cell,
    track_no: c.body.track_no ?? null, pick: cleanPick(c.body.pick),
    player_id: c.player.id, player_name: c.player.name,
  };

  const reason = await checkTick(c, word);
  if (reason) {
    await req(c.env, "POST", "tl_bingo_marks", "", { ...markBase, state: "rejected" });
    return json({ ok: false, reason }, 200, c.request);
  }

  const existing = await req<TlBingoMark>(c.env, "GET", "tl_bingo_marks",
    `team_id=eq.${teamId}&cell=eq.${cell}&state=eq.confirmed&select=id`);
  if (existing[0]) {
    await req(c.env, "PATCH", "tl_bingo_marks", `id=eq.${existing[0].id}`, markBase);
  } else {
    await req(c.env, "POST", "tl_bingo_marks", "", { ...markBase, state: "confirmed" });
  }
  // The square is settled; clear its pending suggestions and old misses.
  await req(c.env, "DELETE", "tl_bingo_marks", `team_id=eq.${teamId}&cell=eq.${cell}&state=in.(suggested,rejected)`);

  const won = await checkWin(c, board);
  return json({ ok: true, won }, 200, c.request);
}

async function checkWin(c: Ctx, board: TlBingoBoard): Promise<boolean> {
  if (board.won_at) return true;
  const marks = await req<TlBingoMark>(c.env, "GET", "tl_bingo_marks",
    `team_id=eq.${board.team_id}&state=eq.confirmed&select=cell`);
  if (!hasWon(board.size, new Set(marks.map(m => m.cell)), winMode(c.room))) return false;
  await req(c.env, "PATCH", "tl_bingo_boards", `team_id=eq.${board.team_id}`, {
    won_at: new Date().toISOString(), won_track_no: c.room.track_cursor ?? null,
  });
  await updateRoom(c.env, c.room.id, { status: "finished", playing_since: null });
  return true;
}

async function dismiss(c: Ctx): Promise<Response> {
  if (typeof c.body.mark_id !== "number") return json({ error: "mark_id required" }, 400, c.request);
  const rows = await req<TlBingoMark>(c.env, "GET", "tl_bingo_marks",
    `id=eq.${c.body.mark_id}&room_id=eq.${c.room.id}&state=eq.suggested&select=*`);
  const s = rows[0];
  if (!s) return json({ ok: true }, 200, c.request);
  if (s.player_id !== c.player.id && !canConfirmFor(c, s.team_id)) {
    return json({ error: "Only the captain or whoever suggested it can dismiss it" }, 403, c.request);
  }
  await req(c.env, "DELETE", "tl_bingo_marks", `id=eq.${s.id}`);
  return json({ ok: true }, 200, c.request);
}

async function unmark(c: Ctx): Promise<Response> {
  const teamId = typeof c.body.team_id === "number" ? c.body.team_id : c.player.team_id;
  if (teamId == null || typeof c.body.cell !== "number") return json({ error: "team and square required" }, 400, c.request);
  if (!canConfirmFor(c, teamId)) return json({ error: "Only the captain can un-tick a word" }, 403, c.request);
  await req(c.env, "DELETE", "tl_bingo_marks", `team_id=eq.${teamId}&cell=eq.${c.body.cell}&state=eq.confirmed`);
  return json({ ok: true }, 200, c.request);
}
