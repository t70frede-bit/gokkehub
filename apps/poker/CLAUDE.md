# apps/poker — poker.gokkehub.com

Home-game money tracker: buy-ins/cash-outs, groups, balances/leaderboard,
MobilePay settle-up, PWA shell. Owning agent: **poker-dev**.

- **RPC-first architecture:** backend logic lives in Postgres RPCs + a Supabase
  Edge Function, NOT in Pages Functions. The web client calls RPCs. Respect that
  boundary — don't move money logic client-side or into Pages Functions.
- Migrations use descriptive suffixes (`-017-hardening.sql`) with `-NNN-rollback.sql`
  companions for risky ones. Current head 017.
- MobilePay/site config are build-time `VITE_*` vars injected by CI (see deploy.yml).

Defer: schema/RPCs/RLS → supabase-migrations; visual → design; deploy/secrets → infra-deploy.
