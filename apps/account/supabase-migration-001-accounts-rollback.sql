-- Rollback for account migration 001. Drops all account rows and linked
-- identities; sessions in KV keep working (they carry their own copy).
begin;
drop table if exists public.gh_identities;
drop table if exists public.gh_users;
commit;
