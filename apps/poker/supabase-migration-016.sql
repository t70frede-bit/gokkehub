-- =============================================================================
-- GokkeHub Poker — migration 016: tournament bounty (register→start), pre-sealed
-- per-head bounties, and chop/cash-out rules. Run after 001–015.
--
-- Bounty (tournament) games now:
--   * are created in 'lobby' (registration); players buy in + pay the bounty.
--   * the host STARTS them → each player's bounty is sealed (hidden, varied, sums
--     exactly to the pool) and no one can join after that.
--   * knockout reveals the eliminated player's OWN sealed bounty → to the
--     eliminator. Last player standing grabs their own. Chop settles per rules.
-- New per-session settings: allow_cashout, allow_chop, chop_stack_mode
-- ('even'|'keep'), chop_bounty_mode ('even'|'own').
-- =============================================================================

alter table poker_game_sessions add column if not exists allow_cashout    boolean not null default true;
alter table poker_game_sessions add column if not exists allow_chop       boolean not null default true;
alter table poker_game_sessions add column if not exists chop_stack_mode  text not null default 'keep' check (chop_stack_mode in ('even','keep'));
alter table poker_game_sessions add column if not exists chop_bounty_mode text not null default 'even' check (chop_bounty_mode in ('even','own'));
alter table poker_game_sessions add column if not exists chop_agreed      boolean not null default false;
alter table poker_bounty_entries add column if not exists sealed integer;

-- ── Create (cash = live now; tournament = lobby/registration) ─────────────────
drop function if exists poker_create_session(text, integer, integer, boolean, integer, text);
create or replace function poker_create_session(
  p_mode text, p_min integer, p_max integer, p_rebuys boolean,
  p_bounty_buyin integer, p_bounty_payout text,
  p_allow_cashout boolean, p_allow_chop boolean, p_chop_stack text, p_chop_bounty text
)
returns poker_game_sessions language plpgsql security definer set search_path = public as $$
declare s poker_game_sessions; g uuid; v_mode text := coalesce(nullif(p_mode,''),'cash');
  v_payout text := coalesce(nullif(p_bounty_payout,''),'balance');
  v_stack text := coalesce(nullif(p_chop_stack,''),'keep');
  v_bchop text := coalesce(nullif(p_chop_bounty,''),'even');
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  g := poker_my_group();
  if g is null or not poker_is_member(g) then raise exception 'join or select a group first'; end if;
  if v_payout not in ('balance','stack') then v_payout := 'balance'; end if;
  if v_stack not in ('even','keep') then v_stack := 'keep'; end if;
  if v_bchop not in ('even','own') then v_bchop := 'even'; end if;

  if v_mode = 'tournament' then
    if p_min <= 0 then raise exception 'set a buy-in'; end if;
    if p_bounty_buyin is null or p_bounty_buyin <= 0 then raise exception 'a bounty game needs a bounty buy-in'; end if;
    insert into poker_game_sessions (host_id, group_id, status, min_buyin, max_buyin, rebuys_enabled,
      mode, bounty_enabled, bounty_buyin, bounty_pool, bounty_payout,
      allow_cashout, allow_chop, chop_stack_mode, chop_bounty_mode)
    values (auth.uid(), g, 'lobby', p_min, p_min, false,
      'tournament', true, p_bounty_buyin, 0, v_payout,
      coalesce(p_allow_cashout, false), coalesce(p_allow_chop, true), v_stack, v_bchop)
    returning * into s;
  else
    if p_min < 0 or p_max < p_min then raise exception 'invalid buy-in range'; end if;
    insert into poker_game_sessions (host_id, group_id, status, min_buyin, max_buyin, rebuys_enabled,
      mode, bounty_enabled, bounty_buyin, bounty_pool, bounty_payout, allow_cashout, allow_chop)
    values (auth.uid(), g, 'active', p_min, p_max, coalesce(p_rebuys, true),
      'cash', false, 0, 0, 'balance', true, false)
    returning * into s;
  end if;
  return s;
end; $$;

