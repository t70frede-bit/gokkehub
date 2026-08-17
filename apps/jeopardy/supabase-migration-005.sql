-- Jeopardy migration 005 — team colours
-- =====================================
-- Adds a per-team display colour used on the big screen (and editable by a
-- captain via functions/room/[id]/update-team.ts). Nullable: when null the UI
-- falls back to the default palette slot (getTeamColor / TEAM_COLOR_PALETTE in
-- src/lib/types.ts), so existing teams keep working with no backfill.
--
-- Idempotent — safe to run more than once. Run in Supabase AFTER 004.

ALTER TABLE jp_teams
  ADD COLUMN IF NOT EXISTS color TEXT;
