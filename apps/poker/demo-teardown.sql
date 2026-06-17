-- =============================================================================
-- DEMO TEARDOWN — removes everything demo-seed.sql created.
-- Deleting the demo group cascades its sessions, players, events, transactions,
-- memberships and bounty rows (incl. Gokkefar's demo membership + demo top-up).
-- Then the 4 demo accounts are deleted (cascades their poker_users rows).
-- Your real account (Gokkefar) and all real groups are untouched.
-- =============================================================================

delete from poker_groups where id = 'a0000000-0000-0000-0000-0000000000d1';

delete from auth.users where id in (
  'a0000000-0000-0000-0000-0000000000a1',
  'a0000000-0000-0000-0000-0000000000a2',
  'a0000000-0000-0000-0000-0000000000a3',
  'a0000000-0000-0000-0000-0000000000a4'
);
