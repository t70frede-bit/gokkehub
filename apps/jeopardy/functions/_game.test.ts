import { describe, it, expect } from "vitest";
import { assignSpecialTiles } from "./_game";
import type { JpGameConfig, JpTileConfig } from "../src/lib/types";

// Manual special-tile placement is re-validated server-side at launch, so a
// stale or hand-edited config can't put a special somewhere the game can't
// handle. These cover the rules assignSpecialTiles enforces in "manual" mode.

const tile = (answerMode: JpTileConfig["answerMode"] = "standard"): JpTileConfig => ({
  questionBlocks: [{ id: "q", type: "text", text: "Q" }],
  answerBlocks:   [],
  answerMode,
});

function config(overrides: Partial<JpGameConfig> = {}): JpGameConfig {
  return {
    boards: [{
      categories:  ["A", "B"],
      rows:        2,
      pointValues: [100, 200],
      tiles: {
        "0-0": tile(),
        "0-1": tile(),
        "1-0": tile("multipleChoice"),
        // "1-1" deliberately left empty
      },
    }],
    buzzer: {
      noRebuzz:               false,
      teamLockout:            false,
      defaultBuzzDisplayMode: "stay",
      collectionWindowMs:     300,
    },
    powerups: {
      sniper:       { enabled: true,  rowRange: [0, 1] },
      buffer:       { enabled: false, rowRange: [0, 1] },
      secondChance: { enabled: false, rowRange: [0, 1] },
    },
    dangerous:        { buzzed: { enabled: true, count: 1, rowRange: [0, 1] } },
    specialPlacement: "manual",
    ...overrides,
  };
}

describe("assignSpecialTiles — manual placement", () => {
  it("keeps pins that point at filled, eligible tiles", () => {
    const out = assignSpecialTiles(config({
      manualSpecials: { board0: { "0-0": "buzzed", "0-1": "powerup_sniper" } },
    }));
    expect(out.board0).toEqual({ "0-0": "buzzed", "0-1": "powerup_sniper" });
  });

  it("drops Buzzed pinned on a submission tile — it can't be buzzed", () => {
    const out = assignSpecialTiles(config({
      manualSpecials: { board0: { "1-0": "buzzed" } },
    }));
    expect(out.board0).toEqual({});
  });

  it("drops pins on tiles that no longer have a question", () => {
    const out = assignSpecialTiles(config({
      manualSpecials: { board0: { "1-1": "buzzed" } },
    }));
    expect(out.board0).toEqual({});
  });

  it("drops power-ups that are switched off, without touching the pins", () => {
    const out = assignSpecialTiles(config({
      manualSpecials: { board0: { "0-0": "powerup_buffer", "0-1": "powerup_sniper" } },
    }));
    expect(out.board0).toEqual({ "0-1": "powerup_sniper" });
  });

  it("allows only one tile per power-up per board", () => {
    const out = assignSpecialTiles(config({
      manualSpecials: { board0: { "0-0": "powerup_sniper", "0-1": "powerup_sniper" } },
    }));
    expect(Object.values(out.board0)).toEqual(["powerup_sniper"]);
  });

  it("allows several Buzzed tiles on one board", () => {
    const out = assignSpecialTiles(config({
      manualSpecials: { board0: { "0-0": "buzzed", "0-1": "buzzed" } },
    }));
    expect(out.board0).toEqual({ "0-0": "buzzed", "0-1": "buzzed" });
  });

  it("ignores the manual map entirely in random placement", () => {
    const out = assignSpecialTiles(config({
      specialPlacement: "random",
      manualSpecials:   { board0: { "0-0": "buzzed" } },
      powerups: {
        sniper:       { enabled: false, rowRange: [0, 1] },
        buffer:       { enabled: false, rowRange: [0, 1] },
        secondChance: { enabled: false, rowRange: [0, 1] },
      },
      dangerous: { buzzed: { enabled: false, count: 1, rowRange: [0, 1] } },
    }));
    expect(out.board0).toEqual({});
  });
});
