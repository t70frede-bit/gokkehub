import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button, Panel } from "@gokkehub/ui";
import { useRoom } from "../hooks/useRoom";
import { useDJAudio, useListenerAudio } from "../hooks/useAudio";
import { useDJWebRTC, useListenerWebRTC } from "../hooks/useWebRTC";
import { supabase } from "../lib/supabase";
import type { TlTimelineEntry, SpotifyTrack } from "../lib/types";

// ── Timer ─────────────────────────────────────────────────────────────────────

function useTimer(startedAt: number | null, onExpire: () => void) {
  const [remaining, setRemaining] = useState(90);
  const expiredRef = useRef(false);

  useEffect(() => {
    if (!startedAt) { setRemaining(90); expiredRef.current = false; return; }
    expiredRef.current = false;
    const tick = () => {
      const elapsed = (Date.now() - startedAt) / 1000;
      const left = Math.max(0, 90 - elapsed);
      setRemaining(left);
      if (left === 0 && !expiredRef.current) {
        expiredRef.current = true;
        onExpire();
      }
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [startedAt, onExpire]);

  return remaining;
}

// ── Timer ring SVG ────────────────────────────────────────────────────────────

function TimerRing({ remaining, total = 90 }: { remaining: number; total?: number }) {
  const R = 18;
  const C = 2 * Math.PI * R;
  const dash = Math.min(1, remaining / total) * C;
  const danger = remaining < 20;

  return (
    <svg width="46" height="46" viewBox="0 0 46 46" style={{ flexShrink: 0 }}>
      <circle cx="23" cy="23" r={R} className="timer-ring-track" strokeWidth="2.5" />
      <circle cx="23" cy="23" r={R}
        className={`timer-ring-fill ${danger ? "danger" : ""}`}
        strokeWidth="2.5"
        style={{
          strokeDasharray: C,
          strokeDashoffset: C - dash,
          transform: "rotate(-90deg)",
          transformOrigin: "23px 23px",
        }}
      />
      <text x="23" y="27.5" textAnchor="middle"
        style={{ fontSize: "11px", fontWeight: 700, fill: danger ? "rgb(220,60,60)" : "rgb(var(--color-secondary-rgb))", fontFamily: "var(--font-mono)" }}>
        {Math.ceil(remaining)}
      </text>
    </svg>
  );
}

// ── Timeline component ────────────────────────────────────────────────────────

interface TimelineProps {
  entries:    TlTimelineEntry[];
  dragCard:   SpotifyTrack | null;
  isCaptain:  boolean;
  onPlace:    (leftYear: number | null, rightYear: number | null) => void;
  pingYears?: number[];
  pending?:   SpotifyTrack[];
}

function Timeline({ entries, dragCard, isCaptain, onPlace, pingYears = [], pending = [] }: TimelineProps) {
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const dragging = useRef(false);

  const sorted = [...entries].sort((a, b) => a.year - b.year);
  const gaps   = sorted.length + 1;

  function getYearsForGap(gapIdx: number): [number | null, number | null] {
    return [sorted[gapIdx - 1]?.year ?? null, sorted[gapIdx]?.year ?? null];
  }

  function confirmPlacement(gapIdx: number) {
    const [left, right] = getYearsForGap(gapIdx);
    onPlace(left, right);
    setSelected(null);
  }

  return (
    <div>
      {/* Ping year badges */}
      {pingYears.length > 0 && (
        <div className="flex gap-1.5 mb-2 flex-wrap">
          {pingYears.map((y, i) => (
            <span key={i} className="text-xs px-2 py-0.5 rounded-full"
              style={{
                background: "rgba(var(--color-secondary-rgb), 0.12)",
                color: "rgb(var(--color-secondary-rgb))",
                border: "1px solid rgba(var(--color-secondary-rgb), 0.2)",
              }}>
              📍 {y}
            </span>
          ))}
        </div>
      )}

      {/* Timeline rail */}
      <div className="timeline-rail">
        {Array.from({ length: gaps }).map((_, gapIdx) => {
          const card   = sorted[gapIdx];
          const isOver = dragOver === gapIdx;
          const isSel  = selected === gapIdx;

          return (
            <div key={gapIdx} className="flex items-center flex-shrink-0">
              {/* Gap */}
              {isCaptain && dragCard ? (
                <div
                  className={`tl-gap ${isOver ? "dropping" : ""} ${isSel ? "active" : ""}`}
                  onDragOver={e => { e.preventDefault(); setDragOver(gapIdx); }}
                  onDragLeave={() => setDragOver(null)}
                  onDrop={() => { setDragOver(null); confirmPlacement(gapIdx); }}
                  onClick={() => setSelected(selected === gapIdx ? null : gapIdx)}
                >
                  {(isOver || isSel) ? (
                    <div className="flex flex-col items-center gap-1 p-1">
                      {isSel ? (
                        <button onClick={e => { e.stopPropagation(); confirmPlacement(gapIdx); }}
                          className="text-xs px-2 py-1 rounded-lg font-bold whitespace-nowrap"
                          style={{ background: "rgb(var(--color-primary-rgb))", color: "#000" }}>
                          Place here
                        </button>
                      ) : (
                        <span style={{ color: "rgb(var(--color-primary-rgb))", fontSize: "16px" }}>↓</span>
                      )}
                    </div>
                  ) : (
                    <span className="tl-gap-dot" />
                  )}
                </div>
              ) : (
                <div className="tl-gap" style={{ cursor: "default" }}>
                  <span className="tl-gap-dot" />
                </div>
              )}

              {/* Existing locked card */}
              {card && (
                <div className="flex-shrink-0 mx-0.5">
                  <TrackCard entry={card} />
                </div>
              )}
            </div>
          );
        })}

        {/* Draggable ??? card */}
        {isCaptain && dragCard && (
          <div
            draggable
            className="flex-shrink-0 mx-2"
            onDragStart={() => { dragging.current = true; }}
            onDragEnd={() => { dragging.current = false; setDragOver(null); }}
          >
            <QuestionCard track={dragCard} />
          </div>
        )}

        {/* Pending cards */}
        {pending.length > 0 && (
          <div className="flex items-center gap-1 flex-shrink-0 ml-2 pl-2"
            style={{ borderLeft: "1px dashed rgba(var(--color-secondary-rgb), 0.2)" }}>
            {pending.map((t, i) => (
              <div key={`${t.id}-${i}`} className="pending-card-wrap flex-shrink-0">
                <div className="track-card" style={{ opacity: 0.7 }}>
                  <img src={t.coverUrl} alt="" className="w-full aspect-square object-cover" style={{ opacity: 0.5 }} />
                  <div className="p-1.5">
                    <p className="text-xs font-black" style={{ color: "rgb(var(--color-secondary-rgb))" }}>?</p>
                    <p className="text-xs truncate opacity-70">{t.artist}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TrackCard({ entry }: { entry: TlTimelineEntry }) {
  return (
    <div className="track-card">
      <img src={entry.track.coverUrl} alt="" className="w-full aspect-square object-cover" />
      <div className="p-1.5">
        <p className="text-xs font-black" style={{ color: "rgb(var(--color-secondary-rgb))", fontFamily: "var(--font-mono)" }}>
          {entry.year}
        </p>
        <p className="text-xs truncate opacity-70">{entry.track.artist}</p>
        <p className="text-xs truncate opacity-45">{entry.track.name}</p>
      </div>
    </div>
  );
}

function QuestionCard(_: { track: SpotifyTrack }) {
  return (
    <div className="question-card">
      <div className="w-full aspect-square flex items-center justify-center"
        style={{ background: "rgba(255,255,255,0.04)" }}>
        <span className="text-2xl">🎵</span>
      </div>
      <div className="p-1.5">
        <p className="text-sm font-black" style={{ color: "rgb(var(--color-primary-rgb))", fontFamily: "var(--font-mono)" }}>???</p>
        <p className="text-xs opacity-30">Place your guess</p>
      </div>
    </div>
  );
}

// ── Audio Player ──────────────────────────────────────────────────────────────

interface AudioPlayerProps {
  isDJ:        boolean;
  isMyTurn:    boolean;
  trackUri:    string | null;
  playingSince: number | null;
  pausedAtMs:  number | null;
  onPlay:      (uri: string) => void;
  onPause:     () => void;
  onSeek:      (ms: number) => void;
  volume:      number;
  onVolume:    (v: number) => void;
  durationMs:  number;
  positionMs:  number;
  djReady:     boolean;
  onCapture:   () => void;
  streaming:   boolean;
  listenerConnected: boolean;
}

function AudioPlayerUI(props: AudioPlayerProps) {
  const {
    isDJ, trackUri, onPlay, onPause, onSeek, volume, onVolume,
    durationMs, positionMs, djReady, onCapture, streaming, listenerConnected,
  } = props;

  const playing = props.playingSince !== null && props.pausedAtMs === null;

  function fmt(ms: number) {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }

  const pct = durationMs > 0 ? (positionMs / durationMs) * 100 : 0;

  return (
    <Panel className="p-4 space-y-3">

      {isDJ && !streaming && (
        <div className="text-center">
          <p className="text-xs opacity-60 mb-2">Share your tab audio so everyone can hear. Chrome required.</p>
          <Button size="sm" variant="ghost" onClick={onCapture}>🎧 Share tab audio</Button>
        </div>
      )}

      {!isDJ && !listenerConnected && (
        <p className="text-xs text-center opacity-50">Waiting for host audio…</p>
      )}

      {/* Playback row */}
      <div className="flex items-center gap-3">
        {/* Play/pause — DJ only */}
        {isDJ ? (
          playing ? (
            <button onClick={onPause}
              className="w-10 h-10 rounded-full flex items-center justify-center text-lg flex-shrink-0"
              style={{ background: "rgb(var(--color-primary-rgb))", color: "#000" }}>
              ⏸
            </button>
          ) : (
            <button onClick={() => trackUri && onPlay(trackUri)}
              disabled={!djReady || !trackUri}
              className="w-10 h-10 rounded-full flex items-center justify-center text-lg flex-shrink-0 disabled:opacity-30"
              style={{ background: "rgb(var(--color-primary-rgb))", color: "#000" }}>
              ▶
            </button>
          )
        ) : (
          /* Listener waveform / idle indicator */
          playing ? (
            <div className="wave-bars flex-shrink-0">
              {Array.from({ length: 7 }).map((_, i) => <span key={i} className="wave-bar" />)}
            </div>
          ) : (
            <div className="flex gap-0.5 items-end flex-shrink-0" style={{ height: 20 }}>
              {[10, 16, 20, 14, 18, 12, 8].map((h, i) => (
                <span key={i} className="block w-[3px] rounded-[1.5px]"
                  style={{ height: h, background: "rgba(255,255,255,0.1)" }} />
              ))}
            </div>
          )
        )}

        {/* Progress bar + waveform (DJ has waveform when playing) */}
        <div className="flex-1 space-y-1.5">
          {isDJ && playing && (
            <div className="wave-bars">
              {Array.from({ length: 7 }).map((_, i) => <span key={i} className="wave-bar" />)}
            </div>
          )}
          <div className="relative h-1.5 rounded-full overflow-hidden cursor-pointer"
            style={{ background: "rgba(255,255,255,0.08)" }}
            onClick={e => {
              if (!isDJ || durationMs === 0) return;
              const rect = e.currentTarget.getBoundingClientRect();
              onSeek(Math.floor(((e.clientX - rect.left) / rect.width) * durationMs));
            }}>
            <div className="absolute left-0 top-0 h-full rounded-full"
              style={{ width: `${pct}%`, background: "rgb(var(--color-primary-rgb))" }} />
          </div>
        </div>

        {/* Time */}
        <div className="text-right text-xs opacity-40 flex-shrink-0" style={{ fontFamily: "var(--font-mono)" }}>
          <div>{fmt(positionMs)}</div>
          <div>{fmt(durationMs)}</div>
        </div>
      </div>

      {/* Volume + streaming status */}
      <div className="flex items-center gap-2">
        <span className="text-xs opacity-40">🔈</span>
        <input type="range" min="0" max="1" step="0.05" value={volume}
          onChange={e => onVolume(Number(e.target.value))}
          className="flex-1 orange-range" />
        <span className="text-xs opacity-40">🔊</span>
        {isDJ && streaming && (
          <span className="ml-2 text-xs" style={{ color: "rgb(var(--color-success-rgb, 40,180,60))" }}>● live</span>
        )}
      </div>
    </Panel>
  );
}

// ── Reveal overlay ────────────────────────────────────────────────────────────

interface RevealProps {
  track:        SpotifyTrack;
  outcome:      "correct" | "incorrect";
  actualYear:   number;
  isActiveTeam: boolean;
  pendingCount: number;
  tokens:       number;
  onStop:       () => void;
  onToken:      () => void;
  onNext:       () => void;
}

function RevealOverlay({ track, outcome, actualYear, isActiveTeam, pendingCount, tokens, onStop, onToken, onNext }: RevealProps) {
  const isCorrect = outcome === "correct";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.85)", backdropFilter: "blur(10px)" }}>
      <div className="w-full max-w-sm text-center space-y-4">

        <img src={track.coverUrl} alt=""
          className="w-20 h-20 rounded-xl object-cover mx-auto"
          style={{ opacity: 0.7 }} />

        {/* Year stamp */}
        <div className="stamp-in">
          <div className="inline-block px-6 py-3 rounded-xl"
            style={{
              background: isCorrect ? "rgba(var(--color-success-rgb, 40,180,60), 0.1)" : "rgba(var(--color-danger-rgb, 220,60,60), 0.1)",
              border: `2px solid ${isCorrect ? "rgba(40,180,60,0.5)" : "rgba(220,60,60,0.5)"}`,
            }}>
            <p style={{ fontFamily: "var(--font-mono)", fontSize: "36px", fontWeight: 700,
              color: isCorrect ? "rgb(40,180,60)" : "rgb(220,60,60)", lineHeight: 1 }}>
              {actualYear}
            </p>
          </div>
        </div>

        <div>
          <p className="font-bold text-lg">{track.name}</p>
          <p className="text-sm opacity-60">{track.artist}</p>
        </div>

        {!isCorrect && (
          <div className="rounded-xl p-3"
            style={{ background: "rgba(220,60,60,0.1)", border: "1px solid rgba(220,60,60,0.2)" }}>
            <p className="text-sm font-semibold text-red-400">
              Wrong placement — {pendingCount > 0 ? `${pendingCount} pending card${pendingCount > 1 ? "s" : ""} lost` : "turn ends"}
            </p>
          </div>
        )}

        {isCorrect && isActiveTeam && (
          <div className="space-y-2">
            <p className="text-sm opacity-60">{pendingCount} card{pendingCount !== 1 ? "s" : ""} this turn</p>
            <div className="grid grid-cols-3 gap-2">
              <Button onClick={onStop} variant="ghost" size="sm" className="flex-col gap-0.5 py-3">
                <span className="text-lg">🛑</span>
                <span className="text-xs">Stop & lock</span>
              </Button>
              <Button onClick={onToken} variant="ghost" size="sm" disabled={tokens <= 0}
                className="flex-col gap-0.5 py-3">
                <span className="text-lg">🪙</span>
                <span className="text-xs">Token ({tokens})</span>
              </Button>
              <Button onClick={onNext} size="sm" className="flex-col gap-0.5 py-3">
                <span className="text-lg">▶</span>
                <span className="text-xs">Next song</span>
              </Button>
            </div>
            <p className="text-xs opacity-40">
              Token: lock cards + skip song · Next: risk losing all {pendingCount} cards
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main GamePage ─────────────────────────────────────────────────────────────

export default function GamePage() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate   = useNavigate();
  const myPlayerId = roomId ? localStorage.getItem(`tl_player_${roomId}`) ?? undefined : undefined;

  const { state } = useRoom(roomId, myPlayerId);

  const [noteText,   setNoteText]   = useState("");
  const [pingYear,   setPingYear]   = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [revealData, setRevealData] = useState<{ outcome: "correct" | "incorrect"; year: number } | null>(null);

  const [djStream,  setDjStream]  = useState<MediaStream | null>(null);
  const [streaming, setStreaming] = useState(false);

  const onDJStateChange = useCallback((playing: boolean, positionMs: number) => {
    if (!roomId) return;
    const newSince = playing ? Date.now() - positionMs : null;
    const paused   = playing ? null : positionMs;
    supabase.from("tl_rooms").update({ playing_since: newSince, paused_at_ms: paused }).eq("id", roomId);
  }, [roomId]);

  const djAudio     = useDJAudio(onDJStateChange);
  const listenAudio = useListenerAudio();

  const isDJ       = state?.myPlayer?.is_host ?? false;
  const isMyTurn   = !!(state?.room.active_team_id && state.myPlayer?.team_id === state.room.active_team_id);
  const iAmCaptain = state?.myPlayer?.is_captain ?? false;

  useDJWebRTC(isDJ ? roomId : undefined, isDJ ? myPlayerId : undefined, djStream);
  useListenerWebRTC(!isDJ ? roomId : undefined, !isDJ ? myPlayerId : undefined, listenAudio.setStream);

  useEffect(() => {
    if (state?.room.status === "finished") navigate(`/end/${roomId}`);
  }, [state?.room.status, roomId, navigate]);

  async function handleCapture() {
    const stream = await djAudio.captureStream();
    if (stream) { setDjStream(stream); setStreaming(true); }
  }

  const onTimerExpire = useCallback(async () => {
    if (!isMyTurn || !iAmCaptain || !state?.round || state.round.outcome !== null) return;
    await fetch(`/room/${roomId}/round?action=place`, {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify({ round_id: state.round.id, left_year: null, right_year: null, player_id: myPlayerId }),
    });
  }, [isMyTurn, iAmCaptain, state?.round, roomId, myPlayerId]);

  const timerStartedAt = state?.room.playing_since ?? null;
  const remaining = useTimer(timerStartedAt, onTimerExpire);

  if (!state) return <div className="flex-1 flex items-center justify-center opacity-50">Loading…</div>;

  const { room, teams, round, timelines, notes, pings, myPlayer } = state;
  const activeTeam = teams.find(t => t.id === room.active_team_id);
  const pingYears  = pings.map(p => p.year);

  async function submitPlacement(leftYear: number | null, rightYear: number | null) {
    if (!round || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/room/${roomId}/round?action=place`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ round_id: round.id, left_year: leftYear, right_year: rightYear, player_id: myPlayerId }),
      });
      const data = await res.json() as { outcome: "correct" | "incorrect"; actual_year: number };
      setRevealData({ outcome: data.outcome, year: data.actual_year });
    } finally {
      setSubmitting(false);
    }
  }

  async function doTurnAction(action: "stop" | "token" | "next") {
    setRevealData(null);
    await fetch(`/room/${roomId}/round?action=turn`, {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify({ action, player_id: myPlayerId }),
    });
  }

  async function sendNote() {
    if (!noteText.trim() || !round || !myPlayer) return;
    await supabase.from("tl_notes").insert({
      round_id: round.id, player_id: myPlayer.id, player_name: myPlayer.name, content: noteText.trim(),
    });
    setNoteText("");
  }

  async function sendPing() {
    const yr = parseInt(pingYear, 10);
    if (isNaN(yr) || yr < 1900 || yr > 2025 || !round || !myPlayer) return;
    await supabase.from("tl_pings").insert({
      round_id: round.id, player_id: myPlayer.id, player_name: myPlayer.name, year: yr,
    });
    setPingYear("");
  }

  return (
    <div className="flex-1 flex flex-col p-3 gap-3 max-w-4xl mx-auto w-full">

      {/* ── Turn banner ───────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between rounded-xl px-4 py-2.5"
        style={{
          background: isMyTurn ? "rgba(var(--color-primary-rgb), 0.12)" : "rgba(var(--surface-raised-rgb), 0.3)",
          border: `1px solid ${isMyTurn ? "rgba(var(--color-primary-rgb), 0.35)" : "rgba(255,255,255,0.06)"}`,
        }}>
        <div>
          <p className="text-xs opacity-50">{isMyTurn ? "Your turn!" : `${activeTeam?.name ?? "…"}'s turn`}</p>
          <p className="font-bold text-sm">{activeTeam?.name}</p>
        </div>
        <div className="flex items-center gap-3">
          {teams.map(t => (
            <div key={t.id} className="flex items-center gap-1 text-xs opacity-60">
              <span className="font-semibold">{t.name.slice(0, 8)}</span>
              <span>{"🪙".repeat(t.tokens)}</span>
            </div>
          ))}
          {timerStartedAt && <TimerRing remaining={remaining} />}
        </div>
      </div>

      {/* ── Audio player ─────────────────────────────────────────────────── */}
      <AudioPlayerUI
        isDJ={isDJ}
        isMyTurn={isMyTurn}
        trackUri={round?.track.uri ?? null}
        playingSince={room.playing_since}
        pausedAtMs={room.paused_at_ms}
        onPlay={djAudio.play}
        onPause={djAudio.pause}
        onSeek={djAudio.seek}
        volume={isDJ ? djAudio.volume : listenAudio.volume}
        onVolume={isDJ ? djAudio.setVolume : listenAudio.setVolume}
        durationMs={djAudio.durationMs}
        positionMs={djAudio.positionMs}
        djReady={djAudio.ready}
        onCapture={handleCapture}
        streaming={streaming}
        listenerConnected={listenAudio.connected}
      />

      {/* ── Current song ─────────────────────────────────────────────────── */}
      {round && (
        <div className="flex items-center gap-3 rounded-xl p-3"
          style={{ background: "rgba(var(--surface-raised-rgb), 0.3)", border: "1px solid rgba(255,255,255,0.06)" }}>
          {round.outcome === null ? (
            <div className="w-12 h-12 rounded-lg flex-shrink-0 flex items-center justify-center"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
              <span className="text-xl">🎵</span>
            </div>
          ) : (
            <img src={round.track.coverUrl} alt=""
              className="w-12 h-12 rounded-lg object-cover flex-shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            {round.outcome === null ? (
              <p className="text-sm opacity-50 italic">Listen and guess the year…</p>
            ) : (
              <>
                <p className="font-bold" style={{ color: "rgb(var(--color-secondary-rgb))", fontFamily: "var(--font-mono)" }}>
                  {round.track.releaseYear}
                </p>
                <p className="font-semibold truncate">{round.track.artist} — {round.track.name}</p>
              </>
            )}
          </div>
          {round.outcome === null && isMyTurn && !iAmCaptain && (
            <p className="text-xs opacity-50 flex-shrink-0">Waiting for captain…</p>
          )}
        </div>
      )}

      {/* ── Teams' timelines ─────────────────────────────────────────────── */}
      <div className="space-y-3">
        {teams.map(team => {
          const tl           = timelines[team.id] ?? [];
          const isActive     = team.id === room.active_team_id;
          const pending      = team.pending_tracks ?? [];
          const showDragCard = isActive && round && round.outcome === null;
          const isMyTeam     = myPlayer?.team_id === team.id;

          return (
            <Panel key={team.id} className="p-3">
              <div className="flex items-center gap-2 mb-2">
                <p className="font-semibold text-sm">{team.name}</p>
                {isActive && (
                  <span className="text-xs px-1.5 py-0.5 rounded-full font-bold"
                    style={{ background: "rgba(var(--color-primary-rgb),0.2)", color: "rgb(var(--color-primary-rgb))" }}>
                    Active
                  </span>
                )}
                <span className="text-xs opacity-40 ml-auto">
                  {tl.length} locked
                  {pending.length > 0 && <span style={{ color: "rgb(var(--color-secondary-rgb))" }}> · {pending.length} pending</span>}
                </span>
              </div>

              {tl.length === 0 && !showDragCard ? (
                <p className="text-xs opacity-30 italic">No cards yet</p>
              ) : (
                <Timeline
                  entries={tl}
                  dragCard={showDragCard && isMyTeam && iAmCaptain ? round.track : null}
                  isCaptain={iAmCaptain && isMyTeam && isActive}
                  onPlace={submitPlacement}
                  pingYears={isMyTeam ? pingYears : []}
                  pending={pending as SpotifyTrack[]}
                />
              )}
            </Panel>
          );
        })}
      </div>

      {/* ── Round chat ────────────────────────────────────────────────────── */}
      <Panel className="p-3 space-y-3">
        <p className="text-xs font-semibold opacity-50 uppercase tracking-wider">Round chat</p>

        <div className="space-y-1 max-h-36 overflow-y-auto">
          {notes.length === 0 && <p className="text-xs opacity-30 italic">No notes yet…</p>}
          {notes.map(n => (
            <div key={n.id} className="note-enter text-sm">
              <span className="font-semibold opacity-70">{n.player_name}: </span>
              <span>{n.content}</span>
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          <input
            value={noteText}
            onChange={e => setNoteText(e.target.value)}
            onKeyDown={e => e.key === "Enter" && sendNote()}
            placeholder="Type a hint, song name, year…"
            maxLength={100}
            className="flex-1 rounded-lg px-3 py-1.5 text-sm outline-none"
            style={{
              background: "rgba(var(--surface-raised-rgb),0.5)",
              border:     "1px solid rgba(255,255,255,0.1)",
              color:      "inherit",
            }}
          />
          <button onClick={sendNote}
            className="px-3 py-1.5 rounded-lg text-sm font-medium"
            style={{ background: "rgba(var(--color-primary-rgb),0.2)", color: "rgb(var(--color-primary-rgb))" }}>
            Send
          </button>
        </div>

        <div className="flex gap-2 items-center">
          <span className="text-xs opacity-40">📍 Pin a year:</span>
          <input
            type="number"
            value={pingYear}
            onChange={e => setPingYear(e.target.value)}
            onKeyDown={e => e.key === "Enter" && sendPing()}
            placeholder="e.g. 1991"
            min={1900} max={2025}
            className="w-24 rounded-lg px-2 py-1 text-sm outline-none"
            style={{
              background: "rgba(var(--surface-raised-rgb),0.5)",
              border:     "1px solid rgba(255,255,255,0.1)",
              color:      "inherit",
              fontFamily: "var(--font-mono)",
            }}
          />
          <button onClick={sendPing}
            className="px-2 py-1 rounded text-xs font-bold"
            style={{ background: "rgba(var(--color-secondary-rgb),0.15)", color: "rgb(var(--color-secondary-rgb))" }}>
            Pin
          </button>
        </div>
      </Panel>

      {/* Reveal overlay */}
      {revealData && round && (
        <RevealOverlay
          track={round.track}
          outcome={revealData.outcome}
          actualYear={revealData.year}
          isActiveTeam={isMyTurn}
          pendingCount={activeTeam?.pending_tracks?.length ?? 0}
          tokens={activeTeam?.tokens ?? 0}
          onStop={() => doTurnAction("stop")}
          onToken={() => doTurnAction("token")}
          onNext={() => doTurnAction("next")}
        />
      )}

      {revealData?.outcome === "incorrect" && (
        <AutoDismiss onDismiss={() => setRevealData(null)} ms={3000} />
      )}

      {/* Hidden audio element — required for WebRTC stream playback on listener clients */}
      {!isDJ && <audio ref={listenAudio.audioRef} style={{ display: "none" }} />}
    </div>
  );
}

function AutoDismiss({ onDismiss, ms }: { onDismiss: () => void; ms: number }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, ms);
    return () => clearTimeout(t);
  }, [onDismiss, ms]);
  return null;
}
