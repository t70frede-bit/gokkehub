-- GokkeHub Jeopardy — migration 001
-- Run in Supabase SQL editor

-- ── Tables ────────────────────────────────────────────────────────────────────

-- Saved game configs (dashboard drafts / rematch source). host_id is the
-- Supabase Auth user id — the dashboard is auth-scoped, unlike live rooms.
CREATE TABLE IF NOT EXISTS jp_games (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id     TEXT NOT NULL,
  title       TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'draft',   -- draft | ready | archived
  config      JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jp_games_host_idx ON jp_games (host_id);

-- One live play session. id IS the room code (uppercase alphanumeric) —
-- gokkehub.com/api/find-room probes this table by id, same as tl_rooms.
-- host_id is the host *player* id (jp_players.id), matching the tl convention.
CREATE TABLE IF NOT EXISTS jp_rooms (
  id           TEXT PRIMARY KEY,
  game_id      UUID NOT NULL REFERENCES jp_games(id),
  host_id      TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'lobby',  -- lobby | playing | paused | finished
  board_state  JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS jp_teams (
  id          SERIAL PRIMARY KEY,
  room_id     TEXT NOT NULL REFERENCES jp_rooms(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  score       INT  NOT NULL DEFAULT 0,
  powerup     TEXT,
  captain_id  TEXT,
  sort_order  INT  NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS jp_teams_room_idx ON jp_teams (room_id);

CREATE TABLE IF NOT EXISTS jp_players (
  id         TEXT PRIMARY KEY,
  room_id    TEXT NOT NULL REFERENCES jp_rooms(id) ON DELETE CASCADE,
  team_id    INT REFERENCES jp_teams(id),
  name       TEXT NOT NULL,
  user_id    TEXT,
  connected  BOOLEAN NOT NULL DEFAULT true,
  joined_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jp_players_room_idx ON jp_players (room_id);

-- The buzz race. created_at (Postgres now()) is the authoritative timestamp;
-- client and edge-isolate clocks are never trusted. buzz_round increments on
-- every re-buzz so each race is fresh.
CREATE TABLE IF NOT EXISTS jp_buzz_attempts (
  id          BIGSERIAL PRIMARY KEY,
  room_id     TEXT NOT NULL REFERENCES jp_rooms(id) ON DELETE CASCADE,
  tile_key    TEXT NOT NULL,
  buzz_round  INT  NOT NULL,
  team_id     INT  NOT NULL,
  player_id   TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- One buzz per player per race; a double-tap must not move them up the queue.
CREATE UNIQUE INDEX IF NOT EXISTS jp_buzz_attempts_once
  ON jp_buzz_attempts (room_id, tile_key, buzz_round, player_id);

-- Event log driving post-game stats. Written throughout play.
CREATE TABLE IF NOT EXISTS jp_game_events (
  id          BIGSERIAL PRIMARY KEY,
  room_id     TEXT NOT NULL REFERENCES jp_rooms(id) ON DELETE CASCADE,
  event_type  TEXT NOT NULL,
  team_id     INT,
  player_id   TEXT,
  payload     JSONB,
  created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jp_game_events_room_idx ON jp_game_events (room_id);

-- ── Buzz RPCs ─────────────────────────────────────────────────────────────────

-- Records a buzz and returns its 1-based arrival rank within the race.
-- The Pages Function that gets rank 1 owns the collection window: it waits
-- the configured ms, then calls jp_resolve_buzz. Under concurrency two
-- callers can both see rank 1 (each transaction can't see the other's
-- uncommitted row) — harmless, because jp_resolve_buzz is idempotent.
-- A duplicate buzz from the same player returns rank 0 (ignored).
CREATE OR REPLACE FUNCTION jp_buzz_insert(
  p_room_id   TEXT,
  p_tile_key  TEXT,
  p_buzz_round INT,
  p_team_id   INT,
  p_player_id TEXT
) RETURNS INT
LANGUAGE plpgsql AS $$
DECLARE
  v_id   BIGINT;
  v_rank INT;
BEGIN
  INSERT INTO jp_buzz_attempts (room_id, tile_key, buzz_round, team_id, player_id)
  VALUES (p_room_id, p_tile_key, p_buzz_round, p_team_id, p_player_id)
  ON CONFLICT (room_id, tile_key, buzz_round, player_id) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RETURN 0;  -- duplicate buzz, already racing
  END IF;

  SELECT COUNT(*) INTO v_rank
  FROM jp_buzz_attempts
  WHERE room_id = p_room_id AND tile_key = p_tile_key AND buzz_round = p_buzz_round
    AND id <= v_id;

  RETURN v_rank;
END;
$$;

-- Resolves the race: lowest Sniper-adjusted created_at wins. Writes the
-- winner into board_state atomically (conditional on buzzedBy still null),
-- locks the buzzers, and logs a buzz_win event. Safe to call from multiple
-- server instances — only the first conditional UPDATE lands. Returns the
-- winner recorded on the room, whether or not this call was the one that
-- wrote it.
CREATE OR REPLACE FUNCTION jp_resolve_buzz(
  p_room_id   TEXT,
  p_tile_key  TEXT,
  p_buzz_round INT,
  p_sniper_ms INT DEFAULT 0
) RETURNS TABLE (winner_team_id INT, winner_player_id TEXT)
LANGUAGE plpgsql AS $$
DECLARE
  v_team   INT;
  v_player TEXT;
  v_updated INT;
BEGIN
  SELECT a.team_id, a.player_id INTO v_team, v_player
  FROM jp_buzz_attempts a
  JOIN jp_teams t ON t.id = a.team_id
  WHERE a.room_id = p_room_id AND a.tile_key = p_tile_key AND a.buzz_round = p_buzz_round
  ORDER BY a.created_at
           - CASE WHEN t.powerup = 'sniper'
                  THEN make_interval(secs => p_sniper_ms / 1000.0)
                  ELSE INTERVAL '0' END,
           a.id
  LIMIT 1;

  IF v_team IS NULL THEN
    RETURN;  -- no attempts (shouldn't happen)
  END IF;

  UPDATE jp_rooms SET
    board_state = jsonb_set(
                    jsonb_set(
                      jsonb_set(
                        jsonb_set(board_state, '{buzzersOpen}', 'false'::jsonb),
                        '{activeQuestion,buzzedBy}',       to_jsonb(v_team)),
                      '{activeQuestion,buzzedPlayerId}',   to_jsonb(v_player)),
                    '{activeQuestion,timerStart}',         to_jsonb((extract(epoch FROM now()) * 1000)::BIGINT)),
    updated_at  = now()
  WHERE id = p_room_id
    AND status = 'playing'
    AND (board_state->>'buzzersOpen')::boolean = true
    AND board_state->'activeQuestion'->>'tileKey' = p_tile_key
    AND (board_state->'activeQuestion'->>'buzzedBy') IS NULL;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated > 0 THEN
    INSERT INTO jp_game_events (room_id, event_type, team_id, player_id, payload)
    VALUES (p_room_id, 'buzz_win', v_team, v_player,
            jsonb_build_object('tileKey', p_tile_key, 'buzzRound', p_buzz_round));
  END IF;

  -- Report whatever winner is on the room now (ours, or an earlier resolver's).
  RETURN QUERY
  SELECT (r.board_state->'activeQuestion'->>'buzzedBy')::INT,
         r.board_state->'activeQuestion'->>'buzzedPlayerId'
  FROM jp_rooms r
  WHERE r.id = p_room_id;
END;
$$;

-- ── Realtime ──────────────────────────────────────────────────────────────────

ALTER PUBLICATION supabase_realtime ADD TABLE jp_rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE jp_teams;
ALTER PUBLICATION supabase_realtime ADD TABLE jp_players;

-- ── RLS: open read + service-role write (same pattern as tl_* tables) ────────

ALTER TABLE jp_games         ENABLE ROW LEVEL SECURITY;
ALTER TABLE jp_rooms         ENABLE ROW LEVEL SECURITY;
ALTER TABLE jp_teams         ENABLE ROW LEVEL SECURITY;
ALTER TABLE jp_players       ENABLE ROW LEVEL SECURITY;
ALTER TABLE jp_buzz_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE jp_game_events   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read_all" ON jp_games         FOR SELECT USING (true);
CREATE POLICY "read_all" ON jp_rooms         FOR SELECT USING (true);
CREATE POLICY "read_all" ON jp_teams         FOR SELECT USING (true);
CREATE POLICY "read_all" ON jp_players       FOR SELECT USING (true);
CREATE POLICY "read_all" ON jp_game_events   FOR SELECT USING (true);
-- jp_buzz_attempts: no anon read needed (queue display is a later pass);
-- all writes everywhere go through Pages Functions with the service role.
