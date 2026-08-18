import { describe, it, expect } from "vitest";
import { gradeSubmissions, formatResolutionLines, splitShare } from "./_scoring";
import type {
  JpAnswerMode, JpAnswerModeConfig, JpClosestNumberConfig,
  JpMultipleChoiceConfig, JpRankingConfig, JpSubmissionRow,
} from "../src/lib/types";

// These tests pin CURRENT behaviour. The scoring modes in the Round Two plan
// change the rules on purpose — when that lands, these expectations change with
// it, deliberately. Until then, a failure here means an accident.

const sub = (teamId: number, value: number | number[] | string, at = 0): JpSubmissionRow => ({
  team_id:    teamId,
  player_id:  `p${teamId}`,
  kind:       "answer",
  payload:    { value },
  created_at: new Date(1_700_000_000_000 + at).toISOString(),
});

const name = (id: number) => `Team ${id}`;
const grade = (mode: JpAnswerMode, cfg: JpAnswerModeConfig, value: number, subs: JpSubmissionRow[]) => {
  const g = gradeSubmissions(mode, cfg, value, subs);
  return { ...g, lines: formatResolutionLines(g, name) };
};

const mc = (over: Partial<JpMultipleChoiceConfig> = {}): JpMultipleChoiceConfig => ({
  options: ["Alpha", "Beta", "Gamma"], correctIndex: 1, firstCorrectOnly: false, ...over,
});
const cn = (over: Partial<JpClosestNumberConfig> = {}): JpClosestNumberConfig => ({
  input: "slider", unit: "kr.", correct: 100, min: 0, max: 200, ...over,
});
const rk = (over: Partial<JpRankingConfig> = {}): JpRankingConfig => ({
  items: ["A", "B", "C", "D"], scoring: "partial", ...over,
});

describe("splitShare", () => {
  it("pays the whole value to a single winner", () => {
    expect(splitShare(400, 1)).toBe(400);
    expect(splitShare(400, 0)).toBe(400);
  });

  it("rounds each share UP to the nearest 100", () => {
    expect(splitShare(300, 2)).toBe(200);   // 150 → 200, so 400 total
    expect(splitShare(400, 2)).toBe(200);
    expect(splitShare(500, 3)).toBe(200);   // 166.67 → 200
  });
});

describe("multipleChoice", () => {
  it("pays every correct team when firstCorrectOnly is false", () => {
    const g = grade("multipleChoice", mc(), 400, [sub(1, 1), sub(2, 1), sub(3, 0)]);
    expect(g.awards).toEqual([{ teamId: 1, delta: 400 }, { teamId: 2, delta: 400 }]);
    expect(g.lines).toEqual([
      "Team 1: Beta +400",
      "Team 2: Beta +400",
      "Team 3: Alpha",
    ]);
  });

  it("pays only the earliest correct team when firstCorrectOnly is true", () => {
    // getSubmissions returns created_at ascending, so the first correct row wins.
    const g = grade("multipleChoice", mc({ firstCorrectOnly: true }), 400,
      [sub(3, 0, 10), sub(1, 1, 20), sub(2, 1, 30)]);
    expect(g.awards).toEqual([{ teamId: 1, delta: 400 }]);
  });

  it("shows an em dash for an index that resolves to no option", () => {
    const g = grade("multipleChoice", mc(), 400, [sub(1, 9), sub(2, "nonsense")]);
    expect(g.awards).toEqual([]);
    expect(g.lines).toEqual(["Team 1: —", "Team 2: —"]);
  });

  it("reports the correct option for the reveal", () => {
    expect(grade("multipleChoice", mc(), 400, []).correct)
      .toEqual({ mode: "multipleChoice", index: 1, label: "Beta" });
  });
});

describe("closestNumber", () => {
  it("pays the nearest team only, and appends the answer line", () => {
    const g = grade("closestNumber", cn(), 400, [sub(1, 90), sub(2, 130)]);
    expect(g.awards).toEqual([{ teamId: 1, delta: 400 }]);
    expect(g.lines).toEqual([
      "Team 1: 90 kr. +400",
      "Team 2: 130 kr.",
      "Answer: 100 kr.",
    ]);
  });

  it("splits a tie under the round-up-to-100 rule", () => {
    const g = grade("closestNumber", cn(), 300, [sub(1, 90), sub(2, 110)]);
    expect(g.awards).toEqual([{ teamId: 1, delta: 200 }, { teamId: 2, delta: 200 }]);
  });

  it("ignores non-numeric answers when finding the winner", () => {
    const g = grade("closestNumber", cn(), 400, [sub(1, "dunno"), sub(2, 150)]);
    expect(g.awards).toEqual([{ teamId: 2, delta: 400 }]);
    expect(g.results[0]).toMatchObject({ teamId: 1, distance: null, rank: null, won: false });
  });

  it("pays nobody when no team submitted a number", () => {
    const g = grade("closestNumber", cn(), 400, [sub(1, "x")]);
    expect(g.awards).toEqual([]);
  });

  it("exposes distance, rank and the slider bounds for the reveal", () => {
    const g = grade("closestNumber", cn(), 400, [sub(1, 130), sub(2, 95)]);
    expect(g.results.map(r => [r.teamId, r.distance, r.rank])).toEqual([[1, 30, 2], [2, 5, 1]]);
    expect(g.correct).toEqual({ mode: "closestNumber", value: 100, unit: "kr.", min: 0, max: 200 });
  });
});

