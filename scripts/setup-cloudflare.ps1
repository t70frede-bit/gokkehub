# setup-cloudflare.ps1
# Run once to create Cloudflare Pages projects and set runtime secrets.
# Prerequisites:
#   - wrangler installed globally (npm i -g wrangler)
#   - authenticated: wrangler login

$ErrorActionPreference = "Continue"

Write-Host "=== GokkeHub — Cloudflare Pages setup ===" -ForegroundColor Cyan
Write-Host ""

# ── 1. Create Pages projects ──────────────────────────────────────────────────
Write-Host ">>> Creating Pages projects" -ForegroundColor Yellow

wrangler pages project create web           --production-branch main
wrangler pages project create account       --production-branch main
wrangler pages project create gridchallenge --production-branch main

Write-Host ""

# ── 2. Runtime secrets for apps/account ──────────────────────────────────────
Write-Host ">>> Setting runtime secrets for the 'account' project" -ForegroundColor Yellow
Write-Host "    You will be prompted for each value. Paste and press Enter." -ForegroundColor Gray
Write-Host ""

wrangler pages secret put SUPABASE_URL              --project-name account
wrangler pages secret put SUPABASE_ANON_KEY         --project-name account
wrangler pages secret put SUPABASE_SERVICE_ROLE_KEY --project-name account
wrangler pages secret put DISCORD_CLIENT_ID         --project-name account
wrangler pages secret put DISCORD_CLIENT_SECRET     --project-name account
wrangler pages secret put SPOTIFY_CLIENT_ID         --project-name account
wrangler pages secret put SPOTIFY_CLIENT_SECRET     --project-name account
wrangler pages secret put STEAM_API_KEY             --project-name account

Write-Host ""

# ── 3. R2 bucket ─────────────────────────────────────────────────────────────
Write-Host ">>> Creating R2 bucket for user avatars" -ForegroundColor Yellow
wrangler r2 bucket create gokkehub-avatars

Write-Host ""
Write-Host "=== Done ===" -ForegroundColor Green
Write-Host ""
Write-Host "Next manual steps (Cloudflare dashboard):"
Write-Host "  1. web project           -> Custom domain: gokkehub.com + www.gokkehub.com"
Write-Host "  2. account project       -> Custom domain: account.gokkehub.com"
Write-Host "  3. gridchallenge project -> Custom domain: partybingo.gokkehub.com"
Write-Host ""
Write-Host "Then rotate your Supabase anon key — see scripts/rotate-supabase-key.md"
