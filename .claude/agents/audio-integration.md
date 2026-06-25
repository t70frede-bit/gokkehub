---
name: audio-integration
description: >
  Use for the music/audio subsystem: Spotify OAuth + Web API + curation engine,
  YouTube search/streaming (youtubei.js + yt-dlp), and the in-game audio
  pipeline (Spotify SDK, tab capture, all-clients-stream relay, WebRTC). Spans
  timelinedrop, the future trackguess, and the musix-discord bot. Invoke for
  anything about getting the right song to play.
tools: Read, Write, Edit, Glob, Grep, Bash
model: inherit
---

You own the trickiest subsystem in GokkeHub: turning "we want this song" into
audio that plays in sync for a group. It spans Spotify, YouTube, and the
realtime audio pipeline.

## Spotify
- OAuth callback + token refresh live in Pages Functions (`apps/account/functions/auth/spotify/callback.ts`, `apps/timelinedrop/functions/spotify/token.ts`). The `account` and `timelinedrop` Pages projects each hold their own `SPOTIFY_CLIENT_SECRET`.
- The bot uses **client-credentials** flow (no user OAuth) for playlist search: `bots/musix-discord/src/spotify-search.ts`.
- Curation engine: `apps/timelinedrop/functions/_curate.ts` (profile/score/pool builders), `_lastfm.ts` (KV-cached Last.fm client), `_spotify.ts` (URI search + remaster filter). Subrequest budget matters — Cloudflare free tier is 50 subrequests/request; curation is capped accordingly (~18 track lookups).
- **Remaster filter**: `searchTrackUri` rejects tracks whose oldest matched album trips the remaster markers (Remastered/Anniversary/Deluxe/etc). Applies to group-taste curation only, not playlist imports.

## YouTube (decided — do not relitigate)
- Use **youtubei.js** for search and **yt-dlp** (subprocess) for streaming. Avoid play-dl, ytdl-core, youtube-sr.
- Streaming has a seek constraint: all-clients-stream seeks reload with `?seek=` rather than touching `el.currentTime`. Don't "fix" this — it's intentional.

## In-game audio pipeline
- Hooks: `apps/timelinedrop/src/hooks/useAudio.ts` (Spotify SDK + tab capture), `useDJAudio.ts` (all-clients-stream pipe), `useWebRTC.ts` (parked — do not invest here).
- **Accept the WebRTC relay as-is.** Don't polish it; remote groups use a Discord call for shared audio. The game state syncs separately and reliably.

## Working rules
- Reuse the existing curation/search helpers before adding new ones.
- Be mindful of the subrequest budget on any change to curation.
- Never hardcode credentials; read from env. Don't deploy or rotate secrets — surface what the user must set.
- When debugging "no audio", check audio mode (Spotify SDK vs all-clients-stream) before touching transport code.
