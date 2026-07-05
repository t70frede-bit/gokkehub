import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button, Panel } from "@gokkehub/ui";
import { getStoredPlayerId, useRoom } from "../hooks/useRoom";
import { useBuzzer } from "../hooks/useBuzzer";
import BuzzerButton from "../components/BuzzerButton";
import AnswerTimer from "../components/AnswerTimer";
import PowerUpPrompt from "../components/PowerUpPrompt";
import MultipleChoice from "../components/AnswerModes/MultipleChoice";
import ClosestNumber from "../components/AnswerModes/ClosestNumber";
import Ranking from "../components/AnswerModes/Ranking";
import type {
  JpClosestNumberConfig, JpMultipleChoiceConfig, JpRankingConfig,
} from "../lib/types";
import { POWERUP_META, getBoard } from "../lib/types";

const inputStyle = {
  background: "rgb(var(--surface-input-rgb))",
  border:     "1px solid rgb(var(--border-rgb))",
  color:      "rgb(var(--text-primary-rgb))",
} as const;

export default function PlayerPage() {
  const navigate   = useNavigate();
  const { roomId } = useParams();
  const { room, game, teams, players, loading, error } = useRoom(roomId);

  const playerId = roomId ? getStoredPlayerId(roomId) : null;
  const me       = useMemo(() => players.find(p => p.id === playerId) ?? null, [players, playerId]);
  const myTeam   = useMemo(() => teams.find(t => t.id === me?.team_id) ?? null, [teams, me]);

  const { phase, buzz, inFlight } = useBuzzer(
    room, playerId, me?.team_id ?? null,
    game?.config.buzzer.queueMode ?? "rebuzz",
  );

  const [busy, setBusy]           = useState(false);
  const [wager, setWager]         = useState("");
  const [finalAnswer, setFinalAnswer] = useState("");
  const [submitErr, setSubmitErr] = useState<string | null>(null);

  useEffect(() => {
    if (!room || !roomId) return;
    if (room.status === "lobby")    navigate(`/lobby/${roomId}`, { replace: true });
    if (room.status === "finished") navigate(`/end/${roomId}`, { replace: true });
  }, [room?.status, roomId]);

  const submit = useCallback(async (kind: string, value: unknown): Promise<void> => {
    if (!roomId || !playerId) return;
    setBusy(true);
    setSubmitErr(null);
    try {
      const res = await fetch(`/room/${roomId}/submit`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ player_id: playerId, kind, value }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: string } | null;
        setSubmitErr(body?.error ?? "Could not submit");
      }
    } catch {
      setSubmitErr("Network error");
    } finally {
      setBusy(false);
    }
  }, [roomId, playerId]);

  const powerupChoice = useCallback(async (choice: "points" | "powerup") => {
    if (!roomId || !playerId) return;
    setBusy(true);
    try {
      await fetch(`/room/${roomId}/powerup-choice`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ player_id: playerId, choice }),
      });
    } finally {
      setBusy(false);
    }
  }, [roomId, playerId]);

  if (loading) return <div className="flex-1 flex items-center justify-center opacity-60">Loading…</div>;
  if (error || !room || !game) {
    return <div className="flex-1 flex items-center justify-center">{error ?? "Room not found"}</div>;
  }
  if (!playerId || !me || !myTeam) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6">
        <p style={{ color: "rgb(var(--text-secondary-rgb))" }}>You haven't joined this game yet.</p>
        <Link to={`/join?room=${room.id}`}><Button>Join room {room.id}</Button></Link>
      </div>
    );
  }

  const state  = room.board_state;
  const q      = state.activeQuestion;
  const board  = getBoard(game.config, state.currentBoard);
  const tile   = q && board ? board.tiles[q.tileKey] : null;
  const mode   = q?.mode ?? "standard";
  const final  = state.final ?? null;
  const prompt = state.powerupPrompt ?? null;
  const seed   = `${playerId}:${q?.tileKey ?? ""}`;
  const mySubmitted = (q?.submittedTeamIds ?? []).includes(myTeam.id);
  const myFinalSubmitted = (final?.submittedTeamIds ?? []).includes(myTeam.id);

  const teamMode    = game.config.teams?.mode === "teams";
  const isCaptain   = myTeam.captain_id === me.id;
  const captainName = players.find(p => p.id === myTeam.captain_id)?.name ?? "your captain";
  const captainOnlyBuzz = teamMode && game.config.teams?.buzzerMode === "captain" && !isCaptain;

  // Device questions and Final Jeopardy always run on the captain's phone —
  // the team gathers around it. Everyone else gets a pointer, not inputs.
  const gatherAround = (
    <p className="text-center py-6" style={{ color: "rgb(var(--text-secondary-rgb))" }}>
      ⭐ Gather around <span className="font-bold">{captainName}</span>'s phone —
      your team answers there!
    </p>
  );

  const header = (
    <div className="flex justify-between items-center rounded-lg px-4 py-3"
      style={{ background: "rgb(var(--surface-raised-rgb))", border: "1px solid rgb(var(--border-rgb))" }}>
      <span className="font-bold truncate">
        {myTeam.powerup && (
          <span className="mr-1.5" title={POWERUP_META[myTeam.powerup].name}>
            {POWERUP_META[myTeam.powerup].icon}
          </span>
        )}
        {me.name}
      </span>
      <span className="font-black text-xl tabular-nums"
        style={{ color: myTeam.score < 0 ? "rgb(var(--color-danger-rgb))" : "rgb(var(--color-primary-rgb))" }}>
        {myTeam.score}
      </span>
    </div>
  );

  // ── Power-up choice belongs to my team ────────────────────────────────
  if (prompt && prompt.teamId === myTeam.id) {
    return (
      <div className="flex-1 w-full max-w-md mx-auto p-4 flex flex-col gap-4">
        {header}
        <PowerUpPrompt prompt={prompt} onChoice={powerupChoice} busy={busy} />
      </div>
    );
  }

  // ── Final Jeopardy ────────────────────────────────────────────────────
  if (final) {
    return (
      <div className="flex-1 w-full max-w-md mx-auto p-4 flex flex-col gap-4">
        {header}
        <Panel>
          <p className="text-xs uppercase tracking-widest mb-1"
            style={{ color: "rgb(var(--text-secondary-rgb))" }}>
            Final Jeopardy — {final.category}
          </p>
          {(final.stage === "wager" || final.stage === "question") && teamMode && !isCaptain ? (
            myFinalSubmitted
              ? <p className="text-center font-bold py-6" style={{ color: "rgb(var(--color-primary-rgb))" }}>
                  Your team is locked in ✓
                </p>
              : gatherAround
          ) : null}
          {(!teamMode || isCaptain) && final.stage === "wager" && (
            myFinalSubmitted ? (
              <p className="text-center font-bold py-6" style={{ color: "rgb(var(--color-primary-rgb))" }}>
                Wager locked in ✓
              </p>
            ) : (
              <div className="flex flex-col gap-3 mt-2">
                <p className="text-sm" style={{ color: "rgb(var(--text-secondary-rgb))" }}>
                  Wager up to {Math.max(0, myTeam.score)} points on the final question.
                </p>
                <input type="number" inputMode="numeric" min={0} max={Math.max(0, myTeam.score)}
                  value={wager} placeholder="0" onChange={e => setWager(e.target.value)}
                  className="w-full px-4 py-3 rounded-md text-2xl font-bold text-center outline-none"
                  style={inputStyle} />
                <Button fullWidth size="lg" loading={busy}
                  disabled={!Number.isFinite(Number(wager)) || wager === ""}
                  onClick={() => submit("final_wager", Number(wager))}>
                  Lock in wager
                </Button>
              </div>
            )
          )}
          {(!teamMode || isCaptain) && final.stage === "question" && (
            myFinalSubmitted ? (
              <p className="text-center font-bold py-6" style={{ color: "rgb(var(--color-primary-rgb))" }}>
                Answer locked in ✓
              </p>
            ) : (
              <div className="flex flex-col gap-3 mt-2">
                {(game.config.finalJeopardy?.questionBlocks ?? []).map(b =>
                  b.type === "text" ? <p key={b.id} className="font-bold text-lg">{b.text}</p> : null)}
                <textarea rows={3} value={finalAnswer} placeholder="Your answer…"
                  onChange={e => setFinalAnswer(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-md font-sans text-base outline-none"
                  style={inputStyle} />
                <Button fullWidth size="lg" loading={busy} disabled={!finalAnswer.trim()}
                  onClick={() => submit("final_answer", finalAnswer.trim())}>
                  Submit answer
                </Button>
              </div>
            )
          )}
          {final.stage === "judging" && (
            <p className="text-center py-6" style={{ color: "rgb(var(--text-secondary-rgb))" }}>
              The host is judging answers — watch the big screen!
            </p>
          )}
          {submitErr && <p className="text-sm mt-2" style={{ color: "rgb(var(--color-danger-rgb))" }}>{submitErr}</p>}
        </Panel>
      </div>
    );
  }

  // ── Submission answer modes ───────────────────────────────────────────
  if (q && tile && mode !== "standard") {
    return (
      <div className="flex-1 w-full max-w-md mx-auto p-4 flex flex-col gap-4">
        {header}
        <Panel>
          {tile.questionBlocks.map(b =>
            b.type === "text"
              ? <p key={b.id} className="font-bold text-lg mb-2">{b.text}</p>
              : b.type === "image"
                ? <img key={b.id} src={b.url} alt="" className="rounded-md mb-2 max-h-48 object-contain" />
                : <p key={b.id} className="text-sm mb-2" style={{ color: "rgb(var(--text-secondary-rgb))" }}>
                    {b.type === "audio" ? "🎵 Listen on the big screen" : "🎬 Watch the big screen"}
                  </p>)}
          {teamMode && !isCaptain ? (
            mySubmitted
              ? <p className="text-center font-bold py-6" style={{ color: "rgb(var(--color-primary-rgb))" }}>
                  Your team is locked in ✓
                </p>
              : gatherAround
          ) : !state.buzzersOpen && !mySubmitted ? (
            <p className="text-center py-4" style={{ color: "rgb(var(--text-secondary-rgb))" }}>
              Waiting for the host to open answers…
            </p>
          ) : mode === "multipleChoice" ? (
            <MultipleChoice cfg={tile.answerModeConfig as JpMultipleChoiceConfig}
              seed={seed} submitted={mySubmitted} busy={busy}
              onSubmit={v => submit("answer", v)} />
          ) : mode === "closestNumber" ? (
            <ClosestNumber cfg={tile.answerModeConfig as JpClosestNumberConfig}
              submitted={mySubmitted} busy={busy}
              onSubmit={v => submit("answer", v)} />
          ) : (
            <Ranking cfg={tile.answerModeConfig as JpRankingConfig}
              seed={seed} submitted={mySubmitted} busy={busy}
              onSubmit={v => submit("answer", v)} />
          )}
          {submitErr && <p className="text-sm mt-2" style={{ color: "rgb(var(--color-danger-rgb))" }}>{submitErr}</p>}
        </Panel>
      </div>
    );
  }

  // ── Standard buzzer ───────────────────────────────────────────────────
  return (
    <div className="flex-1 w-full max-w-md mx-auto p-4 flex flex-col gap-4">
      {header}
      {captainOnlyBuzz && q ? (
        <div className="jp-buzzer w-full flex-1 min-h-64 rounded-2xl flex items-center justify-center font-bold text-xl text-center p-6"
          style={{
            background: "rgb(var(--surface-input-rgb))",
            border:     "1px solid rgb(var(--border-rgb))",
            color:      "rgba(var(--text-secondary-rgb), 0.8)",
          }}>
          ⭐ {captainName} buzzes for your team
        </div>
      ) : (
        <BuzzerButton phase={phase} inFlight={inFlight} onBuzz={buzz} />
      )}
      {phase === "you-buzzed" && (
        <div className="text-center">
          <p className="font-bold mb-1">
            {q?.secondChanceUsed && myTeam.powerup === "secondChance"
              ? "🎯 Second chance — answer again!"
              : "Answer out loud — the host judges!"}
          </p>
          <AnswerTimer startMs={q?.timerStart ?? null} />
        </div>
      )}
      {q?.special === "buzzed" && phase === "you-buzzed" && (
        <p className="text-center font-bold" style={{ color: "rgb(var(--color-danger-rgb))" }}>
          💥 Buzzed tile — you have to answer this one!
        </p>
      )}
    </div>
  );
}
