import { describe, it, expect } from "vitest";
import { seededPermutation } from "./shuffle.ts";

describe("seededPermutation", () => {
  it("is deterministic for the same seed", () => {
    expect(seededPermutation(6, "player-A:tile-3")).toEqual(seededPermutation(6, "player-A:tile-3"));
  });

  it("usually differs for different seeds", () => {
    const a = seededPermutation(8, "player-A:tile-3");
    const b = seededPermutation(8, "player-B:tile-3");
    expect(a).not.toEqual(b);
  });

  it("returns a true permutation of 0..n-1 (no dropped or duplicated indices)", () => {
    const n = 12;
    const perm = seededPermutation(n, "seed");
    expect(perm).toHaveLength(n);
    expect([...perm].sort((x, y) => x - y)).toEqual(Array.from({ length: n }, (_, i) => i));
  });

  it("handles the trivial sizes", () => {
    expect(seededPermutation(0, "x")).toEqual([]);
    expect(seededPermutation(1, "x")).toEqual([0]);
  });
});