-- ── Join (tournaments: only during registration / lobby) ─────────────────────
create or replace function poker_join_session(p_session uuid, p_buyin integer)
returns void language plpgsql security definer set search_path = public as $$
declare s poker_game_sessions; bal integer; needed integer;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into s from poker_game_sessions where id = p_session for update;
  if s is null then raise exception 'session not found'; end if;
  if not poker_is_member(s.group_id) then raise exception 'not a member of this group'; end if;
  if s.status = 'finished' then raise exception 'session is over'; end if;
  if s.mode = 'tournament' and s.status <> 'lobby' then raise exception 'registration is closed'; end if;
  if exists (select 1 from poker_game_players where session_id = p_session and user_id = auth.uid())
    then raise exception 'already joined'; end if;
  if p_buyin < s.min_buyin or p_buyin > s.max_buyin
    then raise exception 'buy-in must be between % and %', s.min_buyin, s.max_buyin; end if;

  needed := p_buyin + (case when s.bounty_enabled then s.bounty_buyin else 0 end);
  bal := poker_balance_of(auth.uid(), s.group_id);
  if bal < needed then raise exception 'insufficient balance'; end if;

  insert into poker_game_players (session_id, group_id, user_id, total_buyin)
  values (p_session, s.group_id, auth.uid(), p_buyin);
  insert into poker_transactions (user_id, group_id, amount, type, status, session_id, note)
  values (auth.uid(), s.group_id, p_buyin, 'buy_in', 'confirmed', p_session, 'Buy-in');

  if s.bounty_enabled then
    insert into poker_transactions (user_id, group_id, amount, type, status, session_id, note)
    values (auth.uid(), s.group_id, s.bounty_buyin, 'withdrawal', 'confirmed', p_session, 'Bounty buy-in');
    insert into poker_bounty_entries (session_id, user_id, amount)
    values (p_session, auth.uid(), s.bounty_buyin) on conflict (session_id, user_id) do nothing;
    update poker_game_sessions set bounty_pool = bounty_pool + s.bounty_buyin where id = p_session;
  end if;

  perform poker_recompute_balance(auth.uid(), s.group_id);
  insert into poker_game_events (session_id, group_id, type, user_id, amount)
  values (p_session, s.group_id, 'player_joined', auth.uid(), p_buyin);
end; $$;

-- ── Start the tournament: lock the field + pre-seal everyone's bounty ─────────
create or replace function poker_start_session(p_session uuid)
returns void language plpgsql security definer set search_path = public as $$
declare s poker_game_sessions; cnt int; pool int; rem int; top_user uuid;
begin
  select * into s from poker_game_sessions where id = p_session for update;
  if s is null then raise exception 'session not found'; end if;
  if s.host_id <> auth.uid() and not poker_is_group_admin(s.group_id) then raise exception 'only the host can start'; end if;
  if s.status <> 'lobby' then raise exception 'already started'; end if;
  select count(*) into cnt from poker_bounty_entries where session_id = p_session;
  if cnt < 2 then raise exception 'need at least two players to start'; end if;

  pool := s.bounty_pool;
  -- Seal each head a weighted share of the pool (most ~ buy-in, some bigger).
  with w as (
    select user_id, 1 + (case when random() < 0.25 then random() * 5 else 0 end) as weight
    from poker_bounty_entries where session_id = p_session
  ), tot as (select sum(weight) tw from w)
  update poker_bounty_entries b
    set sealed = greatest(1, floor(pool * w.weight / tot.tw))::int
    from w, tot where b.session_id = p_session and b.user_id = w.user_id;

  -- Give any rounding remainder to the current top head (the jackpot).
  select pool - coalesce(sum(sealed), 0) into rem from poker_bounty_entries where session_id = p_session;
  if rem <> 0 then
    select user_id into top_user from poker_bounty_entries where session_id = p_session order by sealed desc limit 1;
    update poker_bounty_entries set sealed = sealed + rem where session_id = p_session and user_id = top_user;
  end if;

  update poker_game_sessions set status = 'active' where id = p_session;
end; $$;

