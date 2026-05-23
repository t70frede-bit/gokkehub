-- Migration 024 — shop pings
--
-- Teammates (and opponents, with a softer label) can ping a specific
-- token in another team's shop to draw the active captain's attention.
-- Distinct from tl_pings (timeline gap/card pings) because shop pings
-- aren't tied to a round or a year — they're attached to a team + token
-- type.
--
-- Lifetime is short: clients auto-expire pings after ~10s. We don't
-- bother with a server-side TTL job — rows are tiny and a reset/replay
-- cleans them up via reset.ts.

CREATE TABLE IF NOT EXISTS tl_shop_pings (
  id          SERIAL PRIMARY KEY,
  room_id     TEXT NOT NULL,
  team_id     INT  NOT NULL,
  token_type  TEXT NOT NULL,
  player_id   TEXT NOT NULL,
  player_name TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tl_shop_pings_room_created
  ON tl_shop_pings (room_id, created_at DESC);

-- Realtime so clients get pushed updates without polling.
ALTER PUBLICATION supabase_realtime ADD TABLE tl_shop_pings;

-- RLS pattern matches tl_pings: open read, open insert (service-role
-- key writes from Cloudflare Functions; clients only read).
ALTER TABLE tl_shop_pings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read_all"     ON tl_shop_pings FOR SELECT USING (true);
CREATE POLICY "insert_pings" ON tl_shop_pings FOR INSERT WITH CHECK (true);
