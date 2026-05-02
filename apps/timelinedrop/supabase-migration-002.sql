-- TimelineDrop migration 002: lobby settings + spectators
-- Run in Supabase SQL editor after 001.

-- 1) Lobby-wide settings (late join mode, streamer mode, hide spectators, team swap)
ALTER TABLE tl_rooms
  ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}'::jsonb;

-- 2) Spectator role on players (DJ-only host or late spectator joiner)
ALTER TABLE tl_players
  ADD COLUMN IF NOT EXISTS is_spectator BOOLEAN NOT NULL DEFAULT false;
