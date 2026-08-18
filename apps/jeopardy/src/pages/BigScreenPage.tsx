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
import { POWERUP_META, getBoard, getTeamColor } from "../lib/types";
import { readableTextOn } from "../lib/color";
import type { JpClosestNumberConfig, JpMultipleChoiceConfig, JpPowerupType, JpRankingConfig, JpResolutionSummary } from "../lib/types";

const secondary = { color: "rgb(var(--text-secondary-rgb))" } as const;
const primary   = { color: "rgb(var(--color-primary-rgb))" } as const;

// Animate a score total counting from `from` up/down to `to`.
function ScoreCountUp({ from, to }: { from: number; to: number }) {
  const [val, setVal] = useState(from);
  useEffect(() => {
    let raf = 0, startTs = 0;
    // Choreography: card + starting total fade in, hold ~1s, the delta fades in
    // above the box, then ~0.5s later (1.5s total) it drops down and the total
    // counts up/down to its new value. Deliberate rather than hasty.
    const DUR = 800, DELAY = 1500;
    const tick = (ts: number) => {
      if (!startTs) startTs = ts;
      const t = Math.min(1, (ts - startTs) / DUR);
      const eased = 1 - Math.pow(1 - t, 3);
      setVal(Math.round(from + (to - from) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    const timer = window.setTimeout(() => { raf = requestAnimationFrame(tick); }, DELAY);
    return () => { window.clearTimeout(timer); cancelAnimationFrame(raf); };
  }, [from, to]);
  return <>{val}</>;
}

// Reading delay: buzzers are open but not live until `openAt`. Counts down on
// the big screen so the room can see the race start fairly, then flips to BUZZ
// NOW. Self-ticking so the rest of the page doesn't re-render every 100ms.
function BuzzArming({ openAt }: { openAt: number | null }) {
  const [left, setLeft] = useState(() => (openAt ? Math.max(0, openAt - Date.now()) : 0));
  useEffect(() => {
    if (!openAt) { setLeft(0); return; }
    setLeft(Math.max(0, openAt - Date.now()));
    const tick = setInterval(() => {
      const ms = Math.max(0, openAt - Date.now());
      setLeft(ms);
      if (ms === 0) clearInterval(tick);
    }, 100);
    return () => clearInterval(tick);
  }, [openAt]);

  if (left <= 0) {
    return <p className="font-bold text-xl sm:text-3xl animate-pulse" style={primary}>BUZZ NOW!</p>;
  }
  return (
    <div className="flex flex-col items-center gap-1">
      <p className="text-sm sm:text-lg uppercase tracking-widest font-bold" style={secondary}>
        Buzzers open in
      </p>
      <p className="font-black tabular-nums leading-none" style={{ fontSize: "clamp(3rem, 9vw, 6rem)", ...primary }}>
        {Math.ceil(left / 1000)}
      </p>
    </div>
  );
}

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
    index: number; name: string; desc: string; total: number; phase: "show" | "hide";
  } | null>(null);

  // ── Score award announcement ────────────────────────────────────────
  // A bottom-of-screen pop-up (no blur) fired on any score change: the delta
  // is "pulled down" into the team's running total, which counts up/down to
  // its new value. Keeps the question/answer front-and-centre.
  const prevTeamScores   = useRef<Record<number, number>>({});
  const announceTimers   = useRef<ReturnType<typeof setTimeout>[]>([]);
  type ScoreEntry = { name: string; delta: number; color: string; from: number; to: number };
  const [scoreAnnounce, setScoreAnnounce] = useState<
    { entries: ScoreEntry[]; key: number; phase: "in" | "out" } | null
  >(null);

  useEffect(() => {
    const changed: ScoreEntry[] = [];
    for (const team of teams) {
      const prev = prevTeamScores.current[team.id];
      if (prev !== undefined && prev !== team.score) {
        const idx = teams.findIndex(t => t.id === team.id);
        changed.push({ name: team.name, delta: team.score - prev, color: getTeamColor(team, idx), from: prev, to: team.score });
      }
      prevTeamScores.current[team.id] = team.score;
    }
    if (changed.length === 0) return;
    announceTimers.current.forEach(clearTimeout);
    const holdMs = 3900;   // fade-in + ~1s pause + count-up + time to read the new total
    const fadeMs = 420;
    setScoreAnnounce({ entries: changed, key: Date.now(), phase: "in" });
    announceTimers.current = [
      setTimeout(() => setScoreAnnounce(a => (a ? { ...a, phase: "out" } : null)), holdMs),
      setTimeout(() => setScoreAnnounce(null), holdMs + fadeMs),
    ];
  }, [teams]);

  // ── Powerup claim animation ─────────────────────────────────────────
  const prevTeamPowerups   = useRef<Record<number, JpPowerupType | null>>({});
  const powerupClaimTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  type PowerupClaim = { teamName: string; kind: JpPowerupType; key: number };
  const [powerupClaim, setPowerupClaim] = useState<PowerupClaim | null>(null);

  useEffect(() => {
    for (const team of teams) {
      const prev = prevTeamPowerups.current[team.id];
      if (prev !== undefined && prev === null && team.powerup !== null) {
        if (powerupClaimTimer.current) clearTimeout(powerupClaimTimer.current);
        setPowerupClaim({ teamName: team.name, kind: team.powerup, key: Date.now() });
        powerupClaimTimer.current = setTimeout(() => setPowerupClaim(null), 3200);
      }
      prevTeamPowerups.current[team.id] = team.powerup ?? null;
    }
  }, [teams]);

  // ── Special tile reveal overlay ─────────────────────────────────────
  // Full-screen dramatic splash when a buzzed or power-up tile is first hit.
  const prevSpecial   = useRef<string | null>(null);
  const prevAcked     = useRef(false);
  const specialTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  type SpecialReveal = { kind: "buzzed" | JpPowerupType; phase: "in" | "out"; key: number } | null;
  const [specialReveal, setSpecialReveal] = useState<SpecialReveal>(null);

  const special            = room?.board_state.activeQuestion?.special ?? null;
  const specialRevealAcked = room?.board_state.activeQuestion?.specialRevealAcked ?? false;

  // New special tile selected → play in animation, hold until host acks.
  useEffect(() => {
    if (special === prevSpecial.current) return;
    const prev = prevSpecial.current;
    prevSpecial.current = special;
    specialTimers.current.forEach(clearTimeout);
    specialTimers.current = [];
    if (special && !specialRevealAcked) {
      const kind = special === "buzzed" ? "buzzed" : special.slice("powerup_".length) as JpPowerupType;
      setSpecialReveal({ kind, phase: "in", key: Date.now() });
    } else if (!special && prev) {
      // Question dismissed before ack — clear immediately.
      setSpecialReveal(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [special]);

  // Host presses Continue (ack_special) → play out animation.
  useEffect(() => {
    if (!specialRevealAcked) { prevAcked.current = false; return; }
    if (prevAcked.current) return;
    prevAcked.current = true;
    specialTimers.current.forEach(clearTimeout);
    setSpecialReveal(r => r ? { ...r, phase: "out" } : null);
    specialTimers.current = [setTimeout(() => setSpecialReveal(null), 620)];
  }, [specialRevealAcked]);

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

    setCatAnim({ index: newIdx, name: cats[newIdx] ?? "", desc: board?.categoryDescriptions?.[newIdx] ?? "", total: cats.length, phase: "show" });

    const t1 = setTimeout(() => setCatAnim(a => a ? { ...a, phase: "hide" } : null), 1900);
    const t2 = setTimeout(() => setCatAnim(null), 2360);
    catTimers.current = [t1, t2];

    return () => { catTimers.current.forEach(clearTimeout); catTimers.current = []; };
  }, [revealedKey]);

  // ── Answer-reveal overlay fade in/out ──────────────────────────────
  // Mirror the server's lastResolution locally so the blurry board overlay
  // can fade OUT after the host dismisses it (once lastResolution clears),
  // rather than snapping away.
  const bs           = room?.board_state;
  const answerShown  = !!(bs && !bs.activeQuestion && !bs.powerupPrompt && bs.lastResolution);
  const answerResKey = answerShown ? bs!.lastResolution!.tileKey : null;
  const [answerReveal, setAnswerReveal] =
    useState<{ res: JpResolutionSummary; phase: "in" | "out"; key: number } | null>(null);
  const answerRevealTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    if (answerShown && bs?.lastResolution) {
      answerRevealTimers.current.forEach(clearTimeout);
      answerRevealTimers.current = [];
      const res = bs.lastResolution;
      setAnswerReveal(prev =>
        prev && prev.phase === "in" ? { ...prev, res } : { res, phase: "in", key: Date.now() });
    } else {
      setAnswerReveal(prev => {
        if (!prev || prev.phase === "out") return prev;
        answerRevealTimers.current.forEach(clearTimeout);
        answerRevealTimers.current = [setTimeout(() => setAnswerReveal(null), 440)];
        return { ...prev, phase: "out" };
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answerShown, answerResKey]);

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

  // Whose turn it is to pick. Read from across the room as a coloured frame
  // around the whole board rather than a line of text near it.
  const boardOwner = (() => {
    if ((state.activeBoardTeamId ?? null) === null) return null;
    const idx  = teams.findIndex(t => t.id === state.activeBoardTeamId);
    const team = teams[idx];
    return team ? { name: team.name, color: getTeamColor(team, idx) } : null;
  })();

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
  const SPECIAL_REVEAL_DESC: Record<string, string> = {
    buzzed:       "The team that picked this tile is automatically buzzed in — no escape!",
    sniper:       "Answer correctly to earn a permanent head-start on the buzzer!",
    buffer:       "Answer correctly to cushion any wrong-answer point loss!",
    secondChance: "Answer correctly to unlock two attempts on every future buzz!",
  };
  // Colour palette per tile type: [bgRgb, glowRgb]
  const SPECIAL_COLOURS: Record<string, [string, string]> = {
    buzzed:       ["30,0,0",   "220,30,30"],
    sniper:       ["40,28,0",  "220,160,0"],
    buffer:       ["0,15,60",  "50,130,255"],
    secondChance: ["0,35,20",  "50,210,130"],
  };

  return (
    <div className="flex-1 relative flex flex-col gap-4 p-4 sm:p-8">
      {/* Special tile reveal splash */}
      {specialReveal && (() => {
        const isBuzzed = specialReveal.kind === "buzzed";
        const meta     = isBuzzed ? null : POWERUP_META[specialReveal.kind as JpPowerupType];
        const [bgRgb, glowRgb] = SPECIAL_COLOURS[specialReveal.kind] ?? ["0,0,0", "255,255,255"];
        return (
          <div
            key={specialReveal.key}
            className={specialReveal.phase === "in" ? "jp-special-overlay-in" : "jp-special-overlay-out"}
            style={{
              position: "fixed", inset: 0, zIndex: 60, pointerEvents: "none",
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              gap: "1rem",
              background: `radial-gradient(ellipse at center, rgba(${glowRgb},0.35) 0%, rgba(${bgRgb},0.97) 60%)`,
              backdropFilter: "blur(6px)",
            }}
          >
            <div
              className={isBuzzed ? "jp-special-icon-shake" : "jp-special-icon-in"}
              style={{ fontSize: "clamp(5rem, 14vw, 9rem)", lineHeight: 1 }}
            >
              {isBuzzed ? "💥" : meta!.icon}
            </div>
            <p className="jp-special-title-in" style={{
              color: `rgb(${glowRgb})`,
              fontWeight: 900,
              fontSize: "clamp(2.8rem, 9vw, 6.5rem)",
              textTransform: "uppercase",
              letterSpacing: "0.07em",
              textShadow: `0 0 50px rgba(${glowRgb},0.65), 0 4px 24px rgba(0,0,0,0.7)`,
              lineHeight: 1.05,
              textAlign: "center",
            }}>
              {isBuzzed ? "BUZZED!" : `${meta!.name}!`}
            </p>
            <p className="jp-special-desc-in" style={{
              color: "rgba(255,255,255,0.82)",
              fontSize: "clamp(1rem, 2.8vw, 1.6rem)",
              textAlign: "center",
              maxWidth: "62vw",
              lineHeight: 1.45,
            }}>
              {SPECIAL_REVEAL_DESC[specialReveal.kind]}
            </p>
          </div>
        );
      })()}

      {/* Category reveal overlay */}
      {catAnim && (
        <div className="absolute inset-0 z-40 flex items-center justify-center overflow-hidden pointer-events-none"
          style={{
            backdropFilter: "blur(14px)",
            background:     "rgba(var(--bg-rgb), 0.45)",
            opacity:        catAnim.phase === "hide" ? 0 : 1,
            transition:     "opacity 0.4s ease-in",
          }}>
          <div className={catAnim.phase === "show" ? "jp-cat-appear" : "jp-cat-disappear"}
            style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.75rem", maxWidth: "80vw" }}>
            <p style={{
              color:         "rgb(var(--color-primary-rgb))",
              fontWeight:    900,
              textTransform: "uppercase",
              letterSpacing: "0.12em",
              textAlign:     "center",
              textShadow:    "0 2px 24px rgba(0,0,0,0.55)",
              fontSize:      "clamp(2.5rem, 7vw, 5.5rem)",
            }}>
              {catAnim.name}
            </p>
            {catAnim.desc && (
              <p style={{
                color:      "rgb(var(--text-secondary-rgb))",
                fontWeight: 600,
                textAlign:  "center",
                fontSize:   "clamp(1rem, 2.6vw, 1.7rem)",
                lineHeight: 1.4,
              }}>
                {catAnim.desc}
              </p>
            )}
          </div>
        </div>
      )}

      {soundChip}

      {game.config.board2Mode !== "off" && (
        <p className="text-center text-sm font-bold uppercase tracking-widest" style={secondary}>
          Board {state.currentBoard + 1}
        </p>
      )}
      <div className="flex-1 flex items-center">
        {/* The board owner's colour frames the whole board. An outline rather
            than a border so nothing reflows when the owner changes, and the
            name rides the frame so the colour still says WHO. */}
        {/* Transition only the frame — `transition-all` here would also animate
            the board's own layout every time a tile is spent. */}
        <div className="relative w-full rounded-xl transition-[outline-color,box-shadow] duration-300"
          style={boardOwner ? {
            outline:       `3px solid ${boardOwner.color}`,
            outlineOffset: "8px",
            boxShadow:     `0 0 48px ${boardOwner.color}33`,
          } : undefined}>
          {boardOwner && (
            <div className="absolute -top-4 left-8 px-3 py-0.5 rounded-full text-xs font-bold uppercase tracking-widest whitespace-nowrap"
              style={{ background: boardOwner.color, color: readableTextOn(boardOwner.color) }}>
              {boardOwner.name} picks
            </div>
          )}
          {board && <BoardGrid board={board} state={state} />}
        </div>
      </div>
      <PodiumStrip teams={teams} players={players} buzzedTeamId={q?.buzzedBy ?? null} />

      {/* Answer reveal — shown after every question resolves, until the next tile is picked.
          Driven by the local mirror so it can fade out on dismiss. */}
      {answerReveal && (() => {
        const res       = answerReveal.res;
        const revTile   = board?.tiles[res.tileKey];

        const hasAnswerContent = !!(
          revTile && (
            revTile.answerBlocks.length > 0 ||
            res.mode === "multipleChoice" ||
            res.mode === "closestNumber" ||
            res.mode === "ranking"
          )
        );
        // Who-scored feedback now lives in the bottom score pop-up. With no
        // answer to display, there's nothing for this overlay to add — skip it
        // so the board stays clear.
        if (!hasAnswerContent || !revTile) return null;

        return (
          <div className={`absolute inset-0 z-10 flex items-center justify-center p-4 sm:p-10 ${
            answerReveal.phase === "out" ? "jp-blur-out" : "jp-blur-in"}`}
            style={{ backdropFilter: "blur(6px)", background: "rgba(var(--bg-rgb), 0.6)" }}>
            <div className="w-full max-w-3xl rounded-2xl overflow-hidden"
              style={{ background: "rgb(var(--surface-raised-rgb))", border: "1px solid rgb(var(--border-rgb))", boxShadow: "0 24px 80px rgba(0,0,0,0.75)" }}>

              {/* Answer section */}
              {(
                <div className="px-8 py-6">
                  <p className="text-xs uppercase tracking-widest mb-4 font-bold" style={{ color: "rgb(var(--text-secondary-rgb))" }}>
                    Answer
                  </p>
                  <div className="flex flex-col items-center gap-3 text-center">
                    {/* Explicit answer blocks (text / image / audio / video) */}
                    {revTile.answerBlocks.map(b =>
                      b.type === "text"
                        ? <p key={b.id} className="font-black" style={{ fontSize: "clamp(1.5rem, 5vw, 3rem)", color: "rgb(var(--color-primary-rgb))" }}>{b.text}</p>
                        : b.type === "image"
                          ? <img key={b.id} src={b.url} alt="" className="max-h-[55vh] max-w-[80vw] rounded-lg object-contain" />
                          : <MediaPlayer key={b.id} block={b} buzzed={false} nonce={0} soundOn={soundOn} controls />)}
                    {/* MC: show the correct option */}
                    {res.mode === "multipleChoice" && revTile.answerModeConfig && (
                      <p className="font-black" style={{ fontSize: "clamp(1.2rem, 3.5vw, 2.5rem)", color: "rgb(var(--color-primary-rgb))" }}>
                        ✓ {(revTile.answerModeConfig as JpMultipleChoiceConfig).options[
                          (revTile.answerModeConfig as JpMultipleChoiceConfig).correctIndex
                        ]}
                      </p>
                    )}
                    {/* Closest number: show correct value */}
                    {res.mode === "closestNumber" && revTile.answerModeConfig && (
                      <p className="font-black" style={{ fontSize: "clamp(1.5rem, 5vw, 3rem)", color: "rgb(var(--color-primary-rgb))" }}>
                        {(revTile.answerModeConfig as JpClosestNumberConfig).correct}{" "}
                        {(revTile.answerModeConfig as JpClosestNumberConfig).unit}
                      </p>
                    )}
                    {/* Ranking: show correct order */}
                    {res.mode === "ranking" && revTile.answerModeConfig && (
                      <ol className="list-decimal list-inside text-left" style={{ color: "rgb(var(--color-primary-rgb))" }}>
                        {(revTile.answerModeConfig as JpRankingConfig).items.map((item, i) => (
                          <li key={i} className="font-bold" style={{ fontSize: "clamp(0.95rem, 2.5vw, 1.6rem)" }}>{item}</li>
                        ))}
                      </ol>
                    )}
                    {/* Submission-mode per-team results (each team's guess + outcome). */}
                    {res.mode !== "standard" && res.lines.length > 0 && (
                      <div className="mt-4 pt-4 w-full max-w-lg flex flex-col gap-1"
                        style={{ borderTop: "1px solid rgb(var(--border-rgb))" }}>
                        {res.lines.map((line, i) => (
                          <p key={i} className="font-semibold text-center" style={{ fontSize: "clamp(0.85rem, 2.2vw, 1.25rem)", color: "rgb(var(--text-secondary-rgb))" }}>{line}</p>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

            </div>
          </div>
        );
      })()}

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

      {/* Score pop-up — bottom of screen, no blur. The delta drops into the
          team's running total, which counts up/down to its new value. */}
      {scoreAnnounce && (
        <div className={`absolute inset-x-0 bottom-8 z-30 flex justify-center flex-wrap gap-5 px-4 pointer-events-none ${
          scoreAnnounce.phase === "out" ? "jp-blur-out" : "jp-blur-in"}`}>
          {scoreAnnounce.entries.map((e, i) => {
            const pos    = e.delta >= 0;
            const dColor = pos ? e.color : "rgb(var(--color-danger-rgb))";
            return (
              <div key={i} className="relative flex flex-col items-center rounded-2xl px-8 pt-8 pb-4"
                style={{
                  background: "rgb(var(--surface-raised-rgb))",
                  border:     `1px solid ${e.color}66`,
                  boxShadow:  "0 12px 48px rgba(0,0,0,0.6)",
                  minWidth:   "clamp(9rem, 18vw, 13rem)",
                }}>
                {/* The delta appears above the box, then is "pulled down" into the total. */}
                <span key={scoreAnnounce.key} className="jp-delta-drop absolute left-0 right-0 text-center font-black tabular-nums"
                  style={{ bottom: "100%", fontSize: "clamp(1.4rem, 3.4vw, 2.3rem)", color: dColor, textShadow: `0 0 24px ${dColor}99` }}>
                  {pos ? "+" : ""}{e.delta}
                </span>
                <span className="font-bold uppercase tracking-wide"
                  style={{ fontSize: "clamp(0.8rem, 1.6vw, 1.05rem)", color: e.color }}>
                  {e.name}
                </span>
                <span className="font-black tabular-nums leading-none mt-1"
                  style={{ fontSize: "clamp(2.4rem, 6vw, 4rem)", color: "rgb(var(--text-primary-rgb))" }}>
                  <ScoreCountUp from={e.from} to={e.to} />
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Powerup claim celebration */}
      {powerupClaim && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none"
          style={{ zIndex: 32 }}>
          <div
            key={powerupClaim.key}
            className="jp-powerup-claim flex flex-col items-center gap-4 rounded-2xl px-12 py-8 text-center"
            style={{
              background:     "rgba(var(--bg-rgb), 0.93)",
              border:         "1px solid rgba(var(--color-primary-rgb), 0.5)",
              backdropFilter: "blur(12px)",
              boxShadow:      "0 12px 48px rgba(0,0,0,0.55), 0 0 60px rgba(var(--color-primary-rgb), 0.2)",
            }}
          >
            <div style={{ fontSize: "clamp(4rem, 12vw, 7rem)", lineHeight: 1 }}>
              {POWERUP_META[powerupClaim.kind].icon}
            </div>
            <div>
              <p className="font-black" style={{
                fontSize: "clamp(1.8rem, 5vw, 3.5rem)",
                color:    "rgb(var(--color-primary-rgb))",
              }}>
                {powerupClaim.teamName}
              </p>
              <p style={{
                fontSize:  "clamp(1rem, 2.8vw, 2rem)",
                color:     "rgb(var(--text-secondary-rgb))",
                marginTop: "0.25rem",
              }}>
                claimed {POWERUP_META[powerupClaim.kind].name}!
              </p>
            </div>
          </div>
        </div>
      )}

      {q && tile && (
        <QuestionOverlay
          category={state.revealedCategories.includes(Number(q.tileKey.split("-")[0]))
            ? board!.categories[Number(q.tileKey.split("-")[0])]
            : "???"}
          categoryDesc={state.revealedCategories.includes(Number(q.tileKey.split("-")[0]))
            ? board!.categoryDescriptions?.[Number(q.tileKey.split("-")[0])]
            : undefined}
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
              // Pre-reveal: power-up tile waiting for host to press Continue.
              // Buzzed tiles always have questionRevealed=true so never reach here.
              q.special && q.special !== "buzzed" ? (
                <p className="font-black text-2xl sm:text-4xl animate-pulse" style={{ color: "rgb(var(--color-primary-rgb))" }}>
                  {POWERUP_META[(q.special as string).slice("powerup_".length) as JpPowerupType].icon} Special tile! Get ready…
                </p>
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
                  state.buzzersOpen ? (
                    <p className="font-bold text-xl sm:text-3xl" style={primary}>
                      Lock in your answers! {(q.submittedTeamIds ?? []).length}/{teams.length} in
                    </p>
                  ) : (
                    <>
                      <p className="font-black text-xl sm:text-3xl" style={primary}>
                        🎯 {modeLabel}
                      </p>
                      <p className="font-bold text-base sm:text-xl max-w-2xl text-center" style={secondary}>
                        {modeInstruction}
                      </p>
                      <p className="text-sm sm:text-base mt-1 animate-pulse" style={secondary}>
                        {teamMode ? "Gather around your captain's phone!" : "Open your phone to play!"}
                      </p>
                    </>
                  )
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
                  <BuzzArming openAt={state.buzzersOpenAt ?? null} />
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
