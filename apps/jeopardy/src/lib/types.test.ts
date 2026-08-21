import { describe, it, expect } from "vitest";
import { ANSWER_MODE_META, TEAM_COLOR_PALETTE, getTeamColor } from "./types";
import type { JpAnswerMode } from "./types";

const ALL_MODES: JpAnswerMode[] = ["standard", "multipleChoice", "closestNumber", "ranking"];

describe("ANSWER_MODE_META", () => {
  it("covers every answer mode", () => {
    for (const mode of ALL_MODES) {
      expect(ANSWER_MODE_META[mode]?.icon, mode).toBeTruthy();
      expect(ANSWER_MODE_META[mode]?.label, mode).toBeTruthy();
    }
  });

  it("gives each mode a distinct glyph", () => {
    // The whole point is telling modes apart at a glance on the host's phone —
    // two modes sharing an icon would quietly defeat that.
    const icons = ALL_MODES.map(m => ANSWER_MODE_META[m].icon);
    expect(new Set(icons).size).toBe(ALL_MODES.length);
  });
});

describe("getTeamColor", () => {
  it("uses the team's own colour when it has one", () => {
    expect(getTeamColor({ color: "#123456" }, 3)).toBe("#123456");
  });

  it("falls back to the palette slot for the team's position", () => {
    expect(getTeamColor({ color: null }, 0)).toBe(TEAM_COLOR_PALETTE[0]);
    expect(getTeamColor({ color: null }, 2)).toBe(TEAM_COLOR_PALETTE[2]);
  });

  it("wraps around rather than running off the end of the palette", () => {
    const n = TEAM_COLOR_PALETTE.length;
    expect(getTeamColor({ color: null }, n)).toBe(TEAM_COLOR_PALETTE[0]);
    expect(getTeamColor({ color: null }, n + 1)).toBe(TEAM_COLOR_PALETTE[1]);
  });

  it("gives distinct colours to a full board of teams", () => {
    // Every screen resolves colours from the same sort_order-ordered list, so
    // as long as there are no more teams than palette slots, no two share one.
    const colors = Array.from({ length: TEAM_COLOR_PALETTE.length }, (_, i) =>
      getTeamColor({ color: null }, i));
    expect(new Set(colors).size).toBe(TEAM_COLOR_PALETTE.length);
  });
});
