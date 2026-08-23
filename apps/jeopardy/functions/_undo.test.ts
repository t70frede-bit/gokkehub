import { describe, it, expect } from "vitest";
import { planUndo } from "./_undo";
import type { JpEventType, JpGameEvent } from "../src/lib/types";

let seq = 0;
const ev = (
  event_type: JpEventType,
  team_id: number | null,
  payload: Record<string, unknown> | null,
  atMs = ++seq * 1000,
): JpGameEvent => ({
  id:         seq,
  room_id:    "ABCD",
  event_type,
  team_id,
  player_id:  null,
  payload,
  created_at: new Date(1_700_000_000_000 + atMs).toISOString(),
});

const TILE = { tileKey: "2-3" };

describe("planUndo — scores", () => {
  it("reverses a single correct answer", () => {
    const plan = planUndo([ev("answer_correct", 1, { ...TILE, pointsDelta: 400 })]);
    expect(plan.scoreDeltas).toEqual([{ teamId: 1, delta: 400 }]);
  });

  it("reverses a wrong answer's loss", () => {
    const plan = planUndo([ev("answer_wrong", 2, { ...TILE, pointsDelta: -400 })]);
    expect(plan.scoreDeltas).toEqual([{ teamId: 2, delta: -400 }]);
  });

  it("sums several teams from one submission question", () => {
    const plan = planUndo([
      ev("answer_correct", 1, { ...TILE, pointsDelta: 320 }),
      ev("answer_correct", 2, { ...TILE, pointsDelta: 240 }),
    ]);
    expect(plan.scoreDeltas).toEqual([{ teamId: 1, delta: 320 }, { teamId: 2, delta: 240 }]);
  });

  it("nets a team's wrong-then-right sequence into one reversal", () => {
    // Second Chance: a free miss, then a doubled loss, then the award.
    const plan = planUndo([
      ev("answer_wrong",   1, { ...TILE, pointsDelta: 0, secondChance: true }),
      ev("answer_wrong",   1, { ...TILE, pointsDelta: -800 }),
      ev("answer_correct", 1, { ...TILE, pointsDelta: 400 }),
    ]);
    expect(plan.scoreDeltas).toEqual([{ teamId: 1, delta: -400 }]);
  });

  it("ignores events that moved no points", () => {
    const plan = planUndo([
      ev("tile_selected", null, TILE),
      ev("buzz_win",      1,    TILE),
      ev("answer_wrong",  1,    { ...TILE, pointsDelta: 0, secondChance: true }),
    ]);
    expect(plan.scoreDeltas).toEqual([]);
  });

  it("survives a malformed or missing payload", () => {
    const plan = planUndo([
      ev("answer_correct", 1, null),
      ev("answer_correct", 1, { ...TILE, pointsDelta: "nonsense" }),
      ev("answer_correct", 1, { ...TILE, pointsDelta: 100 }),
    ]);
    expect(plan.scoreDeltas).toEqual([{ teamId: 1, delta: 100 }]);
  });
});

describe("planUndo — power-ups", () => {
  it("restores nothing when the team had nothing before", () => {
    const plan = planUndo([
      ev("powerup_claimed", 1, { ...TILE, powerupType: "sniper", replaced: null }),
      ev("answer_correct",  1, { ...TILE, pointsDelta: 0, claimedPowerup: "sniper" }),
    ]);
    expect(plan.powerupRestores).toEqual([{ teamId: 1, powerup: null }]);
  });

  it("puts back the power-up a swap replaced", () => {
    const plan = planUndo([
      ev("powerup_swapped", 1, { ...TILE, powerupType: "sniper", replaced: "buffer" }),
    ]);
    expect(plan.powerupRestores).toEqual([{ teamId: 1, powerup: "buffer" }]);
  });

  it("takes the points payout of a declined power-up", () => {
    const plan = planUndo([
      ev("powerup_declined", 1, { ...TILE, powerupType: "sniper", tookPoints: 400 }),
      ev("answer_correct",   1, { ...TILE, pointsDelta: 400 }),
    ]);
    expect(plan.scoreDeltas).toEqual([{ teamId: 1, delta: 400 }]);
    expect(plan.powerupRestores).toEqual([]);
  });
});

describe("planUndo — undo, replay, undo again", () => {
  // The reason nothing is deleted when a question is undone: the marker in the
  // log is what stops the first run being reversed a second time.
  it("only reverses what happened after the last undo", () => {
    const plan = planUndo([
      ev("answer_correct",  1, { ...TILE, pointsDelta: 400 }),
      ev("question_undone", null, { ...TILE, reversed: [{ teamId: 1, delta: 400 }] }),
      ev("answer_correct",  2, { ...TILE, pointsDelta: 400 }),
    ]);
    expect(plan.scoreDeltas).toEqual([{ teamId: 2, delta: 400 }]);
  });

  it("reverses nothing when the tile was undone and not played again", () => {
    const plan = planUndo([
      ev("answer_correct",  1, { ...TILE, pointsDelta: 400 }),
      ev("question_undone", null, { ...TILE, reversed: [{ teamId: 1, delta: 400 }] }),
    ]);
    expect(plan.scoreDeltas).toEqual([]);
    expect(plan.powerupRestores).toEqual([]);
  });

  it("uses the most recent undo when there have been several", () => {
    const plan = planUndo([
      ev("answer_correct",  1, { ...TILE, pointsDelta: 100 }),
      ev("question_undone", null, TILE),
      ev("answer_correct",  2, { ...TILE, pointsDelta: 200 }),
      ev("question_undone", null, TILE),
      ev("answer_correct",  3, { ...TILE, pointsDelta: 300 }),
    ]);
    expect(plan.scoreDeltas).toEqual([{ teamId: 3, delta: 300 }]);
  });

  it("does not restore a power-up claimed before the last undo", () => {
    const plan = planUndo([
      ev("powerup_swapped", 1, { ...TILE, powerupType: "sniper", replaced: "buffer" }),
      ev("question_undone", null, TILE),
      ev("answer_correct",  1, { ...TILE, pointsDelta: 400 }),
    ]);
    expect(plan.powerupRestores).toEqual([]);
    expect(plan.scoreDeltas).toEqual([{ teamId: 1, delta: 400 }]);
  });
});

describe("planUndo — nothing to do", () => {
  it("returns empty for a tile with no events", () => {
    expect(planUndo([])).toEqual({ scoreDeltas: [], powerupRestores: [] });
  });
});
