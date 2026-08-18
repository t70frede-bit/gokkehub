import type {
  JpAnswerMode, JpAnswerModeConfig, JpClosestNumberConfig,
  JpMultipleChoiceConfig, JpRankingConfig, JpSubmissionRow,
} from "../src/lib/types";

/**
 * Grading for the submission answer modes (multiple choice, closest number,
 * ranking). Pure — no env, no room, no fetch — so the payout rules can be read
 * and tested on their own. `action.ts` owns everything around it: reading the
 * submissions, writing scores, the power-up prompt, the room state.
 *
 * Two outputs, deliberately separated:
 *  - `awards` decides money. Its ORDER IS LOAD-BEARING: `action.ts` takes the
 *    top award for a power-up prompt (stable sort, so ties keep submission
 *    order) and the first winner takes the board. Push in submission order.
 *  - `results` describes what happened, per team, as data — distances, ranks,
 *    counts — so the big screen can draw a reveal instead of printing a
 *    sentence. `formatResolutionLines` renders the strings the big screen shows
 *    today; anything richer reads `results` directly.
 */

export interface JpAward {
  teamId: number;
  delta:  number;
}

/** One team's outcome on a submission question. Mode-specific fields are optional. */
export interface JpTeamResult {
  teamId: number;
  /** Exactly what the team submitted, untouched — may be unusable for the mode. */
  answer: number | number[] | string | null;
  delta:  number;
  /** Did this team take points (or, in exact ranking, get it perfect)? */
  won:    boolean;

  /** multipleChoice: the chosen option, and its label when the index resolves. */
  choiceIndex?: number | null;
  choiceLabel?: string | null;

  /** closestNumber: absolute distance from the correct value, 1-based rank by it. */
  distance?: number | null;
  rank?:     number | null;

  /** ranking: how many items landed in the right place, out of how many. */
  correctCount?: number;
  of?:           number;
}

/** The right answer, shaped for the reveal. `min`/`max` let a slider be redrawn. */
export type JpCorrectAnswer =
  | { mode: "multipleChoice"; index: number; label: string }
  | { mode: "closestNumber";  value: number; unit: string; min?: number; max?: number }
  | { mode: "ranking";        order: string[] }
  | { mode: "standard" };

export interface JpGradeResult {
  mode:    JpAnswerMode;
  awards:  JpAward[];
  results: JpTeamResult[];
  correct: JpCorrectAnswer;
}

/**
 * House rule for a tie: the value is divided, then each share is rounded UP to
 * the nearest 100 — 300 split two ways pays 200 each. Generous on purpose.
 */
export function splitShare(value: number, winners: number): number {
  return winners <= 1 ? value : Math.ceil(value / winners / 100) * 100;
}

