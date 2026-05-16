-- Migration 015 — bad-YouTube-version reporting flow
--
-- Mirrors the year-correction proposal/approval cycle:
--   1. Any player clicks "Wrong song?" → proposed flags get set
--   2. Host approves or rejects → approved flag flips, proposed clears
--   3. On approve, host can click "Redo round" → redo_requested_at stamps,
--      bot re-resolves the track (skipping the bad video) and replays.
--
-- bot_video_id is written by the musix-discord bot on each round start so
-- the server has the YouTube id to feed into the global tl_youtube_reports
-- counter (managed by the bot via the supabase service role).

ALTER TABLE tl_rounds
  ADD COLUMN IF NOT EXISTS bot_video_id                  TEXT,
  ADD COLUMN IF NOT EXISTS video_report_proposed         BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS video_report_proposed_by      TEXT,
  ADD COLUMN IF NOT EXISTS video_report_proposed_name    TEXT,
  ADD COLUMN IF NOT EXISTS video_report_approved         BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS redo_requested_at             TIMESTAMPTZ;
