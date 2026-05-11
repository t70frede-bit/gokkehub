-- TimelineDrop migration 010: structured chat (suggestions for the captain).
-- Run after migration 009.
--
-- Players no longer post free-form chat — they submit "song name" or "artist"
-- suggestions, which the captain sees as click-to-fill chips above their
-- guess inputs. Free-form notes from before this migration default to 'free'
-- and are simply ignored by the new UI.

ALTER TABLE tl_notes
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'free';
