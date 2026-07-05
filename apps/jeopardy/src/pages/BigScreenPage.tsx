import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useRoom } from "../hooks/useRoom";
import BoardGrid from "../components/Board/BoardGrid";
import QuestionOverlay from "../components/Board/QuestionOverlay";
import PodiumStrip from "../components/Podium/PodiumStrip";
import AnswerTimer from "../components/AnswerTimer";

// Passive TV display: no interaction, driven entirely by realtime state.
export default function BigScreenPage() {
  const navigate   = useNavigate();
  const { roomId } = useParams();
  const { room, game, teams, players, loading, error } = useRoom(roomId);

  useEffect(() => {
    if (room?.status === "finished" && roomId) navigate(`/end/${roomId}`, { replace: true });
  }, [room?.status, roomId]);

  if (loading) return <div className="flex-1 flex items-center justify-center opacity-60">Loading…</div>;
  if (error || !room || !game) {
    return <div className="flex-1 flex items-center justify-center">{error ?? "Room not found"}</div>;
  }

  const state = room.board_state;
  const board = game.config.boards[state.currentBoard];
  const q     = state.activeQuestion;
  const tile  = q ? board.tiles[q.tileKey] : null;
  const buzzedTeam = q && q.buzzedBy !== null ? teams.find(t => t.id === q.buzzedBy) : null;
  const contestants = players.filter(p => p.id !== room.host_id);

  if (room.status === "lobby") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-8 p-10">
        <h1 className="text-3xl font-bold" style={{ color: "rgb(var(--text-secondary-rgb))" }}>
          {game.title}
        </h1>
        <div className="text-center">
          <p className="text-xl uppercase tracking-widest" style={{ color: "rgb(var(--text-secondary-rgb))" }}>
            Join at gokkehub.com/join with code
          </p>
          <p className="font-mono font-black text-[10rem] leading-none"
            style={{ color: "rgb(var(--color-primary-rgb))" }}
          >
            {room.id}
          </p>
        </div>
        <div className="flex flex-wrap gap-3 justify-center max-w-4xl">
          {contestants.map(p => (
            <span key={p.id} className="rounded-full px-5 py-2 text-xl font-bold"
              style={{ background: "rgb(var(--surface-raised-rgb))", border: "1px solid rgb(var(--border-rgb))" }}
            >
              {p.name}
            </span>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 relative flex flex-col gap-4 p-4 sm:p-8">
      <div className="flex-1 flex items-center">
        <BoardGrid board={board} state={state} />
      </div>
      <PodiumStrip teams={teams} players={players} buzzedTeamId={q?.buzzedBy ?? null} />

      {q && tile && (
        <QuestionOverlay
          category={state.revealedCategories.includes(Number(q.tileKey.split("-")[0]))
            ? board.categories[Number(q.tileKey.split("-")[0])]
            : "???"}
          value={board.pointValues[Number(q.tileKey.split("-")[1])] ?? 0}
          blocks={tile.questionBlocks}
        >
          <div className="min-h-20 flex flex-col items-center justify-center gap-2">
            {buzzedTeam ? (
              <>
                <p className="jp-podium-buzzed rounded-lg px-8 py-3 font-black text-2xl sm:text-4xl"
                  style={{
                    background: "rgba(var(--color-primary-rgb), 0.15)",
                    border:     "1px solid rgb(var(--color-primary-rgb))",
                    color:      "rgb(var(--color-primary-rgb))",
                  }}
                >
                  {buzzedTeam.name}
                </p>
                <AnswerTimer startMs={q.timerStart} />
              </>
            ) : state.buzzersOpen ? (
              <p className="font-bold text-xl sm:text-3xl animate-pulse"
                style={{ color: "rgb(var(--color-primary-rgb))" }}
              >
                BUZZ NOW!
              </p>
            ) : (
              <p className="text-lg sm:text-2xl" style={{ color: "rgb(var(--text-secondary-rgb))" }}>
                Get ready…
              </p>
            )}
          </div>
        </QuestionOverlay>
      )}
    </div>
  );
}
