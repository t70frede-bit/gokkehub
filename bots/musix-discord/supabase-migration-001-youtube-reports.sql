-- Migration 001 — YouTube video reports
--
-- Players in musix games can downvote the bot's YouTube pick if it's the
-- wrong version, a music video with a long intro, or anything else that
-- spoils the round. This table tracks reports per video_id. The bot's
-- resolver skips any video with >= 2 reports when searching for songs,
-- and the blacklisted flag is set when reports reach >= 5 (still skipped,
-- just a permanent marker for review).
--
-- Apply by pasting into Supabase SQL editor and running.

CREATE TABLE IF NOT EXISTS tl_youtube_reports (
  video_id           TEXT      PRIMARY KEY,
  reports_count      INT       NOT NULL DEFAULT 1,
  blacklisted        BOOLEAN   NOT NULL DEFAULT false,
  first_reported_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_reported_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Lookups are always "give me all video_ids with enough reports to skip".
CREATE INDEX IF NOT EXISTS tl_youtube_reports_count_idx
  ON tl_youtube_reports (reports_count)
  WHERE reports_count >= 2;
