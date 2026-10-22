import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Badge, Button, Modal, Panel } from "@gokkehub/ui";
import { useRoom } from "../hooks/useRoom";
import { useBingo } from "../hooks/useBingo";
import { useDJAudio } from "../hooks/useAudio";
import { useHeaderControls, DEFAULT_HEADER_CONTROLS } from "../App";
import { supabase } from "../lib/supabase";
import { completedLines, describeBingo } from "../lib/bingo";
import { DEFAULT_TL_SETTINGS } from "../lib/types";
import type { TlBingoBoard, TlBingoMark, TlRoom, TlRound, TlTeam, SpotifyTrack } from "../lib/types";
import { AllClientsAudio } from "../components/AllClientsAudio";
import { TrackSearchField, type TrackSearchResult } from "../components/TrackSearchField";

// ── Music Bingo game page ─────────────────────────────────────────────────────
// Every team has its own word board. The host's device drives the songs:
// each one plays for settings.bingoClipSeconds, then the host's client asks
// the server for the next one. Everyone sees the current "Track #N".
//
// Ticking a word: teammates SUGGEST (word + track number [+ searched song]),
// the captain CONFIRMS. The server checks the confirm against the room's
// check mode — see functions/_bingo.ts. A ticked word shows its track
// number underneath; tapping it lets the captain change it.

const TEAM_RGB_VAR: Record<string, string> = {
  red: "--team-red-rgb", blue: "--team-blue-rgb", green: "--team-green-rgb", yellow: "--team-yellow-rgb",
};
const PALETTE = ["red", "blue", "green", "yellow"];
function teamRgb(team: Pick<TlTeam, "color" | "sort_order"> | undefined): string {
  const c = team?.color && TEAM_RGB_VAR[team.color] ? team.color : PALETTE[(team?.sort_order ?? 0) % PALETTE.length];
  return `var(${TEAM_RGB_VAR[c]})`;
}

/** Seconds into the current song, from the room's shared play clock. */
function elapsedSec(room: TlRoom, now: number): number {
  if (room.playing_since) return Math.max(0, (now - room.playing_since) / 1000);
  return (room.paused_at_ms ?? 0) / 1000;
}

