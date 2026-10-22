-- Migration 032 — Music Bingo game mode
--
-- Bingo is a second game mode inside the same musix room (settings.gameMode
-- = "bingo"). It reuses tl_rooms / tl_teams / tl_players and plays songs
-- through tl_rounds exactly like the timeline game, so every audio mode
-- (Spotify SDK, all-clients-stream, the Discord bot) works unchanged: one
-- tl_rounds row per song, current_round_id points at the one playing.
--
-- What's new:
--   • tl_rounds.bingo_track_no — the public "Track #N" every screen shows.
--     The answer for track N is that round's `track`, which the server
--     checks ticks against. Null on timeline rounds.
--   • tl_bingo_boards — one word grid per team (teams share a board).
--   • tl_bingo_marks  — ticks on a board. Teammates SUGGEST, the captain
--     CONFIRMS. A confirm the server rejects (word not in that track, or the
--     searched song isn't that track) is kept as 'rejected' so the board can
--     show failed attempts — a social brake on guessing every track number.
--
-- All writes go through Pages Functions with the service-role key; clients
-- only read (RLS read_all, same as every other tl_ table).

ALTER TABLE tl_rounds ADD COLUMN IF NOT EXISTS bingo_track_no INT;
CREATE INDEX IF NOT EXISTS tl_rounds_bingo_track
  ON tl_rounds (room_id, bingo_track_no) WHERE bingo_track_no IS NOT NULL;

CREATE TABLE IF NOT EXISTS tl_bingo_boards (
  team_id      INT  PRIMARY KEY REFERENCES tl_teams(id) ON DELETE CASCADE,
  room_id      TEXT NOT NULL REFERENCES tl_rooms(id) ON DELETE CASCADE,
  size         INT  NOT NULL CHECK (size BETWEEN 3 AND 5),
  -- size*size display words, row-major. Matching uses the normalised form,
  -- so the display casing here is cosmetic.
  words        JSONB NOT NULL,
  -- Set once when the team completes the win pattern. The first team to
  -- win ends the game; the column is per-team so a simultaneous finish
  -- can still show both.
  won_at       TIMESTAMPTZ,
  won_track_no INT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tl_bingo_boards_room ON tl_bingo_boards (room_id);

CREATE TABLE IF NOT EXISTS tl_bingo_marks (
  id          SERIAL PRIMARY KEY,
  room_id     TEXT NOT NULL REFERENCES tl_rooms(id) ON DELETE CASCADE,
  team_id     INT  NOT NULL REFERENCES tl_teams(id) ON DELETE CASCADE,
  cell        INT  NOT NULL CHECK (cell >= 0 AND cell < 25),
  state       TEXT NOT NULL CHECK (state IN ('suggested', 'confirmed', 'rejected')),
  -- Which played track the tick claims the word came from. Null only when
  -- the room's check mode is "off" and nobody picked one.
  track_no    INT,
  -- Song-search check mode: the track the player picked from /track-search
  -- ({ title, artist, spotifyId? }). Null in the other modes.
  pick        JSONB,
  player_id   TEXT NOT NULL,
  player_name TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tl_bingo_marks_room ON tl_bingo_marks (room_id);
-- One confirmed tick per cell per team. Changing the track number of a
-- ticked word updates this row in place.
CREATE UNIQUE INDEX IF NOT EXISTS tl_bingo_marks_one_confirmed
  ON tl_bingo_marks (team_id, cell) WHERE state = 'confirmed';

ALTER TABLE tl_bingo_boards ENABLE ROW LEVEL SECURITY;
ALTER TABLE tl_bingo_marks  ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read_all" ON tl_bingo_boards;
DROP POLICY IF EXISTS "read_all" ON tl_bingo_marks;
CREATE POLICY "read_all" ON tl_bingo_boards FOR SELECT USING (true);
CREATE POLICY "read_all" ON tl_bingo_marks  FOR SELECT USING (true);

-- DELETE events need the full old row so clients can drop the right mark
-- without a refetch.
ALTER TABLE tl_bingo_marks REPLICA IDENTITY FULL;

ALTER PUBLICATION supabase_realtime ADD TABLE tl_bingo_boards;
ALTER PUBLICATION supabase_realtime ADD TABLE tl_bingo_marks;
