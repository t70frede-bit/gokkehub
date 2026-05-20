import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button, Panel } from "@gokkehub/ui";
import { supabase } from "../lib/supabase";
import { useHeaderControls, DEFAULT_HEADER_CONTROLS } from "../App";
import type { TlTeam, TlRoom, TlRoomSettings } from "../lib/types";

// Team slot → colour token, matching LobbyPage/GamePage.
const TEAM_PALETTE = ["red", "blue", "green", "yellow"] as const;
function teamColor(sortOrder: number): string {
  return TEAM_PALETTE[sortOrder % TEAM_PALETTE.length];
}

const MEDALS = ["🥇", "🥈", "🥉"] as const;
// Podium step heights by rank (1st, 2nd, 3rd).
const STEP_HEIGHTS = [120, 84, 60];
// Visual left-to-right podium order: runner-up, winner, third.
const PODIUM_ORDER = [1, 0, 2];

const AUTO_RESTART_SECONDS = 30;

// Short triumphant arpeggio via Web Audio — no asset needed. Best-effort:
// if the AudioContext is blocked (no prior user gesture) it silently no-ops.
// The player almost always reaches this screen via a click (placing the
// winning card / advancing the turn) so the context is usually unlocked.
function playVictoryChime() {
  try {
    const Ctx = window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    // C5 E5 G5 C6 — a simple major arpeggio resolving up an octave.
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, i) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = freq;
      const t = now + i * 0.13;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.18, t + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.6);
    });
  } catch { /* autoplay blocked or no Web Audio — fine, finale is silent */ }
}

interface ConfettiPiece {
  left: number; color: string; delay: number; dur: number; drift: number;
}
function makeConfetti(colors: string[]): ConfettiPiece[] {
  return Array.from({ length: 44 }, () => ({
    left:  Math.random() * 100,
    color: colors[Math.floor(Math.random() * colors.length)],
    delay: Math.random() * 0.8,
    dur:   2.2 + Math.random() * 1.8,
    drift: (Math.random() - 0.5) * 120,
  }));
}

