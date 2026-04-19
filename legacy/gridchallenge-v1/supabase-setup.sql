-- =============================================
-- Bingo Party Game — Supabase Setup Script
-- =============================================
--
-- HOW TO USE:
--
--   FIRST TIME (fresh project, no data yet):
--     → Paste this ENTIRE file into SQL Editor → Run
--
--   ALREADY HAVE TABLES (existing project with data):
--     → Only paste the section marked "EXISTING PROJECT" below → Run
--       (This updates RLS policies and adds the cleanup job without touching your data)
--
-- =============================================


-- =============================================
-- SECTION 1 — FULL FRESH SETUP
-- (Skip this section if you already have tables)
-- =============================================

-- Drop existing tables if re-running setup
DROP TABLE IF EXISTS versus_state CASCADE;
DROP TABLE IF EXISTS claims CASCADE;
DROP TABLE IF EXISTS custom_challenges CASCADE;
DROP TABLE IF EXISTS players CASCADE;
DROP TABLE IF EXISTS lobbies CASCADE;

-- Lobbies
CREATE TABLE lobbies (
  id TEXT PRIMARY KEY,
  host_player_id TEXT,
  status TEXT DEFAULT 'waiting',        -- 'waiting' | 'playing' | 'finished'
  settings JSONB DEFAULT '{}'::jsonb,   -- board config (size, games, types, etc.)
  board_challenge_ids JSONB,            -- ordered list of challenge IDs once game starts
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Players
CREATE TABLE players (
  id TEXT PRIMARY KEY,                  -- random UUID per browser session
  lobby_id TEXT REFERENCES lobbies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  team TEXT,                            -- 'blue' | 'red' | 'green' | 'yellow' | null = spectator
  is_host BOOLEAN DEFAULT FALSE,
  is_spectator BOOLEAN DEFAULT FALSE,
  kicked BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Custom challenges submitted by players in lobby
CREATE TABLE custom_challenges (
  id SERIAL PRIMARY KEY,
  lobby_id TEXT REFERENCES lobbies(id) ON DELETE CASCADE,
  player_id TEXT,
  player_name TEXT,
  text TEXT NOT NULL,
  type TEXT NOT NULL,                   -- 'single' | 'group' | 'versus'
  game TEXT NOT NULL
);

-- Tile claims (real-time board state)
CREATE TABLE claims (
  lobby_id TEXT REFERENCES lobbies(id) ON DELETE CASCADE,
  challenge_id TEXT,                    -- "csv_1" or "custom_5"
  player_id TEXT,
  player_name TEXT,
  team TEXT,
  claimed_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (lobby_id, challenge_id)
);

-- Versus timer state (host writes, all subscribe)
CREATE TABLE versus_state (
  lobby_id TEXT PRIMARY KEY REFERENCES lobbies(id) ON DELETE CASCADE,
  active_challenge_id TEXT,
  next_challenge_id TEXT,
  next_versus_timestamp BIGINT,
  unlocked_challenge_ids JSONB DEFAULT '[]'::jsonb
);

-- Enable Realtime on all tables
ALTER PUBLICATION supabase_realtime ADD TABLE lobbies;
ALTER PUBLICATION supabase_realtime ADD TABLE players;
ALTER PUBLICATION supabase_realtime ADD TABLE custom_challenges;
ALTER PUBLICATION supabase_realtime ADD TABLE claims;
ALTER PUBLICATION supabase_realtime ADD TABLE versus_state;


-- =============================================
-- SECTION 2 — RLS POLICIES + AUTO-CLEANUP
-- (Run this section for BOTH fresh and existing projects)
-- =============================================

-- Enable Row Level Security
ALTER TABLE lobbies          ENABLE ROW LEVEL SECURITY;
ALTER TABLE players          ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE claims           ENABLE ROW LEVEL SECURITY;
ALTER TABLE versus_state     ENABLE ROW LEVEL SECURITY;

-- Drop old combined policies if they exist
DROP POLICY IF EXISTS "allow_all_lobbies" ON lobbies;
DROP POLICY IF EXISTS "allow_all_players" ON players;
DROP POLICY IF EXISTS "allow_all_custom"  ON custom_challenges;
DROP POLICY IF EXISTS "allow_all_claims"  ON claims;
DROP POLICY IF EXISTS "allow_all_versus"  ON versus_state;

-- Drop new policies too (so this script is safe to re-run)
DROP POLICY IF EXISTS "read_lobbies"  ON lobbies;
DROP POLICY IF EXISTS "write_lobbies" ON lobbies;
DROP POLICY IF EXISTS "read_players"  ON players;
DROP POLICY IF EXISTS "write_players" ON players;
DROP POLICY IF EXISTS "read_custom"   ON custom_challenges;
DROP POLICY IF EXISTS "write_custom"  ON custom_challenges;
DROP POLICY IF EXISTS "read_claims"   ON claims;
DROP POLICY IF EXISTS "write_claims"  ON claims;
DROP POLICY IF EXISTS "read_versus"   ON versus_state;
DROP POLICY IF EXISTS "write_versus"  ON versus_state;

-- Separate SELECT from write policies (suppresses Supabase security warning)
-- The game has no user auth — the lobby code is the only access control.
CREATE POLICY "read_lobbies"  ON lobbies  FOR SELECT USING (true);
CREATE POLICY "write_lobbies" ON lobbies  FOR ALL    USING (true) WITH CHECK (true);
CREATE POLICY "read_players"  ON players  FOR SELECT USING (true);
CREATE POLICY "write_players" ON players  FOR ALL    USING (true) WITH CHECK (true);
CREATE POLICY "read_custom"   ON custom_challenges FOR SELECT USING (true);
CREATE POLICY "write_custom"  ON custom_challenges FOR ALL    USING (true) WITH CHECK (true);
CREATE POLICY "read_claims"   ON claims   FOR SELECT USING (true);
CREATE POLICY "write_claims"  ON claims   FOR ALL    USING (true) WITH CHECK (true);
CREATE POLICY "read_versus"   ON versus_state FOR SELECT USING (true);
CREATE POLICY "write_versus"  ON versus_state FOR ALL    USING (true) WITH CHECK (true);

-- Auto-cleanup: delete lobbies (and all their data) older than 48 hours
-- Runs every hour via pg_cron. Cascades to players, claims, custom_challenges, versus_state.
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  PERFORM cron.unschedule('cleanup-old-lobbies');
EXCEPTION WHEN OTHERS THEN NULL; -- ignore if job doesn't exist yet
END $$;

SELECT cron.schedule(
  'cleanup-old-lobbies',
  '0 * * * *',
  $$
    DELETE FROM lobbies
    WHERE created_at < NOW() - INTERVAL '48 hours';
  $$
);
