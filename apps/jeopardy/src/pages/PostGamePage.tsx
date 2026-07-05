import { Link, useParams } from "react-router-dom";
import { Button, Panel } from "@gokkehub/ui";
import { useRoom } from "../hooks/useRoom";

export default function PostGamePage() {
  const { roomId } = useParams();
  const { room, game, teams, loading, error } = useRoom(roomId);

  if (loading) return <div className="flex-1 flex items-center justify-center opacity-60">Loading…</div>;
  if (error || !room) {
    return <div className="flex-1 flex items-center justify-center">{error ?? "Room not found"}</div>;
  }

  const ranked = [...teams].sort((a, b) => b.score - a.score);
  const winner = ranked[0];

  return (
    <div className="flex-1 w-full max-w-xl mx-auto p-4 sm:p-6 flex flex-col gap-5 justify-center">
      <div className="text-center">
        <p className="text-sm uppercase tracking-widest" style={{ color: "rgb(var(--text-secondary-rgb))" }}>
          {game?.title ?? "Jeopardy"} — final scores
        </p>
        {winner && (
          <h1 className="font-black text-4xl sm:text-6xl mt-2"
            style={{ color: "rgb(var(--color-primary-rgb))" }}
          >
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
              <span className="font-bold w-8" style={{ color: "rgb(var(--text-secondary-rgb))" }}>
                {i + 1}.
              </span>
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

      <Link to="/" className="self-center">
        <Button variant="ghost">Back to dashboard</Button>
      </Link>
    </div>
  );
}