export default function EndPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate   = useNavigate();
  const myPlayerId = roomId ? localStorage.getItem(`tl_player_${roomId}`) : null;
  const [teams,   setTeams]   = useState<TlTeam[]>([]);
  const [counts,  setCounts]  = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(true);
  const [hostId,  setHostId]  = useState<string | null>(null);
  // null until the room row loads — keeps the header at its hidden default
  // (no code flash) until we know the real streamer/gamemaster setting.
  const [headerControls, setHeaderState] = useState<{ hideRoomCode: boolean; hideInvite: boolean } | null>(null);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  // Auto-restart (host opt-in): when armed, counts down then fires playAgain.
  const [autoRestart, setAutoRestart] = useState(false);
  const [countdown,   setCountdown]   = useState(AUTO_RESTART_SECONDS);

  const { setHeaderControls } = useHeaderControls();
  useEffect(() => {
    if (!headerControls) return;
    setHeaderControls(headerControls);
    return () => setHeaderControls(DEFAULT_HEADER_CONTROLS);
  }, [headerControls, setHeaderControls]);

  useEffect(() => {
    if (!roomId) return;
    (async () => {
      const [teamsRes, roomRes] = await Promise.all([
        supabase.from("tl_teams").select("*").eq("room_id", roomId).order("sort_order"),
        supabase.from("tl_rooms").select("host_id, settings").eq("id", roomId).single(),
      ]);
      const ts = (teamsRes.data ?? []) as TlTeam[];
      setTeams(ts);
      const room = roomRes.data as Pick<TlRoom, "host_id" | "settings"> | null;
      setHostId(room?.host_id ?? null);
      const s = (room?.settings ?? {}) as TlRoomSettings;
      const gm = !!(s.gamemasterMode || s.singleScreenMode);
      setHeaderState({
        hideRoomCode: !!s.streamerMode || gm,
        hideInvite:   gm,
      });
      const countMap: Record<number, number> = {};
      for (const t of ts) {
        const r = await supabase.from("tl_timeline").select("*", { count: "exact", head: true }).eq("team_id", t.id);
        countMap[t.id] = r.count ?? 0;
      }
      setCounts(countMap);
      setLoading(false);
    })();
  }, [roomId]);

  // Fire the chime once, when results land.
  const chimedRef = useRef(false);
  useEffect(() => {
    if (loading || chimedRef.current) return;
    chimedRef.current = true;
    playVictoryChime();
  }, [loading]);

  async function playAgain() {
    if (!roomId || !myPlayerId) return;
    setResetting(true);
    setResetError(null);
    try {
      const res = await fetch(`/room/${roomId}/reset`, {
        method:      "POST",
        headers:     { "Content-Type": "application/json" },
        credentials: "include",
        body:        JSON.stringify({ player_id: myPlayerId }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        let msg = `Reset failed (${res.status})`;
        try { msg = (JSON.parse(text).error as string) || msg; } catch { /* ignore */ }
        setResetError(msg);
        setResetting(false);
        return;
      }
      navigate(`/lobby/${roomId}`);
    } catch (e) {
      setResetError(e instanceof Error ? e.message : "Network error");
      setResetting(false);
    }
  }

  // Auto-restart countdown tick. Resets to full when disarmed.
  useEffect(() => {
    if (!autoRestart) { setCountdown(AUTO_RESTART_SECONDS); return; }
    if (countdown <= 0) { void playAgain(); return; }
    const id = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(id);
  // playAgain is stable enough for this use; countdown drives the tick.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRestart, countdown]);

  const sorted = useMemo(
    () => [...teams].sort((a, b) => (counts[b.id] ?? 0) - (counts[a.id] ?? 0)),
    [teams, counts],
  );
  const winner = sorted[0];
  const isHost = !!(myPlayerId && hostId && myPlayerId === hostId);

  // Confetti tinted with the winner's colour + amber accents. Built once.
  const confetti = useMemo(() => {
    if (!winner) return [];
    const c = teamColor(winner.sort_order);
    return makeConfetti([
      `rgb(var(--team-${c}-rgb))`,
      "rgb(var(--color-primary-rgb))",
      "rgb(var(--color-secondary-rgb))",
      "rgba(255,255,255,0.85)",
    ]);
  }, [winner]);

  if (loading) return <div className="flex-1 flex items-center justify-center opacity-50">Loading…</div>;

  const podium = PODIUM_ORDER
    .map(rank => ({ rank, team: sorted[rank] }))
    .filter((p): p is { rank: number; team: TlTeam } => !!p.team);
  const rest = sorted.slice(3);

  return (
    <div className="flex-1 flex items-center justify-center p-4 relative overflow-hidden">
      {/* Confetti burst */}
      {confetti.map((p, i) => (
        <span
          key={i}
          className="confetti-piece"
          style={{
            left:            `${p.left}%`,
            background:       p.color,
            // CSS vars consumed by the confettiFall keyframes.
            ["--delay" as string]: `${p.delay}s`,
            ["--dur"   as string]: `${p.dur}s`,
            ["--drift" as string]: `${p.drift}px`,
          }}
        />
      ))}

      <div className="w-full max-w-md space-y-5 text-center relative z-10">
        {/* Winner spotlight */}
        <div className="finale-stamp">
          <div className="text-6xl mb-1">🏆</div>
          <h1 className="text-3xl font-black leading-tight"
            style={{ fontFamily: "var(--font-display)" }}>
            {winner?.name} wins!
          </h1>
          <p className="opacity-60 mt-1">{counts[winner?.id] ?? 0} cards on the timeline</p>
        </div>

        {/* Podium — top 3 as rising steps (runner-up · winner · third). */}
        {podium.length > 0 && (
          <div className="flex items-end justify-center gap-2 sm:gap-3 pt-2">
            {podium.map(({ rank, team }, idx) => {
              const c = teamColor(team.sort_order);
              return (
                <div key={team.id} className="flex flex-col items-center flex-1 max-w-[120px]">
                  <div className="text-2xl mb-1">{MEDALS[rank]}</div>
                  <div className="text-sm font-bold truncate w-full px-1" title={team.name}>
                    {team.name}
                  </div>
                  <div className="text-xs opacity-60 mb-1.5">{counts[team.id] ?? 0} cards</div>
                  <div
                    className="podium-step w-full rounded-t-lg flex items-start justify-center pt-2"
                    style={{
                      height:          `${STEP_HEIGHTS[rank]}px`,
                      background:      `rgba(var(--team-${c}-rgb), ${rank === 0 ? 0.35 : 0.22})`,
                      borderTop:       `3px solid rgb(var(--team-${c}-rgb))`,
                      borderLeft:      "1px solid rgb(var(--border-rgb))",
                      borderRight:     "1px solid rgb(var(--border-rgb))",
                      // Stagger: 2nd & 3rd rise first, winner last.
                      animationDelay:  `${0.15 + idx * 0.12}s`,
                    }}
                  >
                    <span className="text-lg font-black opacity-70">#{rank + 1}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Remaining standings (4th+), only when there are more than 3 teams. */}
        {rest.length > 0 && (
          <Panel className="p-3 text-left">
            {rest.map((t, i) => (
              <div key={t.id} className="flex items-center gap-3 py-1.5"
                style={{ borderBottom: i < rest.length - 1 ? "1px solid rgba(255,255,255,0.06)" : "none" }}>
                <span className="text-sm font-black opacity-40 w-7">#{i + 4}</span>
                <span className="flex-1 font-semibold text-sm">{t.name}</span>
                <span className="font-bold text-sm opacity-70">{counts[t.id] ?? 0} cards</span>
              </div>
            ))}
          </Panel>
        )}

        <div className="flex gap-3 justify-center">
          <Button onClick={() => navigate("/")} variant="ghost">New game</Button>
          <Button
            onClick={playAgain}
            disabled={!isHost || resetting}
            title={!isHost ? "Only the host can restart this room" : undefined}
          >
            {resetting
              ? "Resetting…"
              : autoRestart
                ? `Play again (${countdown}s)`
                : "Play again"}
          </Button>
        </div>

        {/* Host-only auto-restart toggle. Off by default so the table can
            linger on the results; flip it on for back-to-back party rounds. */}
        {isHost && (
          <button
            onClick={() => setAutoRestart(v => !v)}
            className="text-xs font-semibold px-3 py-1.5 rounded-md border transition-all"
            style={{
              borderColor: autoRestart ? "rgba(var(--color-primary-rgb),0.7)" : "rgba(255,255,255,0.12)",
              background:  autoRestart ? "rgba(var(--color-primary-rgb),0.15)" : "transparent",
              color:       autoRestart ? "rgb(var(--color-primary-rgb))" : "rgb(var(--text-muted-rgb))",
            }}
          >
            🔁 Auto-restart {autoRestart ? `in ${countdown}s — tap to cancel` : "off"}
          </button>
        )}

        {resetError && (
          <p className="text-sm" style={{ color: "rgb(var(--color-danger-rgb, 220,60,60))" }}>
            {resetError}
          </p>
        )}
        {!isHost && (
          <p className="text-xs opacity-50">Waiting for the host to start a new game…</p>
        )}
      </div>
    </div>
  );
}
