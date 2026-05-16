-- Migration 016 — global accepted-answers table for auto-judging
--
-- Every time a judge marks an artist or songname guess correct, the
-- normalized form of that guess is upserted here so future games with
-- the same track auto-judge that variant without needing human input.
-- The table grows with use; over time, the system needs fewer manual
-- judge presses for popular songs.
--
-- Audit fields (source_player_id / last_confirmed_by_id) let you spot
-- abuse — query "all accepted answers added by player X" to see if one
-- user is consistently approving nonsense.
--
-- Soft cap of 20 entries per (track_id, kind) is enforced at write
-- time in recordAcceptedAnswer (apps/timelinedrop/functions/_supabase.ts).
-- The DB doesn't enforce it; it's an application-side anti-bloat guard.

CREATE TABLE IF NOT EXISTS tl_accepted_answers (
  track_id              TEXT      NOT NULL,                            -- Spotify id
  kind                  TEXT      NOT NULL CHECK (kind IN ('artist','songname')),
  answer_normalized     TEXT      NOT NULL,                            -- comparison key
  answer_original       TEXT      NOT NULL,                            -- as a player typed it
  confirmations         INT       NOT NULL DEFAULT 1,                  -- count of positive judge verdicts
  first_added_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_confirmed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_player_id      TEXT      NOT NULL,                            -- who first taught the system this variant
  source_player_name    TEXT      NOT NULL,
  last_confirmed_by_id  TEXT,                                          -- who most recently confirmed it
  last_confirmed_by_name TEXT,
  source_room           TEXT,                                          -- which room first locked it in
  PRIMARY KEY (track_id, kind, answer_normalized)
);

-- Audit query helper: "show me all entries this player added" is the
-- most common abuse-spotting query.
CREATE INDEX IF NOT EXISTS tl_accepted_answers_source_player_idx
  ON tl_accepted_answers (source_player_id);
