-- TimelineDrop migration 012: Force Lock token.
-- Run after migration 011.
--
-- Force Lock is the first opponent-turn token. The opposing team's captain
-- plays it on the active team's current round; when set, the active team
-- can no longer trigger action="next" after a correct placement — their
-- turn ends after this song regardless of outcome (pending cards lock via
-- the existing flow). New column flips true when the token burns.

ALTER TABLE tl_rounds
  ADD COLUMN IF NOT EXISTS force_locked BOOLEAN NOT NULL DEFAULT FALSE;
