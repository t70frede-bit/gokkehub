import { describe, expect, it } from "vitest";
import { GOKKEHUB_GAMES, isCurrentGame } from "./games.ts";

describe("GOKKEHUB_GAMES", () => {
  it("only links to https gokkehub.com subdomains", () => {
    for (const g of GOKKEHUB_GAMES) {
      const u = new URL(g.url);
      expect(u.protocol).toBe("https:");
      expect(u.hostname.endsWith(".gokkehub.com")).toBe(true);
    }
  });

  it("includes jeopardy as a live game", () => {
    expect(GOKKEHUB_GAMES.find((g) => g.name === "Jeopardy")?.status).toBe("live");
  });
});

describe("isCurrentGame", () => {
  it("matches the current host", () => {
    expect(isCurrentGame("https://musix.gokkehub.com", "musix.gokkehub.com")).toBe(true);
    expect(isCurrentGame("https://musix.gokkehub.com", "MUSIX.gokkehub.com")).toBe(true);
  });
  it("does not match other hosts or missing input", () => {
    expect(isCurrentGame("https://musix.gokkehub.com", "poker.gokkehub.com")).toBe(false);
    expect(isCurrentGame("https://musix.gokkehub.com", null)).toBe(false);
    expect(isCurrentGame("not a url", "musix.gokkehub.com")).toBe(false);
  });
});
