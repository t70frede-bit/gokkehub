-- =============================================================================
-- GokkeHub Poker — migration 012: knockouts need confirmation + actually bust
-- Run after 001–011.
--
-- Recording a knockout now creates a PENDING claim (no draw, no money moves).
-- The KNOCKED-OUT player OR the host/admin then confirms → the eliminated player
-- is cashed out at 0 (removed from the table), the eliminator draws the bounty
-- (to balance or stack per the session setting), and the session finishes once
-- everyone is out. Either party can reject a bogus claim.
-- =============================================================================

alter table poker_bounty_claims
  add column if not exists status text not null default 'confirmed' check (status in ('pending','confirmed'));
alter table poker_bounty_claims alter column amount drop not null;

-- Record = create a PENDING claim (eliminated must still be seated & active).
drop function if exists poker_record_knockout(uuid, uuid);
create or replace function poker_record_knockout(p_session uuid, p_eliminated uuid)
returns void language plpgsql security definer set search_path = public as $$
declare s poker_game_sessions;
begin
  select * into s from poker_game_sessions where id = p_session;
  if s is null then raise exception 'session not found'; end if;
  if not s.bounty_enabled then raise exception 'no bounty on this table'; end if;
  if p_eliminated = auth.uid() then raise exception 'you cannot knock out yourself'; end if;
  if not exists (select 1 from poker_bounty_entries where session_id = p_session and user_id = auth.uid())
    then raise exception 'you must be in the bounty to claim one'; end if;
  if not exists (select 1 from poker_bounty_entries where session_id = p_session and user_id = p_eliminated)
    then raise exception 'that player has no bounty'; end if;
  if not exists (select 1 from poker_game_players
      where session_id = p_session and user_id = p_eliminated and cashed_out_at is null)
    then raise exception 'that player is not at the table'; end if;
  if exists (select 1 from poker_bounty_claims where session_id = p_session and eliminated_id = p_eliminated)
    then raise exception 'a knockout for that player is already pending or done'; end if;

  insert into poker_bounty_claims (session_id, group_id, eliminator_id, eliminated_id, amount, status)
  values (p_session, s.group_id, auth.uid(), p_eliminated, null, 'pending');
end; $$;

-- Confirm = the eliminated player or the host/admin approves it.
create or replace function poker_confirm_knockout(p_claim uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare c poker_bounty_claims; s poker_game_sessions; gp poker_game_players;
  amt integer; pool integer; r double precision; seated boolean; remaining integer;
begin
  select * into c from poker_bounty_claims where id = p_claim for update;
  if c is null then raise exception 'claim not found'; end if;
  if c.status <> 'pending' then raise exception 'already resolved'; end if;
  select * into s from poker_game_sessions where id = c.session_id for update;
  if auth.uid() <> c.eliminated_id and auth.uid() <> s.host_id and not poker_is_group_admin(s.group_id)
    then raise exception 'only the knocked-out player or the host can confirm'; end if;

  -- Draw the bounty from the pool.
  pool := s.bounty_pool;
  if pool <= 0 then
    amt := 0;
  else
    r := random();
    if    r < 0.65 then amt := s.bounty_buyin;
    elsif r < 0.90 then amt := s.bounty_buyin * 2;
    else  amt := ceil(pool * (0.5 + random() * 0.5));
    end if;
    amt := greatest(1, least(amt, pool));
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

  -- Finish the session once everyone is out.
  select count(*) into remaining from poker_game_players where session_id = c.session_id and cashed_out_at is null;
  if remaining = 0 then
    update poker_game_sessions set status = 'finished', finished_at = now() where id = c.session_id;
    insert into poker_game_events (session_id, group_id, type) values (c.session_id, s.group_id, 'session_ended');
  end if;

  return amt;
end; $$;

-- Reject = the eliminated player or host/admin dismisses a bogus claim.
create or replace function poker_reject_knockout(p_claim uuid)
returns void language plpgsql security definer set search_path = public as $$
declare c poker_bounty_claims; s poker_game_sessions;
begin
  select * into c from poker_bounty_claims where id = p_claim;
  if c is null then raise exception 'claim not found'; end if;
  if c.status <> 'pending' then raise exception 'already resolved'; end if;
  select * into s from poker_game_sessions where id = c.session_id;
  if auth.uid() <> c.eliminated_id and auth.uid() <> s.host_id and not poker_is_group_admin(s.group_id)
    then raise exception 'not allowed'; end if;
  delete from poker_bounty_claims where id = p_claim;
end; $$;

grant execute on function poker_record_knockout(uuid, uuid)  to authenticated;
grant execute on function poker_confirm_knockout(uuid)       to authenticated;
grant execute on function poker_reject_knockout(uuid)        to authenticated;
