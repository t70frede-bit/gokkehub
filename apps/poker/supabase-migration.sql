-- =============================================================================
-- GokkeHub Poker — initial schema
-- Run in the Supabase SQL editor (project verbxfbfurachhxztkob), top to bottom.
--
-- Design notes
-- ------------
-- * All tables are prefixed `poker_` so they coexist safely with the other
--   GokkeHub apps in the SAME Supabase project (timelinedrop uses `tl_`,
--   gridchallenge uses `lobbies`, etc.). Nothing here touches existing tables.
-- * Money is stored as INTEGER whole kroner (DKK). Poker buy-ins are whole
--   amounts and MobilePay takes kroner, so this avoids float rounding.
-- * `balance` lives on poker_users and can NEVER go below 0 — enforced by a
--   CHECK constraint here AND re-checked in every RPC before it spends.
-- * Players may NOT write to these tables directly. RLS grants SELECT only.
--   Every mutation goes through a SECURITY DEFINER function below, which runs
--   as the table owner (bypassing RLS) but re-implements its own auth checks.
--   This makes "balance can never be tampered with by the client" structural.
-- =============================================================================

-- ── Tables ───────────────────────────────────────────────────────────────────

create table if not exists poker_users (
  id         uuid primary key references auth.users(id) on delete cascade,
  username   text not null unique,
  email      text,
  role       text not null default 'player' check (role in ('player', 'admin')),
  balance    integer not null default 0 check (balance >= 0),
  created_at timestamptz not null default now()
);

create table if not exists poker_game_sessions (
  id             uuid primary key default gen_random_uuid(),
  host_id        uuid not null references poker_users(id),
  status         text not null default 'lobby' check (status in ('lobby', 'active', 'finished')),
  min_buyin      integer not null check (min_buyin >= 0),
  max_buyin      integer not null check (max_buyin >= min_buyin),
  rebuys_enabled boolean not null default true,
  created_at     timestamptz not null default now(),
  finished_at    timestamptz
);

create table if not exists poker_transactions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references poker_users(id) on delete cascade,
  amount        integer not null check (amount > 0),
  type          text not null check (type in ('deposit', 'withdrawal', 'buy_in', 'cash_out', 'rebuy')),
  status        text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected', 'cancelled')),
  tracking_code text unique,
  note          text,
  confirmed_by  uuid references poker_users(id),
  session_id    uuid references poker_game_sessions(id) on delete set null,
  created_at    timestamptz not null default now()
);

create table if not exists poker_game_players (
  id                   uuid primary key default gen_random_uuid(),
  session_id           uuid not null references poker_game_sessions(id) on delete cascade,
  user_id              uuid not null references poker_users(id),
  total_buyin          integer not null default 0 check (total_buyin >= 0),
  cashout_value        integer,
  net_result           integer,
  chip_stack_photo_url text,
  joined_at            timestamptz not null default now(),
  cashed_out_at        timestamptz,
  unique (session_id, user_id)
);

create table if not exists poker_game_events (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references poker_game_sessions(id) on delete cascade,
  type       text not null check (type in ('player_joined', 'rebuy', 'cashout', 'session_ended')),
  user_id    uuid references poker_users(id),
  amount     integer,
  created_at timestamptz not null default now()
);

create index if not exists poker_tx_user_idx     on poker_transactions (user_id, created_at desc);
create index if not exists poker_tx_status_idx   on poker_transactions (status, created_at desc);
create index if not exists poker_gp_session_idx  on poker_game_players (session_id);
create index if not exists poker_gp_user_idx     on poker_game_players (user_id);
create index if not exists poker_ev_session_idx  on poker_game_events (session_id, created_at);

-- ── Helpers ──────────────────────────────────────────────────────────────────

-- Is the current JWT an admin? SECURITY DEFINER so it can read poker_users
-- without tripping that table's own RLS (avoids recursive policy evaluation).
-- Defined AFTER the tables: sql-language function bodies are validated at
-- creation time, so poker_users must already exist.
create or replace function poker_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from poker_users
    where id = auth.uid() and role = 'admin'
  );
$$;

-- ── Row Level Security ─────────────────────────────────────────────────────────
-- SELECT only. No INSERT/UPDATE/DELETE policies exist, so direct writes from the
-- anon/authenticated roles are denied — all writes funnel through the RPCs.

