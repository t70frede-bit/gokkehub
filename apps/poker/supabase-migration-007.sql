-- =============================================================================
-- GokkeHub Poker — migration 007: sessions are live on creation (no lobby/start)
-- Run after 001–006. Replaces two function bodies + flips any stuck lobby rows.
-- RUN THIS BEFORE/WITH the matching deploy — the new UI has no "Start game"
-- button, so a session must be 'active' from creation or it can't progress.
-- =============================================================================

-- New sessions start ACTIVE. They end only when every player has cashed out.
create or replace function poker_create_session(p_min integer, p_max integer, p_rebuys boolean)
returns poker_game_sessions language plpgsql security definer set search_path = public as $$
declare s poker_game_sessions; g uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  g := poker_my_group();
  if g is null or not poker_is_member(g) then raise exception 'join or select a group first'; end if;
  if p_min < 0 or p_max < p_min then raise exception 'invalid buy-in range'; end if;
  insert into poker_game_sessions (host_id, group_id, status, min_buyin, max_buyin, rebuys_enabled)
  values (auth.uid(), g, 'active', p_min, p_max, coalesce(p_rebuys, true))
  returning * into s;
  return s;
end; $$;

-- Allow deleting an EMPTY (no-players), not-yet-finished table — host or admin.
create or replace function poker_delete_session(p_session uuid)
returns void language plpgsql security definer set search_path = public as $$
declare s poker_game_sessions;
begin
  select * into s from poker_game_sessions where id = p_session;
  if s is null then raise exception 'session not found'; end if;
  if s.host_id <> auth.uid() and not poker_is_group_admin(s.group_id) then raise exception 'not allowed'; end if;
  if s.status = 'finished' then raise exception 'finished sessions cannot be deleted'; end if;
  if exists (select 1 from poker_game_players where session_id = p_session) then raise exception 'has players'; end if;
  delete from poker_game_sessions where id = p_session;
end; $$;

-- No more lobby step: activate anything left in lobby so it isn't stuck.
update poker_game_sessions set status = 'active' where status = 'lobby';
