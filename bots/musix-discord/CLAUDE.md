# bots/musix-discord — Discord bot + audio proxy for timelinedrop

Owning agent: **discord-bot**. Slash commands + command sync, the HTTP audio proxy
that serves the all-clients-stream audio consumed by timelinedrop's `useAudio.ts`,
Discord-side session persistence, and the bot's Spotify/YouTube usage.

- Secrets (Discord bot token, Supabase service-role key) live in
  `bots/musix-discord/.env` on the bot host only — gitignored, never in the repo.
- Audio internals (Spotify/YouTube fetching) → coordinate with audio-integration;
  timelinedrop-side consumption → musix-dev.
