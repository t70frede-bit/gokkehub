# GokkeHub Poker (`poker.gokkehub.com`)

A phone-first poker **balance tracker** for the GokkeHub friend group. One user
is the **house** (admin); all real money moves through them manually via
MobilePay. The app tracks balances, game sessions and a permanent transaction
ledger.

Built exactly like the other GokkeHub apps — **Vite + React + TypeScript +
Tailwind**, themed with the shared `@gokkehub/config` tokens and `@gokkehub/ui`
components, deployed to its own Cloudflare Pages project. It is **additive**: no
existing app, package or config was modified except two surgical, commented
additions (a new theme file `packages/config/src/themes/games/poker.css` and a
new `deploy-poker` job in `.github/workflows/deploy.yml`).

> **Why a web app, not React Native?** A real iOS app requires a paid Apple
> Developer account ($99/yr). We chose the web/PWA path — installable to the
> home screen, same design system, same deploy pipeline. See the chat decision
> log. MobilePay deep links and the camera still work from mobile browsers.

---

## Architecture

- **Frontend:** SPA in `src/`, React Router, Supabase Realtime for live state.
- **Backend:** all logic lives in **Supabase** — there are no Cloudflare Pages
  Functions for this app.
  - **Postgres `SECURITY DEFINER` RPCs** are the *only* way money moves. RLS
    grants clients `SELECT` only; every mutation goes through a function that
    re-checks auth and enforces `balance >= 0` (also a `CHECK` constraint).
  - **One Edge Function** (`admin-create-user`) — creating an auth user needs
    the service-role key, which must never reach the browser.
- **Money** is whole kroner (DKK) stored as `INTEGER`.
- **Tables** are prefixed `poker_` so they coexist with the other apps in the
  shared Supabase project (`verbxfbfurachhxztkob`).

---

## Auth model

- **One-time site gate.** A brand-new visitor sees a "🔒 locked" screen and must
  enter the shared access code (`PokernightAtGokkes` by default, overridable via
  `VITE_SITE_CODE`). It's stored in `localStorage` on that device and never
  asked again. This is a *soft* UX lock — real protection is the Discord login +
  RLS behind it.
- **Login = Discord**, via Supabase's native Discord OAuth provider. No
  poker-specific username/password. On first login a `poker_users` profile is
  created automatically from the Discord identity (`poker_ensure_profile`), so
  it's the same account as the rest of GokkeHub.
  - *Note:* this is "log in with the same Discord account," not silent SSO from
    `account.gokkehub.com` — players tap **Continue with Discord** once per
    device. True invisible carry-over would need a server-side token exchange.
- The Discord handle **`goksi0501`** is provisioned as **admin** automatically.
  Admins can promote/demote anyone else from **Admin → Players**.

## One-time Supabase setup

1. **Run the schema.** In the Supabase SQL editor, paste
   [`supabase-migration.sql`](./supabase-migration.sql), then
   [`supabase-migration-002.sql`](./supabase-migration-002.sql) (in order). These
   create the tables, RLS, RPCs, the `poker-chips` bucket, realtime publication,
   the Discord auto-provisioning function and the `goksi0501` admin rule.

2. **Enable the Discord auth provider.** Supabase dashboard →
   **Authentication → Providers → Discord** → enable, and paste a Discord app's
   **Client ID + Secret**. You can reuse the existing GokkeHub Discord
   application — just add Supabase's callback URL to that app's OAuth redirects
   in the [Discord developer portal](https://discord.com/developers/applications):
   ```
   https://verbxfbfurachhxztkob.supabase.co/auth/v1/callback
   ```

3. **Allow the poker redirect URLs.** Supabase dashboard →
   **Authentication → URL Configuration** → add to *Redirect URLs*:
   ```
   https://poker.gokkehub.com
   http://localhost:5173
   ```

That's it — log in with the `goksi0501` Discord account and you're the admin.
No manual user seeding, no Edge Function.

---

## Environment variables (build-time, client-inlined)

Set these as **GitHub Actions secrets** (consumed by the `deploy-poker` job):

| Secret | Example | Notes |
|---|---|---|
| `SUPABASE_URL` | `https://verbxfbfurachhxztkob.supabase.co` | already used by other apps |
| `SUPABASE_ANON_KEY` | `eyJhbGci…` | already used by other apps |
| `POKER_MOBILEPAY_NUMBER` | `12345678` | the house's MobilePay number (digits only) |
| `POKER_TRACKING_PREFIX` | `GokkePoker` | app-name prefix in tracking codes, e.g. `GokkePoker #4829` |
| `POKER_SITE_CODE` | `PokernightAtGokkes` | one-time site access code (optional; defaults to `PokernightAtGokkes`) |

For local dev, create `apps/poker/.env.local`:
```
VITE_SUPABASE_URL=https://verbxfbfurachhxztkob.supabase.co
VITE_SUPABASE_ANON_KEY=...
VITE_MOBILEPAY_NUMBER=12345678
VITE_TRACKING_PREFIX=GokkePoker
VITE_SITE_CODE=PokernightAtGokkes
```
Then `npm run dev --workspace=apps/poker`.

---

## Deployment (Cloudflare Pages → `poker.gokkehub.com`)

The repo deploys via GitHub Actions on push to `main` (see the `deploy-poker`
job). It builds the workspace and runs
`wrangler pages deploy dist --project-name=poker`.

### First-time Cloudflare setup

1. **Create the Pages project once.** Either let the first Actions run create it
   automatically, or create it manually in the dashboard:
   **Workers & Pages → Create → Pages → Direct Upload**, name it **`poker`**
   (must match `--project-name=poker` in the workflow and `name` in
   `wrangler.toml`).

2. **Add the custom domain.** In the `poker` Pages project →
   **Custom domains → Set up a custom domain** → enter
   **`poker.gokkehub.com`**. Because `gokkehub.com` is already on Cloudflare,
   the dashboard creates the required **CNAME automatically**.

### Adding the DNS record manually (if needed)

If you ever need to add it by hand: **Cloudflare dashboard → `gokkehub.com`
zone → DNS → Records → Add record**:

| Field | Value |
|---|---|
| Type | `CNAME` |
| Name | `poker` |
| Target | `poker.pages.dev` (your Pages project's `*.pages.dev` hostname) |
| Proxy status | **Proxied** (orange cloud) |

DNS can't be set from `wrangler.toml` — it must be the dashboard custom-domain
flow (or the record above). The existing apps (`web`, `account`,
`gridchallenge`, `timelinedrop`) are unaffected.

---

## Spec coverage

- **Auth:** one-time shared site code gate + **Discord login** (Supabase Discord
  OAuth). Profiles auto-provision on first login; `goksi0501` is admin. Roles
  `player` / `admin`, toggleable in the admin panel.
- **Balance & ledger:** never below 0 (CHECK + RPC guards). Top-up request →
  4-digit tracking code → MobilePay deep link → *Payment pending* until the
  house confirms. Only confirmed funds are spendable. Cancelled/rejected
  transactions stay in the ledger forever. Admin can change any status,
  including reinstating cancellations.
- **Game flow:** host sets buy-in range + rebuys; lobby → active → finished;
  join with buy-in (moves balance → limbo); rebuy with confirmed funds; cash out
  with optional chip-stack photo; recap with highest earner / biggest loser /
  pot-in vs pot-out mismatch warning. Empty lobbies are deletable.
- **Home / profile / leaderboard / admin panel / realtime:** all per spec.
