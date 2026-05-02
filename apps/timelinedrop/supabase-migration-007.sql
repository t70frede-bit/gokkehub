-- TimelineDrop migration 007: year corrections + combined judging.
-- Run after migration 006.

ALTER TABLE tl_rounds
  ADD COLUMN IF NOT EXISTS corrected_year                INT,
  ADD COLUMN IF NOT EXISTS year_correction_proposed       INT,
  ADD COLUMN IF NOT EXISTS year_correction_proposed_by    TEXT,
  ADD COLUMN IF NOT EXISTS year_correction_proposed_name  TEXT;

-- Same for tl_timeline so a corrected year persists after the round closes
ALTER TABLE tl_timeline
  ADD COLUMN IF NOT EXISTS corrected_year INT;
