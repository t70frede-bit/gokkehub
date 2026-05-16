-- Migration 017 — audit-trail fields on tl_song_corrections
--
-- tl_song_corrections (migration 013) tracks per-track year corrections
-- but only knew which ROOM submitted them. Adding player identity makes
-- abuse spotting symmetric with tl_accepted_answers — "show me all year
-- corrections player X has filed across all rooms".

ALTER TABLE tl_song_corrections
  ADD COLUMN IF NOT EXISTS source_player_id   TEXT,
  ADD COLUMN IF NOT EXISTS source_player_name TEXT;

CREATE INDEX IF NOT EXISTS tl_song_corrections_source_player_idx
  ON tl_song_corrections (source_player_id);
