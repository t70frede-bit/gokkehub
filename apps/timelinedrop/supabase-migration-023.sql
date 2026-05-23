-- Migration 023 — explicit per-team colour
--
-- Until now team colour was positional: `sort_order` mod 4 picked one of
-- red / blue / green / yellow from a fixed palette. The host couldn't
-- change a team's colour (they'd have to delete + recreate, which loses
-- the lobby URL). This column persists an explicit choice; clients fall
-- back to the positional palette when it's null (legacy rooms + freshly
-- created teams that didn't pick).
--
-- Values: "red" | "blue" | "green" | "yellow". Nullable = use the
-- sort_order-based fallback.

ALTER TABLE tl_teams
  ADD COLUMN IF NOT EXISTS color TEXT;
