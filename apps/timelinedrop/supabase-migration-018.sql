-- Migration 018 — points + shop token economy
--
-- Adds the per-team `points` balance used by the "shop" tokenEconomy
-- mode. In shop mode a team earns +1 point per correct artist field and
-- +1 per correct songname field; the captain can then spend points to
-- buy specific tokens.
--
-- Per-round `shop_*_pointed` flags act as idempotency guards: re-runs of
-- handlePlace / handleJudge / handleFinalize (or auto-judge transitions)
-- don't double-credit points for the same correct guess.
--
-- The other two tokenEconomy modes ("standard", "bonus") ignore these
-- fields — points stay at 0 and the flags never flip.

ALTER TABLE tl_teams
  ADD COLUMN IF NOT EXISTS points INT NOT NULL DEFAULT 0;

ALTER TABLE tl_rounds
  ADD COLUMN IF NOT EXISTS shop_artist_pointed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS shop_song_pointed   BOOLEAN NOT NULL DEFAULT false;
