-- =============================================================================
-- ROLLBACK for migration 009 (Mystery Bounty). Removes everything the bounty
-- test added. Safe: the bounty money rode on normal deposit/withdrawal rows
-- (notes "Bounty …"); those ledger entries stay, balances are unaffected.
-- Run this to fully remove the bounty feature from the database.
-- =============================================================================

drop function if exists poker_enable_bounty(uuid, integer);
drop function if exists poker_buy_bounty(uuid);
drop function if exists poker_record_knockout(uuid, uuid);
drop function if exists poker_close_bounty(uuid);

drop table if exists poker_bounty_claims;
drop table if exists poker_bounty_entries;

alter table poker_game_sessions drop column if exists bounty_enabled;
alter table poker_game_sessions drop column if exists bounty_buyin;
alter table poker_game_sessions drop column if exists bounty_pool;
