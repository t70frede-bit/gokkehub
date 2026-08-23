import type { JpGameEvent, JpPowerupType } from "../src/lib/types";

/**
 * Works out what undoing a question has to reverse, from that tile's event log
 * alone. Pure — `action.ts` does the reading and writing.
 *
 * Every score change for a tile logs its own `pointsDelta`, and a power-up claim
 * logs what it `replaced`, so the log is a complete record of what the question
 * did. Nothing is deleted when a question is undone: an undo appends its own
 * marker instead, which keeps post-game history honest AND is what makes a
 * second undo correct — see below.
 */

export interface JpUndoPlan {
  /** Subtract each delta from that team's score. */
  scoreDeltas:     { teamId: number; delta: number }[];
  /** Put each team's power-up back to what it was before this question. */
  powerupRestores: { teamId: number; powerup: JpPowerupType | null }[];
}

export function planUndo(events: JpGameEvent[]): JpUndoPlan {
  // A tile can be undone, played again, and undone again. Only what happened
  // AFTER the most recent undo of this tile is still live; everything before it
  // was already reversed, and counting it twice would take points a team never
  // got back.
  const lastUndoAt = [...events].reverse()
    .find(e => e.event_type === "question_undone")?.created_at ?? null;
  const live = lastUndoAt ? events.filter(e => e.created_at > lastUndoAt) : events;

  const totals = new Map<number, number>();
  for (const e of live) {
    const delta = Number(e.payload?.pointsDelta ?? 0);
    if (e.team_id === null || !Number.isFinite(delta) || delta === 0) continue;
    totals.set(e.team_id, (totals.get(e.team_id) ?? 0) + delta);
  }

  // Only the FIRST claim in this run matters: if a team somehow claimed twice,
  // the earliest one holds what they had before the question started.
  const restores = new Map<number, JpPowerupType | null>();
  for (const e of live) {
    if (e.event_type !== "powerup_claimed" && e.event_type !== "powerup_swapped") continue;
    if (e.team_id === null || restores.has(e.team_id)) continue;
    restores.set(e.team_id, (e.payload?.replaced as JpPowerupType | null) ?? null);
  }

  return {
    scoreDeltas: [...totals.entries()]
      .filter(([, delta]) => delta !== 0)
      .map(([teamId, delta]) => ({ teamId, delta })),
    powerupRestores: [...restores.entries()].map(([teamId, powerup]) => ({ teamId, powerup })),
  };
}
