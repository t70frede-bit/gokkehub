import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button, Modal, Panel } from "@gokkehub/ui";
import { getStoredPlayerId, useRoom } from "../hooks/useRoom";
import { useHostController } from "../hooks/useHostController";
import BoardGrid from "../components/Board/BoardGrid";
import AnswerTimer from "../components/AnswerTimer";
import type {
  JpClosestNumberConfig, JpMultipleChoiceConfig, JpPowerupType, JpRankingConfig, JpSubmissionRow,
} from "../lib/types";
import { POWERUP_META, boardCount, getBoard, getTeamColor } from "../lib/types";

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

  const [scoreEdit,      setScoreEdit]      = useState<{ teamId: number; value: string } | null>(null);
  const [confirmEnd,     setConfirmEnd]     = useState(false);
  const [confirmDismiss, setConfirmDismiss] = useState(false);
  const [confirmFinal,   setConfirmFinal]   = useState(false);
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
  const allRevealed    = state.revealedCategories.length >= board.categories.length;
  const nextCatIndex   = board.categories.findIndex((_, i) => !state.revealedCategories.includes(i));
  const allTilesSpent  = Object.keys(board.tiles).every(k => state.spentTiles.includes(k));
  const hasBoard2   = boardCount(game.config) > 1;
  const finalOn     = game.config.finalJeopardy?.enabled ?? false;
  const submittedCount = q?.submittedTeamIds?.length ?? 0;

  const selectTile = (tileKey: string) => {
    void dispatch({ type: "select_tile", tileKey });
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

      /* ── Answer reveal — host must explicitly return to board ──── */
      ) : state.lastResolution ? (() => {
        const res    = state.lastResolution!;
        const winner = res.winnerTeamIds?.[0] !== undefined
          ? teams.find(t => t.id === res.winnerTeamIds![0])
          : null;
        const winnerIdx = winner ? teams.findIndex(t => t.id === winner.id) : -1;
        const winColor  = winner ? getTeamColor(winner, winnerIdx) : undefined;
        // Mirror the big screen's own test: it skips the answer overlay when
        // there is nothing to render (no answer blocks on a standard tile).
        // Don't tell the host to look at an empty screen — show it here instead.
        const resTile   = board.tiles[res.tileKey];
        const onScreen  = !!resTile && (
          resTile.answerBlocks.length > 0 || res.mode !== "standard"
        );
        return (
          <Panel className="text-center flex flex-col gap-3">
            <p className="text-2xl font-black" style={{ color: winColor ?? "rgb(var(--text-primary-rgb))" }}>
              {winner ? `✓ ${winner.name}` : "Nobody got it"}
            </p>
            {res.lines.length > 0 && (
              <p className="text-lg font-bold tabular-nums"
                style={{ color: res.lines[0]?.startsWith("-") ? "rgb(var(--color-danger-rgb))" : winColor }}>
                {res.lines[0]}
              </p>
            )}
            {!onScreen && resTile && resTile.answerBlocks.some(b => b.type === "text") && (
              <div className="rounded-md px-3 py-2 text-left"
                style={{ background: "rgba(var(--color-primary-rgb), 0.12)", border: "1px solid rgba(var(--color-primary-rgb), 0.4)" }}>
                <p className="text-xs uppercase tracking-widest" style={secondary}>Answer</p>
                {resTile.answerBlocks.map(b =>
                  b.type === "text"
                    ? <p key={b.id} className="font-bold" style={{ color: "rgb(var(--color-primary-rgb))" }}>{b.text}</p>
                    : null)}
              </div>
            )}
            <p className="text-xs" style={secondary}>
              {onScreen
                ? "The big screen is showing the answer. Dismiss when ready."
                : "No answer to show on the big screen — read it out, then dismiss."}
            </p>
            <Button fullWidth size="lg" loading={busy}
              onClick={() => dispatch({ type: "dismiss_resolution" })}>
              ← Back to board
            </Button>
          </Panel>
        );
      })()

      /* ── Active question ────────────────────────────────────────── */
      : q && tile ? (
        <>
          {q.special && !q.specialRevealAcked ? (() => {
            const isBuzzed = q.special === "buzzed";
            const pMeta = isBuzzed ? null : POWERUP_META[(q.special as string).slice("powerup_".length) as JpPowerupType];
            return (
              <Panel className="text-center">
                <div style={{ fontSize: "3rem", lineHeight: 1 }}>{isBuzzed ? "💥" : pMeta!.icon}</div>
                <p className="font-black text-xl mt-2" style={{ color: "rgb(var(--color-primary-rgb))" }}>
                  {isBuzzed ? "Buzzed tile!" : `${pMeta!.name} tile!`}
                </p>
                <p className="text-sm mt-1 mb-4" style={secondary}>
                  {isBuzzed
                    ? "Whoever picked this tile is locked in automatically."
                    : pMeta!.desc}
                </p>
                <Button fullWidth size="lg" loading={busy}
                  onClick={() => dispatch({ type: "ack_special" })}>
                  Everyone ready — continue →
                </Button>
              </Panel>
            );
          })() : !(q.questionRevealed ?? true) ? (
            <Panel>
              <p className="text-xs uppercase tracking-widest mb-3" style={secondary}>
                {board.categories[Number(q.tileKey.split("-")[0])]} — {value}
              </p>
              {q.special && q.special !== "buzzed" ? (() => {
                // Power-up pre-reveal panel: buzzed tiles skip this (questionRevealed=true at tile-press).
                const pType = (q.special as string).slice("powerup_".length) as JpPowerupType;
                const meta  = POWERUP_META[pType];
                // Submission modes → just show question; together-mode → show question + open buzzers.
                const continueType = (q.mode ?? "standard") !== "standard"
                  ? "reveal_question" as const
                  : "reveal_and_open" as const;
                return (
                  <>
                    <div className="text-center mb-4">
                      <div style={{ fontSize: "2.5rem", lineHeight: 1 }}>{meta.icon}</div>
                      <p className="font-black text-lg mt-1" style={{ color: "rgb(var(--color-primary-rgb))" }}>
                        {meta.name} tile!
                      </p>
                      <p className="text-sm mt-1" style={secondary}>{meta.desc}</p>
                    </div>
                    <Button fullWidth size="lg" loading={busy}
                      onClick={() => dispatch({ type: continueType })}>
                      {(q.mode ?? "standard") !== "standard"
                        ? "Show question →"
                        : "Show question & open buzzers →"}
                    </Button>
                    <Button fullWidth variant="ghost" size="sm" loading={busy} className="mt-1"
                      onClick={() => dispatch({ type: "dismiss_question" })}>
                      Cancel question
                    </Button>
                  </>
                );
              })() : (
                // Together-mode non-special pre-reveal
                <>
                  <Button fullWidth size="lg" loading={busy}
                    onClick={() => dispatch({ type: "reveal_and_open" })}>
                    📋 Reveal question & open buzzers
                  </Button>
                  <p className="text-xs mt-2 text-center" style={secondary}>
                    Players see "⏳ Question incoming…" until you press this.
                  </p>
                </>
              )}
            </Panel>
          ) : (
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
              // If a team is already locked in (buzzed tile), just reveal the
              // rest without reopening buzzers — the team is already in.
              // Otherwise, reveal + open in one step.
              <Button size="lg" fullWidth className="mt-2" loading={busy}
                onClick={() => dispatch({ type: buzzedTeam ? "reveal_rest" : "reveal_and_open" })}>
                {buzzedTeam
                  ? "👁 Reveal rest of question"
                  : tile.revealOrder === "mediaFirst"
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
          ) : q.special === "buzzed" && q.buzzedBy === null && !state.buzzersOpen ? (
            <Panel>
              <p className="text-center font-bold mb-3" style={{ color: "rgb(var(--color-danger-rgb))" }}>
                💥 Who picked this tile?
              </p>
              <div className="flex flex-col gap-2">
                {teams.map(t => (
                  <Button key={t.id} variant="ghost" fullWidth loading={busy}
                    onClick={() => dispatch({ type: "assign_buzzed", teamId: t.id })}>
                    {t.name}
                  </Button>
                ))}
                <Button variant="ghost" fullWidth loading={busy}
                  onClick={() => dispatch({ type: "open_buzzers" })}>
                  Skip — open buzzers for all
                </Button>
              </div>
            </Panel>
          ) : buzzedTeam ? (
            <Panel className="text-center">
              <p className="font-black text-2xl mb-1"
                style={{ color: getTeamColor(buzzedTeam, teams.findIndex(t => t.id === buzzedTeam.id)) }}>
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
              {q.secondChanceUsed && (
                <Button fullWidth variant="ghost" size="sm" loading={busy} className="mt-2"
                  onClick={() => dispatch({ type: "skip_second_chance" })}>
                  ⏭ Skip — don't answer again (−{value}, no double)
                </Button>
              )}
              {q.special === "buzzed" && (
                <details className="mt-3 text-left">
                  <summary className="text-xs cursor-pointer select-none" style={secondary}>
                    Change who picked this tile
                  </summary>
                  <div className="flex flex-col gap-1 mt-2">
                    {teams.filter(t => t.id !== buzzedTeam.id).map((t, _i) => (
                      <Button key={t.id} variant="ghost" size="sm" fullWidth loading={busy}
                        onClick={() => dispatch({ type: "assign_buzzed", teamId: t.id })}>
                        {t.name}
                      </Button>
                    ))}
                  </div>
                </details>
              )}
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
                  <p className="text-center text-sm" style={{ color: "rgb(var(--text-secondary-rgb))" }}>
                    Press "Reveal &amp; open buzzers" above when ready.
                  </p>
                ) : (
                  <Button fullWidth size="lg" loading={busy} onClick={() => dispatch({ type: "open_buzzers" })}>
                    Open buzzers
                  </Button>
                )}
                <Button fullWidth variant="ghost" loading={busy}
                  onClick={() => setConfirmDismiss(true)}>
                  Nobody knows it — close question
                </Button>
              </div>
            </Panel>
          )}
          </>) /* end questionRevealed branch */}
        </>

      /* ── Board ──────────────────────────────────────────────────── */
      ) : (
        <>
          {/* Category reveal phase: one at a time, board hidden until all done */}
          {!allRevealed ? (
            <Panel className="flex flex-col gap-3">
              <p className="text-xs font-bold uppercase tracking-widest text-center" style={secondary}>
                Reveal categories ({state.revealedCategories.length}/{board.categories.length})
              </p>
              {/* Any order — reveal the one you want to talk about next. */}
              <div className="flex flex-col gap-1.5">
                {board.categories.map((cat, i) => {
                  const done = state.revealedCategories.includes(i);
                  return done ? (
                    <div key={i} className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold"
                      style={{ border: "1px solid rgb(var(--border-rgb))", color: "rgb(var(--text-secondary-rgb))" }}>
                      <span style={{ color: "rgb(var(--color-primary-rgb))" }}>✓</span>
                      <span className="truncate">{cat}</span>
                      {board.categoryDescriptions?.[i] && (
                        <span className="truncate text-xs opacity-70">— {board.categoryDescriptions[i]}</span>
                      )}
                    </div>
                  ) : (
                    <Button key={i} fullWidth size={i === nextCatIndex ? "lg" : "md"}
                      variant={i === nextCatIndex ? "primary" : "ghost"} loading={busy}
                      onClick={() => dispatch({ type: "reveal_category", categoryIndex: i })}>
                      Reveal: {cat}
                    </Button>
                  );
                })}
              </div>
              <Button fullWidth variant="ghost" size="sm" loading={busy}
                onClick={() => dispatch({ type: "reveal_all_categories" })}>
                ⏭ Reveal all remaining — skip to the board
              </Button>
            </Panel>
          ) : (
            <Panel variant="bare" className="p-3">
              <BoardGrid compact board={board} state={state} onTileSelect={selectTile} />
            </Panel>
          )}

          <Panel>
            <h2 className="text-sm font-bold uppercase tracking-widest mb-2" style={secondary}>
              Scores (tap to edit)
            </h2>
            <ul className="flex flex-col gap-1.5">
              {teams.map((t, i) => {
                const color   = getTeamColor(t, i);
                const isOwner = (state.activeBoardTeamId ?? null) === t.id;
                return (
                  <li key={t.id}>
                    <button type="button" className="w-full flex justify-between rounded-md px-3 py-2 font-semibold"
                      style={{
                        border:     `1px solid ${isOwner ? `${color}88` : "rgb(var(--border-rgb))"}`,
                        background: isOwner ? `${color}11` : "transparent",
                      }}
                      onClick={() => setScoreEdit({ teamId: t.id, value: String(t.score) })}>
                      <span>
                        {t.powerup && <span className="mr-1.5">{POWERUP_META[t.powerup].icon}</span>}
                        <span style={{ color: isOwner ? color : undefined }}>{t.name}</span>
                        {isOwner && <span className="ml-1.5 text-xs" style={{ color }}>🎯</span>}
                      </span>
                      <span className="tabular-nums"
                        style={{ color: t.score < 0 ? "rgb(var(--color-danger-rgb))" : color }}>
                        {t.score}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Panel>

          {/* Board owner — who picks the next tile. Auto-set from last correct answer. */}
          <Panel className="py-2">
            <p className="text-xs font-bold uppercase tracking-widest mb-2" style={secondary}>
              Picks next
            </p>
            <div className="flex flex-wrap gap-1.5">
              {teams.map((t, i) => {
                const color   = getTeamColor(t, i);
                const isOwner = (state.activeBoardTeamId ?? null) === t.id;
                return (
                  <button key={t.id}
                    onClick={() => dispatch({ type: "set_board_team", teamId: t.id })}
                    className="px-3 py-1 rounded-full text-sm font-bold transition-all"
                    style={{
                      background:  isOwner ? `${color}22` : "transparent",
                      border:      `1px solid ${isOwner ? color : "rgb(var(--border-rgb))"}`,
                      color:       isOwner ? color : "rgb(var(--text-secondary-rgb))",
                      cursor:      "pointer",
                    }}>
                    {t.name}
                  </button>
                );
              })}
              {(state.activeBoardTeamId ?? null) !== null && (
                <button onClick={() => dispatch({ type: "set_board_team", teamId: null })}
                  className="px-2 py-1 rounded-full text-sm"
                  style={{ color: "rgb(var(--text-secondary-rgb))", border: "1px solid rgb(var(--border-rgb))", cursor: "pointer" }}>
                  ✕ clear
                </button>
              )}
            </div>
          </Panel>

          <div className="flex flex-col gap-2">
            {hasBoard2 && state.currentBoard === 0 && (
              <Button loading={busy} disabled={!allTilesSpent}
                title={allTilesSpent ? undefined : "All questions must be answered first"}
                onClick={() => dispatch({ type: "advance_board" })}>
                {allTilesSpent ? "Scoreboard → board 2" : `Answer all questions to advance (${state.spentTiles.length}/${Object.keys(board.tiles).length})`}
              </Button>
            )}
            {finalOn && (
              <Button loading={busy} onClick={() => setConfirmFinal(true)}>
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

      <Modal open={confirmDismiss} onClose={() => setConfirmDismiss(false)}>
        <div className="flex flex-col gap-4">
          <h3 className="text-lg font-bold">Close this question?</h3>
          <p style={secondary}>Nobody scores — the tile is marked as spent and the board returns.</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmDismiss(false)}>Cancel</Button>
            <Button variant="danger" loading={busy} onClick={async () => {
              await dispatch({ type: "dismiss_question" });
              setConfirmDismiss(false);
            }}>
              Close question
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={confirmFinal} onClose={() => setConfirmFinal(false)}>
        <div className="flex flex-col gap-4">
          <h3 className="text-lg font-bold">Start Final Jeopardy?</h3>
          <p style={secondary}>All normal questions end and the final round begins immediately.</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmFinal(false)}>Cancel</Button>
            <Button loading={busy} onClick={async () => {
              await dispatch({ type: "start_final" });
              setConfirmFinal(false);
            }}>
              Start Final Jeopardy
            </Button>
          </div>
        </div>
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
