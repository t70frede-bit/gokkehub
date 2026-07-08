import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { playBuzzerSound, unlockAudio } from "@gokkehub/ui";
import { useRoom } from "../hooks/useRoom";
import BoardGrid from "../components/Board/BoardGrid";
import QuestionOverlay from "../components/Board/QuestionOverlay";
import PodiumStrip from "../components/Podium/PodiumStrip";
import AnswerTimer from "../components/AnswerTimer";
import PowerUpPrompt from "../components/PowerUpPrompt";
import MediaPlayer from "../components/MediaPlayer";
import { POWERUP_META, getBoard } from "../lib/types";
import type { JpRankingConfig } from "../lib/types";

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

  // ── Buzzer audio ────────────────────────────────────────────────────
  // Browsers block audio until a user gesture, so the TV shows a one-time
  // "enable sound" chip. After that: the buzz winner's sound plays on
  // buzz-in, and a device-round winner's sound plays at the reveal.
  const [soundOn, setSoundOn] = useState(false);
  const lastBuzzPlayer = useRef<string | null>(null);
  const lastReveal     = useRef<string | null>(null);

  // ── Category reveal animation ───────────────────────────────────────
  const prevRevealedCats = useRef<number[]>([]);
  const catTimers        = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [catAnim, setCatAnim] = useState<{
    index: number; name: string; total: number; phase: "show" | "fly";
  } | null>(null);

  // ── Special tile flash ──────────────────────────────────────────────
  // Briefly flood the screen in the tile's colour on first appearance.
  const prevSpecial     = useRef<string | null>(null);
  const prevPromptType  = useRef<string | null>(null);
  const [tileFlash, setTileFlash] = useState<{ color: string; key: number } | null>(null);

  const special    = room?.board_state.activeQuestion?.special ?? null;
  const promptType = room?.board_state.powerupPrompt?.powerupType ?? null;

  useEffect(() => {
    if (special !== prevSpecial.current) {
      if (special === "buzzed") {
        setTileFlash({ color: "var(--color-danger-rgb)", key: Date.now() });
      }
      prevSpecial.current = special;
    }
  }, [special]);

  useEffect(() => {
    if (promptType !== prevPromptType.current) {
      if (promptType) {
        setTileFlash({ color: "var(--color-primary-rgb)", key: Date.now() });
      }
      prevPromptType.current = promptType;
    }
  }, [promptType]);

  const buzzedPlayerId = room?.board_state.activeQuestion?.buzzedPlayerId ?? null;
  useEffect(() => {
    if (buzzedPlayerId === lastBuzzPlayer.current) return;
    lastBuzzPlayer.current = buzzedPlayerId;
    if (!soundOn || !buzzedPlayerId) return;
    const p = players.find(pl => pl.id === buzzedPlayerId);
    playBuzzerSound(p?.buzzer_sound);
  }, [buzzedPlayerId, soundOn, players]);

  const resolution = room?.board_state.lastResolution ?? null;
  useEffect(() => {
    const key = resolution ? `${resolution.tileKey}` : null;
    if (key === lastReveal.current) return;
    lastReveal.current = key;
    const winner = resolution?.winnerTeamIds?.[0];
    if (!soundOn || winner === undefined) return;
    const captainId = teams.find(t => t.id === winner)?.captain_id;
    const captain   = players.find(pl => pl.id === captainId);
    playBuzzerSound(captain?.buzzer_sound);
  }, [resolution, soundOn, teams, players]);

  // ── Category reveal animation effect ───────────────────────────────
  const revealedKey = room?.board_state.revealedCategories.join(",") ?? "";
  useEffect(() => {
    if (!room || !game) return;
    const state  = room.board_state;
    const board  = getBoard(game.config, state.currentBoard);
    const cats   = board?.categories ?? [];
    const prev   = prevRevealedCats.current;
    const curr   = state.revealedCategories;

    if (curr.length <= prev.length) {
      prevRevealedCats.current = [...curr];
      return;
    }

    const newIdx = curr.find(i => !prev.includes(i));
    prevRevealedCats.current = [...curr];
    if (newIdx === undefined) return;

    catTimers.current.forEach(clearTimeout);
    catTimers.current = [];

    setCatAnim({ index: newIdx, name: cats[newIdx] ?? "", total: cats.length, phase: "show" });

    const t1 = setTimeout(() => setCatAnim(a => a ? { ...a, phase: "fly" } : null), 1900);
    const t2 = setTimeout(() => setCatAnim(null), 2750);
    catTimers.current = [t1, t2];

    return () => { catTimers.current.forEach(clearTimeout); catTimers.current = []; };
  }, [revealedKey]);

  if (loading) return <div className="flex-1 flex items-center justify-center opacity-60">Loading…</div>;
  if (error || !room || !game) {
    return <div className="flex-1 flex items-center justify-center">{error ?? "Room not found"}</div>;
  }

  const soundChip = !soundOn && (
    <button
      type="button"
      onClick={() => { unlockAudio(); setSoundOn(true); }}
      className="fixed top-3 right-3 z-50 rounded-full px-4 py-2 font-bold text-sm"
      style={{
        background: "rgb(var(--surface-raised-rgb))",
        border:     "1px solid rgb(var(--color-primary-rgb))",
        color:      "rgb(var(--color-primary-rgb))",
      }}
    >
      🔊 Click to enable buzzer sounds
    </button>
  );

  const state = room.board_state;
  const board = getBoard(game.config, state.currentBoard);
  const q     = state.activeQuestion;
  const tile  = q && board ? board.tiles[q.tileKey] : null;
  const mode  = q?.mode ?? "standard";
  const teamMode    = game.config.teams?.mode === "teams";
  const buzzedTeam  = q && q.buzzedBy !== null ? teams.find(t => t.id === q.buzzedBy) : null;
  const contestants = players.filter(p => p.id !== room.host_id);
  const prompt      = state.powerupPrompt ?? null;
  const final       = state.final ?? null;
  const displayMode = tile?.buzzDisplayMode ?? game.config.buzzer.defaultBuzzDisplayMode;
  const ranked      = [...teams].sort((a, b) => b.score - a.score);
  const questionRevealed = q?.questionRevealed ?? true;

  const rankingCfg  = mode === "ranking" ? tile?.answerModeConfig as JpRankingConfig | undefined : undefined;
  const modeLabel   = mode === "multipleChoice" ? "Multiple choice"
                    : mode === "ranking"         ? "Rank the answers"
                    : "Number challenge";
  const modeInstruction = mode === "multipleChoice"
    ? "Look at the captain's device — be the first to choose the correct answer from the list. You get one guess."
    : mode === "ranking"
      ? (rankingCfg?.topLabel
          ? `Sort the answers from "${rankingCfg.topLabel}" at the top to "${rankingCfg.bottomLabel ?? "least"}" at the bottom.`
          : "Sort the answers from top to bottom in the correct order.")
      : "Type the correct number using the slider on your device.";

  // ── Lobby ───────────────────────────────────────────────────────────
  if (room.status === "lobby") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-8 p-10">
        {soundChip}
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
        {soundChip}
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
        {soundChip}
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
                  : b.type === "image"
                    ? <img key={b.id} src={b.url} alt="" className="max-h-[40vh] rounded-lg object-contain" />
                    : <MediaPlayer key={b.id} block={b} buzzed={false} nonce={0} soundOn={soundOn} />)}
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
      {tileFlash && (
        <div key={tileFlash.key} className="jp-tile-flash"
          style={{ background: `rgba(${tileFlash.color}, 0.45)` }} />
      )}

      {/* Category reveal overlay */}
      {catAnim && (() => {
        const offsetPct = ((catAnim.index + 0.5) / catAnim.total - 0.5) * 78;
        const flying    = catAnim.phase === "fly";
        return (
          <div className="absolute inset-0 z-40 flex items-center justify-center overflow-hidden pointer-events-none"
            style={{
              backdropFilter: flying ? "blur(0)"   : "blur(14px)",
              background:     flying ? "transparent" : "rgba(var(--bg-rgb), 0.45)",
              transition: flying ? "backdrop-filter 0.75s ease, background 0.75s ease" : "none",
            }}>
            <p
              className={catAnim.phase === "show" ? "jp-cat-appear" : undefined}
              style={{
                color:         "rgb(var(--color-primary-rgb))",
                fontWeight:    900,
                textTransform: "uppercase",
                letterSpacing: "0.12em",
                textAlign:     "center",
                textShadow:    "0 2px 24px rgba(0,0,0,0.55)",
                fontSize:      flying ? "1.1rem"                    : "clamp(2.5rem, 7vw, 5.5rem)",
                maxWidth:      flying ? `${100 / catAnim.total}vw`  : "80vw",
                transform:     flying ? `translate(${offsetPct}vw, -38vh) scale(1)` : "none",
                opacity:       flying ? 0                           : 1,
                transition:    flying ? "all 0.85s cubic-bezier(0.4, 0, 0.2, 1)" : "none",
              }}>
              {catAnim.name}
            </p>
          </div>
        );
      })()}

      {soundChip}
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
          questionRevealed={questionRevealed}
          displayMode={mode === "standard" ? displayMode : "stay"}
          buzzed={q.buzzedBy !== null}
          mediaNonce={q.mediaNonce ?? 0}
          soundOn={soundOn}
          revealOrder={tile.revealOrder}
          revealStage={q.revealStage}
        >
          <div className="min-h-20 flex flex-col items-center justify-center gap-2 text-center">
            {!questionRevealed ? (
              // Pre-reveal: show context while host gets ready
              q.special === "buzzed" ? (
                <p className="font-black text-2xl sm:text-4xl animate-pulse"
                  style={{ color: "rgb(var(--color-danger-rgb))" }}>
                  💥 Special tile! Host is revealing…
                </p>
              ) : mode !== "standard" ? (
                <>
                  <p className="font-black text-2xl sm:text-4xl" style={primary}>
                    🎯 {modeLabel}
                  </p>
                  <p className="font-bold text-base sm:text-2xl max-w-2xl text-center" style={secondary}>
                    {modeInstruction}
                  </p>
                  <p className="text-sm sm:text-lg mt-1 animate-pulse" style={secondary}>
                    {teamMode ? "Gather around your captain's phone!" : "Open your phone to play!"}
                  </p>
                </>
              ) : (
                <p className="text-lg sm:text-2xl animate-pulse" style={secondary}>
                  ⏳ Question incoming…
                </p>
              )
            ) : (
              // Question is revealed — normal play flow
              <>
                {q.special === "buzzed" && (
                  <p className="font-black text-2xl sm:text-4xl" style={{ color: "rgb(var(--color-danger-rgb))" }}>
                    💥 BUZZED TILE!
                  </p>
                )}
                {mode !== "standard" ? (
                  <p className="font-bold text-xl sm:text-3xl" style={state.buzzersOpen ? primary : secondary}>
                    {state.buzzersOpen
                      ? `Lock in your answers! ${(q.submittedTeamIds ?? []).length}/${teams.length} in`
                      : "Open your phones — host will open answers shortly"}
                  </p>
                ) : buzzedTeam ? (
                  <>
                    <p className="jp-podium-buzzed rounded-lg px-8 py-3 font-black text-2xl sm:text-4xl"
                      style={{
                        background: "rgba(var(--color-primary-rgb), 0.15)",
                        border:     "1px solid rgb(var(--color-primary-rgb))",
                        ...primary,
                      }}>
                      {buzzedTeam.name} buzzed in!
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
              </>
            )}
          </div>
        </QuestionOverlay>
      )}
    </div>
  );
}
