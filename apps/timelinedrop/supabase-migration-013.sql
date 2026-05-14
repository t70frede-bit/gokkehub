-- TimelineDrop migration 013: Persistent year corrections (Phase 1 of the
-- "song knowledge database" — see plan_timelinedrop_roadmap.md).
-- Run after migration 012.
--
-- One host-approved year correction in any room now persists for every
-- future game across the platform. Spotify's album.release_date is wrong
-- for remasters and compilations; this lets every party that hits the
-- same song inherit the corrected year automatically, instead of having
-- to re-correct it in every room.
--
-- Latest-wins policy: the most recent host-approved year overwrites any
-- prior value (option A in the design discussion). Bad data can be
-- cleaned up via SQL — voting/median is a future enhancement.

CREATE TABLE IF NOT EXISTS tl_song_corrections (
  track_id        TEXT        PRIMARY KEY,    -- Spotify track id
  corrected_year  INT         NOT NULL,
  source_room     TEXT,                       -- room that submitted the latest correction
  corrected_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tl_song_corrections_corrected_at
  ON tl_song_corrections (corrected_at DESC);

ALTER TABLE tl_song_corrections ENABLE ROW LEVEL SECURITY;
-- Read open (any client can fetch corrections); writes happen server-side
-- via the service-role key, so no INSERT/UPDATE policies are needed.
CREATE POLICY "read_all" ON tl_song_corrections FOR SELECT USING (true);
