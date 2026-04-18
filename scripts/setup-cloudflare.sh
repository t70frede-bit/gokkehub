#!/usr/bin/env bash
# setup-cloudflare.sh
# Run once to create Cloudflare Pages projects and set runtime secrets.
# Prerequisites:
#   - wrangler installed globally (npm i -g wrangler)
#   - authenticated: wrangler login
#   - All secret values ready (see prompts below)

set -euo pipefail

echo "=== GokkeHub — Cloudflare Pages setup ==="
echo ""

# ── 1. Create Pages projects ──────────────────────────────────────────────────
echo ">>> Creating Pages projects (safe to re-run — will error if already exists)"

wrangler pages project create web          --production-branch main || true
wrangler pages project create account      --production-branch main || true
wrangler pages project create gridchallenge --production-branch main || true

echo ""

# ── 2. Runtime secrets for apps/account ──────────────────────────────────────
# These are NOT in GitHub Actions secrets — they only run inside the Pages Function
# (Workers runtime), so they must be set via `wrangler pages secret put`.
echo ">>> Setting runtime secrets for the 'account' project"
echo "    You will be prompted for each value. Paste and press Enter."
echo ""

wrangler pages secret put SUPABASE_SERVICE_ROLE_KEY --project-name account
wrangler pages secret put DISCORD_CLIENT_ID         --project-name account
wrangler pages secret put DISCORD_CLIENT_SECRET     --project-name account
wrangler pages secret put SPOTIFY_CLIENT_ID         --project-name account
wrangler pages secret put SPOTIFY_CLIENT_SECRET     --project-name account
wrangler pages secret put STEAM_API_KEY             --project-name account

# SUPABASE_URL and SUPABASE_ANON_KEY are already in wrangler.toml [vars] for
# local dev, and passed as VITE_ env vars at build time for gridchallenge.
# For the account Pages Function they also need to be available at runtime:
wrangler pages secret put SUPABASE_URL      --project-name account
wrangler pages secret put SUPABASE_ANON_KEY --project-name account

echo ""

# ── 3. R2 bucket ─────────────────────────────────────────────────────────────
echo ">>> Creating R2 bucket for user avatars"
wrangler r2 bucket create gokkehub-avatars || true

echo ""
echo "=== Done ==="
echo ""
echo "Next manual steps (Cloudflare dashboard):"
echo "  1. web project          → Custom domain: gokkehub.com + www.gokkehub.com"
echo "  2. account project      → Custom domain: account.gokkehub.com"
echo "  3. gridchallenge project → Custom domain: partybingo.gokkehub.com"
echo ""
echo "Then rotate your Supabase anon key — the old one is in the git history of"
echo "the old bingo repo. Run: npm run rotate-supabase-key (see README for steps)"
