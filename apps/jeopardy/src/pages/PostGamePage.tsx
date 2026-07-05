import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button, Panel } from "@gokkehub/ui";
import { getStoredPlayerId, useRoom } from "../hooks/useRoom";
import { useHostController } from "../hooks/useHostController";
import { supabase } from "../lib/supabase";
import type { JpGameEvent, JpTeam } from "../lib/types";
import { POWERUP_META } from "../lib/types";

const secondary = { color: "rgb(var(--text-secondary-rgb))" } as const;
const primary   = { color: "rgb(var(--color-primary-rgb))" } as const;

interface StatLine { label: string; team: string; detail: string }

// Distils the jp_game_events log into the spec's stats recap. All counting
// is per team (solo players ARE one-member teams in the current mode).
function computeStats(events: JpGameEvent[], teams: JpTeam[]): StatLine[] {
  const name = (id: number | null) => teams.find(t => t.id === id)?.name ?? "—";
  const byTeam = <T,>(init: () => T): Map<number, T> => {
    const m = new Map<number, T>();
    for (const t of teams) m.set(t.id, init());
    return m;
  };

  const correct = byTeam(() => 0);
  const wrong   = byTeam(() => 0);
  const buzzes  = byTeam(() => 0);
  const streaks = byTeam(() => ({ current: 0, best: 0 }));
  let biggestGain: { teamId: number | null; points: number } = { teamId: null, points: 0 };
  let totalBuzzes = 0;
  const powerupLines: string[] = [];

  for (const e of events) {
    const tid = e.team_id;
    const delta = typeof e.payload?.pointsDelta === "number" ? e.payload.pointsDelta as number : 0;

    if (e.event_type === "answer_correct" || (e.event_type === "final_judged" && e.payload?.correct)) {
      if (tid !== null) {
        correct.set(tid, (correct.get(tid) ?? 0) + 1);
        const s = streaks.get(tid) ?? { current: 0, best: 0 };
        s.current += 1;
        s.best = Math.max(s.best, s.current);
        streaks.set(tid, s);
      }
      if (delta > biggestGain.points) biggestGain = { teamId: tid, points: delta };
    }
    if (e.event_type === "answer_wrong" || (e.event_type === "final_judged" && e.payload?.correct === false)) {
      if (tid !== null) {
        wrong.set(tid, (wrong.get(tid) ?? 0) + 1);
        const s = streaks.get(tid) ?? { current: 0, best: 0 };
        s.current = 0;
        streaks.set(tid, s);
      }
    }
    if (e.event_type === "buzz_win" && tid !== null) {
      buzzes.set(tid, (buzzes.get(tid) ?? 0) + 1);
      totalBuzzes += 1;
    }
    if (e.event_type === "powerup_claimed" || e.event_type === "powerup_swapped") {
      const ptype = e.payload?.powerupType as keyof typeof POWERUP_META | undefined;
      if (ptype && POWERUP_META[ptype]) {
        powerupLines.push(`${name(tid)} claimed ${POWERUP_META[ptype].icon} ${POWERUP_META[ptype].name}`);
      }
    }
  }

  const top = (m: Map<number, number>) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).find(([, v]) => v > 0);

  const lines: StatLine[] = [];
  const mostCorrect = top(correct);
  if (mostCorrect) lines.push({ label: "🎓 Most correct answers", team: name(mostCorrect[0]), detail: `${mostCorrect[1]}` });
  const mostWrong = top(wrong);
  if (mostWrong) lines.push({ label: "🙈 Most wrong answers", team: name(mostWrong[0]), detail: `${mostWrong[1]}` });
  if (biggestGain.teamId !== null) {
    lines.push({ label: "💰 Biggest single gain", team: name(biggestGain.teamId), detail: `+${biggestGain.points}` });
  }
  const bestStreak = [...streaks.entries()].sort((a, b) => b[1].best - a[1].best).find(([, s]) => s.best > 1);
  if (bestStreak) lines.push({ label: "🔥 Longest correct streak", team: name(bestStreak[0]), detail: `${bestStreak[1].best} in a row` });
  const fastest = top(buzzes);
  if (fastest && totalBuzzes > 0) {
    lines.push({
      label: "⚡ Fastest finger",
      team:  name(fastest[0]),
      detail: `won ${Math.round((fastest[1] / totalBuzzes) * 100)}% of buzzes`,
    });
  }
  for (const p of powerupLines.slice(0, 4)) {
    lines.push({ label: "🎁 Power-up", team: p, detail: "" });
  }
  return lines;
}

