-- =============================================================================
-- GokkeHub Poker — migration 010: game mode chosen at creation
-- Run after 001–009.
--
-- Two modes, picked when hosting:
--   * cash       — buy-in RANGE, optional rebuys, no bounty.
--   * tournament — FIXED buy-in + a MANDATORY mystery bounty: sitting down at the
--                  table automatically enrolls you in (and charges) the bounty.
-- Updates poker_create_session (mode + bounty params) and poker_join_session
-- (auto-enroll + charge the bounty when the session has one).
-- =============================================================================

alter table poker_game_sessions add column if not exists mode text not null default 'cash'
  check (mode in ('cash', 'tournament'));

drop function if exists poker_create_session(integer, integer, boolean);
create or replace function poker_create_session(
  p_mode text, p_min integer, p_max integer, p_rebuys boolean, p_bounty_buyin integer
)
returns poker_game_sessions language plpgsql security definer set search_path = public as $$
declare s poker_game_sessions; g uuid; v_mode text := coalesce(nullif(p_mode,''), 'cash');
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  g := poker_my_group();
  if g is null or not poker_is_member(g) then raise exception 'join or select a group first'; end if;

  if v_mode = 'tournament' then
    if p_min <= 0 then raise exception 'set a buy-in'; end if;
    if p_bounty_buyin is null or p_bounty_buyin <= 0 then raise exception 'a bounty game needs a bounty buy-in'; end if;
    insert into poker_game_sessions (host_id, group_id, status, min_buyin, max_buyin, rebuys_enabled,
      mode, bounty_enabled, bounty_buyin, bounty_pool)
    values (auth.uid(), g, 'active', p_min, p_min, coalesce(p_rebuys, false),
      'tournament', true, p_bounty_buyin, 0)
    returning * into s;
  else
    if p_min < 0 or p_max < p_min then raise exception 'invalid buy-in range'; end if;
    insert into poker_game_sessions (host_id, group_id, status, min_buyin, max_buyin, rebuys_enabled,
      mode, bounty_enabled, bounty_buyin, bounty_pool)
    values (auth.uid(), g, 'active', p_min, p_max, coalesce(p_rebuys, true),
      'cash', false, 0, 0)
    returning * into s;
  end if;
  return s;
end; $$;

create or replace function poker_join_session(p_session uuid, p_buyin integer)
returns void language plpgsql security definer set search_path = public as $$
declare s poker_game_sessions; bal integer; needed integer;
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

  -- Bounty (tournament) games charge the bounty buy-in on top, automatically.
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

grant execute on function poker_create_session(text,integer,integer,boolean,integer) to authenticated;
