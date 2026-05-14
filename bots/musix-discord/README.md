# musix-discord

Discord bot that plays the songs for a musix.gokkehub.com game directly
into the host's voice channel. Activated per-room via the lobby's "Audio: 🤖
Discord bot" toggle.

> **Why a separate process?** Cloudflare Pages Functions are request /
> response — they can't hold a persistent Discord voice connection. The bot
> runs as a long-lived Node.js process and subscribes to the same Supabase
> realtime stream the React clients use, so it follows round transitions
> without needing an extra API surface on our side.

## Audio source

Spotify's terms forbid bots streaming their audio (this is why every popular
Discord music bot ended up YouTube-backed). So:

- **Metadata** comes from Spotify, as today (track id, artist, title, cover,
  release year — already curated into `tl_rooms.track_pool`).
- **Audio** is resolved at play-time: search YouTube for `"{artist} {title}"`,
  take the top match, stream it via `@discordjs/voice` + `ffmpeg`.

There's a mismatch risk (Spotify shows track A, YouTube plays a cover / live
version / wrong song) — common to all Discord music bots and usually fine for
mainstream tracks. The persistent year-corrections system (migration 013)
helps with the related "remaster year is wrong" problem.

## How a game uses it

1. Host enables **Audio: Discord bot** in the lobby.
2. Host adds the bot to their Discord server (one-time setup).
3. Host joins a voice channel, runs `/musix join {ROOM_CODE}`.
4. Bot looks up the room in Supabase, joins the host's voice channel, and
   subscribes to that room's realtime channel.
5. When `tl_rooms.current_round_id` flips to a new round, the bot resolves
   `tl_rounds.track` to a YouTube stream and plays it.
6. When `tl_rooms.paused_at_ms` is set, the bot pauses. When
   `tl_rooms.playing_since` is non-null and `paused_at_ms` is null, the bot
   plays.
7. When `tl_rounds.song_limit_seconds` is set (Song Limiter token), the bot
   auto-stops after that many seconds.
8. `/musix leave` (or room status → finished) makes the bot disconnect.

## Setup (one-time, for the bot operator)

### 1. Discord application

You can reuse an existing GokkeHub Discord app (the same one that powers
the OAuth login on account.gokkehub.com is fine — bot and OAuth coexist on
one application). Or create a fresh one at
<https://discord.com/developers/applications>.

Then on that application:

1. Sidebar → **Bot**. If the page shows **Add Bot**, click it. Otherwise
   the bot already exists.
2. **Reset Token**, copy it — this is `DISCORD_BOT_TOKEN`. It's distinct
   from the OAuth client secret on the General Information page; don't
   confuse them.
3. Turn **Public Bot** OFF if you want to be the only one who can invite
   the bot.
4. **Privileged Gateway Intents:** leave them OFF. Slash commands + voice
   don't need any privileged intent; turning them on would require
   Discord's gateway review for any future scaling.
5. Sidebar → **OAuth2** → **URL Generator**. Scopes: `bot`,
   `applications.commands`. Bot permissions: `Connect`, `Speak`, `Use
   Voice Activity`. Open the generated URL and add the bot to your
   Discord server.

**OAuth redirects + secrets:** don't touch them. The bot doesn't use OAuth
redirect URIs or the OAuth client secret — those continue serving the
account.gokkehub.com login flow.

### 2. Set environment variables

Copy `.env.example` to `.env` and fill in:

```
DISCORD_BOT_TOKEN=…
DISCORD_CLIENT_ID=…       # also from the developer portal, "General Information"
SUPABASE_URL=https://verbxfbfurachhxztkob.supabase.co
SUPABASE_SERVICE_ROLE_KEY=…  # same key the Cloudflare Pages Functions use
```

### 3. Install + run

```bash
cd bots/musix-discord
pnpm install
pnpm dev      # local development, hot reload
pnpm start    # production
```

`ffmpeg` must be installed on the host machine (or available in the deploy
image). On Debian/Ubuntu: `apt install ffmpeg`. On macOS: `brew install
ffmpeg`. On Railway / Fly.io, see deploy notes below.

## Deployment

The bot needs to run 24/7 (or whenever someone might play a game). Options:

| Platform | Cost | Notes |
|---|---|---|
| **Railway** | Free $5 credit/month; ~$3-5/month after | Easiest. `ffmpeg` available via the Nixpacks builder. |
| **Fly.io** | Free tier covers small bots | Needs a Dockerfile with `apt install ffmpeg`. |
| **VPS** (Hetzner, DigitalOcean…) | $4-5/month | Most reliable. Use systemd or pm2 to keep it alive. |
| **Raspberry Pi / home server** | Hardware cost only | Works if your network's stable. |

Pick whichever fits. The bot is small (~150-200 MB resident) and CPU-light
except when ffmpeg is transcoding.

## Implementation phases

1. **Phase 1 (current scaffold)** — README + `.env.example` + planning. ✅
2. **Phase 2 — Hello-world bot.** Connects to Discord, registers
   `/musix-join` / `/musix-leave` slash commands, replies with stub messages.
   No voice yet. Confirms the bot setup + token + slash command flow works.
3. **Phase 3 — Voice connection.** `/musix-join` actually joins the host's
   voice channel. Plays a static test MP3 to verify @discordjs/voice +
   ffmpeg are wired correctly. Subscribes to the room's Supabase realtime
   channel.
4. **Phase 4 — YouTube resolver.** Given a `SpotifyTrack`, search YouTube
   and return a streamable URL. Use `play-dl` (handles search + streaming in
   one library, less brittle than yt-dlp shell-outs).
5. **Phase 5 — Round playback.** On `tl_rounds.current_round_id` change,
   resolve the track and stream it. Honour pause/resume from
   `playing_since` / `paused_at_ms`. Honour `song_limit_seconds`.
6. **Phase 6 — Persistence + reliability.** Store the room → voice channel
   mapping in a small `tl_discord_sessions` table so bot restarts pick the
   game back up. Handle host disconnects, voice-channel changes, etc.

Each phase is its own commit. Phase 2 next.

## File layout (post-Phase 5)

```
bots/musix-discord/
├── README.md
├── .env.example
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts           # entry — boots Discord client + supabase listener
│   ├── discord.ts         # Discord client setup, slash command registration
│   ├── commands.ts        # /musix-join, /musix-leave handlers
│   ├── voice.ts           # voice connection + audio pipeline
│   ├── resolver.ts        # SpotifyTrack → YouTube stream URL (play-dl)
│   ├── sessions.ts        # room → voice channel mapping (in-memory + DB)
│   └── supabase.ts        # realtime subscription helpers
└── Dockerfile             # for Fly.io / Railway with ffmpeg
```
