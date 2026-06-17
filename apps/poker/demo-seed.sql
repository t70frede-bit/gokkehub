-- =============================================================================
-- DEMO SEED — a ready-to-play "Demo Night" group with 3 seated demo players and
-- a live, bounty-enabled table. Run AFTER migrations 001–009.
-- Idempotent-ish (fixed IDs + ON CONFLICT). Remove it all with demo-teardown.sql.
--
-- Demo logins (if you want to act as them): <name>@demo.local / demo123
-- Your account "Gokkefar" is auto-added with 500 kr IF it already exists
-- (i.e. you've logged in once as Gokkefar). Then switch to "Demo Night".
-- =============================================================================
create extension if not exists pgcrypto with schema extensions;

-- ── Fixed IDs ────────────────────────────────────────────────────────────────
--   group   a0000000-0000-0000-0000-0000000000g1  (g→ uses 'd' below; hex only)
-- group:   a0000000-0000-0000-0000-0000000000d1
-- session: a0000000-0000-0000-0000-0000000000d2
-- users:   ...00a1 House, ...00a2 Alice, ...00a3 Bob, ...00a4 Charlie

-- ── Demo auth users + profiles ───────────────────────────────────────────────
do $$
declare
  ids uuid[] := array[
    'a0000000-0000-0000-0000-0000000000a1','a0000000-0000-0000-0000-0000000000a2',
    'a0000000-0000-0000-0000-0000000000a3','a0000000-0000-0000-0000-0000000000a4'];
  names text[] := array['HouseDemo','Alice','Bob','Charlie'];
  i int;
begin
  for i in 1..4 loop
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change_token_new, email_change)
    values ('00000000-0000-0000-0000-000000000000', ids[i], 'authenticated', 'authenticated',
      lower(names[i]) || '@demo.local', crypt('demo123', gen_salt('bf')),
      now(), now(), now(), '{"provider":"email","providers":["email"]}',
      jsonb_build_object('username', names[i]), '', '', '', '')
    on conflict (id) do nothing;

    insert into poker_users (id, username, email, role)
    values (ids[i], names[i], lower(names[i]) || '@demo.local', 'player')
    on conflict (id) do nothing;
  end loop;
end $$;

-- ── Group + memberships ──────────────────────────────────────────────────────
insert into poker_groups (id, name, slug, payment_type, payment_value, passcode,
  join_invite, join_request, join_passcode, created_by)
values ('a0000000-0000-0000-0000-0000000000d1', 'Demo Night', 'demo night',
  'mobilepay_box', 'https://qr.mobilepay.dk/box/063cb2bd-0e5d-4d3b-8539-b2f389efc3ad/pay-in',
  'demo', true, true, true, 'a0000000-0000-0000-0000-0000000000a1')
on conflict (id) do nothing;

insert into poker_group_members (group_id, user_id, role, balance, status) values
  ('a0000000-0000-0000-0000-0000000000d1','a0000000-0000-0000-0000-0000000000a1','admin', 0,  'active'),
  ('a0000000-0000-0000-0000-0000000000d1','a0000000-0000-0000-0000-0000000000a2','player',750,'active'),
  ('a0000000-0000-0000-0000-0000000000d1','a0000000-0000-0000-0000-0000000000a3','player',750,'active'),
  ('a0000000-0000-0000-0000-0000000000d1','a0000000-0000-0000-0000-0000000000a4','player',750,'active')
on conflict (group_id, user_id) do nothing;

update poker_users set active_group_id = 'a0000000-0000-0000-0000-0000000000d1'
  where id in ('a0000000-0000-0000-0000-0000000000a1','a0000000-0000-0000-0000-0000000000a2',
               'a0000000-0000-0000-0000-0000000000a3','a0000000-0000-0000-0000-0000000000a4');

-- ── Live BOUNTY (tournament) session hosted by HouseDemo: fixed 200 buy-in ───
insert into poker_game_sessions (id, host_id, group_id, status, min_buyin, max_buyin,
  rebuys_enabled, mode, bounty_enabled, bounty_buyin, bounty_pool)
values ('a0000000-0000-0000-0000-0000000000d2','a0000000-0000-0000-0000-0000000000a1',
  'a0000000-0000-0000-0000-0000000000d1','active', 200, 200, true, 'tournament', true, 50, 150)
on conflict (id) do nothing;

-- Alice/Bob/Charlie: deposit 1000, buy in 200, pay 50 bounty → balance 750.
do $$
declare
  ids uuid[] := array['a0000000-0000-0000-0000-0000000000a2',
    'a0000000-0000-0000-0000-0000000000a3','a0000000-0000-0000-0000-0000000000a4'];
  g uuid := 'a0000000-0000-0000-0000-0000000000d1';
  ses uuid := 'a0000000-0000-0000-0000-0000000000d2';
  u uuid;
begin
  foreach u in array ids loop
    insert into poker_transactions (user_id, group_id, amount, type, status, note)
      values (u, g, 1000, 'deposit', 'confirmed', 'Demo top-up');
    insert into poker_transactions (user_id, group_id, amount, type, status, session_id, note)
      values (u, g, 200, 'buy_in', 'confirmed', ses, 'Buy-in');
    insert into poker_transactions (user_id, group_id, amount, type, status, session_id, note)
      values (u, g, 50, 'withdrawal', 'confirmed', ses, 'Bounty buy-in');
    insert into poker_game_players (session_id, group_id, user_id, total_buyin)
      values (ses, g, u, 200) on conflict (session_id, user_id) do nothing;
    insert into poker_game_events (session_id, group_id, type, user_id, amount)
      values (ses, g, 'player_joined', u, 200);
    insert into poker_bounty_entries (session_id, user_id, amount)
      values (ses, u, 50) on conflict (session_id, user_id) do nothing;
  end loop;
end $$;

-- ── Add YOUR account (Gokkefar) with 500 kr, if it exists ────────────────────
do $$
declare gokke uuid; g uuid := 'a0000000-0000-0000-0000-0000000000d1';
begin
  select id into gokke from poker_users where lower(username) = 'gokkefar' limit 1;
  if gokke is not null then
    insert into poker_group_members (group_id, user_id, role, balance, status)
      values (g, gokke, 'player', 500, 'active') on conflict (group_id, user_id) do nothing;
    insert into poker_transactions (user_id, group_id, amount, type, status, note)
      values (gokke, g, 500, 'deposit', 'confirmed', 'Demo top-up');
  end if;
end $$;
