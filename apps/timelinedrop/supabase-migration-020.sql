-- Migration 020 — bonus_blocked flag on rounds
--
-- The Artist Picker token (and future Genre Picker) lets the active
-- captain choose what song comes next. In exchange, that round can't
-- earn token/shop rewards — otherwise picking a song you obviously know
-- would be a free bonus. This flag marks such rounds; the award helpers
-- in functions/room/[id]/round.ts skip them.

ALTER TABLE tl_rounds
  ADD COLUMN IF NOT EXISTS bonus_blocked BOOLEAN NOT NULL DEFAULT false;
