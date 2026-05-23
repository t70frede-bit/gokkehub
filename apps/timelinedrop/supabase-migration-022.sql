-- Migration 022 — unified "Correct an issue?" request type
--
-- The reveal overlay now has a single "❓ Correct an issue?" button that
-- replaces the separate year-correction and video-report propose UIs.
-- Players pick one of four actions:
--   • Correct year                     → year correction only
--   • Correct year and refund token    → year correction + un-burn the
--                                         team's token used this round
--   • Report YouTube video             → video issue flag
--   • Report YouTube video and do over → video flag + trigger redo
--
-- The propose flags reuse existing columns (year_correction_proposed
-- and video_report_proposed) — the new column below records WHICH of
-- the four flavours was requested so the host's approval banner can
-- show it and the server can do the extra action (refund / redo) when
-- the host approves.
--
-- Values: "year" | "year_refund" | "video" | "video_redo". Nullable
-- when no issue is currently proposed.

ALTER TABLE tl_rounds
  ADD COLUMN IF NOT EXISTS issue_request_type TEXT;
