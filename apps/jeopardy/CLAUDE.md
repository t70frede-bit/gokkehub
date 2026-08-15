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

Defer: schema/RLS → supabase-migrations; audio/media playback internals →
audio-integration; visual → design; rules copy → game-rules.
