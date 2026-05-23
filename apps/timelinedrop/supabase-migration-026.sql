-- Migration 026 — Phase 2 song stats
--
-- Per-Spotify-track aggregate counters that accumulate across every
-- room. The eventual Phase 3 curation consumer reads correct /
-- incorrect placement rates to: (a) replace Spotify top-tracks rank
-- as the difficulty proxy, (b) drive a "stretch mode" that biases
-- toward low-correct-placement songs, and (c) act as a smarter global
-- recently-played filter than the per-player tl_played_tracks (which
-- only knows about the players in the current room).
--
-- Phase 2 = ship the table + write hook. No consumer yet — data
-- starts accumulating immediately so Phase 3 has signal to work
-- with when it lands.
--
-- Schema:
--   track_id              Spotify track id (PK)
--   plays                 # placement attempts (correct + incorrect)
--   correct_placements    cumulative # placed within tolerance
--   incorrect_placements  cumulative # placed outside tolerance
--   last_played_at        most recent placement attempt

CREATE TABLE IF NOT EXISTS tl_song_stats (
  track_id             TEXT NOT NULL PRIMARY KEY,
  plays                INT  NOT NULL DEFAULT 0,
  correct_placements   INT  NOT NULL DEFAULT 0,
  incorrect_placements INT  NOT NULL DEFAULT 0,
  last_played_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tl_song_stats_last_played
  ON tl_song_stats (last_played_at DESC);

ALTER TABLE tl_song_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read_all" ON tl_song_stats FOR SELECT USING (true);
-- Writes come from Cloudflare Functions via service-role key — no
-- client-side insert/update policy. The eventual Phase 3 curator
-- queries this with the anon key (SELECT only).
