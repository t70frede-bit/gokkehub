import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button, Modal, Panel } from "@gokkehub/ui";
import { getStoredPlayerId, useRoom } from "../hooks/useRoom";
import { useHostController } from "../hooks/useHostController";
import BoardGrid from "../components/Board/BoardGrid";
import AnswerTimer from "../components/AnswerTimer";
import type {
  JpClosestNumberConfig, JpMultipleChoiceConfig, JpRankingConfig, JpSubmissionRow,
} from "../lib/types";
import { POWERUP_META, boardCount, getBoard } from "../lib/types";

const inputStyle = {
  background: "rgb(var(--surface-input-rgb))",
  border:     "1px solid rgb(var(--border-rgb))",
  color:      "rgb(var(--text-primary-rgb))",
} as const;
const secondary = { color: "rgb(var(--text-secondary-rgb))" } as const;

export default function HostControllerPage() {
  const navigate   = useNavigate();
  const { roomId } = useParams();
  const { room, game, teams, loading, error } = useRoom(roomId);

  const playerId = roomId ? getStoredPlayerId(roomId) : null;
  const { dispatch, busy, error: actionError } = useHostController(roomId, playerId);

  const [scoreEdit, setScoreEdit]   = useState<{ teamId: number; value: string } | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [pickerTile, setPickerTile] = useState<string | null>(null);
  const [finalSubs, setFinalSubs]   = useState<JpSubmissionRow[]>([]);

  useEffect(() => {
    if (!room || !roomId) return;
    if (room.status === "lobby")    navigate(`/lobby/${roomId}`, { replace: true });
    if (room.status === "finished") navigate(`/end/${roomId}`, { replace: true });
  }, [room?.status, roomId]);

  const state = room?.board_state;
  const finalStage = state?.final?.stage;

  const loadFinalSubs = useCallback(async () => {
    if (!roomId || !playerId) return;
    const res = await fetch(`/room/${roomId}/submissions?player_id=${playerId}`);
    if (!res.ok) return;
    const body = await res.json() as { submissions: JpSubmissionRow[] };
    setFinalSubs(body.submissions);
  }, [roomId, playerId]);

  // Host needs the secret answers once judging is possible.
  useEffect(() => {
    if (finalStage === "question" || finalStage === "judging") void loadFinalSubs();
  }, [finalStage, state?.final?.submittedTeamIds?.length, loadFinalSubs]);

  if (loading) return <div className="flex-1 flex items-center justify-center opacity-60">Loading…</div>;
  if (error || !room || !game || !state) {
    return <div className="flex-1 flex items-center justify-center">{error ?? "Room not found"}</div>;
  }
  if (!playerId || room.host_id !== playerId) {
    return <div className="flex-1 flex items-center justify-center">This view is for the host's phone.</div>;
  }

  const board = getBoard(game.config, state.currentBoard);
  if (!board) return <div className="flex-1 flex items-center justify-center">Board config missing.</div>;

  const q      = state.activeQuestion;
  const tile   = q ? board.tiles[q.tileKey] : null;
  const value  = q ? board.pointValues[Number(q.tileKey.split("-")[1])] ?? 0 : 0;
  const mode   = q?.mode ?? "standard";
  const buzzedTeam  = q && q.buzzedBy !== null ? teams.find(t => t.id === q.buzzedBy) : null;
  const prompt      = state.powerupPrompt ?? null;
  const allRevealed = state.revealedCategories.length >= board.categories.length;
  const buzzedTilesOn = game.config.dangerous?.buzzed.enabled ?? false;
  const hasBoard2   = boardCount(game.config) > 1;
  const finalOn     = game.config.finalJeopardy?.enabled ?? false;
  const submittedCount = q?.submittedTeamIds?.length ?? 0;

  const selectTile = (tileKey: string) => {
    // With Buzzed tiles in play the server needs to know who picked —
    // the host can't see which tiles are dangerous (that's the point).
    if (buzzedTilesOn) setPickerTile(tileKey);
    else void dispatch({ type: "select_tile", tileKey });
  };

  const hasMedia = !!tile?.questionBlocks.some(b => b.type === "audio" || b.type === "video");

  const hostAnswerPanel = tile && (
    <div className="mt-3 rounded-md px-3 py-2"
      style={{ background: "rgba(var(--color-primary-rgb), 0.12)", border: "1px solid rgba(var(--color-primary-rgb), 0.4)" }}>
      <p className="text-xs uppercase tracking-widest" style={secondary}>Answer</p>
      {tile.answerBlocks.map(b =>
        b.type === "text"
          ? <p key={b.id} className="font-bold" style={{ color: "rgb(var(--color-primary-rgb))" }}>{b.text}</p>
          : b.type === "image"
            ? <img key={b.id} src={b.url} alt="" className="rounded-md mt-1 max-h-32 object-contain" />
            : b.type === "audio"
              ? <audio key={b.id} src={b.url} controls className="w-full mt-1" />
              : <video key={b.id} src={b.url} controls className="rounded-md mt-1 max-h-32" />)}
      {mode === "multipleChoice" && (
        <p className="font-bold" style={{ color: "rgb(var(--color-primary-rgb))" }}>
          ✓ {(tile.answerModeConfig as JpMultipleChoiceConfig).options[(tile.answerModeConfig as JpMultipleChoiceConfig).correctIndex]}
        </p>
      )}
      {mode === "closestNumber" && (
        <p className="font-bold" style={{ color: "rgb(var(--color-primary-rgb))" }}>
          {(tile.answerModeConfig as JpClosestNumberConfig).correct} {(tile.answerModeConfig as JpClosestNumberConfig).unit}
        </p>
      )}
      {mode === "ranking" && (
        <ol className="font-bold list-decimal list-inside" style={{ color: "rgb(var(--color-primary-rgb))" }}>
          {(tile.answerModeConfig as JpRankingConfig).items.map((it, i) => <li key={i}>{it}</li>)}
        </ol>
      )}
    </div>
  );

  return (
    <div className="flex-1 w-full max-w-xl mx-auto p-3 sm:p-6 flex flex-col gap-4">
      {/* ── Between boards ─────────────────────────────────────────── */}
      {state.interlude ? (
        <Panel className="text-center">
          <h2 className="text-xl font-bold mb-3">Board 1 done!</h2>
          <p className="mb-4" style={secondary}>
            The big screen is showing the scoreboard.
            {game.config.powerupCarryover === "reset" ? " Power-ups have been reset." : ""}
          </p>
          <Button fullWidth size="lg" loading={busy} onClick={() => dispatch({ type: "continue_board" })}>
            Continue to board 2
          </Button>
        </Panel>

      /* ── Final Jeopardy ─────────────────────────────────────────── */
      ) : state.final ? (
        <Panel>
          <p className="text-xs uppercase tracking-widest mb-1" style={secondary}>
            Final Jeopardy — {state.final.category}
          </p>
          {(game.config.finalJeopardy?.questionBlocks ?? []).map(b =>
            b.type === "text" ? <p key={b.id} className="font-bold text-lg">{b.text}</p> : null)}
          <div className="mt-2 rounded-md px-3 py-2"
            style={{ background: "rgba(var(--color-primary-rgb), 0.12)", border: "1px solid rgba(var(--color-primary-rgb), 0.4)" }}>
            <p className="text-xs uppercase tracking-widest" style={secondary}>Answer</p>
            {(game.config.finalJeopardy?.answerBlocks ?? []).map(b =>
              b.type === "text"
                ? <p key={b.id} className="font-bold" style={{ color: "rgb(var(--color-primary-rgb))" }}>{b.text}</p>
                : null)}
          </div>

          {state.final.stage === "wager" && (
            <div className="flex flex-col gap-3 mt-4">
              <p style={secondary}>
                Wagers in: {state.final.submittedTeamIds.length}/{teams.length}
              </p>
              <Button fullWidth size="lg" loading={busy}
                onClick={() => dispatch({ type: "final_reveal_question" })}>
                Reveal the question
              </Button>
            </div>
          )}

          {(state.final.stage === "question" || state.final.stage === "judging") && (
            <div className="flex flex-col gap-3 mt-4">
              {state.final.stage === "question" && (
                <p style={secondary}>
                  Answers in: {state.final.submittedTeamIds.length}/{teams.length}
                </p>
              )}
              {teams.map(t => {
                const judged = state.final!.revealed[t.id];
                const answer = finalSubs.find(s => s.kind === "final_answer" && s.team_id === t.id);
                const wagerS = finalSubs.find(s => s.kind === "final_wager"  && s.team_id === t.id);
                return (
                  <div key={t.id} className="rounded-md px-3 py-2"
                    style={{ border: "1px solid rgb(var(--border-rgb))" }}>
                    <div className="flex justify-between font-bold">
                      <span>{t.name}</span>
                      <span style={secondary}>wager {typeof wagerS?.payload.value === "number" ? wagerS.payload.value : 0}</span>
                    </div>
                    <p className="text-sm my-1">
                      {typeof answer?.payload.value === "string" ? answer.payload.value : <em style={secondary}>no answer yet</em>}
                    </p>
                    {judged ? (
                      <p className="text-sm font-bold"
                        style={{ color: judged.correct ? "rgb(var(--color-primary-rgb))" : "rgb(var(--color-danger-rgb))" }}>
                        {judged.correct ? `✓ +${judged.wager}` : `✗ −${judged.wager}`}
                      </p>
                    ) : (
                      <div className="flex gap-2">
                        <Button size="sm" fullWidth loading={busy}
                          onClick={() => dispatch({ type: "final_judge", teamId: t.id, correct: true })}>
                          ✓ Correct
                        </Button>
                        <Button size="sm" fullWidth variant="danger" loading={busy}
                          onClick={() => dispatch({ type: "final_judge", teamId: t.id, correct: false })}>
                          ✗ Wrong
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
              <Button fullWidth variant="danger" loading={busy} onClick={() => setConfirmEnd(true)}>
                Finish game — reveal winner
              </Button>
            </div>
          )}
        </Panel>

      /* ── Power-up choice pending ────────────────────────────────── */
      ) : prompt ? (
        <Panel className="text-center">
          <p className="text-3xl mb-1">{POWERUP_META[prompt.powerupType].icon}</p>
          <h3 className="font-bold text-lg mb-1">
            {teams.find(t => t.id === prompt.teamId)?.name} hit a power-up tile!
          </h3>
          <p className="text-sm mb-4" style={secondary}>
            They choose on their phone: {prompt.value} points or {POWERUP_META[prompt.powerupType].name}.
            You can force it if they dawdle.
          </p>
          <div className="flex gap-2">
            <Button fullWidth variant="ghost" loading={busy}
              onClick={() => dispatch({ type: "force_powerup_choice", choice: "points" })}>
              Force points
            </Button>
            <Button fullWidth variant="ghost" loading={busy}
              onClick={() => dispatch({ type: "force_powerup_choice", choice: "powerup" })}>
              Force power-up
            </Button>
          </div>
        </Panel>

      /* ── Active question ────────────────────────────────────────── */
      ) : q && tile ? (
        <>
          <Panel>
            <p className="text-xs uppercase tracking-widest mb-1" style={secondary}>
              {board.categories[Number(q.tileKey.split("-")[0])]} — {value}
              {q.special === "buzzed" ? " · 💥 BUZZED TILE" : ""}
            </p>
            {tile.questionBlocks.map(b =>
              b.type === "text"
                ? <p key={b.id} className="font-bold text-lg leading-snug">{b.text}</p>
                : b.type === "image"
                  ? <img key={b.id} src={b.url} alt="" className="rounded-md mt-1 max-h-40 object-contain" />
                  : <p key={b.id} className="text-sm mt-1" style={secondary}>
                      {b.type === "audio" ? "🎵 Audio clip plays on the big screen" : "🎬 Video clip plays on the big screen"}
                    </p>)}
            {(q.revealStage ?? 1) < 1 && (
              // Staged reveal: one button both reveals the held-back content
              // AND opens buzzers — so the host never has to press two things.
              <Button size="lg" fullWidth className="mt-2" loading={busy}
                onClick={() => dispatch({ type: "reveal_and_open" })}>
                {tile.revealOrder === "mediaFirst"
                  ? "📝 Reveal text & open buzzers"
                  : tile.revealOrder === "textFirst"
                    ? (tile.questionBlocks.some(b => b.type === "video") ? "🎬 Reveal video & open buzzers" : "🖼 Reveal image & open buzzers")
                    : "👁 Reveal & open buzzers"}
              </Button>
            )}
            {hasMedia && (q.revealStage ?? 1) >= 1 && (
              <Button variant="ghost" size="sm" className="mt-2" loading={busy}
                onClick={() => dispatch({ type: "replay_media" })}>
                🔁 Replay clip on big screen
              </Button>
            )}
            {hostAnswerPanel}
          </Panel>

          {mode !== "standard" ? (
            <Panel>
              <div className="flex flex-col gap-3">
                {state.buzzersOpen ? (
                  <p className="text-center font-bold" style={{ color: "rgb(var(--color-primary-rgb))" }}>
                    Answers open — {submittedCount}/{teams.length} locked in
                  </p>
                ) : (
                  <Button fullWidth size="lg" loading={busy} onClick={() => dispatch({ type: "open_buzzers" })}>
                    Open answers
                  </Button>
                )}
                <Button fullWidth loading={busy} disabled={!state.buzzersOpen}
                  onClick={() => dispatch({ type: "resolve_submissions" })}>
                  Close & score ({submittedCount} in)
                </Button>
                <Button fullWidth variant="ghost" loading={busy}
                  onClick={() => dispatch({ type: "dismiss_question" })}>
                  Cancel question
                </Button>
              </div>
            </Panel>
          ) : buzzedTeam ? (
            <Panel className="text-center">
              <p className="font-black text-2xl mb-1" style={{ color: "rgb(var(--color-primary-rgb))" }}>
                {buzzedTeam.name}
                {buzzedTeam.powerup && ` ${POWERUP_META[buzzedTeam.powerup].icon}`}
              </p>
              {q.secondChanceUsed && (
                <p className="text-sm font-bold mb-1" style={{ color: "rgb(var(--color-danger-rgb))" }}>
                  🎯 Second attempt — wrong again costs double
                </p>
              )}
              <AnswerTimer startMs={q.timerStart} />
              <div className="flex gap-3 mt-4">
                <Button fullWidth size="lg" loading={busy}
                  onClick={() => dispatch({ type: "accept_answer" })}>
                  ✓ Correct{q.secondChanceUsed ? " (net 0)" : ` (+${value})`}
                </Button>
                <Button fullWidth size="lg" variant="danger" loading={busy}
                  onClick={() => dispatch({ type: "reject_answer" })}>
                  ✗ Wrong{buzzedTeam.powerup === "secondChance" && !q.secondChanceUsed
                    ? " (2nd chance)"
                    : ` (−${q.secondChanceUsed ? value * 2 : value})`}
                </Button>
              </div>
            </Panel>
          ) : (
            <Panel>
              <div className="flex flex-col gap-3">
                {state.buzzersOpen ? (
                  <p className="text-center font-bold text-lg animate-pulse"
                    style={{ color: "rgb(var(--color-primary-rgb))" }}>
                    Buzzers open…
                  </p>
                ) : (q.revealStage ?? 1) < 1 ? (
                  // Staged-reveal tile: the big "Reveal & open buzzers" button
                  // above (in the question panel) covers both actions. Show a
                  // small reminder so the host knows what's waiting.
                  <p className="text-center text-sm" style={{ color: "rgb(var(--text-secondary-rgb))" }}>
                    Press "Reveal & open buzzers" above when ready.
                  </p>
                ) : (
                  <Button fullWidth size="lg" loading={busy} onClick={() => dispatch({ type: "open_buzzers" })}>
                    Open buzzers
                  </Button>
                )}
                <Button fullWidth variant="ghost" loading={busy}
                  onClick={() => dispatch({ type: "dismiss_question" })}>
                  Nobody knows it — close question
                </Button>
              </div>
            </Panel>
          )}
        </>

      /* ── Board ──────────────────────────────────────────────────── */
      ) : (
        <>
          <Panel variant="bare" className="p-3">
            <BoardGrid compact board={board} state={state} onTileSelect={selectTile} />
            {!allRevealed && (
              <Button fullWidth variant="ghost" size="sm" className="mt-3" loading={busy}
                onClick={() => dispatch({ type: "reveal_all_categories" })}>
                Reveal categories
              </Button>
            )}
          </Panel>

          <Panel>
            <h2 className="text-sm font-bold uppercase tracking-widest mb-2" style={secondary}>
              Scores (tap to edit)
            </h2>
            <ul className="flex flex-col gap-1.5">
              {teams.map(t => (
                <li key={t.id}>
                  <button type="button" className="w-full flex justify-between rounded-md px-3 py-2 font-semibold"
                    style={{ border: "1px solid rgb(var(--border-rgb))" }}
                    onClick={() => setScoreEdit({ teamId: t.id, value: String(t.score) })}>
                    <span>
                      {t.powerup && <span className="mr-1.5">{POWERUP_META[t.powerup].icon}</span>}
                      {t.name}
                    </span>
                    <span className="tabular-nums"
                      style={{ color: t.score < 0 ? "rgb(var(--color-danger-rgb))" : "rgb(var(--color-primary-rgb))" }}>
                      {t.score}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Panel>

          <div className="flex flex-col gap-2">
            {hasBoard2 && state.currentBoard === 0 && (
              <Button loading={busy} onClick={() => dispatch({ type: "advance_board" })}>
                Scoreboard → board 2
              </Button>
            )}
            {finalOn && (
              <Button loading={busy} onClick={() => dispatch({ type: "start_final" })}>
                Start Final Jeopardy
              </Button>
            )}
            <Button variant="danger" onClick={() => setConfirmEnd(true)}>End game</Button>
          </div>
        </>
      )}

      {actionError && (
        <p className="text-center text-sm" style={{ color: "rgb(var(--color-danger-rgb))" }}>{actionError}</p>
      )}

      {/* ── Who picked this tile? (Buzzed tiles in play) ─────────────── */}
      <Modal open={pickerTile !== null} onClose={() => setPickerTile(null)}>
        {pickerTile && (
          <div className="flex flex-col gap-3">
            <h3 className="text-lg font-bold">Who picked this tile?</h3>
            <p className="text-sm" style={secondary}>
              Needed in case it's a 💥 Buzzed tile — the picker gets locked in automatically.
            </p>
            {teams.map(t => (
              <Button key={t.id} variant="ghost" fullWidth loading={busy}
                onClick={async () => {
                  await dispatch({ type: "select_tile", tileKey: pickerTile, pickerTeamId: t.id });
                  setPickerTile(null);
                }}>
                {t.name}
              </Button>
            ))}
            <Button variant="ghost" fullWidth loading={busy}
              onClick={async () => {
                await dispatch({ type: "select_tile", tileKey: pickerTile });
                setPickerTile(null);
              }}>
              Skip — host picked
            </Button>
          </div>
        )}
      </Modal>

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
              style={inputStyle}
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
          <p style={secondary}>Everyone is sent to the final scoreboard.</p>
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
