-- =============================================================================
-- GokkeHub Poker — migration 005: multi-group / public version
-- Run after 001–004. NON-BACKWARD-COMPATIBLE: deploy the matching app build at
-- the same time (the old build reads poker_users.balance, which now lives on the
-- membership). Idempotent-ish (guards on existence) but intended to run once.
--
-- What changes:
--  * New poker_groups + poker_group_members. Balance + role + the "house"/admin
--    concept move to the MEMBERSHIP, so money/ledger/sessions are isolated per
--    group. Each group has its own MobilePay box.
--  * group_id added to sessions / transactions / game_players / game_events.
--  * Existing live data is migrated into a default group "Gokkes" (goksi0501 as
--    admin, current box) so nothing is lost.
--  * Every money/game RPC is rewritten to be group-scoped; new group RPCs added.
--  * The one-time site code is retired in the app; access = group membership.
-- =============================================================================

-- ── New tables ─────────────────────────────────────────────────────────────────
create table if not exists poker_groups (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  slug          text not null unique,                 -- lower(name), for name+passcode join
  payment_type  text not null default 'mobilepay_box',-- mobilepay_box|swish|paypal|revolut|vipps|other
  payment_value text,                                 -- box URL / phone / handle / link / instructions
  passcode      text,                                 -- for name+passcode join
  invite_token  text not null unique default encode(gen_random_bytes(9), 'hex'),
  join_invite   boolean not null default true,        -- join via invite link
  join_request  boolean not null default true,        -- join via request + admin approval
  join_passcode boolean not null default false,       -- join via group name + passcode
  created_by    uuid not null references poker_users(id),
  created_at    timestamptz not null default now()
);

create table if not exists poker_group_members (
  id        uuid primary key default gen_random_uuid(),
  group_id  uuid not null references poker_groups(id) on delete cascade,
  user_id   uuid not null references poker_users(id) on delete cascade,
  role      text not null default 'player' check (role in ('player', 'admin')),
  balance   integer not null default 0 check (balance >= 0),
  status    text not null default 'active' check (status in ('active', 'pending', 'rejected')),
  joined_at timestamptz not null default now(),
  unique (group_id, user_id)
);

create index if not exists poker_gm_user_idx  on poker_group_members (user_id);
create index if not exists poker_gm_group_idx on poker_group_members (group_id, status);

-- Which group the user is currently acting in.
alter table poker_users add column if not exists active_group_id uuid references poker_groups(id);

-- Scope the existing tables to a group.
alter table poker_game_sessions add column if not exists group_id uuid references poker_groups(id) on delete cascade;
alter table poker_transactions  add column if not exists group_id uuid references poker_groups(id) on delete cascade;
alter table poker_game_players  add column if not exists group_id uuid references poker_groups(id) on delete cascade;
alter table poker_game_events   add column if not exists group_id uuid references poker_groups(id) on delete cascade;

create index if not exists poker_tx_group_idx  on poker_transactions (group_id, status, created_at desc);
create index if not exists poker_gs_group_idx  on poker_game_sessions (group_id, status);

-- ── Migrate existing single-tenant data into a default group ────────────────────
do $$
declare g uuid; admin_id uuid;
begin
  if not exists (select 1 from poker_groups) and exists (select 1 from poker_users) then
    select id into admin_id from poker_users where role = 'admin' order by created_at limit 1;
    if admin_id is null then select id into admin_id from poker_users order by created_at limit 1; end if;

    insert into poker_groups (name, slug, payment_type, payment_value, join_invite, join_request, join_passcode, created_by)
    values ('Gokkes', 'gokkes', 'mobilepay_box',
            'https://qr.mobilepay.dk/box/063cb2bd-0e5d-4d3b-8539-b2f389efc3ad/pay-in',
            true, true, false, admin_id)
    returning id into g;

    insert into poker_group_members (group_id, user_id, role, balance, status)
    select g, id, role, balance, 'active' from poker_users;

    update poker_users          set active_group_id = g;
    update poker_game_sessions  set group_id = g where group_id is null;
    update poker_transactions   set group_id = g where group_id is null;
    update poker_game_players   set group_id = g where group_id is null;
    update poker_game_events    set group_id = g where group_id is null;
  end if;
end $$;

-- ── Helpers ─────────────────────────────────────────────────────────────────────
create or replace function poker_my_group()
returns uuid language sql stable security definer set search_path = public as $$
  select active_group_id from poker_users where id = auth.uid();
