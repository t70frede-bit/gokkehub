/**
 * Deterministic index permutation seeded by a string. Multiple-choice options
 * and ranking items are scrambled per device (seed = playerId + tileKey) so a
 * player's order is stable across re-renders, but submissions always reference
 * the ORIGINAL index.
 */
export function seededPermutation(n: number, seed: string): number[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const perm = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h ^= h >>> 13;
    const j = Math.abs(h) % (i + 1);
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  return perm;
}
