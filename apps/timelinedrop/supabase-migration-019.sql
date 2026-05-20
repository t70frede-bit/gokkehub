-- Migration 019 — Discord bot session persistence (Phase 6)
--
-- The musix-discord bot keeps its game sessions in an in-memory
-- Map<guildId, Session>. A restart (deploy, crash, host reboot) wipes
-- them, so the bot forgets which voice channel it was playing in and
-- goes silent until someone re-runs /musix join.
--
-- This table mirrors each GAME-mode session (not the ephemeral /play
-- music queue) so the bot can re-join the voice channel + re-subscribe
-- to the room's realtime channel on boot. One row per guild — the bot
-- can only be in one voice channel per server at a time, so guild_id
-- is the natural primary key.
--
-- Rows are written on /musix join, deleted on /musix leave, AFK
-- disconnect, or when the bot is kicked from voice. They are KEPT on a
-- graceful shutdown so the next boot can recover them.

CREATE TABLE IF NOT EXISTS tl_discord_sessions (
  guild_id            TEXT        PRIMARY KEY,    -- Discord guild (server) id
  room_id             TEXT        NOT NULL,       -- tl_rooms.id the bot is playing
  voice_channel_id    TEXT        NOT NULL,       -- voice channel the bot joined
  text_channel_id     TEXT,                       -- channel where now-playing messages post
  invited_by_user_id  TEXT,                       -- who ran /musix join (for logs)
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tl_discord_sessions_room_idx
  ON tl_discord_sessions (room_id);

ALTER TABLE tl_discord_sessions ENABLE ROW LEVEL SECURITY;
-- Reads open (consistent with the other tl_ tables); the bot writes with
-- the service-role key which bypasses RLS, so no write policy is needed.
CREATE POLICY "read_all" ON tl_discord_sessions FOR SELECT USING (true);
