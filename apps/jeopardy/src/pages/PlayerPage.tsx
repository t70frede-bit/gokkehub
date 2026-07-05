import { useEffect, useMemo } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "@gokkehub/ui";
import { getStoredPlayerId, useRoom } from "../hooks/useRoom";
import { useBuzzer } from "../hooks/useBuzzer";
import BuzzerButton from "../components/BuzzerButton";
import AnswerTimer from "../components/AnswerTimer";

export default function PlayerPage() {
  const navigate   = useNavigate();
  const { roomId } = useParams();
  const { room, teams, players, loading, error } = useRoom(roomId);

  const playerId = roomId ? getStoredPlayerId(roomId) : null;
  const me       = useMemo(() => players.find(p => p.id === playerId) ?? null, [players, playerId]);
  const myTeam   = useMemo(() => teams.find(t => t.id === me?.team_id) ?? null, [teams, me]);

  const { phase, buzz, inFlight } = useBuzzer(room, playerId, me?.team_id ?? null);

  useEffect(() => {
    if (!room || !roomId) return;
    if (room.status === "lobby")    navigate(`/lobby/${roomId}`, { replace: true });
    if (room.status === "finished") navigate(`/end/${roomId}`, { replace: true });
  }, [room?.status, roomId]);

  if (loading) return <div className="flex-1 flex items-center justify-center opacity-60">Loading…</div>;
  if (error || !room) {
    return <div className="flex-1 flex items-center justify-center">{error ?? "Room not found"}</div>;
  }
  if (!playerId || !me) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6">
        <p style={{ color: "rgb(var(--text-secondary-rgb))" }}>You haven't joined this game yet.</p>
        <Link to={`/join?room=${room.id}`}><Button>Join room {room.id}</Button></Link>
      </div>
    );
  }

  const q = room.board_state.activeQuestion;

  return (
    <div className="flex-1 w-full max-w-md mx-auto p-4 flex flex-col gap-4">
      <div className="flex justify-between items-center rounded-lg px-4 py-3"
        style={{ background: "rgb(var(--surface-raised-rgb))", border: "1px solid rgb(var(--border-rgb))" }}
      >
        <span className="font-bold truncate">{me.name}</span>
        <span className="font-black text-xl tabular-nums"
          style={{ color: (myTeam?.score ?? 0) < 0 ? "rgb(var(--color-danger-rgb))" : "rgb(var(--color-primary-rgb))" }}
        >
          {myTeam?.score ?? 0}
        </span>
      </div>

      <BuzzerButton phase={phase} inFlight={inFlight} onBuzz={buzz} />

      {phase === "you-buzzed" && (
        <div className="text-center">
          <p className="font-bold mb-1">Answer out loud — the host judges!</p>
          <AnswerTimer startMs={q?.timerStart ?? null} />
        </div>
      )}
    </div>
  );
}
