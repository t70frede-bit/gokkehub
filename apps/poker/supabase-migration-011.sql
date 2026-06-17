-- =============================================================================
-- GokkeHub Poker — migration 011: bounty payout destination (balance vs stack)
-- Run after 001–010.
--
-- New per-session setting `bounty_payout`:
--   'balance' — a won bounty is credited to spendable balance (default).
--   'stack'   — winnings go back into play: credited (+) then re-bought into the
--               table (−), so total_buyin grows and the chips ride the session.
--               Keeps pot-in/pot-out balanced and conserves money.
-- =============================================================================

alter table poker_game_sessions add column if not exists bounty_payout text not null default 'balance'
  check (bounty_payout in ('balance', 'stack'));

drop function if exists poker_create_session(text, integer, integer, boolean, integer);
create or replace function poker_create_session(
  p_mode text, p_min integer, p_max integer, p_rebuys boolean,
  p_bounty_buyin integer, p_bounty_payout text
)
returns poker_game_sessions language plpgsql security definer set search_path = public as $$
declare s poker_game_sessions; g uuid; v_mode text := coalesce(nullif(p_mode,''), 'cash');
  v_payout text := coalesce(nullif(p_bounty_payout,''), 'balance');
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  g := poker_my_group();
  if g is null or not poker_is_member(g) then raise exception 'join or select a group first'; end if;
  if v_payout not in ('balance','stack') then v_payout := 'balance'; end if;

  if v_mode = 'tournament' then
    if p_min <= 0 then raise exception 'set a buy-in'; end if;
    if p_bounty_buyin is null or p_bounty_buyin <= 0 then raise exception 'a bounty game needs a bounty buy-in'; end if;
    insert into poker_game_sessions (host_id, group_id, status, min_buyin, max_buyin, rebuys_enabled,
      mode, bounty_enabled, bounty_buyin, bounty_pool, bounty_payout)
    values (auth.uid(), g, 'active', p_min, p_min, false,
      'tournament', true, p_bounty_buyin, 0, v_payout)
    returning * into s;
  else
    if p_min < 0 or p_max < p_min then raise exception 'invalid buy-in range'; end if;
    insert into poker_game_sessions (host_id, group_id, status, min_buyin, max_buyin, rebuys_enabled,
      mode, bounty_enabled, bounty_buyin, bounty_pool, bounty_payout)
    values (auth.uid(), g, 'active', p_min, p_max, coalesce(p_rebuys, true),
      'cash', false, 0, 0, 'balance')
    returning * into s;
  end if;
  return s;
end; $$;

-- Knockout draw honours the session's payout destination.
create or replace function poker_record_knockout(p_session uuid, p_eliminated uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare s poker_game_sessions; r double precision; amt integer; pool integer; seated boolean;
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

  r := random();
  if    r < 0.65 then amt := s.bounty_buyin;
  elsif r < 0.90 then amt := s.bounty_buyin * 2;
  else  amt := ceil(pool * (0.5 + random() * 0.5));
  end if;
  amt := greatest(1, least(amt, pool));

  select exists (select 1 from poker_game_players
    where session_id = p_session and user_id = auth.uid() and cashed_out_at is null) into seated;

  -- Credit the win (deposit). If payout = stack and the winner is still seated,
  -- also re-buy it into the table (buy_in) so it becomes chips in play.
  insert into poker_transactions (user_id, group_id, amount, type, status, session_id, note)
  values (auth.uid(), s.group_id, amt, 'deposit', 'confirmed', p_session, 'Bounty win');

  if s.bounty_payout = 'stack' and seated then
    insert into poker_transactions (user_id, group_id, amount, type, status, session_id, note)
    values (auth.uid(), s.group_id, amt, 'buy_in', 'confirmed', p_session, 'Bounty to stack');
    update poker_game_players set total_buyin = total_buyin + amt
      where session_id = p_session and user_id = auth.uid();
  end if;

  perform poker_recompute_balance(auth.uid(), s.group_id);
  insert into poker_bounty_claims (session_id, group_id, eliminator_id, eliminated_id, amount)
  values (p_session, s.group_id, auth.uid(), p_eliminated, amt);
  update poker_game_sessions set bounty_pool = bounty_pool - amt where id = p_session;
  return amt;
end; $$;

grant execute on function poker_create_session(text,integer,integer,boolean,integer,text) to authenticated;
