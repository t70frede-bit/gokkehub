-- =============================================================================
-- GokkeHub Poker — migration 009: Mystery Bounty (TEST / additive)
-- Run after 001–008. Fully ADDITIVE and ISOLATED — it does NOT modify
-- create/join/cashout. Bounty money rides on existing transaction types
-- (withdrawal = pay in, deposit = win/refund, with notes) so the balance
-- recompute is UNCHANGED. To remove it entirely, run supabase-migration-009-rollback.sql.
--
-- Model (cash-game friendly):
--   * Host enables a bounty on a session + sets a bounty buy-in.
--   * Players opt in (separate from the table buy-in) → their stake joins a pool.
--   * "Record knockout": eliminator draws a RANDOM amount from the remaining
--     pool (skewed: usually ~1x buy-in, rarely the jackpot) → credited to them.
--   * Close & refund: leftover pool is split back to entrants (money conserved).
-- =============================================================================

alter table poker_game_sessions add column if not exists bounty_enabled boolean not null default false;
alter table poker_game_sessions add column if not exists bounty_buyin   integer not null default 0;
alter table poker_game_sessions add column if not exists bounty_pool     integer not null default 0;

create table if not exists poker_bounty_entries (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references poker_game_sessions(id) on delete cascade,
  user_id    uuid not null references poker_users(id),
  amount     integer not null,
  created_at timestamptz not null default now(),
  unique (session_id, user_id)
);

create table if not exists poker_bounty_claims (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references poker_game_sessions(id) on delete cascade,
  group_id      uuid not null references poker_groups(id) on delete cascade,
  eliminator_id uuid not null references poker_users(id),
  eliminated_id uuid not null references poker_users(id),
  amount        integer not null,
  created_at    timestamptz not null default now(),
  unique (session_id, eliminated_id)   -- one knockout per head per session
);

alter table poker_bounty_entries enable row level security;
alter table poker_bounty_claims  enable row level security;

drop policy if exists poker_bounty_entries_select on poker_bounty_entries;
create policy poker_bounty_entries_select on poker_bounty_entries
  for select using (exists (select 1 from poker_game_sessions s where s.id = session_id and poker_is_member(s.group_id)));

drop policy if exists poker_bounty_claims_select on poker_bounty_claims;
create policy poker_bounty_claims_select on poker_bounty_claims
  for select using (poker_is_member(group_id));

-- Host enables the bounty + sets the buy-in (only before anyone has opted in).
create or replace function poker_enable_bounty(p_session uuid, p_buyin integer)
returns void language plpgsql security definer set search_path = public as $$
declare s poker_game_sessions;
begin
  select * into s from poker_game_sessions where id = p_session;
  if s is null then raise exception 'session not found'; end if;
  if s.host_id <> auth.uid() and not poker_is_group_admin(s.group_id) then raise exception 'host only'; end if;
  if s.status <> 'active' then raise exception 'session is not active'; end if;
  if p_buyin <= 0 then raise exception 'bounty buy-in must be positive'; end if;
  if exists (select 1 from poker_bounty_entries where session_id = p_session)
    then raise exception 'players have already joined the bounty'; end if;
  update poker_game_sessions set bounty_enabled = true, bounty_buyin = p_buyin where id = p_session;
end; $$;

-- Player opts into the bounty (must be seated at the table + have funds).
create or replace function poker_buy_bounty(p_session uuid)
returns void language plpgsql security definer set search_path = public as $$
declare s poker_game_sessions; gp poker_game_players; bal integer;
begin
  select * into s from poker_game_sessions where id = p_session for update;
  if s is null then raise exception 'session not found'; end if;
  if not s.bounty_enabled then raise exception 'no bounty on this table'; end if;
  if s.status <> 'active' then raise exception 'session is not active'; end if;
  select * into gp from poker_game_players where session_id = p_session and user_id = auth.uid();
  if gp is null or gp.cashed_out_at is not null then raise exception 'join the table first'; end if;
  if exists (select 1 from poker_bounty_entries where session_id = p_session and user_id = auth.uid())
    then raise exception 'already in the bounty'; end if;
  bal := poker_balance_of(auth.uid(), s.group_id);
  if bal < s.bounty_buyin then raise exception 'insufficient balance for the bounty'; end if;

  insert into poker_transactions (user_id, group_id, amount, type, status, session_id, note)
  values (auth.uid(), s.group_id, s.bounty_buyin, 'withdrawal', 'confirmed', p_session, 'Bounty buy-in');
  perform poker_recompute_balance(auth.uid(), s.group_id);
  insert into poker_bounty_entries (session_id, user_id, amount) values (p_session, auth.uid(), s.bounty_buyin);
  update poker_game_sessions set bounty_pool = bounty_pool + s.bounty_buyin where id = p_session;
