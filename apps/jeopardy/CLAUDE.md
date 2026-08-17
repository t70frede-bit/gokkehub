# apps/jeopardy — jeopardy.gokkehub.com

Realtime Jeopardy: game authoring (board/tiles/media, collaborators), then live
rooms with buzzer, powerups, and multiple answer modes. Owning agent: **jeopardy-dev**.

- Backend: Pages Functions in `functions/game/*` (authoring + launch) and
  `functions/room/[id]/*` (live play: `buzz`, `submit`, `action`, `powerup-choice`,
  `claim-host`). Shared helpers `_cors.ts`, `_env.ts`, `_game.ts`, `_supabase.ts`.
- Realtime + buzzer race: the buzz endpoint resolves who was first server-side —
  read `functions/room/[id]/buzz.ts` and `src/hooks/useBuzzer.ts` before touching
  buzz/turn flow. Don't introduce client-trusted ordering.
- Answer modes live in `src/components/AnswerModes/` (ClosestNumber, MultipleChoice,
  Ranking) — keep new modes consistent with that shape.

## Local testing (no push required)

`npm run dev` alone is not enough: Vite doesn't run `functions/`, and the
session cookie is `Domain=.gokkehub.com; Secure`, so the browser never sends it
to localhost — you are permanently signed out. Two terminals:

1. `npm run dev:functions --workspace=apps/jeopardy` — wrangler on :8788 serving
   the real Pages Functions. Needs `apps/jeopardy/.dev.vars` (see
   `.dev.vars.example`): the service-role key plus `DEV_USER_ID`. A `pre` script
   runs `scripts/dev-doctor.mjs jeopardy` first and refuses to start on a broken
   config — read its output before debugging anything else. See the
   `dev-jeopardy` skill.
2. `npm run dev --workspace=apps/jeopardy` — Vite on :5173 with HMR; its proxy
   forwards `/game/*` and `/room/*` to :8788.

**Restarting wrangler, on Windows:** `.dev.vars` is read once at startup and is
*not* watched — editing it does nothing until wrangler rebuilds (a change to a
`functions/*.ts` file also triggers this). Worse, Ctrl-C / killing the npm
wrapper can leave the `workerd` child alive, and Windows will happily let the
new instance bind :8788 *alongside* it — you get "Ready on 8788" while your
requests still hit the old process and its old env. If a `.dev.vars` change
seems to have no effect, kill the strays before restarting:

```powershell
Get-Process workerd -ErrorAction SilentlyContinue | Stop-Process -Force
```

`DEV_USER_ID` (+ `VITE_DEV_USER_ID` in `.env` for the client) stands in for a
login. It is honoured **only** when the var is set *and* the request hostname is
localhost/127.0.0.1 — see `functions/_session.ts` and its test. The client half
sits behind `import.meta.env.DEV`, so it is dead code in a production build.
Local runs hit the **real Supabase project**: rooms, games and events you create
are live data.

Defer: schema/RLS → supabase-migrations; audio/media playback internals →
audio-integration; visual → design; rules copy → game-rules.
