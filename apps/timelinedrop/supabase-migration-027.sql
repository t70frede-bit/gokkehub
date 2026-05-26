-- Migration 027 — per-player Spotify ID
--
-- Captured at join/create time when the joining session has Spotify
-- linked. Used by the Lobby coverage indicator (counts how many
-- players have Spotify connected for the spotify-taste curation
-- source) and as a tombstone flag if we later add a re-link prompt.
--
-- Nullable — players who joined without linking Spotify simply
-- carry NULL. Mirrors the existing `discord_id` column shape.

ALTER TABLE tl_players
  ADD COLUMN IF NOT EXISTS spotify_id TEXT;
