-- Collaborators list per game: stored as JSONB array directly on the game row.
-- Each entry: { userId, displayName, avatar, addedAt, permissions: { editQuestions, editSettings } }
ALTER TABLE jp_games ADD COLUMN IF NOT EXISTS collaborators JSONB NOT NULL DEFAULT '[]';
