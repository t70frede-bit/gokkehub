# apps/account — account.gokkehub.com

Identity hub: Discord / Spotify / Last.fm / Steam OAuth, session, profile, avatar.
Owning agent: **account-dev** (see repo-root `CLAUDE.md` › Agent map).

This is the highest-risk surface in the repo. Before editing anything under
`functions/auth/*`, re-read the root `CLAUDE.md` security invariants — especially:

- Every response from a credentialed cross-subdomain endpoint goes through
  `functions/_cors.ts` so it always carries `Vary: Origin`; session endpoints
  (`auth/me.ts`, `auth/logout.ts`) add `Cache-Control: no-store`. Do not hand-roll
  CORS/cache headers — reuse `_cors.ts`, `_ratelimit.ts`, `_env.ts`.
- OAuth client secrets and `SESSION_SECRET` are Cloudflare Pages secrets on the
  **account** project, never in the repo. The only consumer of
  `DISCORD_CLIENT_SECRET` is `functions/auth/discord/callback.ts`.
- Cookies use `COOKIE_DOMAIN=.gokkehub.com` (valid on all subdomains).

Defer: schema/RLS → supabase-migrations; visual → design; deploy/secrets → infra-deploy.
