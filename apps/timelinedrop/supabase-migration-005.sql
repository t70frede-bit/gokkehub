-- TimelineDrop migration 005: live staging — broadcast captain's tentative placement to all clients.

ALTER TABLE tl_rounds
  ADD COLUMN IF NOT EXISTS staged_left_year  INT,
  ADD COLUMN IF NOT EXISTS staged_right_year INT;
