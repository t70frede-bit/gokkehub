-- =============================================================================
-- GokkeHub Poker — migration 006: account + group ownership actions
-- Run after 001–005. ADDITIVE (new functions only) — safe to run anytime; the
-- previously deployed build doesn't call these, so nothing breaks.
-- =============================================================================

-- Rename yourself (unique, case-insensitive).
create or replace function poker_set_username(p_username text)
returns void language plpgsql security definer set search_path = public as $$
declare v text := btrim(p_username);
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if length(v) < 2 then raise exception 'username too short'; end if;
  if exists (select 1 from poker_users where lower(username) = lower(v) and id <> auth.uid())
    then raise exception 'that username is taken'; end if;
  update poker_users set username = v where id = auth.uid();
end; $$;

-- Leave a group. Blocked if you still hold a balance, or you're the only admin
-- (transfer ownership first). Reassigns your active group afterwards.
create or replace function poker_leave_group(p_group uuid)
returns void language plpgsql security definer set search_path = public as $$
declare m poker_group_members; admin_count int; next_group uuid;
begin
  select * into m from poker_group_members where group_id = p_group and user_id = auth.uid();
  if m.id is null then raise exception 'you are not in this group'; end if;
  if m.balance <> 0 then raise exception 'settle your balance before leaving'; end if;
  if m.role = 'admin' then
    select count(*) into admin_count from poker_group_members
      where group_id = p_group and role = 'admin' and status = 'active';
    if admin_count <= 1 then raise exception 'transfer ownership before leaving'; end if;
  end if;

  delete from poker_group_members where group_id = p_group and user_id = auth.uid();

  -- Move active group to any other membership (or null).
  select group_id into next_group from poker_group_members
    where user_id = auth.uid() and status = 'active' limit 1;
  update poker_users set active_group_id = next_group where id = auth.uid();
end; $$;

-- Transfer ownership: make another active member the admin and step down to
-- player. Updates the group's created_by for tidiness.
create or replace function poker_transfer_ownership(p_group uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not poker_is_group_admin(p_group) then raise exception 'admin only'; end if;
  if p_user = auth.uid() then raise exception 'you already own this group'; end if;
  if not exists (select 1 from poker_group_members
      where group_id = p_group and user_id = p_user and status = 'active')
    then raise exception 'that person is not an active member'; end if;

  update poker_group_members set role = 'admin'  where group_id = p_group and user_id = p_user;
  update poker_group_members set role = 'player' where group_id = p_group and user_id = auth.uid();
  update poker_groups set created_by = p_user where id = p_group;
end; $$;

grant execute on function poker_set_username(text)              to authenticated;
grant execute on function poker_leave_group(uuid)               to authenticated;
grant execute on function poker_transfer_ownership(uuid, uuid)  to authenticated;
