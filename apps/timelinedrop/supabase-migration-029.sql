-- Migration 029 — catalog playlists hand-encoded as track lists
--
-- The Spotify-playlist-ID approach (migration 028) had two problems:
--   1. Editorial playlists are 404 for new apps post Nov 2024, so we
--      were stuck using user-curated playlists that get deleted/renamed
--   2. Most discoverable themed playlists are single-decade (90s rap,
--      80s rock) which makes the year-placement game trivial — we want
--      pools spanning at least 30-40 years
--
-- Solution: catalog entries can carry their own track list as JSONB
-- (array of {artist, title, year}). At import time the server runs
-- each through searchTrackUri (same path the curation pipeline uses)
-- to resolve the Spotify URI. This gives us full curatorial control
-- and decouples from any specific source playlist.
--
-- Backward compat: spotify_playlist_id stays but becomes nullable.
-- Existing rows from migration 028 are wiped (they were all single-
-- decade anyway).

ALTER TABLE tl_playlist_catalog
  ALTER COLUMN spotify_playlist_id DROP NOT NULL;

ALTER TABLE tl_playlist_catalog
  ADD COLUMN IF NOT EXISTS track_list JSONB;

-- Wipe the old single-decade seed and replace with a real multi-
-- decade list. One seed for now to validate the pipeline; expand
-- via follow-up commits once the architecture is in.
DELETE FROM tl_playlist_catalog;

INSERT INTO tl_playlist_catalog
  (name, description, owner_name, genre_tags, era_tags, baseline_difficulty, track_list)
VALUES (
  'Classic Rock Spanning Decades',
  '50 well-known rock songs from 1965 to 2010 — wide year spread for the timeline game.',
  'GokkeHub',
  ARRAY['rock','classic-rock'],
  ARRAY['60s','70s','80s','90s','2000s'],
  3,
  '[
    {"artist":"The Rolling Stones","title":"(I Can''t Get No) Satisfaction","year":1965},
    {"artist":"The Beatles","title":"Hey Jude","year":1968},
    {"artist":"Creedence Clearwater Revival","title":"Fortunate Son","year":1969},
    {"artist":"Led Zeppelin","title":"Whole Lotta Love","year":1969},
    {"artist":"The Who","title":"Baba O''Riley","year":1971},
    {"artist":"John Lennon","title":"Imagine","year":1971},
    {"artist":"Led Zeppelin","title":"Stairway to Heaven","year":1971},
    {"artist":"Don McLean","title":"American Pie","year":1971},
    {"artist":"Pink Floyd","title":"Money","year":1973},
    {"artist":"Lynyrd Skynyrd","title":"Free Bird","year":1973},
    {"artist":"David Bowie","title":"Heroes","year":1977},
    {"artist":"Queen","title":"Bohemian Rhapsody","year":1975},
    {"artist":"Aerosmith","title":"Dream On","year":1975},
    {"artist":"Bob Dylan","title":"Hurricane","year":1975},
    {"artist":"Fleetwood Mac","title":"Go Your Own Way","year":1977},
    {"artist":"Eagles","title":"Hotel California","year":1977},
    {"artist":"The Clash","title":"London Calling","year":1979},
    {"artist":"Pink Floyd","title":"Another Brick in the Wall, Pt. 2","year":1979},
    {"artist":"AC/DC","title":"Back in Black","year":1980},
    {"artist":"Queen","title":"Another One Bites the Dust","year":1980},
    {"artist":"Journey","title":"Don''t Stop Believin''","year":1981},
    {"artist":"Survivor","title":"Eye of the Tiger","year":1982},
    {"artist":"Michael Jackson","title":"Beat It","year":1982},
    {"artist":"The Police","title":"Every Breath You Take","year":1983},
    {"artist":"Van Halen","title":"Jump","year":1984},
    {"artist":"Tina Turner","title":"What''s Love Got to Do with It","year":1984},
    {"artist":"Dire Straits","title":"Money for Nothing","year":1985},
    {"artist":"Bon Jovi","title":"Livin'' on a Prayer","year":1986},
    {"artist":"Guns N'' Roses","title":"Sweet Child O'' Mine","year":1987},
    {"artist":"U2","title":"With or Without You","year":1987},
    {"artist":"R.E.M.","title":"Losing My Religion","year":1991},
    {"artist":"Nirvana","title":"Smells Like Teen Spirit","year":1991},
    {"artist":"Red Hot Chili Peppers","title":"Under the Bridge","year":1991},
    {"artist":"Pearl Jam","title":"Alive","year":1991},
    {"artist":"Radiohead","title":"Creep","year":1992},
    {"artist":"Soundgarden","title":"Black Hole Sun","year":1994},
    {"artist":"Oasis","title":"Wonderwall","year":1995},
    {"artist":"Foo Fighters","title":"Everlong","year":1997},
    {"artist":"Red Hot Chili Peppers","title":"Otherside","year":1999},
    {"artist":"Linkin Park","title":"In the End","year":2000},
    {"artist":"The Strokes","title":"Last Nite","year":2001},
    {"artist":"The White Stripes","title":"Seven Nation Army","year":2003},
    {"artist":"Green Day","title":"American Idiot","year":2004},
    {"artist":"Franz Ferdinand","title":"Take Me Out","year":2004},
    {"artist":"Arctic Monkeys","title":"I Bet You Look Good on the Dancefloor","year":2005},
    {"artist":"Kings of Leon","title":"Sex on Fire","year":2008},
    {"artist":"Muse","title":"Uprising","year":2009},
    {"artist":"Foster the People","title":"Pumped Up Kicks","year":2010},
    {"artist":"Mumford & Sons","title":"Little Lion Man","year":2009},
    {"artist":"Black Keys","title":"Lonely Boy","year":2011}
  ]'::JSONB
);
