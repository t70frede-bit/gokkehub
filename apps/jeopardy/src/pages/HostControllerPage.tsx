import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button, Modal, Panel } from "@gokkehub/ui";
import { getStoredPlayerId, useRoom } from "../hooks/useRoom";
import { useHostController } from "../hooks/useHostController";
import BoardGrid from "../components/Board/BoardGrid";
import AnswerTimer from "../components/AnswerTimer";

export default function HostControllerPage() {
  const navigate   = useNavigate();
  const { roomId } = useParams();
  const { room, game, teams, loading, error } = useRoom(roomId);

  const playerId = roomId ? getStoredPlayerId(roomId) : null;
  const { dispatch, busy, error: actionError } = useHostController(roomId, playerId);

  const [scoreEdit, setScoreEdit] = useState<{ teamId: number; value: string } | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);

  useEffect(() => {
    if (!room || !roomId) return;
    if (room.status === "lobby")    navigate(`/lobby/${roomId}`, { replace: true });
    if (room.status === "finished") navigate(`/end/${roomId}`, { replace: true });
  }, [room?.status, roomId]);

  if (loading) return <div className="flex-1 flex items-center justify-center opacity-60">Loading…</div>;
  if (error || !room || !game) {
    return <div className="flex-1 flex items-center justify-center">{error ?? "Room not found"}</div>;
  }
  if (!playerId || room.host_id !== playerId) {
    return <div className="flex-1 flex items-center justify-center">This view is for the host's phone.</div>;
  }

  const state = room.board_state;
  const board = game.config.boards[state.currentBoard];
  const q     = state.activeQuestion;
  const tile  = q ? board.tiles[q.tileKey] : null;
  const value = q ? board.pointValues[Number(q.tileKey.split("-")[1])] ?? 0 : 0;
  const buzzedTeam = q?.buzzedBy !== null && q ? teams.find(t => t.id === q.buzzedBy) : null;
  const allRevealed = state.revealedCategories.length >= board.categories.length;

  return (
    <div className="flex-1 w-full max-w-xl mx-auto p-3 sm:p-6 flex flex-col gap-4">
      {q && tile ? (
        /* ── Active question ─────────────────────────────────────────── */
        <>
          <Panel>
            <p className="text-xs uppercase tracking-widest mb-1"
              style={{ color: "rgb(var(--text-secondary-rgb))" }}
            >
              {board.categories[Number(q.tileKey.split("-")[0])]} — {value}
            </p>
            {tile.questionBlocks.map(b => (
              <p key={b.id} className="font-bold text-lg leading-snug">{b.text}</p>
            ))}
            <div className="mt-3 rounded-md px-3 py-2"
              style={{ background: "rgba(var(--color-primary-rgb), 0.12)", border: "1px solid rgba(var(--color-primary-rgb), 0.4)" }}
            >
              <p className="text-xs uppercase tracking-widest"
                style={{ color: "rgb(var(--text-secondary-rgb))" }}
              >
                Answer
              </p>
              {tile.answerBlocks.map(b => (
                <p key={b.id} className="font-bold" style={{ color: "rgb(var(--color-primary-rgb))" }}>
                  {b.text || "—"}
                </p>
              ))}
            </div>
          </Panel>

          {buzzedTeam ? (
            <Panel className="text-center">
              <p className="font-black text-2xl mb-1" style={{ color: "rgb(var(--color-primary-rgb))" }}>
                {buzzedTeam.name}
              </p>
              <AnswerTimer startMs={q.timerStart} />
              <div className="flex gap-3 mt-4">
                <Button fullWidth size="lg" loading={busy}
                  onClick={() => dispatch({ type: "accept_answer" })}
                >
                  ✓ Correct (+{value})
                </Button>
                <Button fullWidth size="lg" variant="danger" loading={busy}
                  onClick={() => dispatch({ type: "reject_answer" })}
                >
                  ✗ Wrong (−{value})
                </Button>
              </div>
            </Panel>
          ) : (
            <Panel>
              <div className="flex flex-col gap-3">
                {state.buzzersOpen ? (
                  <p className="text-center font-bold text-lg animate-pulse"
                    style={{ color: "rgb(var(--color-primary-rgb))" }}
                  >
                    Buzzers open…
                  </p>
                ) : (
                  <Button fullWidth size="lg" loading={busy}
                    onClick={() => dispatch({ type: "open_buzzers" })}
                  >
                    Open buzzers
                  </Button>
                )}
                <Button fullWidth variant="ghost" loading={busy}
                  onClick={() => dispatch({ type: "dismiss_question" })}
                >
                  Nobody knows it — close question
                </Button>
              </div>
            </Panel>
          )}
        </>
      ) : (
        /* ── Board ───────────────────────────────────────────────────── */
        <>
          <Panel variant="bare" className="p-3">
            <BoardGrid compact board={board} state={state}
              onTileSelect={key => dispatch({ type: "select_tile", tileKey: key })}
            />
            {!allRevealed && (
              <Button fullWidth variant="ghost" size="sm" className="mt-3" loading={busy}
                onClick={() => dispatch({ type: "reveal_all_categories" })}
              >
                Reveal categories
              </Button>
            )}
          </Panel>

          <Panel>
            <h2 className="text-sm font-bold uppercase tracking-widest mb-2"
              style={{ color: "rgb(var(--text-secondary-rgb))" }}
            >
              Scores (tap to edit)
            </h2>
            <ul className="flex flex-col gap-1.5">
              {teams.map(t => (
                <li key={t.id}>
                  <button type="button" className="w-full flex justify-between rounded-md px-3 py-2 font-semibold"
                    style={{ border: "1px solid rgb(var(--border-rgb))" }}
                    onClick={() => setScoreEdit({ teamId: t.id, value: String(t.score) })}
                  >
                    <span>{t.name}</span>
                    <span className="tabular-nums"
                      style={{ color: t.score < 0 ? "rgb(var(--color-danger-rgb))" : "rgb(var(--color-primary-rgb))" }}
                    >
                      {t.score}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Panel>

          <Button variant="danger" onClick={() => setConfirmEnd(true)}>End game</Button>
        </>
      )}

      {actionError && (
        <p className="text-center text-sm" style={{ color: "rgb(var(--color-danger-rgb))" }}>{actionError}</p>
      )}

      <Modal open={scoreEdit !== null} onClose={() => setScoreEdit(null)}>
        {scoreEdit && (
          <div className="flex flex-col gap-4">
            <h3 className="text-lg font-bold">
              Edit score — {teams.find(t => t.id === scoreEdit.teamId)?.name}
            </h3>
            <input
              type="number"
              value={scoreEdit.value}
              autoFocus
              onChange={e => setScoreEdit({ ...scoreEdit, value: e.target.value })}
              className="w-full px-4 py-2.5 rounded-md font-sans text-base outline-none"
              style={{
                background: "rgb(var(--surface-input-rgb))",
                border:     "1px solid rgb(var(--border-rgb))",
                color:      "rgb(var(--text-primary-rgb))",
              }}
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setScoreEdit(null)}>Cancel</Button>
              <Button onClick={async () => {
                const score = Number(scoreEdit.value);
                if (Number.isFinite(score)) {
                  await dispatch({ type: "set_score", teamId: scoreEdit.teamId, score });
                }
                setScoreEdit(null);
              }}>
                Save
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={confirmEnd} onClose={() => setConfirmEnd(false)}>
        <div className="flex flex-col gap-4">
          <h3 className="text-lg font-bold">End the game?</h3>
          <p style={{ color: "rgb(var(--text-secondary-rgb))" }}>
            Everyone is sent to the final scoreboard.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmEnd(false)}>Cancel</Button>
            <Button variant="danger" loading={busy} onClick={() => dispatch({ type: "end_game" })}>
              End game
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