-- ── Knockout confirm reveals the eliminated player's OWN sealed bounty ────────
create or replace function poker_confirm_knockout(p_claim uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare c poker_bounty_claims; s poker_game_sessions; gp poker_game_players;
  amt integer; seated boolean; remaining integer;
begin
  select * into c from poker_bounty_claims where id = p_claim for update;
  if c is null then raise exception 'claim not found'; end if;
  if c.status <> 'pending' then raise exception 'already resolved'; end if;
  select * into s from poker_game_sessions where id = c.session_id for update;
  if auth.uid() <> c.eliminated_id and auth.uid() <> s.host_id and not poker_is_group_admin(s.group_id)
    then raise exception 'only the knocked-out player or the host can confirm'; end if;

  select coalesce(sealed, 0) into amt from poker_bounty_entries
    where session_id = c.session_id and user_id = c.eliminated_id;
  amt := least(amt, s.bounty_pool);

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

-- ── Last standing grabs their own sealed bounty (= remaining pool) + cashes out
create or replace function poker_grab_bounty(p_session uuid, p_cashout integer)
returns void language plpgsql security definer set search_path = public as $$
declare s poker_game_sessions; active_count int;
begin
  select * into s from poker_game_sessions where id = p_session for update;
  if s is null then raise exception 'session not found'; end if;
  select count(*) into active_count from poker_game_players where session_id = p_session and cashed_out_at is null;
  if active_count <> 1 then raise exception 'this is only for the last player standing'; end if;
  if not exists (select 1 from poker_game_players where session_id = p_session and user_id = auth.uid() and cashed_out_at is null)
    then raise exception 'you are not the last player'; end if;
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

-- ── Vote to chop (no chip value up front). On unanimity: settle per the rules ──
drop function if exists poker_vote_chop(uuid, integer);
drop function if exists poker_vote_chop(uuid);
create or replace function poker_vote_chop(p_session uuid)
returns text language plpgsql security definer set search_path = public as $$
declare s poker_game_sessions; total_active int; voted_active int; prize int; share int; bshare int; brem int;
  e record; first boolean := true;
begin
  select * into s from poker_game_sessions where id = p_session for update;
  if s is null then raise exception 'session not found'; end if;
  if not s.allow_chop then raise exception 'chop is disabled for this game'; end if;
  if not exists (select 1 from poker_game_players where session_id = p_session and user_id = auth.uid() and cashed_out_at is null)
    then raise exception 'only seated players can chop'; end if;

  select count(*) into total_active from poker_game_players where session_id = p_session and cashed_out_at is null;
  if total_active < 2 then raise exception 'need at least two players to chop'; end if;

  insert into poker_bounty_chop_votes (session_id, user_id) values (p_session, auth.uid()) on conflict do nothing;
  select count(*) into voted_active from poker_bounty_chop_votes v where v.session_id = p_session
    and exists (select 1 from poker_game_players p where p.session_id = p_session and p.user_id = v.user_id and p.cashed_out_at is null);
  if voted_active < total_active then return 'voted'; end if;

  -- Unanimous → divide the bounty among the still-in players.
  if s.bounty_enabled and s.bounty_pool > 0 then
    bshare := s.bounty_pool / total_active;
    brem := s.bounty_pool - bshare * total_active;
    for e in select user_id from poker_game_players where session_id = p_session and cashed_out_at is null order by joined_at loop
      declare give int;
      begin
        if s.chop_bounty_mode = 'own' then
          select coalesce(sealed, 0) into give from poker_bounty_entries where session_id = p_session and user_id = e.user_id;
        else
          give := bshare + (case when first then brem else 0 end);
        end if;
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

  if s.chop_stack_mode = 'even' then
    -- Split the table chips equally → cash everyone out → finish.
    select coalesce(sum(total_buyin), 0) into prize from poker_game_players where session_id = p_session;
    share := prize / total_active;
    for e in select user_id from poker_game_players where session_id = p_session and cashed_out_at is null loop
      update poker_game_players set cashout_value = share, net_result = share - total_buyin, cashed_out_at = now()
        where session_id = p_session and user_id = e.user_id;
      if share > 0 then
        insert into poker_transactions (user_id, group_id, amount, type, status, session_id, note)
        values (e.user_id, s.group_id, share, 'cash_out', 'confirmed', p_session, 'Cash-out (chop)');
      end if;
      perform poker_recompute_balance(e.user_id, s.group_id);
      insert into poker_game_events (session_id, group_id, type, user_id, amount)
      values (p_session, s.group_id, 'cashout', e.user_id, share);
    end loop;
    update poker_game_sessions set status = 'finished', finished_at = now() where id = p_session;
    insert into poker_game_events (session_id, group_id, type) values (p_session, s.group_id, 'session_ended');
    return 'chopped';
  else
    -- Keep your stack: bounty's been split; players now cash out their chips.
    update poker_game_sessions set chop_agreed = true where id = p_session;
    return 'chop_settle';
  end if;
end; $$;

grant execute on function poker_create_session(text,integer,integer,boolean,integer,text,boolean,boolean,text,text) to authenticated;
grant execute on function poker_start_session(uuid)   to authenticated;
grant execute on function poker_vote_chop(uuid)       to authenticated;
