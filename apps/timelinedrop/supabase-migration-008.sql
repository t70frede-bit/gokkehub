-- TimelineDrop migration 008: pings can land between cards in narrow gaps.
-- Run after migration 007.
--
-- The Timeline gap-pinging logic averages adjacent card years. For two
-- cards at consecutive years (e.g. 1990 + 1991) the midpoint is 1990.5 —
-- previously we rounded to 1991, which collided with the next card and
-- made gap-pings look like card-pings. Switching the column to NUMERIC
-- preserves the half-year so the ping renders on the gap.

ALTER TABLE tl_pings
  ALTER COLUMN year TYPE NUMERIC USING year::NUMERIC;
