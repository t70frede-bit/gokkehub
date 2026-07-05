-- GokkeHub Jeopardy — migration 002
-- Power-ups + dangerous tiles, answer-mode submissions, media storage.
-- Run in Supabase SQL editor.

-- ── Server-only secrets: which tiles are special ─────────────────────────────
-- No SELECT policy on purpose: board_state is world-readable, so special-tile
-- positions must live where the anon key can't see them. Service role only.
CREATE TABLE IF NOT EXISTS jp_room_secrets (
  room_id       TEXT PRIMARY KEY REFERENCES jp_rooms(id) ON DELETE CASCADE,
  special_tiles JSONB NOT NULL DEFAULT '{}'   -- { "board0": { "2-1": "powerup_sniper", ... }, "board1": {...} }
);
ALTER TABLE jp_room_secrets ENABLE ROW LEVEL SECURITY;

-- ── Submissions: MC / closest-number / ranking answers + Final Jeopardy ──────
-- Also RLS-locked with no read policy: players must not see each other's
-- answers or wagers. The host reads them through a host-checked Pages Function.
CREATE TABLE IF NOT EXISTS jp_submissions (
  id          BIGSERIAL PRIMARY KEY,
  room_id     TEXT NOT NULL REFERENCES jp_rooms(id) ON DELETE CASCADE,
  tile_key    TEXT NOT NULL,               -- "__final__" for Final Jeopardy rows
  kind        TEXT NOT NULL,               -- 'answer' | 'final_wager' | 'final_answer'
  team_id     INT  NOT NULL,
  player_id   TEXT NOT NULL,
  payload     JSONB NOT NULL,              -- { "value": ... }
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- One submission per team per question/kind — first lock-in wins.
CREATE UNIQUE INDEX IF NOT EXISTS jp_submissions_once
  ON jp_submissions (room_id, tile_key, kind, team_id);
ALTER TABLE jp_submissions ENABLE ROW LEVEL SECURITY;

-- ── Atomic submitted-team marker ──────────────────────────────────────────────
-- Appends a team id to the public "who has locked in" list without a
-- read-modify-write race between concurrent submissions. p_final routes to
-- final.submittedTeamIds instead of activeQuestion.submittedTeamIds.
CREATE OR REPLACE FUNCTION jp_mark_submitted(
  p_room_id TEXT,
  p_team_id INT,
  p_final   BOOLEAN DEFAULT false
) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  v_path TEXT[];
BEGIN
  v_path := CASE WHEN p_final
                 THEN ARRAY['final', 'submittedTeamIds']
                 ELSE ARRAY['activeQuestion', 'submittedTeamIds'] END;
  UPDATE jp_rooms
  SET board_state = jsonb_set(
        board_state,
        v_path,
        COALESCE(board_state #> v_path, '[]'::jsonb) || to_jsonb(p_team_id),
        true),
      updated_at = now()
  WHERE id = p_room_id
    AND (CASE WHEN p_final
              THEN board_state->'final'
              ELSE board_state->'activeQuestion' END) IS NOT NULL
    AND NOT (COALESCE(board_state #> v_path, '[]'::jsonb) @> to_jsonb(p_team_id));
END;
$$;

-- ── Media bucket for question images ─────────────────────────────────────────
-- Public read (the big screen and phones fetch images directly); writes go
-- through the host-checked upload Pages Function using the service role.
INSERT INTO storage.buckets (id, name, public)
VALUES ('jp-media', 'jp-media', true)
ON CONFLICT (id) DO NOTHING;
