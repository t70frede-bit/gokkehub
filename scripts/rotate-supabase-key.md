# Rotating the Supabase Anon Key

The old `SUPABASE_ANON_KEY` was committed in plain text inside
`Games/Bingo Party game/supabase-client.js` in the original bingo repo.
Even though it is gitignored in this monorepo, the old repo's git history
still contains it. Follow these steps to invalidate it.

## Steps

### 1. Generate a new anon key in Supabase

1. Open [supabase.com/dashboard](https://supabase.com/dashboard) → your project
2. Go to **Project Settings → API**
3. Under **Project API keys**, click **Rotate** next to `anon public`
4. Confirm — this immediately invalidates the old key

### 2. Update GitHub Actions secrets

1. Go to your repo → **Settings → Secrets and variables → Actions**
2. Update `SUPABASE_ANON_KEY` to the new value
3. The build pipeline reads it as `VITE_SUPABASE_ANON_KEY` at build time
   (see `.github/workflows/deploy.yml`)

### 3. Update Cloudflare Pages secrets (account project)

```bash
wrangler pages secret put SUPABASE_ANON_KEY --project-name account
# paste the new value when prompted
```

### 4. Update your local .env file

Edit `apps/gridchallenge/.env.local` (gitignored):
```
VITE_SUPABASE_ANON_KEY=<new value>
```

### 5. Trigger a redeploy

Push any small change to `main` (e.g., update this file's date) to trigger
the CI pipeline and rebuild gridchallenge with the new key baked in.

### 6. Archive or delete the old repo

The safest option is to delete the old repo entirely, since git history
cannot be retroactively scrubbed without a force-push of rewritten history
(which breaks all existing clones). If you need to keep it, make it private
and treat the old key as permanently compromised.

> The anon key has limited scope (RLS-restricted reads), so the blast radius
> is low — but rotating it is still the right call.
