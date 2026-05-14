-- TimelineDrop migration 014: Song Limiter token.
-- Run after migration 013.
--
-- The opposing team's captain spends a song_limiter token (category
-- opponent_turn) to cut the active team's song to a fixed window — 20
-- seconds in the catalog. The host's audio player watches this column
-- and auto-pauses playback once positionMs exceeds song_limit_seconds * 1000.
-- A "⏱ Ns left" chip surfaces the limit to every client.

ALTER TABLE tl_rounds
  ADD COLUMN IF NOT EXISTS song_limit_seconds INT;