end; $$;

-- Record a knockout: eliminator (caller) draws a random bounty from the pool.
create or replace function poker_record_knockout(p_session uuid, p_eliminated uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare s poker_game_sessions; r double precision; amt integer; pool integer;
begin
  select * into s from poker_game_sessions where id = p_session for update;
  if s is null then raise exception 'session not found'; end if;
  if not s.bounty_enabled then raise exception 'no bounty on this table'; end if;
  if p_eliminated = auth.uid() then raise exception 'you cannot knock out yourself'; end if;
  if not exists (select 1 from poker_bounty_entries where session_id = p_session and user_id = auth.uid())
    then raise exception 'you must be in the bounty to claim one'; end if;
  if not exists (select 1 from poker_bounty_entries where session_id = p_session and user_id = p_eliminated)
    then raise exception 'that player has no bounty'; end if;
  if exists (select 1 from poker_bounty_claims where session_id = p_session and eliminated_id = p_eliminated)
    then raise exception 'that player has already been knocked out'; end if;

  pool := s.bounty_pool;
  if pool <= 0 then raise exception 'the bounty pool is empty'; end if;

  -- Skewed draw: usually ~1x buy-in, sometimes 2x, rarely a jackpot (half→all the pool).
  r := random();
  if    r < 0.65 then amt := s.bounty_buyin;
  elsif r < 0.90 then amt := s.bounty_buyin * 2;
  else  amt := ceil(pool * (0.5 + random() * 0.5));
  end if;
  amt := greatest(1, least(amt, pool));

  insert into poker_transactions (user_id, group_id, amount, type, status, session_id, note)
  values (auth.uid(), s.group_id, amt, 'deposit', 'confirmed', p_session, 'Bounty win');
  perform poker_recompute_balance(auth.uid(), s.group_id);
  insert into poker_bounty_claims (session_id, group_id, eliminator_id, eliminated_id, amount)
  values (p_session, s.group_id, auth.uid(), p_eliminated, amt);
  update poker_game_sessions set bounty_pool = bounty_pool - amt where id = p_session;
  return amt;
end; $$;

-- Host/admin closes the bounty: refund the leftover pool equally to entrants.
create or replace function poker_close_bounty(p_session uuid)
returns void language plpgsql security definer set search_path = public as $$
declare s poker_game_sessions; n int; share int; rem int; e record; first boolean := true;
begin
  select * into s from poker_game_sessions where id = p_session for update;
  if s is null then raise exception 'session not found'; end if;
  if s.host_id <> auth.uid() and not poker_is_group_admin(s.group_id) then raise exception 'host only'; end if;
  if s.bounty_pool <= 0 then update poker_game_sessions set bounty_enabled = false where id = p_session; return; end if;

  select count(*) into n from poker_bounty_entries where session_id = p_session;
  if n = 0 then update poker_game_sessions set bounty_pool = 0, bounty_enabled = false where id = p_session; return; end if;
  share := s.bounty_pool / n;
  rem := s.bounty_pool - share * n;  -- remainder kroner go to the first entrant

  for e in select user_id from poker_bounty_entries where session_id = p_session order by created_at loop
    declare give int := share + (case when first then rem else 0 end);
    begin
      if give > 0 then
        insert into poker_transactions (user_id, group_id, amount, type, status, session_id, note)
        values (e.user_id, s.group_id, give, 'deposit', 'confirmed', p_session, 'Bounty refund');
        perform poker_recompute_balance(e.user_id, s.group_id);
      end if;
    end;
    first := false;
  end loop;

  update poker_game_sessions set bounty_pool = 0, bounty_enabled = false where id = p_session;
end; $$;

grant execute on function poker_enable_bounty(uuid, integer)        to authenticated;
grant execute on function poker_buy_bounty(uuid)                    to authenticated;
grant execute on function poker_record_knockout(uuid, uuid)         to authenticated;
grant execute on function poker_close_bounty(uuid)                  to authenticated;

do $$
begin
  begin alter publication supabase_realtime add table poker_bounty_entries; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table poker_bounty_claims;  exception when duplicate_object then null; end;
end $$;
