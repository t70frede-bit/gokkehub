-- =============================================================================
-- GokkeHub Poker — migration 004: repair usernames stored as raw JSON
-- Run after 001/002 (safe whether or not 003 was run — it re-applies the fix).
--
-- Migration 002 had a fallback (`user_metadata ->> 'custom_claims'`) that, for
-- Discord accounts whose handle only lives in the nested `global_name`, stored
-- the whole object as the username — e.g. {"global_name": "Hr. Slåskamp"} — which
-- then showed up everywhere the username is displayed.
--
-- This (1) re-applies the corrected provisioning function, and (2) rewrites any
-- already-stored JSON-blob usernames to the real global_name.
-- =============================================================================

-- (1) Corrected provisioning function (identical to migration 003 — re-applied
-- here so this single file fully fixes a project even if 003 was skipped).
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
  v_name  text;
  v_final text;
  v_admin boolean;
  rec poker_users;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  v_name := coalesce(
    nullif(v_meta ->> 'user_name', ''),
    nullif(v_meta ->> 'preferred_username', ''),
    nullif(v_meta ->> 'nickname', ''),
    nullif(v_meta #>> '{custom_claims,global_name}', ''),
    nullif(v_meta ->> 'full_name', ''),
    nullif(v_meta ->> 'name', ''),
    nullif(split_part(coalesce(v_email, ''), '@', 1), ''),
    'player'
  );

  v_admin :=
    lower(coalesce(v_meta #>> '{custom_claims,global_name}', '')) = 'goksi0501'
    or exists (
      select 1 from jsonb_each_text(v_meta) e where lower(e.value) = 'goksi0501'
    );

  select * into rec from poker_users where id = v_uid;
  if rec.id is not null then
    if v_admin and rec.role <> 'admin' then
      update poker_users set role = 'admin' where id = v_uid returning * into rec;
    end if;
    return rec;
  end if;

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

-- (2) Repair existing rows whose username is a {"global_name": "..."} blob.
-- Only rewrites when the extracted name isn't already taken (avoids unique
-- collisions); the WHERE guards against non-JSON usernames.
update poker_users u
set username = btrim(u.username::jsonb ->> 'global_name')
where u.username ~ '^\s*\{.*"global_name".*\}\s*$'
  and (u.username::jsonb ->> 'global_name') is not null
  and btrim(u.username::jsonb ->> 'global_name') <> ''
  and not exists (
    select 1 from poker_users x
    where x.id <> u.id
      and lower(x.username) = lower(btrim(u.username::jsonb ->> 'global_name'))
  );

-- See what's left (sanity check):
-- select id, username, role from poker_users order by created_at;
