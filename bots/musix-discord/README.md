# musix-discord

Discord bot that plays the songs for a [musix.gokkehub.com](https://musix.gokkehub.com) game directly into the host's voice channel. Activated per-room via the lobby's "Audio: 🤖 Discord bot" toggle.

> **Why a separate process?** Cloudflare Pages Functions are request / response — they can't hold a persistent Discord voice connection. The bot runs as a long-lived Node.js process and subscribes to the same Supabase realtime stream the React clients use, so it follows round transitions without needing an extra API surface.

## How a game uses it

1. Host enables **Audio: Discord bot** in the lobby.
2. Host invites the bot to their Discord server (one-time).
3. Host joins a voice channel, runs `/musix join {ROOM_CODE}`.
4. Bot looks up the room in Supabase, joins the voice channel, plays a welcome clip.
5. Each new round → bot resolves `tl_rounds.track` to a YouTube stream and plays it.
6. Pause/resume + Song Limiter sync from `tl_rooms.playing_since` / `paused_at_ms`.
7. Players can flag wrong YouTube versions in-game; host approves, then can hit Redo round to get a different YouTube pick.
8. `/musix leave` makes the bot disconnect.

It also doubles as a regular music bot via `/musix play <query>` (search/URL/video ID), with a queue, autocomplete, pause/skip/stop controls, and a progress bar. The two modes don't fight: starting a musix game preserves the music queue and resumes it after `/musix leave`.

## Audio source

Spotify forbids bot streaming of their audio, so we use Spotify for **metadata** (curated into `tl_rooms.track_pool`) and YouTube for **audio**, resolved at play-time. Search runs through `youtubei.js` (Innertube — YouTube's internal mobile/TV API, doesn't break with layout changes). Streaming runs through `yt-dlp` as a subprocess (the only project that keeps up with YouTube's anti-bot dance).

## Quick start with Docker (recommended)

You need:
- Docker + Docker Compose installed
- A Discord application + bot token (yours, not someone else's — Discord allows one active connection per token, so each operator needs their own)
- Supabase credentials (ask the project maintainer for `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`)

### 1. Create your Discord app

1. Go to <https://discord.com/developers/applications> → **New Application**, name it whatever.
2. Sidebar → **Bot** → **Reset Token** → copy. That's your `DISCORD_BOT_TOKEN`.
3. Leave **Privileged Gateway Intents** OFF (the bot doesn't need any).
4. Sidebar → **General Information** → copy **Application ID**. That's your `DISCORD_CLIENT_ID`.

### 2. Invite the bot to your server

Open this URL in a browser (replace `YOUR_CLIENT_ID`):

```
https://discord.com/api/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=36700160&scope=bot+applications.commands
```

Permission integer `36700160` = Connect + Speak + Use Voice Activity. Add the bot to the server you want to play in.

### 3. Configure + run

```bash
git clone https://github.com/t70frede-bit/gokkehub.git
cd gokkehub/bots/musix-discord
cp .env.example .env
# Edit .env — fill in DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID,
# SUPABASE_URL (ask the maintainer), SUPABASE_SERVICE_ROLE_KEY (ditto).
docker compose up -d
```

The bot will boot, register the `/musix` slash command globally (takes up to ~1h on first run; instant for subsequent restarts), and idle until someone runs `/musix join` or `/musix play`.

Tail the logs:

```bash
docker compose logs -f
```

Stop:

```bash
docker compose down
```

### Updating to latest code

```bash
git pull
docker compose up -d --build
```

The `--build` rebuilds the image with the new source. The auto-downloaded yt-dlp binary persists in the `musix-bin` Docker volume across rebuilds.

## Local dev (without Docker)

```bash
cd bots/musix-discord
npm install
cp .env.example .env  # then fill it in
npm run dev           # tsx watch — hot reload
```

System deps for local dev:
- **Node.js 22 LTS** (not 24+ — voice handshake has issues on newer Node)
- **ffmpeg** on PATH (Debian/Ubuntu: `apt install ffmpeg`, macOS: `brew install ffmpeg`, Windows: `winget install Gyan.FFmpeg`)
- `yt-dlp` auto-downloads to `bots/musix-discord/bin/` on first use

## Environment variables

| Var | Required | What |
|---|---|---|
| `DISCORD_BOT_TOKEN` | yes | From Discord developer portal → your app → Bot → Reset Token |
| `DISCORD_CLIENT_ID` | yes | From Discord developer portal → your app → General Information → Application ID |
| `SUPABASE_URL` | yes | The musix project's Supabase URL — same one Cloudflare Pages uses |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Service-role key for that Supabase project — needed to bypass RLS when reading tl_rooms / tl_rounds |
| `DISCORD_DEV_GUILD_ID` | no | Narrow slash-command registration to one guild for instant sync during dev. Omit in prod. |

## Deployment notes

- The bot only needs outbound network access (Discord gateway WS, Discord voice UDP, Supabase, YouTube). No inbound ports.
- Memory footprint is small (~150 MB resident) but spikes during ffmpeg transcoding.
- Bot autodownloads yt-dlp at runtime; in Docker this lands in the `/app/bin` volume.
- Multiple bot instances must use **different** Discord bot tokens — one token = one active gateway connection.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `voice connection failed (last state: signalling): AbortError` with code `4017` | `@discordjs/voice` is too old / on the wrong gateway version. Pull latest — should be `0.19.x`. |
| `yt-dlp` failures / 4xx errors | YouTube broke yt-dlp again. `docker compose pull` then rebuild, or in local dev delete `bin/yt-dlp*` to force re-download of the latest release. |
| Bot joins voice but no audio | Check `ffmpeg` is on PATH inside the container (`docker compose exec musix-discord which ffmpeg` should print a path). |
| `/musix` doesn't appear in Discord | Slash commands take up to an hour to propagate when registered globally. Set `DISCORD_DEV_GUILD_ID` for instant sync during testing. |
| Bot in voice channel but message says "no music session active" on button click | The bot's session ended (e.g. you restarted it) but the Discord message still has live buttons. Run `/musix join` (or `/musix play`) again. |
