-- TimelineDrop migration 003: artist/songname guess + judge fields on rounds
-- Run after migration 002.

ALTER TABLE tl_rounds
  ADD COLUMN IF NOT EXISTS artist_guess     TEXT,
  ADD COLUMN IF NOT EXISTS songname_guess   TEXT,
  ADD COLUMN IF NOT EXISTS artist_correct   BOOLEAN,
  ADD COLUMN IF NOT EXISTS songname_correct BOOLEAN,
  ADD COLUMN IF NOT EXISTS bonus_awarded    BOOLEAN NOT NULL DEFAULT false;
