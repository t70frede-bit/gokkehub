-- TimelineDrop migration 004: judging modes, vote storage, token cooldown
-- Run after migration 003.

-- 1) Token cooldown: pending tokens that become ready when the team's next turn starts.
ALTER TABLE tl_teams
  ADD COLUMN IF NOT EXISTS tokens_pending INT NOT NULL DEFAULT 0;

-- 2) Per-round vote storage and judging-window timestamp (for vote-all mode).
ALTER TABLE tl_rounds
  ADD COLUMN IF NOT EXISTS artist_votes        JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS songname_votes      JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS judging_started_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS judging_finalized   BOOLEAN NOT NULL DEFAULT false;
