-- =============================================================================
-- DEMO TEARDOWN — removes "Demo Night" and the 4 demo accounts.
-- Order matters: clear any active_group_id pointing at the group (incl. your
-- Gokkefar account if the demo set it), then delete the group (cascades its
-- sessions, players, events, transactions, memberships, bounty rows), then the
-- demo accounts. Your real account + real groups are untouched.
-- =============================================================================

update poker_users set active_group_id = null
  where active_group_id = 'a0000000-0000-0000-0000-0000000000d1';

delete from poker_groups where id = 'a0000000-0000-0000-0000-0000000000d1';

delete from auth.users where id in (
  'a0000000-0000-0000-0000-0000000000a1',
  'a0000000-0000-0000-0000-0000000000a2',
  'a0000000-0000-0000-0000-0000000000a3',
  'a0000000-0000-0000-0000-0000000000a4'
);