export function gradeSubmissions(
  mode:  JpAnswerMode,
  cfg:   JpAnswerModeConfig,
  value: number,
  subs:  JpSubmissionRow[],
): JpGradeResult {
  const awards:  JpAward[]      = [];
  const results: JpTeamResult[] = [];

  if (mode === "multipleChoice") {
    const mc      = cfg as JpMultipleChoiceConfig;
    const correct = subs.filter(s => s.payload.value === mc.correctIndex);
    // Submissions arrive ordered by created_at, so slice(0,1) is the fastest.
    const scorers = mc.firstCorrectOnly ? correct.slice(0, 1) : correct;

    for (const s of subs) {
      const won = scorers.some(w => w.team_id === s.team_id);
      if (won) awards.push({ teamId: s.team_id, delta: value });
      const index = typeof s.payload.value === "number" ? s.payload.value : null;
      results.push({
        teamId:      s.team_id,
        answer:      s.payload.value ?? null,
        delta:       won ? value : 0,
        won,
        choiceIndex: index,
        choiceLabel: index === null ? null : (mc.options[index] ?? null),
      });
    }
    return {
      mode, awards, results,
      correct: { mode, index: mc.correctIndex, label: mc.options[mc.correctIndex] ?? "" },
    };
  }

  if (mode === "closestNumber") {
    const cn    = cfg as JpClosestNumberConfig;
    const valid = subs.filter(s => typeof s.payload.value === "number");
    const dist  = (s: JpSubmissionRow) => Math.abs((s.payload.value as number) - cn.correct);
    const best  = valid.length ? Math.min(...valid.map(dist)) : null;
    const winners = best === null ? [] : valid.filter(s => dist(s) === best);
    const share   = splitShare(value, winners.length);

    // Rank by distance for the reveal; a non-numeric answer has no rank.
    const ordered = [...valid].sort((a, b) => dist(a) - dist(b));

    for (const s of subs) {
      const won     = winners.some(w => w.team_id === s.team_id);
      const numeric = typeof s.payload.value === "number";
      if (won) awards.push({ teamId: s.team_id, delta: share });
      results.push({
        teamId:   s.team_id,
        answer:   s.payload.value ?? null,
        delta:    won ? share : 0,
        won,
        distance: numeric ? dist(s) : null,
        rank:     numeric ? ordered.findIndex(o => o.team_id === s.team_id) + 1 : null,
      });
    }
    return {
      mode, awards, results,
      correct: { mode, value: cn.correct, unit: cn.unit, min: cn.min, max: cn.max },
    };
  }

  if (mode === "ranking") {
    const rk = cfg as JpRankingConfig;
    const n  = rk.items.length;
    const orderOf = (s: JpSubmissionRow) =>
      Array.isArray(s.payload.value) ? s.payload.value as number[] : [];
    const inPlace = (s: JpSubmissionRow) => orderOf(s).filter((v, i) => v === i).length;

    if (rk.scoring === "exact") {
      // All-or-nothing: only a perfect order pays, and perfects split the tile.
      const perfect = subs.filter(s => {
        const order = orderOf(s);
        return order.length === n && order.every((v, i) => v === i);
      });
      const share = splitShare(value, perfect.length);

      for (const s of subs) {
        const won = perfect.some(w => w.team_id === s.team_id);
        if (won) awards.push({ teamId: s.team_id, delta: share });
        results.push({
          teamId: s.team_id,
          answer: s.payload.value ?? null,
          delta:  won ? share : 0,
          won,
          correctCount: inPlace(s),
          of: n,
        });
      }
    } else {
      // Partial credit: every team is paid for what it got right, independently.
      for (const s of subs) {
        const correctCount = inPlace(s);
        const delta = Math.floor((value * correctCount) / n);
        if (delta > 0) awards.push({ teamId: s.team_id, delta });
        results.push({
          teamId: s.team_id,
          answer: s.payload.value ?? null,
          delta,
          won: delta > 0,
          correctCount,
          of: n,
        });
      }
    }
    return { mode, awards, results, correct: { mode, order: rk.items } };
  }

  return { mode, awards, results, correct: { mode: "standard" } };
}

/**
 * The per-team lines the big screen prints after a submission question.
 * Kept byte-identical to what `action.ts` produced inline before the grading
 * moved out — the reveal redesign replaces this, not the grader.
 */
export function formatResolutionLines(
  graded: JpGradeResult,
  teamName: (teamId: number) => string,
): string[] {
  const lines: string[] = [];

  for (const r of graded.results) {
    if (graded.mode === "multipleChoice") {
      lines.push(`${teamName(r.teamId)}: ${r.choiceLabel ?? "—"} ${r.won ? `+${r.delta}` : ""}`.trim());
    } else if (graded.mode === "closestNumber") {
      const unit = graded.correct.mode === "closestNumber" ? graded.correct.unit : "";
      lines.push(`${teamName(r.teamId)}: ${r.answer} ${unit} ${r.won ? `+${r.delta}` : ""}`.trim());
    } else if (graded.mode === "ranking") {
      // `won` rather than `delta > 0`: in exact mode a perfect order on a
      // zero-value tile still printed "+0" before, and that stays true.
      lines.push(
        `${teamName(r.teamId)}: ${r.correctCount}/${r.of} in place ${r.won ? `+${r.delta}` : ""}`.trim());
    }
  }

  if (graded.correct.mode === "closestNumber") {
    lines.push(`Answer: ${graded.correct.value} ${graded.correct.unit}`);
  }
  return lines;
}
