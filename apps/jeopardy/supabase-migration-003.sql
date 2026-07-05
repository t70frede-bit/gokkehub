-- GokkeHub Jeopardy — migration 003
-- Buzzer sounds: snapshot of the player's profile buzzer sound, copied from
-- the session at join/launch time. "preset:<id>" or an uploaded-clip URL.
-- Run in Supabase SQL editor.

ALTER TABLE jp_players ADD COLUMN IF NOT EXISTS buzzer_sound TEXT;