$$;

create or replace function poker_is_group_admin(p_group uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from poker_group_members
    where group_id = p_group and user_id = auth.uid() and role = 'admin' and status = 'active');
$$;

create or replace function poker_is_member(p_group uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from poker_group_members
    where group_id = p_group and user_id = auth.uid() and status = 'active');
$$;

-- ── RLS for the new tables ──────────────────────────────────────────────────────
alter table poker_groups        enable row level security;
alter table poker_group_members enable row level security;

drop policy if exists poker_groups_select on poker_groups;
create policy poker_groups_select on poker_groups
  for select using (poker_is_member(id) or created_by = auth.uid());

drop policy if exists poker_gm_select on poker_group_members;
create policy poker_gm_select on poker_group_members
  for select using (user_id = auth.uid() or poker_is_group_admin(group_id));

-- ── Re-scope existing SELECT policies to group membership ───────────────────────
drop policy if exists poker_tx_select on poker_transactions;
create policy poker_tx_select on poker_transactions
  for select using (user_id = auth.uid() or poker_is_group_admin(group_id));

drop policy if exists poker_sessions_select on poker_game_sessions;
create policy poker_sessions_select on poker_game_sessions
  for select using (poker_is_member(group_id));

drop policy if exists poker_players_select on poker_game_players;
create policy poker_players_select on poker_game_players
  for select using (poker_is_member(group_id));

drop policy if exists poker_events_select on poker_game_events;
create policy poker_events_select on poker_game_events
  for select using (poker_is_member(group_id));

