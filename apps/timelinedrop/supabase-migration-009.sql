-- TimelineDrop migration 009: typed tokens with effects.
-- Replaces the simple int counter on tl_teams with one row per token, so each
-- earned token has a stable identity, type, and used-state. Old token counts
-- on tl_teams stay around as a legacy display fallback.

CREATE TABLE IF NOT EXISTS tl_team_tokens (
  id          SERIAL       PRIMARY KEY,
  room_id     TEXT         NOT NULL REFERENCES tl_rooms(id) ON DELETE CASCADE,
  team_id     INT          NOT NULL REFERENCES tl_teams(id) ON DELETE CASCADE,
  type        TEXT         NOT NULL,
  granted_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  granted_round INT,
  used_at     TIMESTAMPTZ,
  used_round  INT,
  pending     BOOLEAN      NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS tl_team_tokens_team_idx
  ON tl_team_tokens (team_id, used_at);

ALTER PUBLICATION supabase_realtime ADD TABLE tl_team_tokens;
ALTER TABLE tl_team_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read_all" ON tl_team_tokens FOR SELECT USING (true);

-- Per-round token-state columns. Most tokens fold their effect into one of
-- these flags; complex tokens get their own column when we wire them up.
ALTER TABLE tl_rounds
  ADD COLUMN IF NOT EXISTS skipped              BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cover_revealed       BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS year_tolerance       INT     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS more_or_less_card_id TEXT,
  ADD COLUMN IF NOT EXISTS recovery_armed       BOOLEAN NOT NULL DEFAULT false;
