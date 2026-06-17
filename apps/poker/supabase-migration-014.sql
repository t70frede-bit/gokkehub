-- =============================================================================
-- GokkeHub Poker — migration 014: chop cashes everyone out + ends the session
-- Run after 001–013.
--
-- A chop now collects each remaining player's chip value. When all still-in
-- players have agreed (entered their stack), the bounty pool is split equally,
-- everyone is cashed out at their declared chip value, and the session finishes
-- → the recap (victory screen) shows for everyone.
-- =============================================================================

alter table poker_bounty_chop_votes add column if not exists cashout integer;

drop function if exists poker_vote_chop(uuid);
create or replace function poker_vote_chop(p_session uuid, p_cashout integer)
returns text language plpgsql security definer set search_path = public as $$
declare s poker_game_sessions; total_active int; voted_active int;
  share int; rem int; e record; first boolean := true;
begin
  select * into s from poker_game_sessions where id = p_session for update;
  if s is null then raise exception 'session not found'; end if;
  if not s.bounty_enabled then raise exception 'no bounty on this table'; end if;
  if p_cashout is null or p_cashout < 0 then raise exception 'enter your chip value'; end if;
  if not exists (select 1 from poker_game_players
      where session_id = p_session and user_id = auth.uid() and cashed_out_at is null)
    then raise exception 'only seated players can chop'; end if;

  select count(*) into total_active from poker_game_players
    where session_id = p_session and cashed_out_at is null;
  if total_active < 2 then raise exception 'need at least two players to chop'; end if;

  insert into poker_bounty_chop_votes (session_id, user_id, cashout)
    values (p_session, auth.uid(), p_cashout)
    on conflict (session_id, user_id) do update set cashout = excluded.cashout;

  select count(*) into voted_active from poker_bounty_chop_votes v
    where v.session_id = p_session
      and exists (select 1 from poker_game_players p
        where p.session_id = p_session and p.user_id = v.user_id and p.cashed_out_at is null);

  if voted_active < total_active then return 'voted'; end if;

  -- Unanimous → split the pool, cash everyone out at their declared value, finish.
  share := case when total_active > 0 then s.bounty_pool / total_active else 0 end;
  rem := s.bounty_pool - share * total_active;

  for e in
    select p.user_id, v.cashout
    from poker_game_players p
    join poker_bounty_chop_votes v on v.session_id = p.session_id and v.user_id = p.user_id
    where p.session_id = p_session and p.cashed_out_at is null
    order by p.joined_at
  loop
    if s.bounty_pool > 0 then
      insert into poker_transactions (user_id, group_id, amount, type, status, session_id, note)
      values (e.user_id, s.group_id, share + (case when first then rem else 0 end), 'deposit', 'confirmed', p_session, 'Bounty chop');
    end if;
    update poker_game_players set cashout_value = e.cashout, net_result = e.cashout - total_buyin, cashed_out_at = now()
      where session_id = p_session and user_id = e.user_id;
    if e.cashout > 0 then
      insert into poker_transactions (user_id, group_id, amount, type, status, session_id, note)
      values (e.user_id, s.group_id, e.cashout, 'cash_out', 'confirmed', p_session, 'Cash-out');
    end if;
    perform poker_recompute_balance(e.user_id, s.group_id);
    insert into poker_game_events (session_id, group_id, type, user_id, amount)
    values (p_session, s.group_id, 'cashout', e.user_id, e.cashout);
    first := false;
  end loop;

  update poker_game_sessions set bounty_pool = 0, status = 'finished', finished_at = now() where id = p_session;
  insert into poker_game_events (session_id, group_id, type) values (p_session, s.group_id, 'session_ended');
  delete from poker_bounty_chop_votes where session_id = p_session;
  return 'chopped';
end; $$;

grant execute on function poker_vote_chop(uuid, integer) to authenticated;
