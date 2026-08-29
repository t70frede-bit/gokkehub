-- Migration 030 — search guess mode
--
-- Adds three things, all in service of the new `guessMode: "search"` room
-- setting where the captain PICKS a track from a typeahead instead of
-- typing free text that a human then judges:
--
--   1. tl_track_index — a local, trigram-searchable index of every track
--      the platform has ever put in front of a player. The /track-search
--      endpoint merges this with Deezer results. The local layer exists to
--      GUARANTEE the round's actual answer is always findable (it came from
--      a track_pool, so it is in here), even if Deezer is down, rate-limits,
--      or spells the title differently. Deezer supplies the breadth that
--      stops players brute-forcing a small index.
--
--   2. tl_rounds.songname_pick_track_id — the Spotify id of the track the
--      captain picked, when the pick came from our own index. Lets the
--      grader short-circuit to an exact id compare instead of normalising
--      strings. Null for typed-mode rounds and for Deezer-only picks.
--
--   3. tl_rounds.guess_dispute_* — the propose/approve pair for the new
--      "my guess was graded wrong" branch of the ❓ Correct an issue?
--      dropdown. Mirrors the existing year_correction_proposed_* shape;
--      issue_request_type (migration 022) gains the value "guess".
--
-- Search mode has no human judge, so a wrongly-graded guess previously had
-- no recovery path at all. The dispute branch also closes the same hole in
-- vote-all judging, where handleFinalize sets judging_finalized and locks
-- the verdict permanently.

-- ── 1. Local track index ────────────────────────────────────────────────────

-- Trigram matching gives us "queen boh" → "Bohemian Rhapsody — Queen"
-- without needing a tsvector/stemming setup, and it degrades gracefully on
-- typos, which is the whole point of a typeahead in a party game.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS tl_track_index (
  track_id     TEXT PRIMARY KEY,             -- Spotify id; same key as tl_song_stats
  title        TEXT NOT NULL,
  artist       TEXT NOT NULL,
  release_year INT,
  cover_url    TEXT,
  -- Denormalised "artist — title" haystack. Written by the trigger below so
  -- callers never have to remember to keep it in sync. The GIN index is on
  -- this column, so a single index serves queries against either field.
  search_text  TEXT NOT NULL DEFAULT '',
  -- Where the row came from: 'pool' (a room's track_pool), 'catalog' (a
  -- curated catalog import), 'seed' (bulk backfill). Diagnostic only.
  source       TEXT NOT NULL DEFAULT 'pool',
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Reserved for popularity ranking in the typeahead. NOT populated yet:
  -- indexTracks() upserts via PostgREST, which can't do an arithmetic
  -- increment without a read-modify-write, and that isn't worth a round-trip
  -- purely to reorder suggestions. The search RPC already sorts by it as a
  -- last tiebreaker, so populating it later (a counter trigger, or reading
  -- tl_song_stats.plays) needs no code change on the query side.
  play_count   INT NOT NULL DEFAULT 0
);

CREATE OR REPLACE FUNCTION tl_track_index_search_text()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_text := lower(NEW.artist || ' ' || NEW.title);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tl_track_index_search_text_trg ON tl_track_index;
CREATE TRIGGER tl_track_index_search_text_trg
  BEFORE INSERT OR UPDATE OF title, artist ON tl_track_index
  FOR EACH ROW EXECUTE FUNCTION tl_track_index_search_text();

CREATE INDEX IF NOT EXISTS tl_track_index_search_trgm
  ON tl_track_index USING GIN (search_text gin_trgm_ops);

ALTER TABLE tl_track_index ENABLE ROW LEVEL SECURITY;
-- Open read, mirroring tl_playlist_catalog (migration 028): the index is
-- public song metadata with no room or player association. Writes go
-- through service-role from Pages Functions only.
DROP POLICY IF EXISTS "read_all" ON tl_track_index;
CREATE POLICY "read_all" ON tl_track_index FOR SELECT USING (true);

-- Typeahead query. Called via PostgREST /rpc/tl_search_tracks.
--
-- similarity() rather than a plain LIKE so "bohemian rapsody" still finds
-- the track. The ILIKE prefilter is what actually uses the GIN index —
-- similarity() alone would force a sequential scan over the whole table.
CREATE OR REPLACE FUNCTION tl_search_tracks(q TEXT, lim INT DEFAULT 10)
RETURNS TABLE (
  track_id     TEXT,
  title        TEXT,
  artist       TEXT,
  release_year INT,
  cover_url    TEXT,
  score        REAL
) AS $$
  SELECT
    t.track_id,
    t.title,
    t.artist,
    t.release_year,
    t.cover_url,
    similarity(t.search_text, lower(q)) AS score
  FROM tl_track_index t
  WHERE t.search_text ILIKE '%' || lower(q) || '%'
     OR similarity(t.search_text, lower(q)) > 0.25
  ORDER BY
    -- Exact prefix beats a fuzzy hit; among equals, prefer songs this
    -- group actually plays.
    (t.search_text ILIKE lower(q) || '%') DESC,
    score DESC,
    t.play_count DESC
  LIMIT LEAST(GREATEST(lim, 1), 25);
$$ LANGUAGE sql STABLE;

-- ── 2. Which track the captain picked ───────────────────────────────────────

ALTER TABLE tl_rounds
  ADD COLUMN IF NOT EXISTS songname_pick_track_id TEXT;

-- ── 3. "My guess was graded wrong" propose/approve ──────────────────────────

-- Which field is being disputed: 'artist' | 'songname'. Null when nothing
-- is in flight. Deliberately one field at a time — a captain who got both
-- wrong-graded files two disputes, which keeps the host's approval banner
-- unambiguous about what they are agreeing to.
ALTER TABLE tl_rounds
  ADD COLUMN IF NOT EXISTS guess_dispute_field         TEXT;
ALTER TABLE tl_rounds
  ADD COLUMN IF NOT EXISTS guess_dispute_proposed_by   TEXT;
ALTER TABLE tl_rounds
  ADD COLUMN IF NOT EXISTS guess_dispute_proposed_name TEXT;
