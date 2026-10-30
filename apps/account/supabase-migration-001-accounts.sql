-- Account migration 001 — GokkeHub accounts (gh_users + gh_identities)
--
-- Until now a GokkeHub "user" was just the login provider's id stored in a
-- 7-day KV session (Discord snowflake, or "sp:<spotify id>"). Linked accounts
-- and profile edits were lost on logout, and the same person signing in with
-- Discord and with Spotify became two users.
--
-- gh_users      — one row per person. `id` is text so EXISTING ids keep
--                 working unchanged: the Discord snowflake / "sp:<id>" that
--                 gridchallenge, musix and jeopardy already store as user_id.
--                 New sign-up methods (Google) get a random uuid as text.
-- gh_identities — one row per linked provider account. Sign-in methods
--                 (discord, google, spotify) and connected services (steam,
--                 lastfm). (provider, provider_user_id) is unique, so one
--                 Discord account can only ever belong to one GokkeHub user.
--
-- Access: written and read ONLY by apps/account Pages Functions with the
-- service-role key. RLS is enabled with no policies, and anon/authenticated
-- have no grants — refresh tokens live here, so the browser must never read it.
--
-- Idempotent; safe to re-run.

begin;

create table if not exists public.gh_users (
  id            text primary key,
  display_name  text,
  avatar_url    text,
  email         text,
  steam_id      text,          -- manually entered Steam id / vanity / profile URL
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.gh_identities (
  provider          text not null
                    check (provider in ('discord', 'google', 'spotify', 'steam', 'lastfm')),
  provider_user_id  text not null,
  user_id           text not null references public.gh_users(id) on delete cascade,
  display_name      text,
  avatar_url        text,
  refresh_token     text,      -- Spotify only (needed to restore playback/import)
  scope             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  primary key (provider, provider_user_id),
  unique (user_id, provider)
);

create index if not exists gh_identities_user_id_idx on public.gh_identities(user_id);

alter table public.gh_users      enable row level security;
alter table public.gh_identities enable row level security;

revoke all on public.gh_users      from anon, authenticated;
revoke all on public.gh_identities from anon, authenticated;

commit;
