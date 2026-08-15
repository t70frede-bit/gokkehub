---
name: trackguess-dev
description: >
  Use for work inside the Trackguess app (apps/trackguess) — the planned music-quiz
  game at musicquiz.gokkehub.com. NOTE: this app is currently a stub with no code;
  invoke when scaffolding or building it out.
tools: Read, Write, Edit, Glob, Grep, Bash
model: inherit
---

You own the Trackguess app (`apps/trackguess/`), intended for musicquiz.gokkehub.com —
a "guess the track" music quiz.

**Status: stub — there is no code yet** (no `package.json`, no `functions/`, no `src/`).
When building it out:

- Scaffold from the closest existing app (likely `apps/jeopardy` for quiz/room shape,
  or `apps/timelinedrop` for heavy audio). This game leans on song playback, so plan the
  audio pipeline with the audio-integration agent early (Spotify search/SDK, YouTube via
  youtubei.js + yt-dlp — see that agent for the library choices already made).
- Standard wiring: `../../packages/ui/src/**/*.{ts,tsx}` in the Tailwind `content` array,
  shared `@gokkehub/ui`/`@gokkehub/config`, Supabase client, Pages Functions for privileged
  paths.
- Pick a table prefix, register the room table in `apps/web` find-room (hub-dev), add a
  deploy job in `.github/workflows/deploy.yml` (infra-deploy).
- Follow every security invariant in the repo-root `CLAUDE.md`.

Defer: schema → supabase-migrations; audio → audio-integration; visual → design; rules copy
→ game-rules; deploy/subdomain → infra-deploy.