alter table poker_users         enable row level security;
alter table poker_transactions  enable row level security;
alter table poker_game_sessions enable row level security;
alter table poker_game_players  enable row level security;
alter table poker_game_events   enable row level security;

-- Users: you can read your OWN full row (incl. balance); admin reads everyone.
-- Other players' usernames / created_at / stats are exposed only through the
-- SECURITY DEFINER stat functions below — NOT through this table — so balance
-- stays private at the database level.
drop policy if exists poker_users_select on poker_users;
create policy poker_users_select on poker_users
  for select using (id = auth.uid() or poker_is_admin());

-- Transactions: your own, or admin sees all.
drop policy if exists poker_tx_select on poker_transactions;
create policy poker_tx_select on poker_transactions
  for select using (user_id = auth.uid() or poker_is_admin());

-- Sessions, game players and events are visible to ALL authenticated users
-- (needed for lobbies, live session state, recaps, profiles and leaderboard).
drop policy if exists poker_sessions_select on poker_game_sessions;
create policy poker_sessions_select on poker_game_sessions
  for select using (auth.role() = 'authenticated');

drop policy if exists poker_players_select on poker_game_players;
create policy poker_players_select on poker_game_players
  for select using (auth.role() = 'authenticated');

drop policy if exists poker_events_select on poker_game_events;
create policy poker_events_select on poker_game_events
  for select using (auth.role() = 'authenticated');