export default function PostGamePage() {
  const navigate   = useNavigate();
  const { roomId } = useParams();
  const { room, game, teams, loading, error } = useRoom(roomId);

  const playerId = roomId ? getStoredPlayerId(roomId) : null;
  const isHost   = !!room && !!playerId && room.host_id === playerId;
  const { dispatch, busy } = useHostController(roomId, playerId);

  const [events, setEvents] = useState<JpGameEvent[]>([]);

  // Rematch flips the room back to lobby — follow it.
  useEffect(() => {
    if (room?.status === "lobby" && roomId) navigate(`/lobby/${roomId}`, { replace: true });
  }, [room?.status, roomId]);

  useEffect(() => {
    if (!roomId || room?.status !== "finished") return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("jp_game_events").select("*")
        .eq("room_id", roomId).order("created_at", { ascending: true });
      if (!cancelled && data) setEvents(data as JpGameEvent[]);
    })();
    return () => { cancelled = true; };
  }, [roomId, room?.status]);

  const stats = useMemo(() => computeStats(events, teams), [events, teams]);

  if (loading) return <div className="flex-1 flex items-center justify-center opacity-60">Loading…</div>;
  if (error || !room) {
    return <div className="flex-1 flex items-center justify-center">{error ?? "Room not found"}</div>;
  }

  const ranked = [...teams].sort((a, b) => b.score - a.score);
  const winner = ranked[0];

  return (
    <div className="flex-1 w-full max-w-xl mx-auto p-4 sm:p-6 flex flex-col gap-5 justify-center">
      <div className="text-center">
        <p className="text-sm uppercase tracking-widest" style={secondary}>
          {game?.title ?? "Jeopardy"} — final scores
        </p>
        {winner && (
          <h1 className="font-black text-4xl sm:text-6xl mt-2" style={primary}>
            🏆 {winner.name}
          </h1>
        )}
      </div>

      <Panel>
        <ol className="flex flex-col gap-2">
          {ranked.map((t, i) => (
            <li key={t.id} className="flex items-center gap-3 rounded-md px-4 py-3"
              style={{
                border: i === 0
                  ? "1px solid rgb(var(--color-primary-rgb))"
                  : "1px solid rgb(var(--border-rgb))",
                background: i === 0 ? "rgba(var(--color-primary-rgb), 0.08)" : undefined,
              }}
            >
              <span className="font-bold w-8" style={secondary}>{i + 1}.</span>
              <span className="flex-1 font-bold truncate">{t.name}</span>
              <span className="font-black text-xl tabular-nums"
                style={{ color: t.score < 0 ? "rgb(var(--color-danger-rgb))" : "rgb(var(--color-primary-rgb))" }}
              >
                {t.score}
              </span>
            </li>
          ))}
        </ol>
      </Panel>

      {stats.length > 0 && (
        <Panel>
          <h2 className="text-sm font-bold uppercase tracking-widest mb-3" style={secondary}>
            Game recap
          </h2>
          <ul className="flex flex-col gap-2">
            {stats.map((s, i) => (
              <li key={i} className="flex items-center gap-3">
                <span className="flex-1 text-sm" style={secondary}>{s.label}</span>
                <span className="font-bold truncate">{s.team}</span>
                {s.detail && <span className="font-black tabular-nums" style={primary}>{s.detail}</span>}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <div className="flex flex-col items-center gap-2">
        {isHost && (
          <Button size="lg" loading={busy} onClick={() => dispatch({ type: "rematch" })}>
            🔁 Rematch — same board, fresh scores
          </Button>
        )}
        <Link to="/">
          <Button variant="ghost">Back to dashboard</Button>
        </Link>
      </div>
    </div>
  );
}
