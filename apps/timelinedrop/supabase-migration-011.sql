-- TimelineDrop migration 011: pool auto-refill needs host session lookup.
-- Run after migration 010.
--
-- Auto-refill (when track_cursor approaches pool.length) fires from any
-- player's request, but the curation engine needs the HOST's Spotify access
-- token to look up URIs. We can't read the host's session cookie from a
-- different player's request, so persist the session id on the room when
-- the game starts and load the session from KV by that id during top-up.
--
-- Stored value is the UUID session id (already in SESSIONS KV); not the
-- access token itself. KV-side expiry handles auth revocation.

ALTER TABLE tl_rooms
  ADD COLUMN IF NOT EXISTS host_session_id TEXT;