-- ── Balance accounting ───────────────────────────────────────────────────────
-- Balance is the sum of CONFIRMED, signed transaction amounts. Recomputing from
-- the ledger after every change keeps it consistent and makes admin status
-- reversals (e.g. un-cancelling a deposit) "just work". If a reversal would push
-- a balance below 0 (player already spent it), the CHECK constraint raises and
-- the status change is rejected — which is the correct, safe failure.
create or replace function poker_recompute_balance(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update poker_users u
  set balance = coalesce((
    select sum(
      case t.type
        when 'deposit'    then  t.amount
        when 'cash_out'   then  t.amount
        when 'withdrawal' then -t.amount
        when 'buy_in'     then -t.amount
        when 'rebuy'      then -t.amount
      end)
    from poker_transactions t
    where t.user_id = p_user and t.status = 'confirmed'
  ), 0)
  where u.id = p_user;
end;
$$;

-- Spendable balance helper (re-reads the row).
create or replace function poker_balance_of(p_user uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$ select balance from poker_users where id = p_user; $$;

-- Unique 4–6 digit tracking code (digits only; the app prefixes the app name).
create or replace function poker_gen_tracking_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare code text;
begin
  loop
    code := lpad((floor(random() * 9000) + 1000)::int::text, 4, '0');  -- 4 digits
    exit when not exists (select 1 from poker_transactions where tracking_code = code);
  end loop;
  return code;
end;
$$;

-- ── Player RPCs ────────────────────────────────────────────────────────────────

-- Player requests a top-up. Creates a PENDING deposit (does not touch balance)
-- and returns the row incl. its tracking code so the client can build the
-- MobilePay deep link.
create or replace function poker_request_topup(p_amount integer)
returns poker_transactions
language plpgsql
security definer
set search_path = public
as $$
declare tx poker_transactions;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'amount must be positive'; end if;

  insert into poker_transactions (user_id, amount, type, status, tracking_code)
  values (auth.uid(), p_amount, 'deposit', 'pending', poker_gen_tracking_code())
  returning * into tx;
  return tx;
end;
$$;

-- Player cancels their OWN pending deposit (e.g. changed their mind before paying).
-- Kept in the ledger as 'cancelled', never deleted.
create or replace function poker_cancel_topup(p_tx uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare tx poker_transactions;
begin
  select * into tx from poker_transactions where id = p_tx;
  if tx is null then raise exception 'transaction not found'; end if;
  if tx.user_id <> auth.uid() then raise exception 'not your transaction'; end if;
  if tx.status <> 'pending' then raise exception 'only pending requests can be cancelled'; end if;
  update poker_transactions set status = 'cancelled' where id = p_tx;
end;
$$;

-- Host opens a session lobby.
create or replace function poker_create_session(
  p_min integer, p_max integer, p_rebuys boolean
)
returns poker_game_sessions
language plpgsql
security definer
set search_path = public
as $$
declare s poker_game_sessions;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_min < 0 or p_max < p_min then raise exception 'invalid buy-in range'; end if;

  insert into poker_game_sessions (host_id, status, min_buyin, max_buyin, rebuys_enabled)
  values (auth.uid(), 'lobby', p_min, p_max, coalesce(p_rebuys, true))
  returning * into s;
  return s;
end;
$$;

-- Host promotes lobby -> active.
create or replace function poker_start_session(p_session uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare s poker_game_sessions;
begin
  select * into s from poker_game_sessions where id = p_session;
  if s is null then raise exception 'session not found'; end if;
  if s.host_id <> auth.uid() and not poker_is_admin() then raise exception 'only the host can start'; end if;
  if s.status <> 'lobby' then raise exception 'session is not in lobby'; end if;
  update poker_game_sessions set status = 'active' where id = p_session;
end;
$$;

-- Join a session with a buy-in (lobby or active). Moves money balance -> limbo.
create or replace function poker_join_session(p_session uuid, p_buyin integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare s poker_game_sessions; bal integer;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into s from poker_game_sessions where id = p_session for update;
  if s is null then raise exception 'session not found'; end if;
  if s.status not in ('lobby', 'active') then raise exception 'session is not open'; end if;
  if exists (select 1 from poker_game_players where session_id = p_session and user_id = auth.uid())
    then raise exception 'already joined'; end if;
  if p_buyin < s.min_buyin or p_buyin > s.max_buyin
    then raise exception 'buy-in must be between % and %', s.min_buyin, s.max_buyin; end if;

  bal := poker_balance_of(auth.uid());
  if bal < p_buyin then raise exception 'insufficient balance'; end if;

  insert into poker_game_players (session_id, user_id, total_buyin)
  values (p_session, auth.uid(), p_buyin);

  insert into poker_transactions (user_id, amount, type, status, session_id, note)
  values (auth.uid(), p_buyin, 'buy_in', 'confirmed', p_session, 'Buy-in');

  perform poker_recompute_balance(auth.uid());

  insert into poker_game_events (session_id, type, user_id, amount)
  values (p_session, 'player_joined', auth.uid(), p_buyin);
end;
$$;

-- Rebuy mid-game (requires rebuys enabled + confirmed funds available).
create or replace function poker_rebuy(p_session uuid, p_amount integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare s poker_game_sessions; gp poker_game_players; bal integer;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into s from poker_game_sessions where id = p_session for update;
  if s is null then raise exception 'session not found'; end if;
  if s.status <> 'active' then raise exception 'session is not active'; end if;
  if not s.rebuys_enabled then raise exception 'rebuys are disabled for this session'; end if;
  if p_amount <= 0 then raise exception 'amount must be positive'; end if;

  select * into gp from poker_game_players where session_id = p_session and user_id = auth.uid();
  if gp is null then raise exception 'you are not in this session'; end if;
  if gp.cashed_out_at is not null then raise exception 'you have already cashed out'; end if;

  bal := poker_balance_of(auth.uid());
  if bal < p_amount then raise exception 'insufficient balance'; end if;

  update poker_game_players set total_buyin = total_buyin + p_amount
    where session_id = p_session and user_id = auth.uid();

  insert into poker_transactions (user_id, amount, type, status, session_id, note)
  values (auth.uid(), p_amount, 'rebuy', 'confirmed', p_session, 'Rebuy');

  perform poker_recompute_balance(auth.uid());

  insert into poker_game_events (session_id, type, user_id, amount)
  values (p_session, 'rebuy', auth.uid(), p_amount);
end;
$$;

-- Cash out with a final chip value (+ optional chip-stack photo). Credits the
-- chip value back to balance, records net result, and finishes the session once
-- everyone has cashed out.
create or replace function poker_cashout(
  p_session uuid, p_cashout integer, p_photo_url text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare s poker_game_sessions; gp poker_game_players; remaining integer;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into s from poker_game_sessions where id = p_session for update;
  if s is null then raise exception 'session not found'; end if;
  if s.status <> 'active' then raise exception 'session is not active'; end if;
  if p_cashout is null or p_cashout < 0 then raise exception 'cash-out value cannot be negative'; end if;

  select * into gp from poker_game_players where session_id = p_session and user_id = auth.uid();
  if gp is null then raise exception 'you are not in this session'; end if;
  if gp.cashed_out_at is not null then raise exception 'already cashed out'; end if;

  update poker_game_players
  set cashout_value = p_cashout,
      net_result = p_cashout - total_buyin,
      chip_stack_photo_url = p_photo_url,
      cashed_out_at = now()
  where session_id = p_session and user_id = auth.uid();

  if p_cashout > 0 then
    insert into poker_transactions (user_id, amount, type, status, session_id, note)
    values (auth.uid(), p_cashout, 'cash_out', 'confirmed', p_session, 'Cash-out');
  end if;

  perform poker_recompute_balance(auth.uid());

  insert into poker_game_events (session_id, type, user_id, amount)
  values (p_session, 'cashout', auth.uid(), p_cashout);

  -- Last one out finishes the session.
  select count(*) into remaining
  from poker_game_players
  where session_id = p_session and cashed_out_at is null;

  if remaining = 0 then
    update poker_game_sessions set status = 'finished', finished_at = now() where id = p_session;
    insert into poker_game_events (session_id, type) values (p_session, 'session_ended');
  end if;
end;
$$;

-- Delete an EMPTY lobby session (host or admin). Never deletes joined/active ones.
create or replace function poker_delete_session(p_session uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare s poker_game_sessions;
begin
  select * into s from poker_game_sessions where id = p_session;
  if s is null then raise exception 'session not found'; end if;
  if s.host_id <> auth.uid() and not poker_is_admin() then raise exception 'not allowed'; end if;
  if s.status <> 'lobby' then raise exception 'only lobby sessions can be deleted'; end if;
  if exists (select 1 from poker_game_players where session_id = p_session)
    then raise exception 'session has players — cannot delete'; end if;
  delete from poker_game_sessions where id = p_session;
end;
$$;

-- ── Admin RPCs ───────────────────────────────────────────────────────────────

-- Change any transaction's status and rebuild the affected balance.
create or replace function poker_set_transaction_status(p_tx uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare tx poker_transactions;
begin
  if not poker_is_admin() then raise exception 'admin only'; end if;
  if p_status not in ('pending', 'confirmed', 'rejected', 'cancelled')
    then raise exception 'invalid status'; end if;

  select * into tx from poker_transactions where id = p_tx;
  if tx is null then raise exception 'transaction not found'; end if;

  update poker_transactions
  set status = p_status,
      confirmed_by = case when p_status = 'confirmed' then auth.uid() else confirmed_by end
  where id = p_tx;

  -- Rebuild balance from the ledger. If this drops below 0 the CHECK constraint
  -- raises and the whole change rolls back (safe — admin sees the error).
  perform poker_recompute_balance(tx.user_id);
end;
$$;

-- Manual balance adjustment with a note. Positive = credit, negative = debit.
create or replace function poker_admin_adjust_balance(
  p_user uuid, p_delta integer, p_note text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not poker_is_admin() then raise exception 'admin only'; end if;
  if p_delta = 0 then raise exception 'adjustment cannot be zero'; end if;

  insert into poker_transactions (user_id, amount, type, status, note, confirmed_by)
  values (
    p_user,
    abs(p_delta),
    case when p_delta > 0 then 'deposit' else 'withdrawal' end,
    'confirmed',
    coalesce(p_note, 'Manual adjustment'),
    auth.uid()
  );

  perform poker_recompute_balance(p_user);
end;
$$;

-- ── Stats (visible to everyone — profiles + leaderboard) ───────────────────────
-- SECURITY DEFINER so they can aggregate across all players WITHOUT exposing the
-- balance column. They return only non-sensitive fields.

create or replace function poker_player_stats(p_user uuid)
returns table (
  user_id uuid, username text, created_at timestamptz,
  games_played bigint, total_won bigint, total_lost bigint,
  net_result bigint, best_game integer, worst_game integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    u.id, u.username, u.created_at,
    count(gp.id) filter (where gp.net_result is not null),
    coalesce(sum(gp.net_result) filter (where gp.net_result > 0), 0),
    coalesce(-sum(gp.net_result) filter (where gp.net_result < 0), 0),
    coalesce(sum(gp.net_result), 0),
    max(gp.net_result),
    min(gp.net_result)
  from poker_users u
  left join poker_game_players gp on gp.user_id = u.id and gp.cashed_out_at is not null
  where u.id = p_user
  group by u.id, u.username, u.created_at;
$$;

create or replace function poker_leaderboard()
returns table (
  user_id uuid, username text,
  games_played bigint, total_won bigint, net_result bigint,
  biggest_win integer, biggest_loss integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    u.id, u.username,
    count(gp.id) filter (where gp.net_result is not null),
    coalesce(sum(gp.net_result) filter (where gp.net_result > 0), 0),
    coalesce(sum(gp.net_result), 0),
    coalesce(max(gp.net_result), 0),
    coalesce(min(gp.net_result), 0)
  from poker_users u
  left join poker_game_players gp on gp.user_id = u.id and gp.cashed_out_at is not null
  group by u.id, u.username;
$$;

-- A player's session history (date, buy-in, cash-out, net) for their profile.
create or replace function poker_player_history(p_user uuid)
returns table (
  session_id uuid, finished_at timestamptz, status text,
  total_buyin integer, cashout_value integer, net_result integer
)
language sql
stable
security definer
set search_path = public
as $$
  select gp.session_id, s.finished_at, s.status,
         gp.total_buyin, gp.cashout_value, gp.net_result
  from poker_game_players gp
  join poker_game_sessions s on s.id = gp.session_id
  where gp.user_id = p_user
  order by coalesce(s.finished_at, s.created_at) desc;
$$;

-- Directory of id -> username for ALL players. Lets clients label game players,
-- events and recaps without exposing the (RLS-protected) poker_users table.
create or replace function poker_usernames()
returns table (user_id uuid, username text)
language sql
stable
security definer
set search_path = public
as $$ select id, username from poker_users; $$;

-- Resolve a username -> auth email so players can log in by username.
-- Granted to anon for the login screen. (Minor: lets someone probe whether a
-- username exists — acceptable for a closed friend group.)
create or replace function poker_email_for_username(p_username text)
returns text
language sql
stable
security definer
set search_path = public
as $$ select email from poker_users where lower(username) = lower(p_username) limit 1; $$;

-- ── Grants ─────────────────────────────────────────────────────────────────────
grant execute on function poker_email_for_username(text) to anon, authenticated;
grant execute on function poker_request_topup(integer)               to authenticated;
grant execute on function poker_cancel_topup(uuid)                   to authenticated;
grant execute on function poker_create_session(integer,integer,boolean) to authenticated;
grant execute on function poker_start_session(uuid)                  to authenticated;
grant execute on function poker_join_session(uuid,integer)           to authenticated;
grant execute on function poker_rebuy(uuid,integer)                  to authenticated;
grant execute on function poker_cashout(uuid,integer,text)           to authenticated;
grant execute on function poker_delete_session(uuid)                 to authenticated;
grant execute on function poker_set_transaction_status(uuid,text)    to authenticated;
grant execute on function poker_admin_adjust_balance(uuid,integer,text) to authenticated;
grant execute on function poker_player_stats(uuid)                   to authenticated;
grant execute on function poker_leaderboard()                        to authenticated;
grant execute on function poker_player_history(uuid)                 to authenticated;
grant execute on function poker_usernames()                          to authenticated;
grant execute on function poker_is_admin()                           to authenticated;
grant execute on function poker_balance_of(uuid)                     to authenticated;

-- ── Realtime ───────────────────────────────────────────────────────────────────
-- Add the live tables to the supabase_realtime publication. Wrapped so re-runs
-- don't error if a table is already a member.
do $$
begin
  begin alter publication supabase_realtime add table poker_game_sessions; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table poker_game_players;  exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table poker_game_events;   exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table poker_transactions;  exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table poker_users;         exception when duplicate_object then null; end;
end $$;

-- =============================================================================
-- Storage bucket for chip-stack photos (run once; safe to re-run).
-- =============================================================================
insert into storage.buckets (id, name, public)
values ('poker-chips', 'poker-chips', true)
on conflict (id) do nothing;

-- Any authenticated user may upload a chip photo; anyone can read (public bucket
-- for easy <img> display). Tighten later if needed.
drop policy if exists poker_chips_insert on storage.objects;
create policy poker_chips_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'poker-chips');

drop policy if exists poker_chips_select on storage.objects;
create policy poker_chips_select on storage.objects
  for select using (bucket_id = 'poker-chips');
