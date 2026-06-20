-- =============================================================================
-- GokkeHub Poker — migration 017: security hardening (pre-launch)
-- Run after 001–016. Safe/idempotent. Defence-in-depth — your current setup is
-- already protected by RLS; this removes the single-point-of-failure and closes
-- two function-level gaps.
--
--   1) Least privilege: revoke direct write access to poker_* tables from anon &
--      authenticated. All writes must go through the SECURITY DEFINER RPCs
--      (which run as the table owner, so they're unaffected). anon loses all
--      access to poker data (it's all behind login anyway).
--   2) Group passcodes become write-only (admins set them; nobody can read them).
--   3) Stats RPCs now verify the caller is a member of the group they query.
-- =============================================================================

-- 1) ── Least privilege on poker_* tables ─────────────────────────────────────
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' and tablename like 'poker_%' loop
    -- writers go through RPCs only
    execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from authenticated', t);
    -- anon never reads or writes poker data
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;
-- (authenticated keeps SELECT, still gated by the RLS SELECT policies.)

-- 2) ── Passcodes are write-only ──────────────────────────────────────────────
revoke select (passcode) on public.poker_groups from authenticated;

-- Keep the existing passcode when an admin saves without re-entering it.
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
    passcode = case when nullif(p_passcode,'') is null then passcode else p_passcode end
  where id = p_group;
end; $$;

-- 3) ── Stats RPCs: only members of the group get its data ─────────────────────
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
  left join poker_game_players gp on gp.user_id = u.id and gp.group_id = p_group and gp.cashed_out_at is not null
  where u.id = p_user and poker_is_member(p_group)
  group by u.id, u.username, u.created_at;
$$;

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
  left join poker_game_players gp on gp.user_id = u.id and gp.group_id = p_group and gp.cashed_out_at is not null
  where m.group_id = p_group and m.status = 'active' and poker_is_member(p_group)
  group by u.id, u.username;
$$;

create or replace function poker_player_history(p_user uuid, p_group uuid)
returns table (session_id uuid, finished_at timestamptz, status text,
  total_buyin integer, cashout_value integer, net_result integer)
language sql stable security definer set search_path = public as $$
  select gp.session_id, s.finished_at, s.status, gp.total_buyin, gp.cashout_value, gp.net_result
  from poker_game_players gp
  join poker_game_sessions s on s.id = gp.session_id
  where gp.user_id = p_user and gp.group_id = p_group and poker_is_member(p_group)
  order by coalesce(s.finished_at, s.created_at) desc;
$$;

create or replace function poker_usernames(p_group uuid)
returns table (user_id uuid, username text)
language sql stable security definer set search_path = public as $$
  select u.id, u.username from poker_users u
  join poker_group_members m on m.user_id = u.id
  where m.group_id = p_group and poker_is_member(p_group);
$$;
