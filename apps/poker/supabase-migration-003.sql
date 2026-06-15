-- =============================================================================
-- GokkeHub Poker — migration 003: robust Discord handle + admin detection
-- Run after 001 and 002.
--
-- Fixes two issues in poker_ensure_profile:
--   1. A fallback key (`custom_claims`) is a JSON *object*; `->>` on it returned
--      stringified JSON, which could become a garbage username.
--   2. The admin check only looked at three hard-coded keys. Supabase's Discord
--      provider puts the handle under inconsistent keys (name / full_name /
--      custom_claims.global_name / user_name). Now we scan EVERY metadata value.
--
-- Re-running is safe (create or replace). Existing players keep their row; the
-- configured admin handle is promoted on their next login/refresh.
-- =============================================================================

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
  v_name  text;   -- chosen display username
  v_final text;   -- username after uniqueness resolution
  v_admin boolean;
  rec poker_users;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  -- Pick the best-looking handle Discord gave us (text keys only; the nested
  -- global_name is read with #>> so it returns text, not an object).
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

  -- Admin if "goksi0501" appears anywhere in the metadata (any top-level string
  -- value, or the nested Discord global_name). Robust to provider key changes.
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
