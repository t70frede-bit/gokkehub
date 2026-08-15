---
name: beatrank-dev
description: >
  Use for work inside the Beatrank app (apps/beatrank) — the planned Bezzerwizzer-style
  music game at bezzerwizzer.gokkehub.com. NOTE: this app is currently a stub with no
  code; invoke when scaffolding or building it out.
tools: Read, Write, Edit, Glob, Grep, Bash
model: inherit
---

You own the Beatrank app (`apps/beatrank/`), intended for bezzerwizzer.gokkehub.com.

**Status: stub — there is no code yet** (no `package.json`, no `functions/`, no `src/`).
When building it out:

- Scaffold from an existing app of the closest shape (a realtime multiplayer music
  game → mirror `apps/timelinedrop` structure; a simpler quiz → mirror `apps/jeopardy`).
- Copy the standard wiring: `tailwind.config.ts` with `../../packages/ui/src/**/*.{ts,tsx}`
  in `content`, `@gokkehub/ui`/`@gokkehub/config` imports, Supabase client from the shared
  pattern, and Pages Functions for anything privileged.
- Pick a `jp_`-style table prefix, register the room table in `apps/web` find-room
  (hub-dev), and add a deploy job in `.github/workflows/deploy.yml` (infra-deploy).
- Follow every security invariant in the repo-root `CLAUDE.md`.

Defer: schema → supabase-migrations; audio/Spotify/YouTube → audio-integration; visual →
design; rules copy → game-rules; deploy/subdomain → infra-deploy.
