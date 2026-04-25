-- TimelineDrop tables
-- Run in Supabase SQL editor

CREATE TABLE IF NOT EXISTS tl_rooms (
  id               TEXT PRIMARY KEY,
  host_id          TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'lobby',
  win_target       INT  NOT NULL DEFAULT 10,
  active_team_id   INT,
  track_pool       JSONB NOT NULL DEFAULT '[]',
  track_cursor     INT  NOT NULL DEFAULT 0,
  current_round_id INT,
  playing_since    BIGINT,
  paused_at_ms     INT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tl_teams (
  id             SERIAL PRIMARY KEY,
  room_id        TEXT NOT NULL REFERENCES tl_rooms(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  tokens         INT  NOT NULL DEFAULT 2,
  pending_tracks JSONB NOT NULL DEFAULT '[]',
  sort_order     INT  NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tl_players (
  id         TEXT PRIMARY KEY,
  room_id    TEXT NOT NULL,
  team_id    INT,
  name       TEXT NOT NULL,
  is_captain BOOLEAN NOT NULL DEFAULT false,
  is_host    BOOLEAN NOT NULL DEFAULT false,
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tl_rounds (
  id          SERIAL PRIMARY KEY,
  room_id     TEXT NOT NULL,
  team_id     INT  NOT NULL,
  track       JSONB NOT NULL,
  left_year   INT,
  right_year  INT,
  outcome     TEXT,
  revealed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS tl_timeline (
  team_id  INT  NOT NULL,
  track_id TEXT NOT NULL,
  year     INT  NOT NULL,
  position INT  NOT NULL DEFAULT 0,
  track    JSONB NOT NULL,
  PRIMARY KEY (team_id, track_id)
);

CREATE TABLE IF NOT EXISTS tl_pings (
  id          SERIAL PRIMARY KEY,
  round_id    INT  NOT NULL,
  player_id   TEXT NOT NULL,
  player_name TEXT NOT NULL,
  year        INT  NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tl_notes (
  id          SERIAL PRIMARY KEY,
  round_id    INT  NOT NULL,
  player_id   TEXT NOT NULL,
  player_name TEXT NOT NULL,
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable realtime on all tables
ALTER PUBLICATION supabase_realtime ADD TABLE tl_rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE tl_teams;
ALTER PUBLICATION supabase_realtime ADD TABLE tl_players;
ALTER PUBLICATION supabase_realtime ADD TABLE tl_rounds;
ALTER PUBLICATION supabase_realtime ADD TABLE tl_timeline;
ALTER PUBLICATION supabase_realtime ADD TABLE tl_pings;
ALTER PUBLICATION supabase_realtime ADD TABLE tl_notes;

-- RLS: open read + service-role write (same pattern as gridchallenge)
ALTER TABLE tl_rooms    ENABLE ROW LEVEL SECURITY;
ALTER TABLE tl_teams    ENABLE ROW LEVEL SECURITY;
ALTER TABLE tl_players  ENABLE ROW LEVEL SECURITY;
ALTER TABLE tl_rounds   ENABLE ROW LEVEL SECURITY;
ALTER TABLE tl_timeline ENABLE ROW LEVEL SECURITY;
ALTER TABLE tl_pings    ENABLE ROW LEVEL SECURITY;
ALTER TABLE tl_notes    ENABLE ROW LEVEL SECURITY;

-- Allow anon to read everything (realtime subscriptions need this)
CREATE POLICY "read_all" ON tl_rooms    FOR SELECT USING (true);
CREATE POLICY "read_all" ON tl_teams    FOR SELECT USING (true);
CREATE POLICY "read_all" ON tl_players  FOR SELECT USING (true);
CREATE POLICY "read_all" ON tl_rounds   FOR SELECT USING (true);
CREATE POLICY "read_all" ON tl_timeline FOR SELECT USING (true);
CREATE POLICY "read_all" ON tl_pings    FOR SELECT USING (true);
CREATE POLICY "read_all" ON tl_notes    FOR SELECT USING (true);

-- Allow anon to insert notes + pings directly (no server round-trip needed)
CREATE POLICY "insert_notes" ON tl_notes FOR INSERT WITH CHECK (true);
CREATE POLICY "insert_pings" ON tl_pings FOR INSERT WITH CHECK (true);
-- Allow anon to update player rows (captain assignment in lobby)
CREATE POLICY "update_players" ON tl_players FOR UPDATE USING (true);
