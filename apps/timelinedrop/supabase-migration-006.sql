-- TimelineDrop migration 006: Last.fm curation engine
-- Run after migration 005.

-- 1) Player Last.fm linkage + manual artist fallback
ALTER TABLE tl_players
  ADD COLUMN IF NOT EXISTS discord_id        TEXT,
  ADD COLUMN IF NOT EXISTS lastfm_username   TEXT,
  ADD COLUMN IF NOT EXISTS manual_artists    JSONB NOT NULL DEFAULT '[]'::jsonb;

-- 2) Per-team / round metadata for tracks once played
ALTER TABLE tl_rounds
  ADD COLUMN IF NOT EXISTS familiarity_score   INT,
  ADD COLUMN IF NOT EXISTS confidence          TEXT,    -- 'known' | 'likely' | 'stretch' | 'wild'
  ADD COLUMN IF NOT EXISTS players_who_know_it JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS lastfm_name         TEXT,
  ADD COLUMN IF NOT EXISTS artist_name         TEXT;

-- 3) 14-day blacklist of played tracks per player
CREATE TABLE IF NOT EXISTS tl_played_tracks (
  id          SERIAL PRIMARY KEY,
  room_id     TEXT        NOT NULL REFERENCES tl_rooms(id) ON DELETE CASCADE,
  player_id   TEXT        NOT NULL,
  track_id    TEXT        NOT NULL,    -- Spotify URI or Last.fm composite key
  played_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tl_played_tracks_player_played_at
  ON tl_played_tracks (player_id, played_at DESC);

-- Enable realtime + open RLS (same pattern as the existing tl_* tables)
ALTER TABLE tl_played_tracks ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "read_all" ON tl_played_tracks FOR SELECT USING (true);

ALTER PUBLICATION supabase_realtime ADD TABLE tl_played_tracks;
