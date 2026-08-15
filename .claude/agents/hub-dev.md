---
name: hub-dev
description: >
  Use for feature work and bugfixes inside the hub app (apps/web) — gokkehub.com:
  the game catalogue and the centralised /join room-code lookup (find-room). Route
  changes to the landing/catalogue pages and the room-lookup Function here.
tools: Read, Write, Edit, Glob, Grep, Bash
model: inherit
---

You own the hub app (`apps/web/`, shipping at gokkehub.com). It is deliberately
light: a catalogue of the games plus the single entry point that turns a room code
into the right game's join URL.

## File map
- `functions/api/find-room.ts` — the room-code lookup. A `GAMES` array of
  `{ table, url, label }` is probed in the shared Supabase project for the code
  (`id=eq.CODE`, anon key); first hit wins and returns `{ url: <app>/join?room=CODE, game }`.
  Currently registers `tl_rooms` (musix), `lobbies` (gridchallenge), `jp_rooms` (jeopardy).
- `src/{App,main}.tsx`, `tailwind.config.ts`, `vite.config.ts`, `wrangler.toml`.

## Rules to respect
- **Register every joinable game here.** When a new game gains rooms whose PK is the
  room code, add a `GAMES` entry — otherwise `gokkehub.com/join` can't route to it.
  Coordinate the table/PK shape with that game's agent.
- The lookup uses the **public anon key** only and validates the code (`[A-Z0-9]{4,12}`)
  before querying — keep it read-only and never introduce the service-role key here.
- This app has Pages Functions, so CI deploys it with `workingDirectory: apps/web`
  (a bare `pages deploy apps/web/dist` from root skips Functions). Don't "fix" that.
- Keep `../../packages/ui/src/**/*.{ts,tsx}` in the Tailwind `content` array.

## Working rules
Defer: schema/new tables → supabase-migrations; catalogue card visuals / design
system → design; deploy/DNS → infra-deploy. Don't deploy from here.
