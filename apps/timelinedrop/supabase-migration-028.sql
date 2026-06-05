-- Migration 028 — playlist catalog
--
-- A curated library of public Spotify playlists the host can browse and
-- add to a room without having to hunt down URLs. Each row stores the
-- Spotify playlist ID + metadata (genre/era tags + a baseline
-- difficulty rating) so the Lobby's catalog browser can filter and sort.
--
-- Per-player effective difficulty is computed CLIENT-SIDE from this
-- baseline + the player's spotify-taste profile + tl_player_song_stats
-- (Phase 2 stats); no derived columns here.
--
-- Spotify-owned editorial playlists (URI prefix 37i9dQZF1...) are NOT
-- usable — they 404 for new apps post Nov 2024. Every seed row below is
-- from a user account (Topsify, Filtr, Pitchfork, etc.).

CREATE TABLE IF NOT EXISTS tl_playlist_catalog (
  id                  SERIAL PRIMARY KEY,
  name                TEXT    NOT NULL,
  description         TEXT,
  spotify_playlist_id TEXT    NOT NULL UNIQUE,
  owner_name          TEXT,
  genre_tags          TEXT[]  NOT NULL DEFAULT '{}',
  era_tags            TEXT[]  NOT NULL DEFAULT '{}',
  baseline_difficulty INT     NOT NULL DEFAULT 3 CHECK (baseline_difficulty BETWEEN 1 AND 5),
  track_count         INT,
  added_by            TEXT    NOT NULL DEFAULT 'system',
  added_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_validated_at   TIMESTAMPTZ,
  is_active           BOOLEAN NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS tl_playlist_catalog_active
  ON tl_playlist_catalog (is_active, baseline_difficulty);

ALTER TABLE tl_playlist_catalog ENABLE ROW LEVEL SECURITY;
-- Open read so the Lobby can fetch via anon key directly; writes go
-- through service-role from Cloudflare functions only.
CREATE POLICY "read_all" ON tl_playlist_catalog FOR SELECT USING (true);

-- Seed: 5 hand-picked playlists across distinct genres/eras + difficulty
-- bands, validated 2026-06-05 via web research. All user-owned (not
-- Spotify-editorial) so /playlists/{id} works for our app.
INSERT INTO tl_playlist_catalog
  (name, description, spotify_playlist_id, owner_name, genre_tags, era_tags, baseline_difficulty)
VALUES
  (
    '90s Hip Hop Don''t Stop',
    'Golden-era classics from Biggie, Tupac, Nas, Outkast and more.',
    '7HQu1GUDVSx64GdCpaB88I',
    'Topsify US',
    ARRAY['hip-hop','rap'],
    ARRAY['90s'],
    3
  ),
  (
    '80s Rock Music — 1980 Rock Songs',
    'Best 80s rock — 150 tracks across the decade''s mega-hits and deep cuts.',
    '2zgYhQXRYLB0OsUo6M0D4x',
    'Redlist',
    ARRAY['rock','classic-rock'],
    ARRAY['80s'],
    2
  ),
  (
    '2010s Summer Pop Throwbacks',
    'Sony''s curated 2010s pop summer anthems — songs everyone knows.',
    '1tPWTwuxOLsE2Do1JQSUxA',
    'Filtr UK',
    ARRAY['pop'],
    ARRAY['2010s'],
    2
  ),
  (
    'Best EDM of All Time',
    'Most popular EDM tracks across the genre''s history.',
    '1dvoCOb3vso33rTd4FWqRW',
    'Akhil Sagar',
    ARRAY['electronic','edm','dance'],
    ARRAY['mixed'],
    4
  ),
  (
    'Pitchfork: 200 Best Songs of the 2010s',
    'Pitchfork''s critical picks — indie, hip-hop and electronic deeper cuts.',
    '2ua9P1PJZ8vNU1ZOZq6tqe',
    'Pitchfork',
    ARRAY['indie','rock','eclectic'],
    ARRAY['2010s'],
    4
  )
ON CONFLICT (spotify_playlist_id) DO NOTHING;
