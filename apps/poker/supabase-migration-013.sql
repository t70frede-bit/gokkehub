-- =============================================================================
-- GokkeHub Poker — migration 013: chop the bounty + last-player-standing grab
-- Run after 001–012.
--
--  * Vote to chop: the still-in (active) players unanimously agree to split the
--    remaining bounty pool equally among themselves (to balance). They then cash
--    out their stacks normally.
--  * Grab bounty: when one player is left, they take the remaining pool and cash
--    out in one go, which finishes the session.
-- =============================================================================

create table if not exists poker_bounty_chop_votes (
  session_id uuid not null references poker_game_sessions(id) on delete cascade,
  user_id    uuid not null references poker_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (session_id, user_id)
);

alter table poker_bounty_chop_votes enable row level security;
drop policy if exists poker_chop_votes_select on poker_bounty_chop_votes;
create policy poker_chop_votes_select on poker_bounty_chop_votes
  for select using (exists (select 1 from poker_game_sessions s where s.id = session_id and poker_is_member(s.group_id)));

-- Vote to chop. When every still-active player has voted, split the pool equally.
create or replace function poker_vote_chop(p_session uuid)
returns text language plpgsql security definer set search_path = public as $$
declare s poker_game_sessions; total_active int; voted_active int;
  share int; rem int; e record; first boolean := true;
begin
  select * into s from poker_game_sessions where id = p_session for update;
  if s is null then raise exception 'session not found'; end if;
  if not s.bounty_enabled then raise exception 'no bounty on this table'; end if;
  if not exists (select 1 from poker_game_players
      where session_id = p_session and user_id = auth.uid() and cashed_out_at is null)
    then raise exception 'only seated players can vote'; end if;

  select count(*) into total_active from poker_game_players
    where session_id = p_session and cashed_out_at is null;
  if total_active < 2 then raise exception 'need at least two players to chop'; end if;

  insert into poker_bounty_chop_votes (session_id, user_id) values (p_session, auth.uid())
    on conflict do nothing;

  select count(*) into voted_active from poker_bounty_chop_votes v
    where v.session_id = p_session
      and exists (select 1 from poker_game_players p
        where p.session_id = p_session and p.user_id = v.user_id and p.cashed_out_at is null);

  if voted_active < total_active then return 'voted'; end if;

  -- Unanimous → split the remaining pool equally among the active players.
  if s.bounty_pool > 0 then
    share := s.bounty_pool / total_active;
    rem := s.bounty_pool - share * total_active;
    for e in select user_id from poker_game_players
      where session_id = p_session and cashed_out_at is null order by joined_at loop
      declare give int := share + (case when first then rem else 0 end);
      begin
        if give > 0 then
          insert into poker_transactions (user_id, group_id, amount, type, status, session_id, note)
          values (e.user_id, s.group_id, give, 'deposit', 'confirmed', p_session, 'Bounty chop');
          perform poker_recompute_balance(e.user_id, s.group_id);
        end if;
      end;
      first := false;
    end loop;
    update poker_game_sessions set bounty_pool = 0 where id = p_session;
  end if;

  delete from poker_bounty_chop_votes where session_id = p_session;
  return 'chopped';
end; $$;

create or replace function poker_unvote_chop(p_session uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from poker_bounty_chop_votes where session_id = p_session and user_id = auth.uid();
end; $$;

-- Last player standing grabs the remaining pool and cashes out, ending the game.
create or replace function poker_grab_bounty(p_session uuid, p_cashout integer)
returns void language plpgsql security definer set search_path = public as $$
declare s poker_game_sessions; active_count int; gp poker_game_players;
begin
  select * into s from poker_game_sessions where id = p_session for update;
  if s is null then raise exception 'session not found'; end if;
  select count(*) into active_count from poker_game_players where session_id = p_session and cashed_out_at is null;
  if active_count <> 1 then raise exception 'this is only for the last player standing'; end if;
  select * into gp from poker_game_players where session_id = p_session and user_id = auth.uid() and cashed_out_at is null;
  if gp.id is null then raise exception 'you are not the last player'; end if;
  if p_cashout is null or p_cashout < 0 then raise exception 'cash-out cannot be negative'; end if;

  if s.bounty_pool > 0 then
    insert into poker_transactions (user_id, group_id, amount, type, status, session_id, note)
    values (auth.uid(), s.group_id, s.bounty_pool, 'deposit', 'confirmed', p_session, 'Bounty (last standing)');
    update poker_game_sessions set bounty_pool = 0 where id = p_session;
  end if;

  update poker_game_players set cashout_value = p_cashout, net_result = p_cashout - total_buyin, cashed_out_at = now()
    where session_id = p_session and user_id = auth.uid();
  if p_cashout > 0 then
    insert into poker_transactions (user_id, group_id, amount, type, status, session_id, note)
    values (auth.uid(), s.group_id, p_cashout, 'cash_out', 'confirmed', p_session, 'Cash-out');
  end if;
  perform poker_recompute_balance(auth.uid(), s.group_id);
  insert into poker_game_events (session_id, group_id, type, user_id, amount)
  values (p_session, s.group_id, 'cashout', auth.uid(), p_cashout);

  update poker_game_sessions set status = 'finished', finished_at = now() where id = p_session;
  insert into poker_game_events (session_id, group_id, type) values (p_session, s.group_id, 'session_ended');
end; $$;

grant execute on function poker_vote_chop(uuid)            to authenticated;
grant execute on function poker_unvote_chop(uuid)          to authenticated;
grant execute on function poker_grab_bounty(uuid, integer) to authenticated;

do $$
begin
  begin alter publication supabase_realtime add table poker_bounty_chop_votes; exception when duplicate_object then null; end;
end $$;
