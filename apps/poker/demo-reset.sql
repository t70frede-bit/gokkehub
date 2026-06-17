-- =============================================================================
-- DEMO RESET — wipes "Demo Night" and rebuilds it for the current schema
-- (migrations 001–011). Sets YOUR account (Gokkefar) as host + group admin if
-- it exists, else falls back to HouseDemo. Re-runnable.
--
-- Result: a live BOUNTY (tournament) table — fixed 200 buy-in + 50 bounty,
-- payout to balance — with Alice/Bob/Charlie already seated (pool 150).
-- You (Gokkefar) are host/admin with 1000 kr; join the table to play.
-- Demo logins: <name>@demo.local / demo123
-- =============================================================================
create extension if not exists pgcrypto with schema extensions;

-- ── WIPE (order matters: clear active_group refs → group → demo accounts) ─────
update poker_users set active_group_id = null where active_group_id = 'a0000000-0000-0000-0000-0000000000d1';
delete from poker_groups where id = 'a0000000-0000-0000-0000-0000000000d1';
delete from auth.users where id in (
  'a0000000-0000-0000-0000-0000000000a1','a0000000-0000-0000-0000-0000000000a2',
  'a0000000-0000-0000-0000-0000000000a3','a0000000-0000-0000-0000-0000000000a4');

-- ── RESEED ────────────────────────────────────────────────────────────────────
do $$
declare
  g     uuid := 'a0000000-0000-0000-0000-0000000000d1';
  ses   uuid := 'a0000000-0000-0000-0000-0000000000d2';
  house uuid := 'a0000000-0000-0000-0000-0000000000a1';
  pids  uuid[] := array['a0000000-0000-0000-0000-0000000000a2',
                        'a0000000-0000-0000-0000-0000000000a3',
                        'a0000000-0000-0000-0000-0000000000a4'];
  pnames text[] := array['Alice','Bob','Charlie'];
  allids uuid[] := array['a0000000-0000-0000-0000-0000000000a1',
                         'a0000000-0000-0000-0000-0000000000a2',
                         'a0000000-0000-0000-0000-0000000000a3',
                         'a0000000-0000-0000-0000-0000000000a4'];
  allnames text[] := array['HouseDemo','Alice','Bob','Charlie'];
  gokke uuid; host uuid; i int; u uuid;
  buyin int := 200; bounty int := 50;
begin
  -- demo auth users + profiles
  for i in 1..4 loop
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change_token_new, email_change)
    values ('00000000-0000-0000-0000-000000000000', allids[i], 'authenticated', 'authenticated',
      lower(allnames[i]) || '@demo.local', crypt('demo123', gen_salt('bf')),
      now(), now(), now(), '{"provider":"email","providers":["email"]}',
      jsonb_build_object('username', allnames[i]), '', '', '', '')
    on conflict (id) do nothing;
    insert into poker_users (id, username, email, role)
    values (allids[i], allnames[i], lower(allnames[i]) || '@demo.local', 'player')
    on conflict (id) do nothing;
  end loop;

  select id into gokke from poker_users where lower(username) = 'gokkefar' limit 1;
  host := coalesce(gokke, house);
  if gokke is null then
    raise notice 'Gokkefar not found — using HouseDemo as host. Log in once as Gokkefar, then re-run this.';
  end if;

  -- group (created by host)
  insert into poker_groups (id, name, slug, payment_type, payment_value, passcode,
    join_invite, join_request, join_passcode, created_by)
  values (g, 'Demo Night', 'demo night', 'mobilepay_box',
    'https://qr.mobilepay.dk/box/063cb2bd-0e5d-4d3b-8539-b2f389efc3ad/pay-in',
    'demo', true, true, true, host);

  -- host = admin with 1000 kr (not seated; join via the app to play)
  insert into poker_group_members (group_id, user_id, role, balance, status)
  values (g, host, 'admin', 1000, 'active')
  on conflict (group_id, user_id) do update set role = 'admin', balance = 1000, status = 'active';
  insert into poker_transactions (user_id, group_id, amount, type, status, note)
  values (host, g, 1000, 'deposit', 'confirmed', 'Demo top-up');
  update poker_users set active_group_id = g where id = host;

  -- live bounty (tournament) session, fixed 200 buy-in + 50 bounty, payout=balance
  insert into poker_game_sessions (id, host_id, group_id, status, min_buyin, max_buyin,
    rebuys_enabled, mode, bounty_enabled, bounty_buyin, bounty_pool, bounty_payout)
  values (ses, host, g, 'active', buyin, buyin, false, 'tournament', true, bounty, 0, 'balance');

  -- seat Alice/Bob/Charlie (deposit 1000, buy in 200, pay 50 bounty → balance 750)
  for i in 1..3 loop
    u := pids[i];
    insert into poker_group_members (group_id, user_id, role, balance, status)
    values (g, u, 'player', 750, 'active') on conflict (group_id, user_id) do nothing;
    update poker_users set active_group_id = g where id = u;
    insert into poker_transactions (user_id, group_id, amount, type, status, note)
      values (u, g, 1000, 'deposit', 'confirmed', 'Demo top-up');
    insert into poker_transactions (user_id, group_id, amount, type, status, session_id, note)
      values (u, g, buyin, 'buy_in', 'confirmed', ses, 'Buy-in');
    insert into poker_transactions (user_id, group_id, amount, type, status, session_id, note)
      values (u, g, bounty, 'withdrawal', 'confirmed', ses, 'Bounty buy-in');
    insert into poker_game_players (session_id, group_id, user_id, total_buyin)
      values (ses, g, u, buyin) on conflict (session_id, user_id) do nothing;
    insert into poker_game_events (session_id, group_id, type, user_id, amount)
      values (ses, g, 'player_joined', u, buyin);
    insert into poker_bounty_entries (session_id, user_id, amount)
      values (ses, u, bounty) on conflict (session_id, user_id) do nothing;
    update poker_game_sessions set bounty_pool = bounty_pool + bounty where id = ses;
  end loop;
end $$;
