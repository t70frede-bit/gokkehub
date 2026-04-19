-- ============================================================
-- GridChallenge v2 — Supabase Setup
-- ============================================================
--
-- HOW TO USE:
--
--   FRESH PROJECT (no tables yet):
--     Paste the ENTIRE file and run it.
--
--   EXISTING PROJECT (upgrading from v1):
--     Run only the section marked "MIGRATION FROM V1" — it
--     adds the new columns and tables without touching data.
--
-- ============================================================


-- ============================================================
-- SECTION 1 — CORE GAME TABLES (fresh install only)
-- ============================================================

-- Lobbies
CREATE TABLE IF NOT EXISTS lobbies (
  id                  TEXT PRIMARY KEY,
  host_player_id      TEXT,
  status              TEXT        DEFAULT 'waiting',   -- waiting | playing | finished
  settings            JSONB       DEFAULT '{}'::jsonb, -- LobbySettings JSON
  board_challenge_ids JSONB,                           -- [{id, source}] once game starts
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Players
CREATE TABLE IF NOT EXISTS players (
  id            TEXT PRIMARY KEY,               -- random UUID per browser session
  lobby_id      TEXT REFERENCES lobbies(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  team          TEXT,                           -- blue|red|green|yellow|null
  is_host       BOOLEAN DEFAULT FALSE,
  is_spectator  BOOLEAN DEFAULT FALSE,
  kicked        BOOLEAN DEFAULT FALSE,
  user_id       TEXT,                           -- GokkeHub userId if signed in
  avatar_url    TEXT,                           -- GokkeHub avatar URL
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Custom challenges submitted by players in lobby
CREATE TABLE IF NOT EXISTS custom_challenges (
  id          SERIAL PRIMARY KEY,
  lobby_id    TEXT REFERENCES lobbies(id) ON DELETE CASCADE,
  player_id   TEXT,
  player_name TEXT,
  text        TEXT NOT NULL,
  type        TEXT NOT NULL,                   -- single | group | versus
  game        TEXT NOT NULL
);

-- Tile claims (real-time board state)
CREATE TABLE IF NOT EXISTS claims (
  lobby_id     TEXT REFERENCES lobbies(id) ON DELETE CASCADE,
  challenge_id TEXT,
  player_id    TEXT,
  player_name  TEXT,
  team         TEXT,
  claimed_at   TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (lobby_id, challenge_id)
);

-- Versus timer state (host writes, everyone subscribes)
CREATE TABLE IF NOT EXISTS versus_state (
  lobby_id               TEXT PRIMARY KEY REFERENCES lobbies(id) ON DELETE CASCADE,
  active_challenge_id    TEXT,
  next_challenge_id      TEXT,
  next_versus_timestamp  BIGINT,
  unlocked_challenge_ids JSONB DEFAULT '[]'::jsonb
);


-- ============================================================
-- SECTION 2 — PLAYER ACCOUNT TABLES (new in v2)
-- ============================================================

-- Game library: games a player has added to their account
-- (populated from Steam/Discord sync or manual entry)
CREATE TABLE IF NOT EXISTS player_games (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        TEXT NOT NULL,                -- GokkeHub userId
  display_name   TEXT NOT NULL,                -- e.g. "Counter-Strike 2"
  normalized_key TEXT NOT NULL,                -- e.g. "cs2"
  source         TEXT NOT NULL DEFAULT 'manual', -- steam | discord | manual
  steam_app_id   INTEGER,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, normalized_key)             -- one entry per game per user
);

-- Player-submitted challenges (saved to their account)
CREATE TABLE IF NOT EXISTS player_challenges (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      TEXT NOT NULL,
  player_name  TEXT NOT NULL,
  text         TEXT NOT NULL,
  type         TEXT NOT NULL,                  -- single | group | versus
  game         TEXT NOT NULL,                  -- normalized game key
  upvote_count INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Upvotes on player challenges (one per GokkeHub user per challenge)
CREATE TABLE IF NOT EXISTS challenge_upvotes (
  challenge_id UUID REFERENCES player_challenges(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (challenge_id, user_id)
);


-- ============================================================
-- SECTION 3 — REALTIME
-- ============================================================

ALTER PUBLICATION supabase_realtime ADD TABLE lobbies;
ALTER PUBLICATION supabase_realtime ADD TABLE players;
ALTER PUBLICATION supabase_realtime ADD TABLE custom_challenges;
ALTER PUBLICATION supabase_realtime ADD TABLE claims;
ALTER PUBLICATION supabase_realtime ADD TABLE versus_state;
-- player_games / player_challenges / challenge_upvotes don't need realtime


-- ============================================================
-- SECTION 4 — ROW LEVEL SECURITY
-- ============================================================

-- Game tables — no auth needed (lobby code is the access control)
ALTER TABLE lobbies           ENABLE ROW LEVEL SECURITY;
ALTER TABLE players           ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE claims            ENABLE ROW LEVEL SECURITY;
ALTER TABLE versus_state      ENABLE ROW LEVEL SECURITY;

-- Account tables — readable by anyone, writable only by owner
ALTER TABLE player_games      ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE challenge_upvotes ENABLE ROW LEVEL SECURITY;

-- Drop old policies (safe to re-run)
DO $$ DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT policyname, tablename FROM pg_policies
    WHERE tablename IN (
      'lobbies','players','custom_challenges','claims','versus_state',
      'player_games','player_challenges','challenge_upvotes'
    )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.policyname, r.tablename);
  END LOOP;
END $$;

-- Game tables: fully open (anon key)
CREATE POLICY "read_lobbies"  ON lobbies           FOR SELECT USING (true);
CREATE POLICY "write_lobbies" ON lobbies            FOR ALL    USING (true) WITH CHECK (true);
CREATE POLICY "read_players"  ON players            FOR SELECT USING (true);
CREATE POLICY "write_players" ON players            FOR ALL    USING (true) WITH CHECK (true);
CREATE POLICY "read_custom"   ON custom_challenges  FOR SELECT USING (true);
CREATE POLICY "write_custom"  ON custom_challenges  FOR ALL    USING (true) WITH CHECK (true);
CREATE POLICY "read_claims"   ON claims             FOR SELECT USING (true);
CREATE POLICY "write_claims"  ON claims             FOR ALL    USING (true) WITH CHECK (true);
CREATE POLICY "read_versus"   ON versus_state       FOR SELECT USING (true);
CREATE POLICY "write_versus"  ON versus_state       FOR ALL    USING (true) WITH CHECK (true);

-- player_games: public read, owner write
-- NOTE: user_id is the GokkeHub userId (text), not the Supabase auth UID.
-- Since the gridchallenge client uses the anon key without user auth, we allow
-- all reads and all writes (the user_id check is enforced application-side).
-- For tighter security in future, set up a Supabase Edge Function proxy.
CREATE POLICY "read_player_games"   ON player_games      FOR SELECT USING (true);
CREATE POLICY "write_player_games"  ON player_games      FOR ALL    USING (true) WITH CHECK (true);

CREATE POLICY "read_player_challenges"  ON player_challenges FOR SELECT USING (true);
CREATE POLICY "write_player_challenges" ON player_challenges FOR ALL    USING (true) WITH CHECK (true);

CREATE POLICY "read_challenge_upvotes"  ON challenge_upvotes FOR SELECT USING (true);
CREATE POLICY "write_challenge_upvotes" ON challenge_upvotes FOR ALL    USING (true) WITH CHECK (true);


-- ============================================================
-- SECTION 5 — AUTO-CLEANUP (pg_cron)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Remove old job if it exists, then reschedule
DO $$
BEGIN
  PERFORM cron.unschedule('cleanup-old-lobbies');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'cleanup-old-lobbies',
  '0 * * * *',
  $$
    DELETE FROM lobbies
    WHERE created_at < NOW() - INTERVAL '48 hours';
  $$
);


-- ============================================================
-- MIGRATION FROM V1 — run this block on an existing project
-- ============================================================
-- Only needed if you already have the lobbies/players/etc tables
-- from the old vanilla JS version. Safe to run multiple times.

-- Add new columns to players (if not already present)
ALTER TABLE players ADD COLUMN IF NOT EXISTS user_id    TEXT;
ALTER TABLE players ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- Create the new account tables (IF NOT EXISTS = safe to re-run)
-- (Already defined above — no need to repeat)

-- Done. The three new tables (player_games, player_challenges, challenge_upvotes)
-- are created by the IF NOT EXISTS statements in Section 2 above.
