import { defineConfig } from "vitest/config";

// Root Vitest config for the GokkeHub monorepo. Tests are co-located next to the
// code they cover as `*.test.ts`. Start with the pure, high-value logic (shared
// auth/session helpers, game scoring/shuffle) — anything that doesn't need the
// Cloudflare Workers or Supabase runtime to exercise.
export default defineConfig({
  test: {
    include: ["**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/.wrangler/**", "**/legacy/**", "**/Games/**"],
    environment: "node",
  },
});
