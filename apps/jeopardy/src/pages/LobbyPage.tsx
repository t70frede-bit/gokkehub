import { useEffect } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button, Panel } from "@gokkehub/ui";
import { getStoredPlayerId, useRoom } from "../hooks/useRoom";
import { useHostController } from "../hooks/useHostController";

export default function LobbyPage() {
  const navigate   = useNavigate();
  const { roomId } = useParams();
  const { room, players, loading, error } = useRoom(roomId);

  const playerId = roomId ? getStoredPlayerId(roomId) : null;
  const isHost   = !!room && !!playerId && room.host_id === playerId;
  const { dispatch, busy, error: actionError } = useHostController(roomId, playerId);

  // Follow the room's status wherever it goes.
  useEffect(() => {
    if (!room || !roomId) return;
    if (room.status === "playing")  navigate(isHost ? `/host/${roomId}` : `/play/${roomId}`, { replace: true });
    if (room.status === "finished") navigate(`/end/${roomId}`, { replace: true });
  }, [room?.status, roomId, isHost]);

  if (loading) return <div className="flex-1 flex items-center justify-center opacity-60">Loading…</div>;
  if (error || !room) {
    return <div className="flex-1 flex items-center justify-center">{error ?? "Room not found"}</div>;
  }

  const contestants = players.filter(p => p.id !== room.host_id);

  return (
    <div className="flex-1 w-full max-w-2xl mx-auto p-4 sm:p-6 flex flex-col gap-5">
      <Panel className="text-center">
        <p className="text-sm uppercase tracking-widest" style={{ color: "rgb(var(--text-secondary-rgb))" }}>
          Room code
        </p>
        <p className="font-mono font-black text-5xl sm:text-6xl my-2"
          style={{ color: "rgb(var(--color-primary-rgb))" }}
        >
          {room.id}
        </p>
        <p className="text-sm" style={{ color: "rgb(var(--text-secondary-rgb))" }}>
          Join at <span className="font-bold">gokkehub.com/join</span>
        </p>
      </Panel>

      <Panel>
        <h2 className="text-lg font-bold mb-3">Players ({contestants.length})</h2>
        {contestants.length === 0 && (
          <p style={{ color: "rgb(var(--text-secondary-rgb))" }}>Waiting for players to join…</p>
        )}
        <ul className="flex flex-col gap-2">
          {contestants.map(p => (
            <li key={p.id} className="rounded-md px-3 py-2 font-semibold"
              style={{ border: "1px solid rgb(var(--border-rgb))" }}
            >
              {p.name}
            </li>
          ))}
        </ul>
      </Panel>

      {isHost ? (
        <Panel>
          <div className="flex flex-col gap-3">
            <Button fullWidth size="lg" loading={busy} disabled={contestants.length === 0}
              onClick={() => dispatch({ type: "start" })}
            >
              Start game
            </Button>
            <Button fullWidth variant="ghost" onClick={() => window.open(`/screen/${room.id}`, "_blank")}>
              Open big screen (on the TV)
            </Button>
            {actionError && (
              <p className="text-sm" style={{ color: "rgb(var(--color-danger-rgb))" }}>{actionError}</p>
            )}
          </div>
        </Panel>
      ) : !playerId ? (
        <Panel className="text-center">
          <p className="mb-3" style={{ color: "rgb(var(--text-secondary-rgb))" }}>
            You're viewing this lobby — join to play.
          </p>
          <Link to={`/join?room=${room.id}`}>
            <Button fullWidth>Join this game</Button>
          </Link>
        </Panel>
      ) : (
        <p className="text-center" style={{ color: "rgb(var(--text-secondary-rgb))" }}>
          Waiting for the host to start…
        </p>
      )}
    </div>
  );
}