describe("ranking, exact scoring", () => {
  it("pays only a perfect order", () => {
    const g = grade("ranking", rk({ scoring: "exact" }), 400, [sub(1, [0, 1, 2, 3]), sub(2, [0, 1, 3, 2])]);
    expect(g.awards).toEqual([{ teamId: 1, delta: 400 }]);
    expect(g.lines).toEqual(["Team 1: 4/4 in place +400", "Team 2: 2/4 in place"]);
  });

  it("splits between multiple perfect orders", () => {
    const g = grade("ranking", rk({ scoring: "exact" }), 300, [sub(1, [0, 1, 2, 3]), sub(2, [0, 1, 2, 3])]);
    expect(g.awards).toEqual([{ teamId: 1, delta: 200 }, { teamId: 2, delta: 200 }]);
  });

  it("pays nothing for a nearly perfect order", () => {
    const g = grade("ranking", rk({ scoring: "exact" }), 400, [sub(1, [0, 1, 3, 2])]);
    expect(g.awards).toEqual([]);
  });

  it("rejects a short order even when every submitted item is in place", () => {
    const g = grade("ranking", rk({ scoring: "exact" }), 400, [sub(1, [0, 1])]);
    expect(g.awards).toEqual([]);
  });
});

describe("ranking, partial scoring", () => {
  it("pays each team floor(value * correct / n), independently", () => {
    const g = grade("ranking", rk(), 400, [sub(1, [0, 1, 3, 2]), sub(2, [0, 1, 2, 3])]);
    expect(g.awards).toEqual([{ teamId: 1, delta: 200 }, { teamId: 2, delta: 400 }]);
    expect(g.lines).toEqual(["Team 1: 2/4 in place +200", "Team 2: 4/4 in place +400"]);
  });

  it("floors the share rather than rounding it", () => {
    // 300 * 1 / 4 = 75 → 75, not 100.
    const g = grade("ranking", rk(), 300, [sub(1, [0, 3, 1, 2])]);
    expect(g.awards).toEqual([{ teamId: 1, delta: 75 }]);
  });

  it("keeps a zero-scoring team out of awards but still shows its line", () => {
    const g = grade("ranking", rk(), 400, [sub(1, [3, 2, 1, 0])]);
    expect(g.awards).toEqual([]);
    expect(g.lines).toEqual(["Team 1: 0/4 in place"]);
  });

  it("reports the correct order for the reveal", () => {
    expect(grade("ranking", rk(), 400, []).correct)
      .toEqual({ mode: "ranking", order: ["A", "B", "C", "D"] });
  });
});

describe("award ordering", () => {
  // action.ts takes the top award for a power-up prompt with a stable sort, and
  // hands the board to the first winner — so submission order must survive.
  it("keeps awards in submission order when deltas tie", () => {
    const g = grade("multipleChoice", mc(), 400, [sub(7, 1, 10), sub(3, 1, 20), sub(5, 1, 30)]);
    expect(g.awards.map(a => a.teamId)).toEqual([7, 3, 5]);
  });
});

// ── differential test ────────────────────────────────────────────────────────
// A verbatim copy of the grading as it was written inline in action.ts before
// the extraction. Phase 1 claims "no behaviour change"; this checks the claim
// across randomised inputs instead of trusting the eight cases above.