async function post(roomId: string, action: string, body: Record<string, unknown>): Promise<{ ok: boolean; error?: string; reason?: string; won?: boolean }> {
  try {
    const res = await fetch(`/room/${roomId}/bingo?action=${action}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({})) as { ok?: boolean; error?: string; reason?: string; won?: boolean };
    if (!res.ok) return { ok: false, error: data.error ?? `HTTP ${res.status}` };
    return { ok: data.ok !== false, reason: data.reason, won: data.won };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── Host Spotify playback (audioMode "browser") ──────────────────────────────
// Only the host's tab runs the Spotify SDK; it starts every new song itself.
function HostSpotifyPlayer({ roomId, round }: { roomId: string; round: TlRound | null }) {
  const onState = useCallback((playing: boolean, positionMs: number) => {
    void supabase.from("tl_rooms").update({
      playing_since: playing ? Date.now() - positionMs : null,
      paused_at_ms:  playing ? null : positionMs,
    }).eq("id", roomId);
  }, [roomId]);
  const dj = useDJAudio(onState);
  const startedRef = useRef<number | null>(null);
  useEffect(() => {
    if (!dj.ready || !round?.track?.uri) return;
    if (startedRef.current === round.id) return;
    startedRef.current = round.id;
    void dj.play(round.track.uri);
  }, [dj.ready, round?.id, round?.track?.uri, dj]);

  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-md"
      style={{ background: "rgb(var(--surface-raised-rgb))", border: "1px solid rgb(var(--border-rgb))" }}>
      <span>🎵</span>
      <p className="text-xs flex-1 opacity-70">
        {dj.ready ? "Playing from your Spotify. Share your audio so everyone hears it." : "Connecting to Spotify…"}
      </p>
      {dj.ready && round?.track?.uri && (
        <button
          onClick={async () => {
            if (dj.playing) { await dj.pause(); return; }
            // The SDK has no resume via this hook: restart the song and jump back.
            const at = dj.positionMs;
            await dj.play(round.track.uri);
            if (at > 0) await dj.seek(at);
          }}
          className="w-9 h-9 rounded-full flex items-center justify-center"
          style={{ background: "rgb(var(--color-primary-rgb))", color: "#000" }}
          title={dj.playing ? "Pause" : "Play"}
        >
          {dj.playing ? "⏸" : "▶"}
        </button>
      )}
    </div>
  );
}

// ── Board ────────────────────────────────────────────────────────────────────

function wordFontSize(size: number, len: number): string {
  // Sized against the square itself (container query units) so a word
  // always fits on one line: bold glyphs average ~0.62em wide.
  const max = size >= 5 ? 15 : 18;
  return `min(${max}px, ${(100 / (Math.max(len, 4) * 0.62)).toFixed(1)}cqw)`;
}

function BoardGrid({
  board, marks, accent, onCell,
}: {
  board:  TlBingoBoard;
  marks:  TlBingoMark[];
  accent: string;
  onCell: (cell: number) => void;
}) {
  const confirmed = useMemo(() => new Map(marks.filter(m => m.state === "confirmed").map(m => [m.cell, m])), [marks]);
  const lineCells = useMemo(
    () => new Set(completedLines(board.size, new Set(confirmed.keys())).flat()),
    [board.size, confirmed],
  );
  return (
    <div className="grid gap-1.5 w-full mx-auto" style={{ gridTemplateColumns: `repeat(${board.size}, minmax(0, 1fr))`, maxWidth: 560 }}>
      {board.words.map((word, cell) => {
        const tick = confirmed.get(cell);
        const suggestions = marks.filter(m => m.cell === cell && m.state === "suggested");
        const misses = marks.filter(m => m.cell === cell && m.state === "rejected").length;
        const inLine = lineCells.has(cell);
        return (
          <button
            key={cell}
            onClick={() => onCell(cell)}
            className="relative aspect-square rounded-lg flex flex-col items-center justify-center p-1 text-center transition-transform active:scale-95"
            style={{
              containerType: "inline-size",
              background: tick ? `rgba(${accent}, ${inLine ? 0.45 : 0.25})` : "rgba(255,255,255,0.04)",
              border:     `1.5px solid ${tick ? `rgba(${accent}, 0.9)` : suggestions.length ? "rgba(var(--color-secondary-rgb),0.6)" : "rgba(255,255,255,0.12)"}`,
            }}
          >
            <span
              className="font-bold leading-tight whitespace-nowrap w-full"
              style={{
                // Shrink long words instead of breaking them mid-word on phones.
                fontSize:       wordFontSize(board.size, word.length),
                textDecoration: tick ? "line-through" : "none",
                opacity:        tick ? 0.85 : 1,
              }}
            >
              {word}
            </span>
            {tick?.track_no != null && (
              <span className="mt-1 px-1.5 rounded text-[10px] font-mono font-bold"
                style={{ background: `rgba(${accent}, 0.9)`, color: "#000" }}>
                #{tick.track_no}
              </span>
            )}
            {!tick && suggestions.length > 0 && (
              <span className="absolute top-0.5 right-1 text-[10px]" title={suggestions.map(s => s.player_name).join(", ")}>
                💡{suggestions.length}
              </span>
            )}
            {!tick && misses > 0 && (
              <span className="absolute bottom-0.5 left-1 text-[10px] text-red-400" title="Rejected attempts">✗{misses}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── Tick dialog ──────────────────────────────────────────────────────────────

function TickModal({
  open, onClose, word, cell, roomId, myPlayerId, teamId, isCaptain, checkMode,
  playedCount, currentMark, suggestions,
}: {
  open:        boolean;
  onClose:     () => void;
  word:        string;
  cell:        number;
  roomId:      string;
  myPlayerId:  string;
  teamId:      number;
  isCaptain:   boolean;
  checkMode:   "off" | "track" | "search";
  playedCount: number;
  currentMark: TlBingoMark | undefined;
  suggestions: TlBingoMark[];
}) {
  const [trackNo, setTrackNo] = useState<number | null>(null);
  const [pick,    setPick]    = useState<TrackSearchResult | null>(null);
  const [busy,    setBusy]    = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTrackNo(currentMark?.track_no ?? (checkMode === "off" ? null : playedCount || null));
    setPick(null);
    setMessage(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, cell]);

  const needTrack = checkMode !== "off";
  const needPick  = checkMode === "search";
  const ready = (!needTrack || trackNo != null) && (!needPick || pick != null);

  async function run(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true); setMessage(null);
    const r = await post(roomId, action, {
      player_id: myPlayerId, team_id: teamId, cell, track_no: trackNo,
      pick: pick ? { title: pick.title, artist: pick.artist, spotifyId: pick.spotifyId } : null,
      ...extra,
    });
    setBusy(false);
    if (r.error)  { setMessage(`⚠️ ${r.error}`); return; }
    if (!r.ok)    { setMessage(`❌ ${r.reason ?? "That doesn't count"}`); return; }
    onClose();
  }

  const numbers = Array.from({ length: playedCount }, (_, i) => playedCount - i);

  return (
    <Modal open={open} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div>
          <p className="text-xs uppercase tracking-wide opacity-50">{currentMark ? "Crossed off" : "Cross off"}</p>
          <h2 className="font-extrabold text-2xl" style={{ fontFamily: "var(--font-display)" }}>{word}</h2>
        </div>

        {/* Track number — newest first, since it's usually the song playing now. */}
        <div>
          <p className="text-sm font-medium mb-2">
            Which track was it in?{!needTrack && <span className="opacity-50"> (optional)</span>}
          </p>
          <div className="flex gap-1.5 flex-wrap max-h-32 overflow-y-auto">
            {numbers.map(n => {
              const active = trackNo === n;
              return (
                <button key={n} onClick={() => setTrackNo(active && !needTrack ? null : n)}
                  className="min-w-[44px] px-2 py-1.5 rounded-md text-sm font-bold font-mono border"
                  style={{
                    borderColor: active ? "rgba(var(--color-primary-rgb),0.8)" : "rgba(255,255,255,0.12)",
                    background:  active ? "rgba(var(--color-primary-rgb),0.2)" : "transparent",
                  }}>
                  #{n}
                </button>
              );
            })}
          </div>
        </div>

        {needPick && (
          <TrackSearchField label="Find the song" pick={pick} onPick={setPick} />
        )}

        {isCaptain && suggestions.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-medium">Team suggestions</p>
            {suggestions.map(s => (
              <div key={s.id} className="flex items-center gap-2 px-3 py-2 rounded-md text-sm"
                style={{ background: "rgba(var(--color-secondary-rgb),0.10)", border: "1px solid rgba(var(--color-secondary-rgb),0.3)" }}>
                <span className="flex-1 min-w-0 truncate">
                  <strong>{s.player_name}</strong>
                  {s.track_no != null && <> · #{s.track_no}</>}
                  {s.pick && <> · {s.pick.title} ({s.pick.artist})</>}
                </span>
                <Button size="sm" disabled={busy} onClick={() => run("confirm", { mark_id: s.id, track_no: null, pick: null })}>✓</Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => run("dismiss", { mark_id: s.id })}>✕</Button>
              </div>
            ))}
          </div>
        )}

        {message && <p className="text-sm">{message}</p>}

        <div className="flex gap-2 flex-wrap">
          {isCaptain ? (
            <Button className="flex-1" disabled={!ready || busy} loading={busy} onClick={() => run("confirm")}>
              {currentMark ? "Save" : "✓ Cross it off"}
            </Button>
          ) : (
            <Button className="flex-1" disabled={!ready || busy} loading={busy} onClick={() => run("suggest")}>
              💡 Suggest to captain
            </Button>
          )}
          {isCaptain && currentMark && (
            <Button variant="danger" disabled={busy} onClick={() => run("unmark")}>Un-tick</Button>
          )}
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
        {!isCaptain && (
          <p className="text-xs opacity-50">Your captain decides which words get crossed off.</p>
        )}
      </div>
    </Modal>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function BingoPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate   = useNavigate();
  const myPlayerId = roomId ? localStorage.getItem(`tl_player_${roomId}`) ?? undefined : undefined;
  const { state, error } = useRoom(roomId, myPlayerId);
  const { boards, marks } = useBingo(roomId);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  const [openCell,    setOpenCell]    = useState<number | null>(null);
  const [viewTeamId,  setViewTeamId]  = useState<number | null>(null);
  const [hostBusy,    setHostBusy]    = useState(false);
  const [hostError,   setHostError]   = useState<string | null>(null);
  const [playedTracks, setPlayedTracks] = useState<Array<{ no: number; track: SpotifyTrack }>>([]);

  // Header: same room-code rules as the other pages.
  const { setHeaderControls } = useHeaderControls();
  const loaded = !!state;
  const streamer = !!state?.room.settings?.streamerMode;
  const gm = !!(state?.room.settings?.gamemasterMode || state?.room.settings?.singleScreenMode);
  useEffect(() => {
    if (!loaded) return;
    setHeaderControls({ hideRoomCode: streamer || gm, hideInvite: gm });
    return () => setHeaderControls(DEFAULT_HEADER_CONTROLS);
  }, [loaded, streamer, gm, setHeaderControls]);

  // Back to the lobby when the host resets the room; timeline rooms don't belong here.
  useEffect(() => {
    if (!state) return;
    if (state.room.settings?.gameMode !== "bingo") navigate(`/game/${roomId}`, { replace: true });
    else if (state.room.status === "lobby") navigate(`/lobby/${roomId}`, { replace: true });
  }, [state?.room.status, state?.room.settings?.gameMode, roomId, navigate, state]);

  const room     = state?.room;
  const round    = state?.round ?? null;
  const settings = { ...DEFAULT_TL_SETTINGS, ...(room?.settings ?? {}) };
  const isHost   = !!state?.myPlayer?.is_host;
  const finished = room?.status === "finished";
  const trackNo  = room?.track_cursor ?? 0;

  // Clip length for the current song. "Full song" uses the track's own
  // duration (falls back to 3 min when the source didn't give one).
  const clipSec = settings.bingoClipSeconds > 0
    ? settings.bingoClipSeconds
    : Math.round((round?.track?.durationMs ?? 180_000) / 1000);
  const elapsed = room ? elapsedSec(room, now) : 0;
  const remaining = Math.max(0, Math.ceil(clipSec - elapsed));
  const paused = !!room && room.playing_since === null;

  const next = useCallback(async (expected?: number) => {
    if (!roomId || !myPlayerId) return;
    setHostBusy(true); setHostError(null);
    const r = await post(roomId, "next", { player_id: myPlayerId, expected_track_no: expected });
    setHostBusy(false);
    if (r.error) setHostError(r.error);
  }, [roomId, myPlayerId]);

  // Host auto-advance. Fires once per track when the clip runs out; the
  // server ignores it if the track already moved on (expected_track_no).
  const advancedForRef = useRef<number | null>(null);
  useEffect(() => {
    if (!isHost || finished || !room || !round) return;
    if (round.bingo_track_no !== trackNo) return;          // round row not caught up yet
    if (elapsed < clipSec) return;
    if (advancedForRef.current === trackNo) return;
    advancedForRef.current = trackNo;
    void next(trackNo);
  }, [isHost, finished, room, round, trackNo, elapsed, clipSec, next]);

  // Pause/resume the shared play clock. The Discord bot follows it; in
  // Spotify mode the host's player bar pauses the SDK instead (its state
  // changes drive the clock), so this button is hidden there.
  async function togglePause() {
    if (!room || !roomId) return;
    const patch = paused
      ? { playing_since: Date.now() - (room.paused_at_ms ?? 0), paused_at_ms: null }
      : { playing_since: null, paused_at_ms: Math.round(elapsed * 1000) };
    await supabase.from("tl_rooms").update(patch).eq("id", roomId);
  }

  async function endGame() {
    if (!roomId || !myPlayerId) return;
    if (!window.confirm("End the game for everyone?")) return;
    await post(roomId, "end", { player_id: myPlayerId });
  }

  async function playAgain() {
    if (!roomId || !myPlayerId) return;
    await fetch(`/room/${roomId}/reset`, {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify({ player_id: myPlayerId }),
    });
  }

  // Reveal every played song once the game is over.
  useEffect(() => {
    if (!finished || !roomId) return;
    supabase.from("tl_rounds").select("bingo_track_no, track").eq("room_id", roomId)
      .not("bingo_track_no", "is", null).order("bingo_track_no")
      .then(r => setPlayedTracks(((r.data ?? []) as Array<{ bingo_track_no: number; track: SpotifyTrack }>)
        .map(x => ({ no: x.bingo_track_no, track: x.track }))));
  }, [finished, roomId]);

  if (error)  return <div className="p-8 text-center">Error: {error}</div>;
  if (!state || !room || !roomId) return <div className="p-8 text-center opacity-60">Loading…</div>;

  const me = state.myPlayer;
  const teams = state.teams;
  // Which board is on screen: your own; gamemasters, spectators and the
  // end screen can flip between teams.
  const ownTeamId = me && !me.is_spectator ? me.team_id : null;
  const shownTeamId = viewTeamId ?? ownTeamId ?? boards[0]?.team_id ?? null;
  const board  = boards.find(b => b.team_id === shownTeamId);
  const team   = teams.find(t => t.id === shownTeamId);
  const accent = teamRgb(team);
  const boardMarks = marks.filter(m => m.team_id === shownTeamId);
  const isOwnBoard = shownTeamId != null && shownTeamId === ownTeamId;
  const canCaptain = (isOwnBoard && !!me?.is_captain) || (gm && isHost);
  const canTouch   = !finished && (isOwnBoard || (gm && isHost));
  const captain    = state.players.find(p => p.team_id === shownTeamId && p.is_captain);
  const winners    = boards.filter(b => b.won_at).map(b => teams.find(t => t.id === b.team_id)).filter(Boolean) as TlTeam[];
  const d = describeBingo(settings);

  const audioMode = settings.audioMode;
  const playsHere = audioMode === "all-clients-stream" && (!settings.bingoHostOnlyAudio || isHost);

  return (
    <div className="p-3 sm:p-4 max-w-3xl mx-auto w-full flex flex-col gap-3">

      {/* Now playing — the one thing every screen must show. */}
      <Panel className="p-3 sm:p-4">
        <div className="flex items-center gap-4">
          <div className="text-center">
            <p className="text-[10px] uppercase tracking-widest opacity-50">Track</p>
            <p className="font-extrabold leading-none" style={{ fontSize: "clamp(40px, 12vw, 64px)", fontFamily: "var(--font-mono)", color: "rgb(var(--color-primary-rgb))" }}>
              #{trackNo}
            </p>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">
              {finished ? "Game over" : paused ? "⏸ Paused" : "🎵 Now playing"}
            </p>
            {!finished && (
              <>
                <div className="h-1.5 rounded-full overflow-hidden mt-2" style={{ background: "rgba(255,255,255,0.08)" }}>
                  <div className="h-full rounded-full transition-[width] duration-500"
                    style={{ width: `${Math.min(100, (elapsed / clipSec) * 100)}%`, background: "rgb(var(--color-primary-rgb))" }} />
                </div>
                <p className="text-xs mt-1 opacity-60 font-mono">
                  Next song in {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}
                </p>
              </>
            )}
            <p className="text-[11px] mt-1 opacity-50">
              {d.board} · win with {d.win} · {d.check}
            </p>
          </div>
        </div>

        {isHost && !finished && (
          <div className="flex gap-2 mt-3 flex-wrap">
            {audioMode !== "browser" && (
              <Button size="sm" variant="ghost" onClick={togglePause}>{paused ? "▶ Resume" : "⏸ Pause"}</Button>
            )}
            <Button size="sm" variant="ghost" loading={hostBusy} onClick={() => next(trackNo)}>⏭ Next song</Button>
            <Button size="sm" variant="danger" onClick={endGame}>End game</Button>
          </div>
        )}
        {hostError && <p className="text-xs text-red-400 mt-2">⚠️ {hostError}</p>}
        {isHost && !finished && trackNo >= (room.track_pool?.length ?? 0) && (
          <p className="text-xs text-amber-400 mt-2">That was the last song in the pool.</p>
        )}
      </Panel>

      {/* Audio */}
      {!finished && round?.track && (
        <>
          {audioMode === "all-clients-stream" && playsHere && (
            <AllClientsAudio track={round.track} coverRevealed={false} canScrub={isHost} />
          )}
          {audioMode === "browser" && isHost && <HostSpotifyPlayer roomId={roomId} round={round} />}
          {audioMode === "discord-bot" && (
            <p className="text-xs text-center opacity-60">🤖 The songs are playing in Discord.</p>
          )}
          {((audioMode === "all-clients-stream" && !playsHere) || (audioMode === "browser" && !isHost)) && (
            <p className="text-xs text-center opacity-60">🔊 Listen on the host's speakers.</p>
          )}
        </>
      )}

      {/* Winner + the full song list */}
      {finished && (
        <Panel className="p-4 text-center">
          <p className="text-4xl mb-1">🎉</p>
          <h2 className="font-extrabold text-2xl" style={{ fontFamily: "var(--font-display)" }}>
            {winners.length ? `${winners.map(t => t.name).join(" & ")} got BINGO!` : "Game over"}
          </h2>
          {playedTracks.length > 0 && (
            <ol className="text-left text-sm mt-4 flex flex-col gap-1 max-h-72 overflow-y-auto">
              {playedTracks.map(({ no, track }) => (
                <li key={no} className="flex gap-2">
                  <span className="font-mono font-bold w-10 flex-shrink-0 opacity-60">#{no}</span>
                  <span className="min-w-0"><strong>{track.name}</strong> <span className="opacity-60">· {track.artist}</span></span>
                </li>
              ))}
            </ol>
          )}
          <div className="flex gap-2 justify-center mt-4">
            {isHost && <Button onClick={playAgain}>Play again</Button>}
            <Button variant="ghost" onClick={() => navigate("/")}>Home</Button>
          </div>
        </Panel>
      )}

      {/* Team switcher for gamemasters, spectators and the end screen. */}
      {(gm || ownTeamId == null || finished) && teams.length > 1 && (
        <div className="flex gap-2 flex-wrap justify-center">
          {teams.map(t => {
            const active = t.id === shownTeamId;
            return (
              <button key={t.id} onClick={() => setViewTeamId(t.id)}
                className="px-3 py-1.5 rounded-full text-sm font-semibold border"
                style={{
                  borderColor: active ? `rgba(${teamRgb(t)}, 0.9)` : "rgba(255,255,255,0.12)",
                  background:  active ? `rgba(${teamRgb(t)}, 0.2)` : "transparent",
                }}>
                {t.name}
              </button>
            );
          })}
        </div>
      )}

      {/* Board */}
      {board ? (
        <Panel className="p-3 sm:p-4">
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <span className="w-3 h-3 rounded-full" style={{ background: `rgb(${accent})` }} />
            <h2 className="font-bold">{team?.name ?? "Board"}</h2>
            {canCaptain && !finished && <Badge variant="host">CAPTAIN</Badge>}
            <span className="text-xs opacity-50 ml-auto">
              {captain ? `Captain: ${captain.name}` : ""}
            </span>
          </div>
          <BoardGrid board={board} marks={boardMarks} accent={accent}
            onCell={cell => { if (canTouch) setOpenCell(cell); }} />
          {canTouch && (
            <p className="text-xs text-center mt-3 opacity-50">
              {canCaptain
                ? "Tap a word to cross it off. Tap a crossed word to change its track number."
                : "Tap a word to suggest it to your captain."}
            </p>
          )}
        </Panel>
      ) : (
        <Panel className="p-4 text-center text-sm opacity-60">
          {me?.is_spectator ? "You're watching. Pick a team above to see its board." : "Waiting for your board…"}
        </Panel>
      )}

      {/* Scoreboard */}
      {teams.length > 1 && (
        <div className="flex gap-2 flex-wrap justify-center text-xs">
          {teams.map(t => {
            const b = boards.find(x => x.team_id === t.id);
            const ticked = new Set(marks.filter(m => m.team_id === t.id && m.state === "confirmed").map(m => m.cell));
            const lines = b ? completedLines(b.size, ticked).length : 0;
            return (
              <span key={t.id} className="px-2.5 py-1 rounded-full"
                style={{ background: `rgba(${teamRgb(t)}, 0.15)`, border: `1px solid rgba(${teamRgb(t)}, 0.4)` }}>
                {t.name}: {ticked.size}{b ? `/${b.size * b.size}` : ""}{lines ? ` · ${lines} line${lines > 1 ? "s" : ""}` : ""}
              </span>
            );
          })}
        </div>
      )}

      {board && openCell !== null && myPlayerId && shownTeamId != null && (
        <TickModal
          open
          onClose={() => setOpenCell(null)}
          word={board.words[openCell]}
          cell={openCell}
          roomId={roomId}
          myPlayerId={myPlayerId}
          teamId={shownTeamId}
          isCaptain={canCaptain}
          checkMode={settings.bingoCheckMode}
          playedCount={trackNo}
          currentMark={boardMarks.find(m => m.cell === openCell && m.state === "confirmed")}
          suggestions={boardMarks.filter(m => m.cell === openCell && m.state === "suggested")}
        />
      )}
    </div>
  );
}
