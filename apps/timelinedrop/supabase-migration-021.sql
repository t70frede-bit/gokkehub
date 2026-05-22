-- Migration 021 — generalised issue-report reason
--
-- The existing video_report_* columns (migration 015) only carry the
-- *who* and *whether* of a report — they were originally for the
-- "wrong YouTube version" flow in Discord-bot mode. The new player-
-- facing "Error?" button lets anyone report an issue mid-round with
-- a chosen reason ("no song playing", "wrong song / bad audio",
-- "other", etc.). Stash that reason here so the host's approval
-- banner can display what was actually reported.
--
-- The flag side reuses video_report_proposed / video_report_approved
-- so existing host-approval / Redo plumbing keeps working. The host-
-- approved track-blacklist (don't re-pick repeatedly-flagged audio in
-- future curation) is intentionally deferred — write side lands later
-- once we agree on the read side in the curation engine.

ALTER TABLE tl_rounds
  ADD COLUMN IF NOT EXISTS issue_report_reason TEXT;
