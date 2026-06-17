-- =============================================================================
-- GokkeHub Poker — migration 015: fix the bounty draw so the pool can't drain early
-- Run after 001–014.
--
-- Bug: poker_confirm_knockout drew fixed amounts (≈1×/2× buy-in or a jackpot)
-- regardless of the remaining pool / un-knocked heads, so a couple of big early
-- draws emptied the pool before later bounties existed.
--
-- Fix: draw a FAIR share of the remaining pool — about pool ÷ (heads still
-- un-knocked), with mild variance and a small jackpot — capped so every other
-- remaining head can still get at least 1. The lone survivor grabs the rest.
-- =============================================================================

create or replace function poker_confirm_knockout(p_claim uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare c poker_bounty_claims; s poker_game_sessions; gp poker_game_players;
  amt integer; pool integer; heads_left integer; fair numeric; seated boolean; remaining integer;
begin
  select * into c from poker_bounty_claims where id = p_claim for update;
  if c is null then raise exception 'claim not found'; end if;
  if c.status <> 'pending' then raise exception 'already resolved'; end if;
  select * into s from poker_game_sessions where id = c.session_id for update;
  if auth.uid() <> c.eliminated_id and auth.uid() <> s.host_id and not poker_is_group_admin(s.group_id)
    then raise exception 'only the knocked-out player or the host can confirm'; end if;

  -- Heads still un-knocked (incl. this one): entries minus already-confirmed claims.
  select count(*) into heads_left from poker_bounty_entries e where e.session_id = c.session_id;
  heads_left := heads_left - (select count(*) from poker_bounty_claims cl
    where cl.session_id = c.session_id and cl.status = 'confirmed');

  pool := s.bounty_pool;
  if pool <= 0 or heads_left <= 0 then
    amt := 0;
  else
    fair := pool::numeric / heads_left;
    if random() < 0.10 then
      amt := ceil(fair * (1.5 + random() * 0.5));   -- ~1.5x–2x jackpot
    else
      amt := ceil(fair * (0.5 + random()));          -- ~0.5x–1.5x
    end if;
    -- never strand the other remaining heads: keep >= 1 for each of them
    amt := least(amt, greatest(1, pool - (heads_left - 1)));
    amt := greatest(1, amt);
  end if;

  if amt > 0 then
    insert into poker_transactions (user_id, group_id, amount, type, status, session_id, note)
    values (c.eliminator_id, s.group_id, amt, 'deposit', 'confirmed', c.session_id, 'Bounty win');
    select exists (select 1 from poker_game_players
      where session_id = c.session_id and user_id = c.eliminator_id and cashed_out_at is null) into seated;
    if s.bounty_payout = 'stack' and seated then
      insert into poker_transactions (user_id, group_id, amount, type, status, session_id, note)
      values (c.eliminator_id, s.group_id, amt, 'buy_in', 'confirmed', c.session_id, 'Bounty to stack');
      update poker_game_players set total_buyin = total_buyin + amt
        where session_id = c.session_id and user_id = c.eliminator_id;
    end if;
    perform poker_recompute_balance(c.eliminator_id, s.group_id);
    update poker_game_sessions set bounty_pool = bounty_pool - amt where id = c.session_id;
  end if;

  -- Bust the eliminated player at 0 (off the table).
  select * into gp from poker_game_players where session_id = c.session_id and user_id = c.eliminated_id;
  if gp.id is not null and gp.cashed_out_at is null then
    update poker_game_players set cashout_value = 0, net_result = 0 - total_buyin, cashed_out_at = now()
      where session_id = c.session_id and user_id = c.eliminated_id;
    perform poker_recompute_balance(c.eliminated_id, s.group_id);
    insert into poker_game_events (session_id, group_id, type, user_id, amount)
    values (c.session_id, s.group_id, 'cashout', c.eliminated_id, 0);
  end if;

  update poker_bounty_claims set status = 'confirmed', amount = amt where id = p_claim;

  select count(*) into remaining from poker_game_players where session_id = c.session_id and cashed_out_at is null;
  if remaining = 0 then
    update poker_game_sessions set status = 'finished', finished_at = now() where id = c.session_id;
    insert into poker_game_events (session_id, group_id, type) values (c.session_id, s.group_id, 'session_ended');
  end if;

  return amt;
end; $$;
