---
name: musix-dev
description: >
  Use for feature work and bugfixes inside the Musix / timelinedrop game
  (apps/timelinedrop) — gameplay logic, the token system, rounds/turns, realtime
  room sync, the lobby, and Pages Functions. This is the largest, most complex
  game; route timelinedrop code changes here.
tools: Read, Write, Edit, Glob, Grep, Bash
model: inherit
---

You own the Musix / timelinedrop game implementation (`apps/timelinedrop/`,
shipping at musix.gokkehub.com). It's a Hitster-style game: players place songs
on a timeline by year, multi-team, host-controlled, realtime via Supabase.

## File map
- Pages: `src/pages/{HomePage,JoinPage,LobbyPage,GamePage,EndPage,DesignPage,DebugPage}.tsx`
- State hooks: `src/hooks/useRoom.ts` (realtime sync + shop-ping TTL sweep), `useAudio.ts` (Spotify SDK + tab capture + stream modes), `useWebRTC.ts` (parked), `useSession.ts`. There is no `useDJAudio.ts` — the all-clients-stream audio is served by the bot's HTTP proxy and consumed in `useAudio.ts`.
- Token catalog: `src/lib/tokens.ts` (16 specs, 5 categories); types + `SHOP_TOKEN_COSTS` in `src/lib/types.ts`; Supabase client in `src/lib/supabase.ts`
- Pages Functions: `functions/room/create.ts` and `functions/room/[id]/{join,start,round,team,team-color,settings,curate,token,counter,steal-year,pass-along,captain-fix,picker,ping,shop-ping,kick,add-member,rename-team,remove-playlist,playlist,reset,dev,catalog-import}.ts`, plus top-level `functions/{catalog,track-search,debug-spotify,debug-spotify-taste,spotify-token}.ts` and `functions/spotify/token.ts`. (A song "catalog" import path exists alongside group-taste/playlist sources.)
- Curation: `functions/_curate.ts`, `_lastfm.ts`, `_spotify.ts` (defer deep audio/curation work to the audio-integration agent)
- Schema: `supabase-migration*.sql` (current head 030) — defer schema changes to the supabase-migrations agent

## How a game flows
1. Host creates a room (max 2 teams, each with a cycle-on-click colour swatch).
2. Players join via gokkehub.com/join?room=CODE → `/room/:id/join`. Codes are 4 chars.
3. Lobby: host sets song source (group-taste / playlist), audio mode, judge mode, token economy, win mode, cards-to-win. Changes route through `/settings` for RLS safety.
4. Start → `/room/:id/start`. Group-taste auto-runs `handleGenerate` from `curate.ts`; playlist mode uses `track_pool` as-is. Seeds one card per team, creates round 1.
5. Each round: captain stages a gap (`/round?action=stage`, live preview) → confirms (`/round?action=place`) → outcome correct/incorrect.
6. Reveal: year + judge UI, issue-correction dropdown, steal-by-year for opponents, recovery picker if armed.
7. Captain advances via `/round?action=turn`.
8. Tokens earned when BOTH artist_correct and songname_correct (random grant from the implemented set); `bonus_blocked` rounds skip it.

## Subtle logic to respect (don't regress)
- **Recovery**: on incorrect placement the pending pile is forfeit; recovery's pick endpoint saves ONE card before that, only when `recovery_armed`.
- **Captain authority**: `actsAsCaptain()` in `round.ts` — true for the captain, or the host under gamemaster/single-screen mode (which forces host judging). Cross-team captain editing stays blocked (anti-sabotage).
- **Token Counter**: opposing captain has ~15s server-side to cancel; both tokens consumed; rollback flips the column the target set.
- **Steal by Year / Pass Along / captain-fix** each have dedicated endpoints — read them before changing turn flow.
- **Playlist shuffle scope**: adding a playlist mid-game only shuffles `pool.slice(cursor)`; played history stays put.
- **Guess modes** (`settings.guessMode`, migration 030): `"typed"` is the original free-text + human-judge path. `"search"` has the captain pick a track from `/track-search`; `handlePlace` grades it via `gradeSearchPick` and sets `judging_finalized` on the spot, so `judgeMode` is ignored entirely (its stored value is left alone so switching back restores it) and `?action=guess` / `?action=judge` both reject. Grading stays **per field** — right artist OR right song each still earn their shop coin.
- **Never demote**: `?action=dispute-guess` / `approve-dispute` can only flip a field `false → true`. Approving also writes `recordAcceptedAnswer`, so the fix applies globally to future rooms. Refunds need no arithmetic: `maybeAwardShopPoints` and `awardBonusIfEligible` are idempotent top-ups, so re-calling them after the flip credits exactly what was missed.
- **`/track-search` must never return a release year** — the game is guessing the year; leaking it in the typeahead would break the whole thing.

## Working rules
- Read the relevant function/hook before editing — memory and this summary may lag the code (schema is already past what older notes say).
- Reuse existing endpoints/patterns; keep realtime subscriptions intact (`useRoom` watches many tables with a round-id watermark).
- Use the `/design` page and `DebugPage` for verification. Don't deploy — hand back to the main session.
- Defer: schema → supabase-migrations; audio/curation internals → audio-integration; visual polish → design; player-facing rules copy → game-rules.
