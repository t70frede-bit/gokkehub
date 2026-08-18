import { describe, it, expect } from "vitest";
import { luminance, contrastRatio, readableTextOn, INK, PAPER } from "./color";
import { TEAM_COLOR_PALETTE } from "./types";

describe("luminance", () => {
  it("anchors at black and white", () => {
    expect(luminance("#000000")).toBeCloseTo(0, 5);
    expect(luminance("#ffffff")).toBeCloseTo(1, 5);
  });

  it("accepts a missing hash and mixed case", () => {
    expect(luminance("FFFFFF")).toBeCloseTo(luminance("#ffffff"), 10);
  });

  it("falls back to mid-grey for junk rather than throwing", () => {
    expect(luminance("not-a-colour")).toBeCloseTo(luminance("#808080"), 10);
  });
});

describe("contrastRatio", () => {
  it("is 21:1 for black on white and 1:1 for a colour on itself", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 2);
    expect(contrastRatio("#3b82f6", "#3b82f6")).toBeCloseTo(1, 5);
  });

  it("does not care about argument order", () => {
    expect(contrastRatio("#22c55e", INK)).toBeCloseTo(contrastRatio(INK, "#22c55e"), 10);
  });
});

describe("readableTextOn", () => {
  it("picks dark text on light colours and white on dark ones", () => {
    expect(readableTextOn("#ffffff")).toBe(INK);
    expect(readableTextOn("#000000")).toBe(PAPER);
  });

  it("always returns whichever option actually has more contrast", () => {
    for (const c of [...TEAM_COLOR_PALETTE, "#1a2b5c", "#fff8e1", "#7f7f7f", "#004d40"]) {
      const other = readableTextOn(c) === INK ? PAPER : INK;
      expect(contrastRatio(c, readableTextOn(c)), `colour ${c}`)
        .toBeGreaterThanOrEqual(contrastRatio(c, other));
    }
  });

  it("gives every palette colour a legible label", () => {
    // 4.5:1 is the WCAG AA bar for body text; the buzzer label is far larger
    // than body text, so clearing it outright is a comfortable margin. Every
    // colour in the current palette is a mid-to-light saturated tone, so they
    // all land on dark text — purple is the tightest at 4.95:1.
    for (const c of TEAM_COLOR_PALETTE) {
      expect(readableTextOn(c), `palette ${c}`).toBe(INK);
      expect(contrastRatio(c, readableTextOn(c)), `palette ${c}`).toBeGreaterThan(4.5);
    }
  });

  it("flips to white when a captain picks a dark custom colour", () => {
    // The palette can't reach here, but the colour picker accepts any #rrggbb.
    expect(readableTextOn("#1a2b5c")).toBe(PAPER);  // navy
    expect(readableTextOn("#004d40")).toBe(PAPER);  // deep teal
    expect(readableTextOn("#3b0764")).toBe(PAPER);  // deep purple
  });
});
