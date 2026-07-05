import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useRoom } from "../hooks/useRoom";
import BoardGrid from "../components/Board/BoardGrid";
import QuestionOverlay from "../components/Board/QuestionOverlay";
import PodiumStrip from "../components/Podium/PodiumStrip";
import AnswerTimer from "../components/AnswerTimer";
import PowerUpPrompt from "../components/PowerUpPrompt";
import { POWERUP_META, getBoard } from "../lib/types";

const secondary = { color: "rgb(var(--text-secondary-rgb))" } as const;
const primary   = { color: "rgb(var(--color-primary-rgb))" } as const;

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
  const board = getBoard(game.config, state.currentBoard);
  const q     = state.activeQuestion;
  const tile  = q && board ? board.tiles[q.tileKey] : null;
  const mode  = q?.mode ?? "standard";
  const buzzedTeam  = q && q.buzzedBy !== null ? teams.find(t => t.id === q.buzzedBy) : null;
  const contestants = players.filter(p => p.id !== room.host_id);
  const prompt      = state.powerupPrompt ?? null;
  const final       = state.final ?? null;
  const displayMode = tile?.buzzDisplayMode ?? game.config.buzzer.defaultBuzzDisplayMode;
  const ranked      = [...teams].sort((a, b) => b.score - a.score);

  // ── Lobby ───────────────────────────────────────────────────────────
  if (room.status === "lobby") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-8 p-10">
        <h1 className="text-3xl font-bold" style={secondary}>{game.title}</h1>
        <div className="text-center">
          <p className="text-xl uppercase tracking-widest" style={secondary}>
            Join at gokkehub.com/join with code
          </p>
          <p className="font-mono font-black text-[10rem] leading-none" style={primary}>
            {room.id}
          </p>
        </div>
        <div className="flex flex-wrap gap-3 justify-center max-w-4xl">
          {contestants.map(p => (
            <span key={p.id} className="rounded-full px-5 py-2 text-xl font-bold"
              style={{ background: "rgb(var(--surface-raised-rgb))", border: "1px solid rgb(var(--border-rgb))" }}>
              {p.name}
            </span>
          ))}
        </div>
      </div>
    );
  }

  // ── Between-boards scoreboard ───────────────────────────────────────
  if (state.interlude) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-8 p-10">
        <h1 className="text-4xl font-black uppercase tracking-widest" style={secondary}>
          Halfway scores
        </h1>
        <div className="flex flex-col gap-3 w-full max-w-2xl">
          {ranked.map((t, i) => (
            <div key={t.id} className="flex items-center gap-4 rounded-xl px-6 py-4"
              style={{
                background: "rgb(var(--surface-raised-rgb))",
                border: i === 0 ? "1px solid rgb(var(--color-primary-rgb))" : "1px solid rgb(var(--border-rgb))",
              }}>
              <span className="font-black text-2xl w-10" style={secondary}>{i + 1}.</span>
              <span className="flex-1 font-bold text-2xl truncate">
                {t.powerup && <span className="mr-2">{POWERUP_META[t.powerup].icon}</span>}
                {t.name}
              </span>
              <span className="font-black text-3xl tabular-nums"
                style={t.score < 0 ? { color: "rgb(var(--color-danger-rgb))" } : primary}>
                {t.score}
              </span>
            </div>
          ))}
        </div>
        <p className="text-xl animate-pulse" style={secondary}>Board 2 coming up…</p>
      </div>
    );
  }

  // ── Final Jeopardy ──────────────────────────────────────────────────
  if (final) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-8 p-10">
        <h1 className="text-3xl font-black uppercase tracking-widest" style={secondary}>
          Final Jeopardy
        </h1>
        <p className="font-black text-5xl text-center" style={primary}>{final.category}</p>

        {final.stage === "wager" && (
          <p className="text-2xl animate-pulse" style={secondary}>
            Place your wagers… {final.submittedTeamIds.length}/{teams.length} locked in
          </p>
        )}

        {final.stage === "question" && (
          <>
            <div className="flex flex-col items-center gap-4 max-w-4xl text-center">
              {(game.config.finalJeopardy?.questionBlocks ?? []).map(b =>
                b.type === "text"
                  ? <p key={b.id} className="text-3xl sm:text-5xl font-bold leading-snug">{b.text}</p>
                  : <img key={b.id} src={b.url} alt="" className="max-h-[40vh] rounded-lg object-contain" />)}
            </div>
            <p className="text-2xl animate-pulse" style={secondary}>
              Answers in: {final.submittedTeamIds.length}/{teams.length}
            </p>
          </>
        )}

        {final.stage === "judging" && (
          <div className="flex flex-col gap-3 w-full max-w-3xl">
            {ranked.map(t => {
              const r = final.revealed[t.id];
              return (
                <div key={t.id} className="flex items-center gap-4 rounded-xl px-6 py-4"
                  style={{
                    background: "rgb(var(--surface-raised-rgb))",
                    border: r
                      ? `1px solid rgb(var(--color-${r.correct ? "primary" : "danger"}-rgb))`
                      : "1px solid rgb(var(--border-rgb))",
                  }}>
                  <span className="font-bold text-2xl w-52 truncate">{t.name}</span>
                  {r ? (
                    <>
                      <span className="flex-1 text-xl italic truncate">"{r.answer}"</span>
                      <span className="font-black text-2xl tabular-nums"
                        style={{ color: r.correct ? "rgb(var(--color-primary-rgb))" : "rgb(var(--color-danger-rgb))" }}>
                        {r.correct ? `+${r.wager}` : `−${r.wager}`}
                      </span>
                      <span className="font-black text-2xl tabular-nums w-24 text-right"
                        style={t.score < 0 ? { color: "rgb(var(--color-danger-rgb))" } : primary}>
                        {t.score}
                      </span>
                    </>
                  ) : (
                    <span className="flex-1 text-xl" style={secondary}>…</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ── Board play ──────────────────────────────────────────────────────
  return (
    <div className="flex-1 relative flex flex-col gap-4 p-4 sm:p-8">
      {game.config.board2Mode !== "off" && (
        <p className="text-center text-sm font-bold uppercase tracking-widest" style={secondary}>
          Board {state.currentBoard + 1}
        </p>
      )}
      <div className="flex-1 flex items-center">
        {board && <BoardGrid board={board} state={state} />}
      </div>
      <PodiumStrip teams={teams} players={players} buzzedTeamId={q?.buzzedBy ?? null} />

      {/* Last submission-round results, until the next tile is picked */}
      {!q && !prompt && state.lastResolution && (
        <div className="absolute left-1/2 top-6 -translate-x-1/2 z-10 rounded-xl px-6 py-4 max-w-xl"
          style={{ background: "rgb(var(--surface-raised-rgb))", border: "1px solid rgb(var(--border-rgb))" }}>
          {state.lastResolution.lines.map((line, i) => (
            <p key={i} className="font-bold text-lg">{line}</p>
          ))}
        </div>
      )}

      {/* Power-up choice pending */}
      {prompt && (
        <div className="absolute inset-0 z-20 flex items-center justify-center p-10"
          style={{ background: "rgba(var(--bg-rgb), 0.9)" }}>
          <div className="w-full max-w-lg">
            <p className="text-center font-black text-3xl mb-4" style={primary}>
              {teams.find(t => t.id === prompt.teamId)?.name}
            </p>
            <PowerUpPrompt prompt={prompt} />
          </div>
        </div>
      )}

      {q && tile && (
        <QuestionOverlay
          category={state.revealedCategories.includes(Number(q.tileKey.split("-")[0]))
            ? board!.categories[Number(q.tileKey.split("-")[0])]
            : "???"}
          value={board!.pointValues[Number(q.tileKey.split("-")[1])] ?? 0}
          blocks={tile.questionBlocks}
          displayMode={mode === "standard" ? displayMode : "stay"}
          buzzed={q.buzzedBy !== null}
        >
          <div className="min-h-20 flex flex-col items-center justify-center gap-2">
            {q.special === "buzzed" && (
              <p className="font-black text-2xl sm:text-4xl" style={{ color: "rgb(var(--color-danger-rgb))" }}>
                💥 BUZZED TILE!
              </p>
            )}
            {mode !== "standard" ? (
              <p className="font-bold text-xl sm:text-3xl" style={state.buzzersOpen ? primary : secondary}>
                {state.buzzersOpen
                  ? `Lock in your answers! ${(q.submittedTeamIds ?? []).length}/${teams.length} in`
                  : "Get ready…"}
              </p>
            ) : buzzedTeam ? (
              <>
                <p className="jp-podium-buzzed rounded-lg px-8 py-3 font-black text-2xl sm:text-4xl"
                  style={{
                    background: "rgba(var(--color-primary-rgb), 0.15)",
                    border:     "1px solid rgb(var(--color-primary-rgb))",
                    ...primary,
                  }}>
                  {buzzedTeam.name}
                  {q.secondChanceUsed && " 🎯"}
                </p>
                <AnswerTimer startMs={q.timerStart} />
              </>
            ) : state.buzzersOpen ? (
              <p className="font-bold text-xl sm:text-3xl animate-pulse" style={primary}>
                BUZZ NOW!
              </p>
            ) : (
              <p className="text-lg sm:text-2xl" style={secondary}>Get ready…</p>
            )}
          </div>
        </QuestionOverlay>
      )}
    </div>
  );
}
