-- =============================================================================
-- GokkeHub Poker — migration 002: Discord-login auth model
-- Run in the Supabase SQL editor AFTER supabase-migration.sql.
--
-- Switches poker from admin-created username/password accounts to self-service
-- **Discord login** (via Supabase's native Discord OAuth provider). On first
-- login a poker_users profile is provisioned automatically from the Discord
-- identity, so there are no poker-specific credentials.
--
-- The Discord username `goksi0501` is provisioned as an admin.
-- =============================================================================

-- The old username->email login helper is no longer used (no passwords now).
drop function if exists poker_email_for_username(text);

-- ── Auto-provision a profile from the logged-in Discord identity ───────────────
-- Called by the client right after login. SECURITY DEFINER so it can insert the
-- row past RLS. Idempotent: returns the existing row if already provisioned, and
-- promotes the configured admin handle if it isn't admin yet.
create or replace function poker_ensure_profile()
returns poker_users
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid  := auth.uid();
  v_meta  jsonb := coalesce(auth.jwt() -> 'user_metadata', '{}'::jsonb);
  v_email text  := auth.jwt() ->> 'email';
  v_handle text;   -- the Discord username (used for the admin check)
  v_name   text;   -- chosen display username
  v_final  text;   -- username after uniqueness resolution
  v_admin  boolean;
  rec poker_users;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  -- The Discord handle Supabase puts in the JWT (provider-dependent keys).
  v_handle := coalesce(
    v_meta ->> 'user_name',
    v_meta ->> 'preferred_username',
    v_meta ->> 'custom_claims',          -- (rarely) nested; falls through below
    v_meta ->> 'name',
    v_meta ->> 'full_name',
    split_part(coalesce(v_email, ''), '@', 1)
  );
  v_name  := coalesce(v_handle, 'player');
  v_admin := lower(coalesce(v_handle, '')) = 'goksi0501';

  select * into rec from poker_users where id = v_uid;
  if rec.id is not null then
    if v_admin and rec.role <> 'admin' then
      update poker_users set role = 'admin' where id = v_uid returning * into rec;
    end if;
    return rec;
  end if;

  -- New profile: make the username unique if it collides.
  v_final := v_name;
  if exists (select 1 from poker_users where lower(username) = lower(v_final)) then
    v_final := v_name || '-' || substr(v_uid::text, 1, 4);
  end if;

  insert into poker_users (id, username, email, role, balance)
  values (v_uid, v_final, v_email, case when v_admin then 'admin' else 'player' end, 0)
  returning * into rec;
  return rec;
end;
$$;

-- ── Admin: promote / demote a player ───────────────────────────────────────────
create or replace function poker_set_role(p_user uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not poker_is_admin() then raise exception 'admin only'; end if;
  if p_role not in ('player', 'admin') then raise exception 'invalid role'; end if;
  update poker_users set role = p_role where id = p_user;
end;
$$;

grant execute on function poker_ensure_profile()        to authenticated;
grant execute on function poker_set_role(uuid, text)    to authenticated;