-- ── Balance accounting (now per membership) ─────────────────────────────────────
drop function if exists poker_recompute_balance(uuid);
create or replace function poker_recompute_balance(p_user uuid, p_group uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update poker_group_members m
  set balance = coalesce((
    select sum(case t.type
      when 'deposit'    then  t.amount
      when 'cash_out'   then  t.amount
      when 'withdrawal' then -t.amount
      when 'buy_in'     then -t.amount
      when 'rebuy'      then -t.amount end)
    from poker_transactions t
    where t.user_id = p_user and t.group_id = p_group and t.status = 'confirmed'), 0)
  where m.user_id = p_user and m.group_id = p_group;
end; $$;

drop function if exists poker_balance_of(uuid);
create or replace function poker_balance_of(p_user uuid, p_group uuid)
returns integer language sql stable security definer set search_path = public as $$
  select balance from poker_group_members where user_id = p_user and group_id = p_group;
$$;

-- ── Group management RPCs ───────────────────────────────────────────────────────
create or replace function poker_create_group(
  p_name text, p_payment_type text, p_payment_value text,
  p_join_invite boolean, p_join_request boolean, p_join_passcode boolean, p_passcode text
)
returns poker_groups language plpgsql security definer set search_path = public as $$
declare g poker_groups; v_slug text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if length(btrim(coalesce(p_name,''))) < 2 then raise exception 'group name too short'; end if;
  v_slug := lower(btrim(p_name));
  if exists (select 1 from poker_groups where slug = v_slug) then raise exception 'a group with that name already exists'; end if;
  if p_join_passcode and length(coalesce(p_passcode,'')) < 3 then raise exception 'passcode too short'; end if;

  insert into poker_groups (name, slug, payment_type, payment_value, passcode, join_invite, join_request, join_passcode, created_by)
  values (btrim(p_name), v_slug, coalesce(nullif(p_payment_type,''),'mobilepay_box'),
          nullif(btrim(coalesce(p_payment_value,'')),''), nullif(p_passcode,''),
          coalesce(p_join_invite,true), coalesce(p_join_request,true), coalesce(p_join_passcode,false), auth.uid())
  returning * into g;

  insert into poker_group_members (group_id, user_id, role, status) values (g.id, auth.uid(), 'admin', 'active');
  update poker_users set active_group_id = g.id where id = auth.uid();
  return g;
end; $$;

create or replace function poker_update_group(
  p_group uuid, p_name text, p_payment_type text, p_payment_value text,
  p_join_invite boolean, p_join_request boolean, p_join_passcode boolean, p_passcode text
)
returns void language plpgsql security definer set search_path = public as $$
declare v_slug text;
begin
  if not poker_is_group_admin(p_group) then raise exception 'admin only'; end if;
  v_slug := lower(btrim(p_name));
  if exists (select 1 from poker_groups where slug = v_slug and id <> p_group) then raise exception 'name taken'; end if;
  update poker_groups set
    name = btrim(p_name), slug = v_slug,
    payment_type = coalesce(nullif(p_payment_type,''), payment_type),
    payment_value = nullif(btrim(coalesce(p_payment_value,'')),''),
    join_invite = coalesce(p_join_invite, join_invite),
    join_request = coalesce(p_join_request, join_request),
    join_passcode = coalesce(p_join_passcode, join_passcode),
    passcode = nullif(p_passcode,'')
  where id = p_group;
end; $$;

create or replace function poker_set_active_group(p_group uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not poker_is_member(p_group) then raise exception 'not a member of that group'; end if;
  update poker_users set active_group_id = p_group where id = auth.uid();
end; $$;

create or replace function poker_join_by_passcode(p_name text, p_passcode text)
returns uuid language plpgsql security definer set search_path = public as $$
declare g poker_groups;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into g from poker_groups where slug = lower(btrim(p_name));
  if g.id is null or not g.join_passcode then raise exception 'no such group, or passcode join is off'; end if;
  if g.passcode is null or g.passcode <> p_passcode then raise exception 'wrong passcode'; end if;
  insert into poker_group_members (group_id, user_id, role, status)
  values (g.id, auth.uid(), 'player', 'active')
  on conflict (group_id, user_id) do update set status = 'active';
  update poker_users set active_group_id = g.id where id = auth.uid();
  return g.id;
end; $$;

create or replace function poker_join_by_invite(p_token text)
returns uuid language plpgsql security definer set search_path = public as $$
declare g poker_groups;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into g from poker_groups where invite_token = p_token;
  if g.id is null or not g.join_invite then raise exception 'invalid or disabled invite'; end if;
  insert into poker_group_members (group_id, user_id, role, status)
  values (g.id, auth.uid(), 'player', 'active')
  on conflict (group_id, user_id) do update set status = 'active';
  update poker_users set active_group_id = g.id where id = auth.uid();
  return g.id;
end; $$;

-- Request to join by group name (admin must approve). Returns the group id.
create or replace function poker_request_join(p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare g poker_groups;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into g from poker_groups where slug = lower(btrim(p_name));
  if g.id is null or not g.join_request then raise exception 'no such group, or requests are off'; end if;
  insert into poker_group_members (group_id, user_id, role, status)
  values (g.id, auth.uid(), 'player', 'pending')
  on conflict (group_id, user_id) do nothing;
  return g.id;
end; $$;

create or replace function poker_approve_member(p_member uuid)
returns void language plpgsql security definer set search_path = public as $$
declare m poker_group_members;
begin
  select * into m from poker_group_members where id = p_member;
  if m.id is null then raise exception 'not found'; end if;
  if not poker_is_group_admin(m.group_id) then raise exception 'admin only'; end if;
  update poker_group_members set status = 'active' where id = p_member;
end; $$;

create or replace function poker_reject_member(p_member uuid)
returns void language plpgsql security definer set search_path = public as $$
declare m poker_group_members;
begin
  select * into m from poker_group_members where id = p_member;
  if m.id is null then raise exception 'not found'; end if;
  if not poker_is_group_admin(m.group_id) then raise exception 'admin only'; end if;
  update poker_group_members set status = 'rejected' where id = p_member;
end; $$;

-- Replaces poker_set_role — now per group.
drop function if exists poker_set_role(uuid, text);
create or replace function poker_set_member_role(p_group uuid, p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not poker_is_group_admin(p_group) then raise exception 'admin only'; end if;
  if p_role not in ('player', 'admin') then raise exception 'invalid role'; end if;
  update poker_group_members set role = p_role where group_id = p_group and user_id = p_user;
end; $$;

-- A user's groups (memberships) for the switcher + active-group details.
create or replace function poker_my_groups()
returns table (group_id uuid, name text, role text, status text,
  is_active boolean, balance integer, payment_type text, payment_value text, invite_token text)
language sql stable security definer set search_path = public as $$
  select m.group_id, g.name, m.role, m.status, (u.active_group_id = m.group_id),
         m.balance, g.payment_type, g.payment_value, g.invite_token
  from poker_group_members m
  join poker_groups g on g.id = m.group_id
  join poker_users  u on u.id = m.user_id
  where m.user_id = auth.uid()
  order by g.name;
$$;

-- ── Re-scoped money / game RPCs ─────────────────────────────────────────────────
create or replace function poker_request_topup(p_amount integer)
returns poker_transactions language plpgsql security definer set search_path = public as $$
declare tx poker_transactions; g uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  g := poker_my_group();
  if g is null or not poker_is_member(g) then raise exception 'join or select a group first'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'amount must be positive'; end if;
  insert into poker_transactions (user_id, group_id, amount, type, status, tracking_code)
  values (auth.uid(), g, p_amount, 'deposit', 'pending', poker_gen_tracking_code())
  returning * into tx;
  return tx;
end; $$;

create or replace function poker_create_session(p_min integer, p_max integer, p_rebuys boolean)
returns poker_game_sessions language plpgsql security definer set search_path = public as $$
declare s poker_game_sessions; g uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  g := poker_my_group();
  if g is null or not poker_is_member(g) then raise exception 'join or select a group first'; end if;
  if p_min < 0 or p_max < p_min then raise exception 'invalid buy-in range'; end if;
  insert into poker_game_sessions (host_id, group_id, status, min_buyin, max_buyin, rebuys_enabled)
  values (auth.uid(), g, 'lobby', p_min, p_max, coalesce(p_rebuys, true))
  returning * into s;
  return s;
end; $$;

create or replace function poker_join_session(p_session uuid, p_buyin integer)
returns void language plpgsql security definer set search_path = public as $$
declare s poker_game_sessions; bal integer;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into s from poker_game_sessions where id = p_session for update;
  if s is null then raise exception 'session not found'; end if;
  if not poker_is_member(s.group_id) then raise exception 'not a member of this group'; end if;
  if s.status not in ('lobby','active') then raise exception 'session is not open'; end if;
  if exists (select 1 from poker_game_players where session_id = p_session and user_id = auth.uid())
    then raise exception 'already joined'; end if;
  if p_buyin < s.min_buyin or p_buyin > s.max_buyin
    then raise exception 'buy-in must be between % and %', s.min_buyin, s.max_buyin; end if;
  bal := poker_balance_of(auth.uid(), s.group_id);
  if bal < p_buyin then raise exception 'insufficient balance'; end if;

  insert into poker_game_players (session_id, group_id, user_id, total_buyin)
  values (p_session, s.group_id, auth.uid(), p_buyin);
  insert into poker_transactions (user_id, group_id, amount, type, status, session_id, note)
  values (auth.uid(), s.group_id, p_buyin, 'buy_in', 'confirmed', p_session, 'Buy-in');
  perform poker_recompute_balance(auth.uid(), s.group_id);
  insert into poker_game_events (session_id, group_id, type, user_id, amount)
  values (p_session, s.group_id, 'player_joined', auth.uid(), p_buyin);
end; $$;

create or replace function poker_rebuy(p_session uuid, p_amount integer)
returns void language plpgsql security definer set search_path = public as $$
declare s poker_game_sessions; gp poker_game_players; bal integer;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into s from poker_game_sessions where id = p_session for update;
  if s is null then raise exception 'session not found'; end if;
  if s.status <> 'active' then raise exception 'session is not active'; end if;
  if not s.rebuys_enabled then raise exception 'rebuys are disabled'; end if;
  if p_amount <= 0 then raise exception 'amount must be positive'; end if;
  select * into gp from poker_game_players where session_id = p_session and user_id = auth.uid();
  if gp is null then raise exception 'you are not in this session'; end if;
  if gp.cashed_out_at is not null then raise exception 'you have cashed out'; end if;
  bal := poker_balance_of(auth.uid(), s.group_id);
  if bal < p_amount then raise exception 'insufficient balance'; end if;

  update poker_game_players set total_buyin = total_buyin + p_amount
    where session_id = p_session and user_id = auth.uid();
  insert into poker_transactions (user_id, group_id, amount, type, status, session_id, note)
  values (auth.uid(), s.group_id, p_amount, 'rebuy', 'confirmed', p_session, 'Rebuy');
  perform poker_recompute_balance(auth.uid(), s.group_id);
  insert into poker_game_events (session_id, group_id, type, user_id, amount)
  values (p_session, s.group_id, 'rebuy', auth.uid(), p_amount);
end; $$;

create or replace function poker_cashout(p_session uuid, p_cashout integer, p_photo_url text)
returns void language plpgsql security definer set search_path = public as $$
declare s poker_game_sessions; gp poker_game_players; remaining integer;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into s from poker_game_sessions where id = p_session for update;
  if s is null then raise exception 'session not found'; end if;
  if s.status <> 'active' then raise exception 'session is not active'; end if;
  if p_cashout is null or p_cashout < 0 then raise exception 'cash-out cannot be negative'; end if;
  select * into gp from poker_game_players where session_id = p_session and user_id = auth.uid();
  if gp is null then raise exception 'you are not in this session'; end if;
  if gp.cashed_out_at is not null then raise exception 'already cashed out'; end if;

  update poker_game_players
  set cashout_value = p_cashout, net_result = p_cashout - total_buyin,
      chip_stack_photo_url = p_photo_url, cashed_out_at = now()
  where session_id = p_session and user_id = auth.uid();

  if p_cashout > 0 then
    insert into poker_transactions (user_id, group_id, amount, type, status, session_id, note)
    values (auth.uid(), s.group_id, p_cashout, 'cash_out', 'confirmed', p_session, 'Cash-out');
  end if;
  perform poker_recompute_balance(auth.uid(), s.group_id);
  insert into poker_game_events (session_id, group_id, type, user_id, amount)
  values (p_session, s.group_id, 'cashout', auth.uid(), p_cashout);

  select count(*) into remaining from poker_game_players where session_id = p_session and cashed_out_at is null;
  if remaining = 0 then
    update poker_game_sessions set status = 'finished', finished_at = now() where id = p_session;
    insert into poker_game_events (session_id, group_id, type) values (p_session, s.group_id, 'session_ended');
  end if;
end; $$;

-- delete empty lobby — now group-admin OR host
create or replace function poker_delete_session(p_session uuid)
returns void language plpgsql security definer set search_path = public as $$
declare s poker_game_sessions;
begin
  select * into s from poker_game_sessions where id = p_session;
  if s is null then raise exception 'session not found'; end if;
  if s.host_id <> auth.uid() and not poker_is_group_admin(s.group_id) then raise exception 'not allowed'; end if;
  if s.status <> 'lobby' then raise exception 'only lobby sessions can be deleted'; end if;
  if exists (select 1 from poker_game_players where session_id = p_session) then raise exception 'has players'; end if;
  delete from poker_game_sessions where id = p_session;
end; $$;

-- admin tx + balance ops, now group-scoped
create or replace function poker_set_transaction_status(p_tx uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare tx poker_transactions;
begin
  if p_status not in ('pending','confirmed','rejected','cancelled') then raise exception 'invalid status'; end if;
  select * into tx from poker_transactions where id = p_tx;
  if tx is null then raise exception 'transaction not found'; end if;
  if not poker_is_group_admin(tx.group_id) then raise exception 'admin only'; end if;
  update poker_transactions set status = p_status,
    confirmed_by = case when p_status = 'confirmed' then auth.uid() else confirmed_by end
  where id = p_tx;
  perform poker_recompute_balance(tx.user_id, tx.group_id);
end; $$;

drop function if exists poker_admin_adjust_balance(uuid, integer, text);
create or replace function poker_admin_adjust_balance(p_group uuid, p_user uuid, p_delta integer, p_note text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not poker_is_group_admin(p_group) then raise exception 'admin only'; end if;
  if p_delta = 0 then raise exception 'adjustment cannot be zero'; end if;
  insert into poker_transactions (user_id, group_id, amount, type, status, note, confirmed_by)
  values (p_user, p_group, abs(p_delta),
          case when p_delta > 0 then 'deposit' else 'withdrawal' end,
          'confirmed', coalesce(p_note,'Manual adjustment'), auth.uid());
  perform poker_recompute_balance(p_user, p_group);
end; $$;

-- ── Group-scoped stats ──────────────────────────────────────────────────────────
drop function if exists poker_player_stats(uuid);
create or replace function poker_player_stats(p_user uuid, p_group uuid)
returns table (user_id uuid, username text, created_at timestamptz,
  games_played bigint, total_won bigint, total_lost bigint,
  net_result bigint, best_game integer, worst_game integer)
language sql stable security definer set search_path = public as $$
  select u.id, u.username, u.created_at,
    count(gp.id) filter (where gp.net_result is not null),
    coalesce(sum(gp.net_result) filter (where gp.net_result > 0), 0),
    coalesce(-sum(gp.net_result) filter (where gp.net_result < 0), 0),
    coalesce(sum(gp.net_result), 0),
    max(gp.net_result), min(gp.net_result)
  from poker_users u
  left join poker_game_players gp
    on gp.user_id = u.id and gp.group_id = p_group and gp.cashed_out_at is not null
  where u.id = p_user
  group by u.id, u.username, u.created_at;
$$;

drop function if exists poker_leaderboard();
create or replace function poker_leaderboard(p_group uuid)
returns table (user_id uuid, username text,
  games_played bigint, total_won bigint, net_result bigint,
  biggest_win integer, biggest_loss integer)
language sql stable security definer set search_path = public as $$
  select u.id, u.username,
    count(gp.id) filter (where gp.net_result is not null),
    coalesce(sum(gp.net_result) filter (where gp.net_result > 0), 0),
    coalesce(sum(gp.net_result), 0),
    coalesce(max(gp.net_result), 0), coalesce(min(gp.net_result), 0)
  from poker_group_members m
  join poker_users u on u.id = m.user_id
  left join poker_game_players gp
    on gp.user_id = u.id and gp.group_id = p_group and gp.cashed_out_at is not null
  where m.group_id = p_group and m.status = 'active'
  group by u.id, u.username;
$$;

drop function if exists poker_player_history(uuid);
create or replace function poker_player_history(p_user uuid, p_group uuid)
returns table (session_id uuid, finished_at timestamptz, status text,
  total_buyin integer, cashout_value integer, net_result integer)
language sql stable security definer set search_path = public as $$
  select gp.session_id, s.finished_at, s.status, gp.total_buyin, gp.cashout_value, gp.net_result
  from poker_game_players gp
  join poker_game_sessions s on s.id = gp.session_id
  where gp.user_id = p_user and gp.group_id = p_group
  order by coalesce(s.finished_at, s.created_at) desc;
$$;

-- usernames directory limited to the group (for labelling)
create or replace function poker_usernames(p_group uuid)
returns table (user_id uuid, username text)
language sql stable security definer set search_path = public as $$
  select u.id, u.username from poker_users u
  join poker_group_members m on m.user_id = u.id
  where m.group_id = p_group;
$$;

-- group members for the admin panel
create or replace function poker_group_member_list(p_group uuid)
returns table (member_id uuid, user_id uuid, username text, role text, status text, balance integer)
language sql stable security definer set search_path = public as $$
  select m.id, u.id, u.username, m.role, m.status, m.balance
  from poker_group_members m
  join poker_users u on u.id = m.user_id
  where m.group_id = p_group and poker_is_member(p_group)
  order by m.status, u.username;
$$;

-- ── Grants ──────────────────────────────────────────────────────────────────────
grant execute on function poker_my_group()                                   to authenticated;
grant execute on function poker_is_group_admin(uuid)                         to authenticated;
grant execute on function poker_is_member(uuid)                              to authenticated;
grant execute on function poker_balance_of(uuid, uuid)                       to authenticated;
grant execute on function poker_create_group(text,text,text,boolean,boolean,boolean,text) to authenticated;
grant execute on function poker_update_group(uuid,text,text,text,boolean,boolean,boolean,text) to authenticated;
grant execute on function poker_set_active_group(uuid)                       to authenticated;
grant execute on function poker_join_by_passcode(text,text)                  to authenticated;
grant execute on function poker_join_by_invite(text)                         to authenticated;
grant execute on function poker_request_join(text)                           to authenticated;
grant execute on function poker_approve_member(uuid)                         to authenticated;
grant execute on function poker_reject_member(uuid)                          to authenticated;
grant execute on function poker_set_member_role(uuid,uuid,text)              to authenticated;
grant execute on function poker_my_groups()                                  to authenticated;
grant execute on function poker_player_stats(uuid,uuid)                      to authenticated;
grant execute on function poker_leaderboard(uuid)                            to authenticated;
grant execute on function poker_player_history(uuid,uuid)                    to authenticated;
grant execute on function poker_usernames(uuid)                              to authenticated;
grant execute on function poker_group_member_list(uuid)                      to authenticated;
grant execute on function poker_admin_adjust_balance(uuid,uuid,integer,text) to authenticated;

-- ── Realtime ────────────────────────────────────────────────────────────────────
do $$
begin
  begin alter publication supabase_realtime add table poker_group_members; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table poker_groups;        exception when duplicate_object then null; end;
end $$;
