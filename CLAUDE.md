# GokkeHub — repository guide

GokkeHub is a multi-game party platform. Each game is a separate app deployed to
its own subdomain; shared identity, UI, and data live in `packages/`. This file
holds the conventions and **security invariants** that apply everywhere. App- and
domain-specific detail lives in the per-app `CLAUDE.md` files and in the agents
under `.claude/agents/` — route work to the owning agent (see "Agent map").

## Layout

```
apps/
  web            gokkehub.com          catalogue + centralised /join lookup (find-room)
  account        account.gokkehub.com  identity hub: Discord/Spotify/Last.fm/Steam OAuth, profile
  gridchallenge  partybingo.gokkehub.com  team-bingo party game (live)
  timelinedrop   musix.gokkehub.com    Hitster-style music timeline game (largest app; "Musix")
  poker          poker.gokkehub.com    home-game money tracker (RPC-first)
  jeopardy       jeopardy.gokkehub.com realtime Jeopardy w/ buzzer, powerups, media
  beatrank       bezzerwizzer.gokkehub.com   stub (no code yet)
  trackguess     musicquiz.gokkehub.com      stub (no code yet)
bots/
  musix-discord  Discord bot + HTTP audio proxy for timelinedrop
packages/
  ui             @gokkehub/ui      shared React components + design system
  config         @gokkehub/config  shared Tailwind theme / tokens
  auth           @gokkehub/auth    session helpers used by Pages Functions
  db             @gokkehub/db       Supabase helpers
supabase/        shared project config
```

## Tech stack

React 18 + Vite + TypeScript + Tailwind CSS v3. Backend is **Cloudflare Pages
Functions** (per-app `functions/`). Data is **Supabase** (Postgres + realtime +
RLS); some Cloudflare KV/D1/R2 exists for sessions/avatars. Monorepo is npm
workspaces + Turborepo. Node ≥ 20, npm 11.

## Commands (run from repo root)

- `npm run dev` — all apps via turbo (per-app: `npm run dev --workspace=apps/<app>`)
- `npm run build` — build everything (`--workspace=apps/<app>` for one)
- `npm run type-check` — tsc across the monorepo; run before considering a change done
- `npm run lint`
- `npm test` — Vitest (`npm run test:watch` to watch). Tests are co-located as
  `*.test.ts` next to the code. Start coverage with pure, high-value logic (shared
  auth/session helpers, game scoring/shuffle) — add a test when you change shared
  `packages/*` logic. There is otherwise no automated test suite yet, so also lean on
  the `verify` / `run` skills to exercise changes end-to-end.
- Deploy is **CI-only**: push to `main` → `.github/workflows/deploy.yml` builds
  once and deploys every app to Cloudflare Pages. Do **not** deploy by hand from
  an agent; hand back to the main session. (Note: every push currently redeploys
  all apps — a paths-filter to scope this is still a TODO.)

## Security invariants — do not violate

1. **Never commit secrets.** Service-role keys, OAuth client secrets,
   `SESSION_SECRET`, and bot tokens live in Cloudflare Pages secrets (account
   project) and `bots/musix-discord/.env` — never in the repo. `.env.local` and
   `.env` are gitignored; keep it that way. Only the **public**
   `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` may appear in client bundles.
   See `.env.example` for where each secret actually lives.
2. **`SUPABASE_SERVICE_ROLE_KEY` is server-only.** It may be read in Pages
   Functions / Edge Functions / the bot, never in `src/` client code. The client
   uses the anon key and goes through RLS.
3. **Never weaken RLS to make a client query work.** Add a policy, or move the
   privileged work into a Pages Function / RPC that uses the service-role key.
4. **Credentialed cross-subdomain endpoints must be cache-safe.** Any endpoint
   called with credentials from another subdomain (the `/auth/*` family in
   `apps/account`) must always send `Vary: Origin` — even the same-origin /
   non-allowed flavour — and session responses must be `Cache-Control: no-store`.
   This was the root cause of the "randomly signed out" saga; copy the pattern in
   `apps/account/functions/_cors.ts` and `auth/me.ts`. Reuse `_cors.ts`,
   `_ratelimit.ts`, and `_env.ts` rather than hand-rolling headers.
5. The Supabase anon key was exposed in an old repo's git history and **still
   needs rotating** — flag this if you touch auth/keys.

## Conventions

- **Tailwind:** every app's `tailwind.config.ts` `content` array MUST include
  `../../packages/ui/src/**/*.{ts,tsx}`. If it doesn't, classes used only inside
  `@gokkehub/ui` components are never emitted (missing padding/styling bugs).
- **Shared first:** reuse `@gokkehub/ui`, `@gokkehub/config`, `@gokkehub/auth`,
  `@gokkehub/db` before writing app-local equivalents. Visual changes that affect
  more than one app belong in `packages/`.
- **Migrations are append-only.** Never edit a shipped SQL migration; add the
  next-numbered file. See `.claude/agents/supabase-migrations.md`.
- **Read before editing.** These docs and the auto-memory can lag the code
  (schema and jeopardy have both moved past older notes). Verify against the file.
- Player-facing rules/copy is a distinct concern from gameplay code — route wording
  changes to the game-rules agent.

## Agent map (`.claude/agents/`)

Route work to the owning agent; each defers cross-cutting concerns to the right specialist.

| Concern | Agent |
|---|---|
| timelinedrop / Musix gameplay | `musix-dev` |
| gridchallenge gameplay | `gridchallenge-dev` |
| poker app | `poker-dev` |
| Shared libs: @gokkehub/{auth,db,config,ui-logic} | `packages-dev` |
| account / OAuth / identity | `account-dev` *(planned)* |
| jeopardy | `jeopardy-dev` *(planned)* |
| web hub + /join | `hub-dev` *(planned)* |
| DB: schema, RLS, RPCs, migrations | `supabase-migrations` |
| Spotify/YouTube + in-game audio | `audio-integration` |
| Discord bot | `discord-bot` |
| Deploy / Cloudflare / DNS / secrets | `infra-deploy` |
| Visual / design system / Tailwind | `design` |
| Player-facing rules & copy | `game-rules` |
