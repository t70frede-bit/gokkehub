-- Migration 025 — Steal by Year token state
--
-- After an opposing team's wrong placement, a captain holding the
-- steal_by_year token can guess the exact year (±tolerance) to steal
-- the card onto their team's timeline. These columns record the
-- attempt so the UI can hide the actual year while the steal is in
-- progress and so the result animates / locks in correctly.
--
-- steal_team_id     — team attempting the steal (the OPPONENT of round.team_id)
-- steal_year_guess  — the year they guessed
-- steal_outcome     — "success" | "fail" once resolved; null while pending
--
-- All three nullable; null on every existing row means "no steal".

ALTER TABLE tl_rounds
  ADD COLUMN IF NOT EXISTS steal_team_id    INTEGER,
  ADD COLUMN IF NOT EXISTS steal_year_guess INTEGER,
  ADD COLUMN IF NOT EXISTS steal_outcome    TEXT;
