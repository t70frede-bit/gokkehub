# apps/timelinedrop — musix.gokkehub.com ("Musix")

Largest, most complex app: Hitster-style music timeline game. Multi-team,
host-controlled, realtime via Supabase, with a 16-token economy.
Owning agent: **musix-dev** — see `.claude/agents/musix-dev.md` for the full file
map, game flow, and the subtle logic (recovery, captain authority, token counter,
steal-by-year) not to regress.

Defer: schema (tables prefixed `tl_`, current migration head 030) →
supabase-migrations; Spotify/YouTube + in-game audio → audio-integration; the
Discord audio proxy → discord-bot; visual → design; rules copy → game-rules.