function legacyGrade(
  mode: JpAnswerMode, cfg: JpAnswerModeConfig, value: number, subs: JpSubmissionRow[],
): { awards: { teamId: number; delta: number }[]; lines: string[] } {
  const awards: { teamId: number; delta: number }[] = [];
  const lines:  string[] = [];

  if (mode === "multipleChoice") {
    const m = cfg as JpMultipleChoiceConfig;
    const correct = subs.filter(s => s.payload.value === m.correctIndex);
    const scorers = m.firstCorrectOnly ? correct.slice(0, 1) : correct;
    for (const s of subs) {
      const won = scorers.some(w => w.team_id === s.team_id);
      if (won) awards.push({ teamId: s.team_id, delta: value });
      const pick = typeof s.payload.value === "number" ? m.options[s.payload.value] : "—";
      lines.push(`${name(s.team_id)}: ${pick ?? "—"} ${won ? `+${value}` : ""}`.trim());
    }
  } else if (mode === "closestNumber") {
    const c = cfg as JpClosestNumberConfig;
    const valid = subs.filter(s => typeof s.payload.value === "number");
    const dist  = (s: JpSubmissionRow) => Math.abs((s.payload.value as number) - c.correct);
    const best  = valid.length ? Math.min(...valid.map(dist)) : null;
    const winners = best === null ? [] : valid.filter(s => dist(s) === best);
    const share = winners.length <= 1 ? value : Math.ceil(value / winners.length / 100) * 100;
    for (const s of subs) {
      const won = winners.some(w => w.team_id === s.team_id);
      if (won) awards.push({ teamId: s.team_id, delta: share });
      lines.push(`${name(s.team_id)}: ${s.payload.value} ${c.unit} ${won ? `+${share}` : ""}`.trim());
    }
    lines.push(`Answer: ${c.correct} ${c.unit}`);
  } else if (mode === "ranking") {
    const r = cfg as JpRankingConfig;
    const n = r.items.length;
    if (r.scoring === "exact") {
      const perfect = subs.filter(s => {
        const order = Array.isArray(s.payload.value) ? s.payload.value as number[] : [];
        return order.length === n && order.every((v, i) => v === i);
      });
      const share = perfect.length <= 1 ? value : Math.ceil(value / perfect.length / 100) * 100;
      for (const s of subs) {
        const won = perfect.some(w => w.team_id === s.team_id);
        if (won) awards.push({ teamId: s.team_id, delta: share });
        const order = Array.isArray(s.payload.value) ? s.payload.value as number[] : [];
        const correctCount = order.filter((v, i) => v === i).length;
        lines.push(`${name(s.team_id)}: ${correctCount}/${n} in place ${won ? `+${share}` : ""}`.trim());
      }
    } else {
      for (const s of subs) {
        const order = Array.isArray(s.payload.value) ? s.payload.value as number[] : [];
        const correctCount = order.filter((v, i) => v === i).length;
        const delta = Math.floor((value * correctCount) / n);
        if (delta > 0) awards.push({ teamId: s.team_id, delta });
        lines.push(`${name(s.team_id)}: ${correctCount}/${n} in place ${delta > 0 ? `+${delta}` : ""}`.trim());
      }
    }
  }
  return { awards, lines };
}

describe("extraction is behaviour-preserving", () => {
  // Deterministic PRNG so a failure is reproducible.
  let seed = 20260818;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
  const int  = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));

  const shuffled = (n: number) => {
    const a = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };

  it("matches the pre-refactor implementation over 600 random rounds", () => {
    for (let round = 0; round < 600; round++) {
      const mode = pick<JpAnswerMode>(["multipleChoice", "closestNumber", "ranking"]);
      const value = pick([0, 100, 200, 300, 400, 500, 1000]);
      const teamCount = int(0, 4);

      let cfg: JpAnswerModeConfig;
      const subs: JpSubmissionRow[] = [];

      if (mode === "multipleChoice") {
        const options = ["A", "B", "C", "D"].slice(0, int(2, 4));
        cfg = { options, correctIndex: int(0, options.length - 1), firstCorrectOnly: rnd() < 0.5 };
        for (let t = 1; t <= teamCount; t++) {
          // Sometimes out of range, sometimes not a number at all.
          const v = rnd() < 0.15 ? "?" : int(0, options.length);
          subs.push(sub(t, v, t * 10));
        }
      } else if (mode === "closestNumber") {
        cfg = { input: "field", unit: pick(["kr.", "%", ""]), correct: int(0, 200), min: 0, max: 200 };
        for (let t = 1; t <= teamCount; t++) {
          const v = rnd() < 0.15 ? "skip" : int(0, 200);
          subs.push(sub(t, v, t * 10));
        }
      } else {
        const n = int(2, 5);
        cfg = {
          items: Array.from({ length: n }, (_, i) => `item${i}`),
          scoring: rnd() < 0.5 ? "exact" : "partial",
        };
        for (let t = 1; t <= teamCount; t++) {
          const v = rnd() < 0.2
            ? shuffled(n).slice(0, int(1, n))      // short / malformed order
            : (rnd() < 0.4 ? Array.from({ length: n }, (_, i) => i) : shuffled(n));
          subs.push(sub(t, v, t * 10));
        }
      }

      const legacy = legacyGrade(mode, cfg, value, subs);
      const now    = grade(mode, cfg, value, subs);

      expect({ awards: now.awards, lines: now.lines }, `round ${round}, mode ${mode}`).toEqual(legacy);
    }
  });
});
