// musix Discord bot — Phase 3 (voice connection + test tones)
//
// On /musix join the bot actually joins the host's voice channel and plays a
// short welcome chime. Whenever a new round INSERT comes through realtime,
// the bot plays a slightly longer test tone — proves the realtime → voice
// pipeline is live. Audio is generated on the fly via the bundled
// ffmpeg-static binary (no system ffmpeg needed). Opus encoding uses
// opusscript (pure JS) and packet encryption uses libsodium-wrappers
// (pure WASM) — both avoid native compilation on Windows.
//
// Real song playback (YouTube resolver) lands in Phase 4. Phase 3 just
// proves "bot joins channel, audio comes out, audio reacts to game state".
//
// Run:
//   1. Copy .env.example to .env, fill in DISCORD_BOT_TOKEN +
//      DISCORD_CLIENT_ID + SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
//      (and DISCORD_DEV_GUILD_ID for fast slash-command sync).
//   2. npm install
//   3. npm run dev

import "dotenv/config";
import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  ButtonInteraction,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Events,
  MessageFlags,
} from "discord.js";
import { createClient, RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  StreamType,
  VoiceConnectionStatus,
  AudioPlayerStatus,
  entersState,
  AudioPlayer,
  VoiceConnection,
} from "@discordjs/voice";
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import {
  resolveTrack,
  resolveByVideoId,
  createStreamResource,
  extractVideoId,
  searchSuggestions,
  reportVideo,
  setSupabaseClient,
  type ResolvedTrack,
} from "./resolver.js";
import { startHttpStreamServer } from "./http-stream-server.js";

// ── Env ─────────────────────────────────────────────────────────────────────
const {
  DISCORD_BOT_TOKEN,
  DISCORD_CLIENT_ID,
  DISCORD_DEV_GUILD_ID,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
} = process.env;

function requireEnv(name: string, value: string | undefined): string {
  if (!value) {
    console.error(`[musix-bot] Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

const BOT_TOKEN     = requireEnv("DISCORD_BOT_TOKEN", DISCORD_BOT_TOKEN);
const CLIENT_ID     = requireEnv("DISCORD_CLIENT_ID", DISCORD_CLIENT_ID);
const SB_URL        = requireEnv("SUPABASE_URL", SUPABASE_URL);
const SB_SERVICE    = requireEnv("SUPABASE_SERVICE_ROLE_KEY", SUPABASE_SERVICE_ROLE_KEY);

// Welcome video played once when /musix join lands the bot in voice.
// User-picked clip; change here to swap.
const BOT_WELCOME_VIDEO_ID = "SuOP90FMEuc";

// AFK disconnect threshold — if the audio player sits Idle (no song,
// not paused) for this long we leave the voice channel. Paused state
// doesn't count as AFK because someone explicitly pressed pause.
const AFK_TIMEOUT_MS = 3 * 60 * 1000;

if (!ffmpegPath) {
  console.warn("[musix-bot] ffmpeg-static didn't resolve a binary path — voice playback won't work.");
}

// ── Supabase ────────────────────────────────────────────────────────────────
const supabase: SupabaseClient = createClient(SB_URL, SB_SERVICE, {
  auth:     { persistSession: false, autoRefreshToken: false },
  realtime: { params: { eventsPerSecond: 10 } },
});
// Give the resolver access to Supabase so the YouTube-report flow can
// read/write tl_youtube_reports without env-wiring of its own.
setSupabaseClient(supabase);

// Shape we read off tl_rooms for validation. Only the fields we use.
interface TlRoomLite {
  id:              string;
  status:          "lobby" | "playing" | "finished";
  current_round_id: number | null;
  settings: {
    audioMode?: "browser" | "discord-bot";
  } | null;
}

async function fetchRoom(roomId: string): Promise<TlRoomLite | null> {
  const { data, error } = await supabase
    .from("tl_rooms")
    .select("id, status, current_round_id, settings")
    .eq("id", roomId)
    .single();
  if (error) {
    console.warn(`[musix-bot] fetchRoom(${roomId}) error:`, error.message);
    return null;
  }
  return data as TlRoomLite;
}

// Used when the bot joins mid-game: fetches the active round so we can
// start playing it immediately instead of waiting for the next INSERT
// (which won't fire until the captain advances).
async function fetchRoundById(roundId: number): Promise<BotRound | null> {
  const { data, error } = await supabase
    .from("tl_rounds")
    .select("id, team_id, outcome, track, song_limit_seconds, force_locked, bot_video_id, video_report_approved, redo_requested_at")
    .eq("id", roundId)
    .single();
  if (error) {
    console.warn(`[musix-bot] fetchRoundById(${roundId}) error:`, error.message);
    return null;
  }
  return data as BotRound;
}

// ── Audio: synthesised test tones ───────────────────────────────────────────
// Generates a sine-wave PCM stream through ffmpeg, hands it to the audio
// player as a raw 48 kHz / 16-bit / stereo resource (Discord's native voice
// format). Phase 4 swaps this for play-dl's YouTube stream.
function playTestTone(player: AudioPlayer, frequencyHz: number, durationSec: number, label: string) {
  if (!ffmpegPath) {
    console.warn(`[voice] cannot play ${label}: ffmpeg-static binary missing`);
    return;
  }
  const ff = spawn(ffmpegPath as string, [
    "-loglevel", "error",
    "-f", "lavfi",
    "-i", `sine=frequency=${frequencyHz}:duration=${durationSec}`,
    "-f", "s16le",
    "-ar", "48000",
    "-ac", "2",
    "pipe:1",
  ], { stdio: ["ignore", "pipe", "ignore"] });
  ff.on("error", (err) => console.warn(`[voice] ffmpeg ${label} failed:`, err));
  const resource = createAudioResource(ff.stdout, { inputType: StreamType.Raw });
  player.play(resource);
  console.log(`[voice] playing ${label} (${frequencyHz} Hz, ${durationSec}s)`);
}

// ── Sessions + queues ──────────────────────────────────────────────────────
// One session per guild — represents the live voice connection. A session
// is in one of two modes: "music" (queue-driven, via /musix play) or "game"
// (round-driven, via /musix join). Switching modes tears down the session
// but the queue lives separately in `queues` so it survives the switch.

type SessionMode = "music" | "game";

interface Session {
  mode:             SessionMode;
  roomId:           string | null;        // set in game mode; null in music
  guildId:          string;
  voiceChannelId:   string;
  invitedByUserId:  string;
  startedAt:        number;
  realtime:         RealtimeChannel | null;
  voice:            VoiceConnection;
  player:           AudioPlayer;
  // Game-mode state (unused in music mode).
  currentRoundId:           number | null;
  currentRoundTeamId:       number | null;
  currentRoundDurationSec:  number;
  currentVideoId:           string | null; // for Restart / +30s re-spawn
  currentTrackId:           string | null; // Spotify id — passed to reportVideo() so we invalidate the right cache entry
  currentSongLimitSeconds:  number | null;
  // Deduplication for the host-approved video report and the redo-round
  // signal. tl_rounds UPDATE events repeat for unrelated field changes
  // (outcome flips, judging, etc.), so we only react once per fresh signal.
  reportedVideoFor:         string | null; // video_id of the last bot-reported video
  lastRedoRequestedAt:      string | null;
  songLimitTimer:           NodeJS.Timeout | null;
  // Playback timing (game-mode round) — shape matches QueueState so
  // computeElapsedMs + renderProgressBar can be reused.
  playStartedAt:       number;
  pauseStartedAt:      number | null;
  pausedAccumulatedMs: number;
  // Game-mode message — one per TURN. Posted on the turn's first round
  // INSERT, edited in place as more rounds happen, finalized into a
  // summary when the turn passes (active_team_id flips).
  notificationChannelId: string | null;
  currentMessage:        { channelId: string; messageId: string } | null;
  progressTimer:         NodeJS.Timeout | null;
  // Per-turn tracking — drives the public per-turn message that
  // accumulates as the active team plays through their streak and
  // gets finalized when the turn passes.
  currentTurnTeamId:        number | null;
  currentTurnHistory:       TurnHistoryEntry[];
  scoresAtTurnStart:        Map<number, number>; // teamId → score+pending at turn start
  // AFK disconnect — armed when the player goes Idle (nothing playing,
  // not paused), cleared when audio starts again. If it ever fires we
  // teardown the session and leave the voice channel.
  afkTimer:                 NodeJS.Timeout | null;
}

interface TurnHistoryEntry {
  roundId:     number;
  trackName:   string;
  trackArtist: string;
  outcome:     "correct" | "incorrect" | null;
  forceLocked: boolean;
}

const sessions = new Map<string, Session>(); // key: guildId

interface QueueItem {
  videoId:     string;
  title:       string;       // full display label; may already include "Artist - Title"
  durationSec: number;
  requestedBy: string;       // Discord user tag, for "added by X" UX
}

interface QueueState {
  upcoming:               QueueItem[];   // FIFO; queue[0] is next to play
  current:                QueueItem | null;
  notificationChannelId:  string | null; // where to post auto-advance messages
  currentMessage:         { channelId: string; messageId: string } | null;
  // Playback timing — used by the progress bar. Reset on each advance.
  playStartedAt:          number;        // ms epoch; 0 means "no song"
  pauseStartedAt:         number | null; // ms epoch of current pause; null if playing
  pausedAccumulatedMs:    number;        // sum of completed pauses for current song
  progressTimer:          NodeJS.Timeout | null;
}

const queues = new Map<string, QueueState>(); // key: guildId

function getOrCreateQueue(guildId: string): QueueState {
  let q = queues.get(guildId);
  if (!q) {
    q = {
      upcoming:               [],
      current:                null,
      notificationChannelId:  null,
      currentMessage:         null,
      playStartedAt:          0,
      pauseStartedAt:         null,
      pausedAccumulatedMs:    0,
      progressTimer:          null,
    };
    queues.set(guildId, q);
  }
  return q;
}

interface TimingState {
  playStartedAt:       number;
  pauseStartedAt:      number | null;
  pausedAccumulatedMs: number;
}
function computeElapsedMs(t: TimingState): number {
  if (!t.playStartedAt) return 0;
  const now = Date.now();
  const pausedNow = t.pauseStartedAt ? now - t.pauseStartedAt : 0;
  return Math.max(0, now - t.playStartedAt - t.pausedAccumulatedMs - pausedNow);
}

function renderProgressBar(elapsedSec: number, totalSec: number, width = 20): string {
  if (totalSec < 1) return `\`[${"░".repeat(width)}]\` ${fmtSec(elapsedSec)} / ?:??`;
  const ratio  = Math.min(Math.max(elapsedSec / totalSec, 0), 1);
  const filled = Math.round(ratio * width);
  return `\`[${"█".repeat(filled)}${"░".repeat(width - filled)}]\` ${fmtSec(elapsedSec)} / ${fmtSec(totalSec)}`;
}

// Builds the full Now-Playing message payload (content + components) at the
// current point in time. Used both when starting a song and on each
// progress tick.
function buildNowPlayingMessage(q: QueueState, item: QueueItem): {
  content:    string;
  components: ActionRowBuilder<ButtonBuilder>[];
} {
  const elapsedSec = Math.floor(computeElapsedMs(q) / 1000);
  const paused     = q.pauseStartedAt !== null;
  const indicator  = paused ? "⏸" : "🎵";
  return {
    content:
      `**${indicator} Now playing — ${item.title}** · requested by ${item.requestedBy}\n` +
      renderProgressBar(elapsedSec, item.durationSec),
    components: [buildPlayerButtons({ paused, hasUpcoming: q.upcoming.length > 0 })],
  };
}

// Build the control row that hangs under every "Now Playing" message.
// `paused` flips Pause↔Resume; `hasUpcoming` greys out Skip when there's
// nothing to skip to (clicking Skip with an empty queue ends playback,
// which is also fine — we just nudge users away from it).
function buildPlayerButtons(state: { paused: boolean; hasUpcoming: boolean }): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(state.paused ? "musix-resume" : "musix-pause")
      .setLabel(state.paused ? "Resume" : "Pause")
      .setEmoji(state.paused ? "▶️" : "⏸️")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("musix-skip")
      .setLabel("Skip")
      .setEmoji("⏭️")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!state.hasUpcoming),
    new ButtonBuilder()
      .setCustomId("musix-stop")
      .setLabel("Stop")
      .setEmoji("⏹️")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("musix-queue")
      .setLabel("Queue")
      .setEmoji("📋")
      .setStyle(ButtonStyle.Secondary),
  );
}

// Edits the previous "Now Playing" message to strip its buttons — used
// when the song advances or stops, so the dead message can't be clicked.
async function disableOldNowPlayingMessage(q: QueueState): Promise<void> {
  const ref = q.currentMessage;
  q.currentMessage = null;
  if (!ref) return;
  try {
    const channel = await client.channels.fetch(ref.channelId);
    if (channel && channel.isSendable() && "messages" in channel) {
      const msg = await channel.messages.fetch(ref.messageId);
      await msg.edit({ components: [] });
    }
  } catch (err) {
    // Message may have been deleted; not worth surfacing.
    console.warn(`[queue] couldn't strip buttons from old now-playing message:`, err);
  }
}

function fmtSec(seconds: number): string {
  if (!seconds || seconds < 1) return "?:??";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

// Edit the live Now-Playing message in place. Called on a 10-second timer
// for progress-bar updates and on every state change (pause/resume).
async function tickNowPlaying(guildId: string): Promise<void> {
  const q = queues.get(guildId);
  if (!q || !q.current || !q.currentMessage) return;
  try {
    const channel = await client.channels.fetch(q.currentMessage.channelId);
    if (!channel || !channel.isSendable() || !("messages" in channel)) return;
    const msg = await channel.messages.fetch(q.currentMessage.messageId);
    await msg.edit(buildNowPlayingMessage(q, q.current));
  } catch (err) {
    // Message may have been deleted; just stop the timer so we don't spam logs.
    console.warn(`[queue] progress edit failed:`, err);
    stopProgressTimer(q);
  }
}

function startProgressTimer(guildId: string): void {
  const q = queues.get(guildId);
  if (!q) return;
  stopProgressTimer(q);
  q.progressTimer = setInterval(() => { void tickNowPlaying(guildId); }, 10_000);
  q.progressTimer.unref?.();
}

function stopProgressTimer(q: QueueState): void {
  if (q.progressTimer) {
    clearInterval(q.progressTimer);
    q.progressTimer = null;
  }
}

// Pops the next item off the queue, resolves a fresh audio stream, and
// starts it. By default posts a "Now playing" message in the queue's
// saved notification channel; `notify:false` skips that for the very
// first song (where the /play slash reply already shows the same info).
// Errors are logged + skip to the following item.
async function advanceQueue(session: Session, opts: { notify?: boolean } = {}): Promise<void> {
  if (session.mode !== "music") return;
  const q = queues.get(session.guildId);
  if (!q) return;

  // Strip buttons from the previous Now-Playing message before posting the
  // new one — otherwise dead messages still look interactive.
  await disableOldNowPlayingMessage(q);

  const next = q.upcoming.shift();
  if (!next) {
    q.current = null;
    console.log(`[queue] queue empty for guild ${session.guildId}`);
    return;
  }
  q.current = next;
  try {
    const resource = await createStreamResource(next.videoId);
    session.player.play(resource);
    q.playStartedAt       = Date.now();
    q.pauseStartedAt      = null;
    q.pausedAccumulatedMs = 0;
    console.log(`[queue] ▶ "${next.title}" (${fmtSec(next.durationSec)})`);
  } catch (err) {
    console.warn(`[queue] failed to play "${next.title}":`, err);
    void advanceQueue(session); // skip and try next
    return;
  }
  if ((opts.notify ?? true) && q.notificationChannelId) {
    try {
      const channel = await client.channels.fetch(q.notificationChannelId);
      if (channel && channel.isSendable()) {
        const sent = await channel.send(buildNowPlayingMessage(q, next));
        q.currentMessage = { channelId: sent.channelId, messageId: sent.id };
      }
    } catch (err) {
      console.warn(`[queue] couldn't post now-playing message:`, err);
    }
  }
  startProgressTimer(session.guildId);
}

// Wires the audio player's Idle event to the queue so that finishing one
// song automatically pulls the next. The Idle event also fires on manual
// stop, which is fine — when /stop clears the queue, advance just finds an
// empty queue and clears `current`. Per-session, removed when the session
// is replaced (the player object goes with it).
function attachQueueAutoAdvance(session: Session) {
  session.player.on(AudioPlayerStatus.Idle, () => {
    const stillSession = sessions.get(session.guildId);
    if (!stillSession || stillSession !== session) return;
    if (stillSession.mode !== "music") return;
    void advanceQueue(stillSession);
  });
}

// ── AFK disconnect ─────────────────────────────────────────────────────────
// If the player sits Idle (not paused, not playing, not buffering) for
// AFK_TIMEOUT_MS we leave the voice channel. Cleanly handles both modes:
// music mode (queue ran out + user walked away) and game mode (no rounds
// being advanced for several minutes).
function armAfkTimer(session: Session) {
  clearAfkTimer(session);
  session.afkTimer = setTimeout(() => {
    const stillSession = sessions.get(session.guildId);
    if (!stillSession || stillSession !== session) return;
    console.log(`[afk] disconnecting idle session: ${describeSession(stillSession)}`);
    void teardownSession(stillSession.guildId);
  }, AFK_TIMEOUT_MS);
  session.afkTimer.unref?.();
}

function clearAfkTimer(session: Session) {
  if (session.afkTimer) {
    clearTimeout(session.afkTimer);
    session.afkTimer = null;
  }
}

function attachAfkDisconnect(session: Session) {
  // Arm when idle, disarm whenever audio is moving (Playing) or about to
  // (Buffering). Paused state is deliberately ignored — the user pressed
  // pause, that's intentional.
  session.player.on(AudioPlayerStatus.Idle, () => {
    const stillSession = sessions.get(session.guildId);
    if (!stillSession || stillSession !== session) return;
    armAfkTimer(stillSession);
  });
  session.player.on(AudioPlayerStatus.Playing, () => {
    const stillSession = sessions.get(session.guildId);
    if (!stillSession || stillSession !== session) return;
    clearAfkTimer(stillSession);
  });
  session.player.on(AudioPlayerStatus.Buffering, () => {
    const stillSession = sessions.get(session.guildId);
    if (!stillSession || stillSession !== session) return;
    clearAfkTimer(stillSession);
  });
}

function describeSession(s: Session) {
  return `mode=${s.mode} room=${s.roomId ?? "(none)"} guild=${s.guildId} channel=${s.voiceChannelId}`;
}

async function teardownSession(guildId: string): Promise<Session | null> {
  const existing = sessions.get(guildId);
  if (!existing) return null;
  sessions.delete(guildId);
  const q = queues.get(guildId);
  if (q) {
    stopProgressTimer(q);
    await disableOldNowPlayingMessage(q);
  }
  if (existing.songLimitTimer) {
    clearTimeout(existing.songLimitTimer);
    existing.songLimitTimer = null;
  }
  clearAfkTimer(existing);
  stopGameProgressTimer(existing);
  await disableOldGameMessage(existing);
  try { existing.player.stop(true); }   catch (err) { console.warn("[voice] player stop failed:", err); }
  try { existing.voice.destroy();   }   catch (err) { console.warn("[voice] connection destroy failed:", err); }
  if (existing.realtime) {
    await existing.realtime.unsubscribe().catch(err => {
      console.warn(`[musix-bot] unsubscribe failed for ${describeSession(existing)}:`, err);
    });
  }
  return existing;
}

// Before a music session is torn down (because /musix join is switching to
// game mode), put the currently-playing item back at the head of upcoming
// so when /play later resumes, it picks up the same song from the start.
// We don't try to preserve elapsed position — the yt-dlp stream is gone
// either way, so re-starting the song is the honest behaviour.
function preserveMusicQueueBeforeTeardown(guildId: string): void {
  const session = sessions.get(guildId);
  if (!session || session.mode !== "music") return;
  const q = queues.get(guildId);
  if (!q) return;
  if (q.current) {
    q.upcoming.unshift(q.current);
    q.current = null;
  }
  q.playStartedAt       = 0;
  q.pauseStartedAt      = null;
  q.pausedAccumulatedMs = 0;
}

// Joins the user's current voice channel and returns a ready-to-use voice
// connection + audio player. Replies to the interaction with an error (and
// returns null) if the user isn't in a voice channel or the handshake fails.
// Used by both /musix join (with realtime subscription added on top) and
// /musix test (without).
async function setupVoiceConnection(
  ix: ChatInputCommandInteraction,
): Promise<{ voice: VoiceConnection; player: AudioPlayer; voiceChannelId: string } | null> {
  if (!ix.guildId || !ix.guild) {
    await ix.editReply("This command only works in a server.");
    return null;
  }
  const member = ix.guild.members.cache.get(ix.user.id)
    ?? (await ix.guild.members.fetch(ix.user.id).catch(() => null));
  const voiceChannelId = member?.voice?.channelId ?? null;
  if (!voiceChannelId) {
    await ix.editReply("Join a voice channel first, then try again.");
    return null;
  }

  let voice: VoiceConnection;
  try {
    voice = joinVoiceChannel({
      channelId:      voiceChannelId,
      guildId:        ix.guildId,
      adapterCreator: ix.guild.voiceAdapterCreator,
      selfDeaf:       true,
      selfMute:       false,
    });
    voice.on("error", (err) => console.warn(`[voice/error]`, err));
    const hookedNetworkings = new WeakSet<object>();
    voice.on("stateChange", (oldState, newState) => {
      console.log(`[voice] state: ${oldState.status} → ${newState.status}`);
      const net = (newState as { networking?: { on: (e: string, fn: (...args: unknown[]) => void) => void } }).networking;
      if (net && !hookedNetworkings.has(net)) {
        hookedNetworkings.add(net);
        net.on("close", (code) => console.log(`[voice/close] networking closed code=${code}`));
      }
    });
    await entersState(voice, VoiceConnectionStatus.Ready, 20_000);
  } catch (err) {
    const lastState = voice! ? voice.state.status : "(no connection)";
    console.error(`[musix-bot] voice connection failed (last state: ${lastState}):`, err);
    try { (voice!).destroy(); } catch { /* may not exist */ }
    await ix.editReply(
      "Couldn't connect to the voice channel. Make sure the bot has **Connect** + **Speak** " +
      "permissions on that channel, then try again.",
    );
    return null;
  }

  const player = createAudioPlayer();
  // Catch stream errors (bad codec, network drop, YouTube auth failure)
  // before they propagate as unhandled 'error' events and crash the process.
  // We log + continue — the next /test or round will create a fresh resource.
  player.on("error", (err) => console.warn(`[player/error] ${err.message}`));
  voice.subscribe(player);
  voice.on(VoiceConnectionStatus.Disconnected, () =>
    console.log(`[voice] disconnected from guild ${ix.guildId}`));
  voice.on(VoiceConnectionStatus.Destroyed, () =>
    console.log(`[voice] destroyed for guild ${ix.guildId}`));

  return { voice, player, voiceChannelId };
}

// Subset of timelinedrop's SpotifyTrack we actually need — see
// apps/timelinedrop/src/lib/types.ts for the full shape. Bot only needs id
// (cache key), name (search query), artist (search query).
interface BotSpotifyTrack {
  id:     string;
  name:   string;
  artist: string;
}

interface BotRound {
  id?:                     number;
  team_id?:                number;
  outcome?:                string | null;
  track?:                  BotSpotifyTrack | null;
  song_limit_seconds?:     number | null;
  force_locked?:           boolean;
  bot_video_id?:           string | null;
  video_report_approved?:  boolean;
  redo_requested_at?:      string | null; // ISO timestamp
}

interface BotRoom {
  playing_since?:    number | null;
  paused_at_ms?:     number | null;
  current_round_id?: number | null;
  status?:           string;
}

interface RealtimeCallbacks {
  onRoundInsert:   (round: BotRound) => void;
  onRoundUpdate?:  (round: BotRound) => void;
  onRoomUpdate?:   (room: BotRoom) => void;
}

function startRealtimeForRoom(roomId: string, cb: RealtimeCallbacks): RealtimeChannel {
  const channel = supabase
    .channel(`bot-room:${roomId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "tl_rooms",  filter: `id=eq.${roomId}` },
      (payload) => {
        const n = payload.new as BotRoom | null;
        console.log(`[realtime] room ${roomId} ${payload.eventType}`, {
          status:           n?.status,
          current_round_id: n?.current_round_id,
          playing_since:    n?.playing_since,
          paused_at_ms:     n?.paused_at_ms,
        });
        if (payload.eventType === "UPDATE" && n && cb.onRoomUpdate) {
          cb.onRoomUpdate(n);
        }
      })
    .on("postgres_changes", { event: "*", schema: "public", table: "tl_rounds", filter: `room_id=eq.${roomId}` },
      (payload) => {
        const n = payload.new as BotRound | null;
        console.log(`[realtime] round ${n?.id ?? "?"} ${payload.eventType} (room ${roomId})`, {
          outcome: n?.outcome,
          track:   n?.track ? `${n.track.artist} — ${n.track.name}` : undefined,
          limit:   n?.song_limit_seconds,
        });
        if (!n) return;
        if (payload.eventType === "INSERT")      cb.onRoundInsert(n);
        else if (payload.eventType === "UPDATE" && cb.onRoundUpdate) cb.onRoundUpdate(n);
      })
    .subscribe((status) => {
      console.log(`[realtime] room ${roomId} subscription → ${status}`);
    });
  return channel;
}

// Mirror room.playing_since into the bot's audio player. Anywhere can flip
// it — the React host UI, this same bot when the Song Limiter fires, a
// future remote control — and the bot follows along. Idempotent: if the
// player is already in the desired state, this is a no-op. Also tracks
// pause-elapsed timing so the game-mode progress bar pauses cleanly.
function syncPauseFromRoom(session: Session, room: BotRoom) {
  const wantsPlaying = room.playing_since !== null && room.playing_since !== undefined;
  const status = session.player.state.status;
  if (wantsPlaying && status === AudioPlayerStatus.Paused) {
    if (session.pauseStartedAt !== null) {
      session.pausedAccumulatedMs += Date.now() - session.pauseStartedAt;
      session.pauseStartedAt = null;
    }
    session.player.unpause();
    console.log(`[round] resumed via room.playing_since=${room.playing_since}`);
    void tickGameNowPlaying(session);
  } else if (!wantsPlaying && status === AudioPlayerStatus.Playing) {
    session.pauseStartedAt = Date.now();
    session.player.pause();
    console.log(`[round] paused via room.playing_since=null`);
    void tickGameNowPlaying(session);
  }
}

// ── Game-mode display ───────────────────────────────────────────────────────
// Posts and refreshes a public "Now playing" message in the channel where
// /musix join was invoked. By design this NEVER shows song name/artist —
// musix is a guess-the-song game and revealing the track would defeat it.
// What it does show: round duration, whose turn it is, all-team scores,
// and a progress bar that ticks every 10 seconds.

interface GameTeam {
  id:        number;
  name:      string;
  sortOrder: number;   // 0-indexed; drives team color
  score:     number;   // cards locked into the timeline
  pending:   number;   // cards earned this turn but not yet locked
}

interface GameSnapshot {
  teams:           GameTeam[];
  currentTeamId:   number | null;
  currentTeamName: string | null;
  currentTeam:     GameTeam | null;
}

// User-defined color palette indexed by sort_order. "team 1 = red, team 2
// = blue" is the user's convention; the rest are sensible defaults.
const TEAM_COLOR_EMOJI = ["🔴", "🔵", "🟢", "🟡", "🟣", "🟠", "⚪", "⚫"];
function teamColor(sortOrder: number): string {
  return TEAM_COLOR_EMOJI[sortOrder] ?? "⭐";
}

async function fetchGameSnapshot(roomId: string, currentTeamId: number | null): Promise<GameSnapshot> {
  const [teamsRes, timelineRes] = await Promise.all([
    supabase.from("tl_teams").select("id, name, sort_order, pending_tracks").eq("room_id", roomId).order("sort_order"),
    supabase.from("tl_timeline").select("team_id").eq("room_id", roomId),
  ]);
  const teamRows = (teamsRes.data ?? []) as {
    id: number; name: string; sort_order: number; pending_tracks?: unknown[] | null;
  }[];
  const timelineRows = (timelineRes.data ?? []) as { team_id: number }[];
  const counts = new Map<number, number>();
  for (const row of timelineRows) {
    counts.set(row.team_id, (counts.get(row.team_id) ?? 0) + 1);
  }
  const teams: GameTeam[] = teamRows.map(t => ({
    id:        t.id,
    name:      t.name,
    sortOrder: t.sort_order,
    score:     counts.get(t.id) ?? 0,
    pending:   Array.isArray(t.pending_tracks) ? t.pending_tracks.length : 0,
  }));
  const currentTeam = currentTeamId != null
    ? (teams.find(t => t.id === currentTeamId) ?? null)
    : null;
  return { teams, currentTeamId, currentTeamName: currentTeam?.name ?? null, currentTeam };
}

function buildGameModeButtons(session: Session): ActionRowBuilder<ButtonBuilder>[] {
  if (!session.currentVideoId) return [];
  // "Wrong song / bad version" used to live here as a Discord button, but
  // moved to the musix in-game UI (mirrors the year-correction propose/
  // approve/redo flow). Bot now reacts to tl_rounds updates from that
  // flow — see handleVideoReportApprovedTransition + handleRedoRequestedTransition.
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("musix-game-restart")
        .setLabel("Restart")
        .setEmoji("⏮")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("musix-game-skip30")
        .setLabel("+30s")
        .setEmoji("⏩")
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

function renderScoreboard(session: Session, snapshot: GameSnapshot, opts: { showDelta: boolean }): string {
  const ranked = [...snapshot.teams]
    .map((t, idx) => ({ ...t, _origIdx: idx, total: t.score + t.pending }))
    .sort((a, b) => b.total - a.total || a._origIdx - b._origIdx);
  return ranked
    .map(t => {
      const c = teamColor(t.sortOrder);
      // Delta against the score we snapshot at this turn's start. Shows
      // both gains (correct guesses) and losses (Card Remover etc.).
      const baseline = session.scoresAtTurnStart.get(t.id) ?? t.total;
      const delta    = t.total - baseline;
      const deltaTag = opts.showDelta && delta !== 0
        ? `  *(${delta > 0 ? "+" : ""}${delta})*`
        : "";
      return `${c} ${t.name} — **${t.total}**${deltaTag}`;
    })
    .join("\n");
}

function renderSongsThisTurn(history: TurnHistoryEntry[]): string {
  if (history.length === 0) return "";
  return history.map((h, i) => {
    let mark = "▶";
    if (h.outcome === "correct")   mark = "✓";
    else if (h.outcome === "incorrect") mark = "✗";
    else if (h.forceLocked)         mark = "🔒";
    return `${i + 1}. ${h.trackName} — ${h.trackArtist} ${mark}`;
  }).join("\n");
}

// "Active" message — shown while the team is mid-turn. Lists previously
// finished songs in this turn (with reveal), the current playback
// progress bar, and the scoreboard with deltas.
function buildActiveTurnMessage(session: Session, snapshot: GameSnapshot): {
  content:    string;
  components: ActionRowBuilder<ButtonBuilder>[];
} {
  const current = snapshot.currentTeam;
  const color   = current ? teamColor(current.sortOrder) : "🎯";
  const teamName = current?.name ?? "Unknown team";
  const paused     = session.pauseStartedAt !== null;
  const elapsedSec = Math.floor(computeElapsedMs(session) / 1000);
  const totalSec   = session.currentRoundDurationSec;
  const indicator  = paused ? "⏸" : "🎵";
  const bar        = renderProgressBar(elapsedSec, totalSec);

  const lines: string[] = [`${color} **${teamName}'s turn**`];
  // Only show finished songs — i.e. ones that already have an outcome.
  // The currently-playing song stays hidden (musix is a guess game).
  const finishedSongs = session.currentTurnHistory.filter(h => h.outcome !== null);
  if (finishedSongs.length > 0) {
    lines.push("");
    lines.push("🎶 **Songs this turn:**");
    lines.push(renderSongsThisTurn(finishedSongs));
  }
  lines.push("");
  lines.push(`${indicator} **Now playing** · ${fmtSec(totalSec)}`);
  lines.push(bar);
  lines.push("");
  lines.push("🏆 **Scoreboard:**");
  lines.push(renderScoreboard(session, snapshot, { showDelta: true }));

  return { content: lines.join("\n"), components: buildGameModeButtons(session) };
}

// "Finalized" message — replaces the active message when the turn ends
// (active_team_id flips, or game finishes). All songs revealed; controls
// stripped; end-reason called out.
function buildFinalizedTurnMessage(
  session: Session,
  snapshot: GameSnapshot,
  team:    GameTeam | null,
  endReason: "wrong" | "force-lock" | "voluntary" | "game-over",
): { content: string; components: ActionRowBuilder<ButtonBuilder>[] } {
  const color = team ? teamColor(team.sortOrder) : "⭐";
  const teamName = team?.name ?? "Team";
  const history = session.currentTurnHistory;
  const correct = history.filter(h => h.outcome === "correct").length;
  const baseline = team ? (session.scoresAtTurnStart.get(team.id) ?? team.score + team.pending) : 0;
  const finalScore = team ? team.score + team.pending : 0;
  const earned = finalScore - baseline;

  const endLabel = endReason === "wrong"      ? `✗ Ended on a wrong answer`
                 : endReason === "force-lock" ? `🔒 Ended by Force Lock token`
                 : endReason === "game-over"  ? `🏁 Game over`
                 :                              `🛑 Turn ended voluntarily`;

  const lines: string[] = [
    `${color} **${teamName}'s turn — finished**`,
    "",
    `🎯 **+${earned >= 0 ? earned : 0} card${earned === 1 ? "" : "s"}** earned this turn (${correct}/${history.length} correct)`,
    endLabel,
  ];
  if (history.length > 0) {
    lines.push("");
    lines.push("🎶 **Songs played:**");
    lines.push(renderSongsThisTurn(history));
  }
  lines.push("");
  lines.push("🏆 **Scoreboard:**");
  lines.push(renderScoreboard(session, snapshot, { showDelta: false }));

  // Controls stripped on finalize — old message becomes archival.
  return { content: lines.join("\n"), components: [] };
}

// Re-streams the current round's song from a given offset. Used by the
// Restart (seek=0) and +30s buttons. yt-dlp does the actual seek via its
// --download-sections flag; the bot just patches its timing state so the
// progress bar shows the new position and re-arms the Song Limiter.
async function seekGameRound(session: Session, seekSec: number): Promise<void> {
  if (!session.currentVideoId) return;
  const total = session.currentRoundDurationSec;
  // Clamp to a sensible range.
  if (total > 0) seekSec = Math.min(Math.max(seekSec, 0), Math.max(0, total - 2));
  else           seekSec = Math.max(seekSec, 0);

  try {
    const resource = await createStreamResource(session.currentVideoId, { seekSec });
    session.player.play(resource);
    session.playStartedAt       = Date.now() - seekSec * 1000;
    session.pauseStartedAt      = null;
    session.pausedAccumulatedMs = 0;
    console.log(`[round] ⏯ seek to ${seekSec}s for round ${session.currentRoundId}`);
  } catch (err) {
    console.warn(`[round] seek to ${seekSec}s failed:`, err);
    return;
  }
  if (session.roomId) {
    try {
      await supabase
        .from("tl_rooms")
        .update({ playing_since: session.playStartedAt, paused_at_ms: null })
        .eq("id", session.roomId);
    } catch (err) {
      console.warn(`[round] couldn't update DB on seek:`, err);
    }
  }
  // Re-arm the Song Limiter based on the new elapsed time. If the seek
  // landed past the limit, fireSongLimitPause runs immediately.
  maybeScheduleSongLimit(session, session.currentSongLimitSeconds);
  void tickGameNowPlaying(session);
}

// Refresh the game-mode Now-Playing message in place. Called by the 10s
// tick, by round-update events, and by pause/resume sync.
async function tickGameNowPlaying(session: Session): Promise<void> {
  if (session.mode !== "game") return;
  if (!session.roomId || !session.currentMessage) return;
  try {
    const snapshot = await fetchGameSnapshot(session.roomId, session.currentRoundTeamId);
    const channel  = await client.channels.fetch(session.currentMessage.channelId);
    if (!channel || !channel.isSendable() || !("messages" in channel)) return;
    const msg = await channel.messages.fetch(session.currentMessage.messageId);
    await msg.edit(buildActiveTurnMessage(session, snapshot));
  } catch (err) {
    console.warn(`[round] game now-playing edit failed:`, err);
    stopGameProgressTimer(session);
  }
}

function startGameProgressTimer(session: Session): void {
  stopGameProgressTimer(session);
  session.progressTimer = setInterval(() => { void tickGameNowPlaying(session); }, 10_000);
  session.progressTimer.unref?.();
}

function stopGameProgressTimer(session: Session): void {
  if (session.progressTimer) {
    clearInterval(session.progressTimer);
    session.progressTimer = null;
  }
}

async function disableOldGameMessage(session: Session): Promise<void> {
  const ref = session.currentMessage;
  session.currentMessage = null;
  if (!ref) return;
  try {
    const channel = await client.channels.fetch(ref.channelId);
    if (channel && channel.isSendable() && "messages" in channel) {
      const msg = await channel.messages.fetch(ref.messageId);
      await msg.edit({ components: [] });
    }
  } catch {
    // Message may have been deleted; nothing to clean up.
  }
}

function clearSongLimitTimer(session: Session) {
  if (session.songLimitTimer) {
    clearTimeout(session.songLimitTimer);
    session.songLimitTimer = null;
  }
}

// Schedules the Song Limiter token pause. Recomputes from now whenever
// song_limit_seconds changes (token can activate mid-round), so a longer
// timer replaces a shorter one and vice versa. If the limit is already
// past, fires immediately.
function maybeScheduleSongLimit(session: Session, songLimitSeconds: number | null | undefined) {
  clearSongLimitTimer(session);
  if (!songLimitSeconds || songLimitSeconds <= 0) return;
  if (!session.playStartedAt) return;
  const elapsedMs   = Date.now() - session.playStartedAt;
  const remainingMs = (songLimitSeconds * 1000) - elapsedMs;
  if (remainingMs <= 0) {
    void fireSongLimitPause(session, songLimitSeconds);
  } else {
    session.songLimitTimer = setTimeout(
      () => void fireSongLimitPause(session, songLimitSeconds),
      remainingMs,
    );
    session.songLimitTimer.unref?.();
    console.log(`[round] song-limit timer armed: ${songLimitSeconds}s total, pausing in ${Math.round(remainingMs / 1000)}s`);
  }
}

async function fireSongLimitPause(session: Session, limitSeconds: number) {
  session.songLimitTimer = null;
  console.log(`[round] ⏱ song-limit reached (${limitSeconds}s) for round ${session.currentRoundId}`);
  if (session.player.state.status === AudioPlayerStatus.Playing) {
    session.player.pause();
    session.pauseStartedAt = Date.now();
  }
  if (session.roomId) {
    try {
      await supabase
        .from("tl_rooms")
        .update({ playing_since: null, paused_at_ms: limitSeconds * 1000 })
        .eq("id", session.roomId);
    } catch (err) {
      console.warn(`[round] couldn't update DB on song-limit pause:`, err);
    }
  }
  void tickGameNowPlaying(session);
}

// Host approved a "wrong song / bad video" report → increment the global
// blacklist counter for the bot's chosen video and invalidate the
// per-track resolution cache so the next round resolves fresh.
// Deduped against session.reportedVideoFor so repeated round-UPDATE
// events for unrelated fields don't double-report.
async function handleVideoReportApprovedTransition(session: Session, round: BotRound): Promise<void> {
  if (!round.video_report_approved) return;
  const videoId = round.bot_video_id ?? session.currentVideoId;
  if (!videoId) return;
  if (session.reportedVideoFor === videoId) return;
  session.reportedVideoFor = videoId;
  const result = await reportVideo(videoId, session.currentTrackId ?? undefined);
  console.log(`[round] approved report for ${videoId}: count=${result.totalReports} blacklisted=${result.blacklisted}`);
}

// Host clicked "Redo round" → server reset round state + stamped
// redo_requested_at. Re-resolve the track (cache is now invalidated by
// the report path above) and play the next-best YouTube match. Deduped
// against session.lastRedoRequestedAt so we re-play exactly once per
// redo, not on every realtime echo.
async function handleRedoRequestedTransition(session: Session, round: BotRound): Promise<void> {
  const stamp = round.redo_requested_at ?? null;
  if (!stamp) return;
  if (stamp === session.lastRedoRequestedAt) return;
  session.lastRedoRequestedAt = stamp;
  console.log(`[round] redo requested for round ${round.id} at ${stamp}`);
  await playRoundTrack(session, round);
}

// Resolves the round's SpotifyTrack to a YouTube video and starts streaming
// it. Replaces whatever was playing before. Also updates room.playing_since
// so React clients see the bot started playback, arms the Song Limiter,
// and posts the public Now-Playing message (which carefully omits the
// song name — that's the whole point of musix).
async function playRoundTrack(session: Session, round: BotRound) {
  if (!round.track) {
    console.warn(`[round] insert without a track on round ${round.id}; skipping`);
    return;
  }
  const { track } = round;
  let resolvedDurationSec = 0;
  try {
    const resolved = await resolveTrack({
      id:      track.id,
      name:    track.name,
      artists: [track.artist],
    });
    if (!resolved) {
      console.warn(`[round] no YouTube match for round ${round.id}`);
      return;
    }
    const resource = await createStreamResource(resolved.videoId);
    session.player.play(resource);
    resolvedDurationSec     = resolved.durationSec;
    session.currentRoundId           = round.id ?? null;
    session.currentRoundTeamId       = round.team_id ?? null;
    session.currentRoundDurationSec  = resolvedDurationSec;
    session.currentVideoId           = resolved.videoId;
    session.currentTrackId           = track.id;
    session.currentSongLimitSeconds  = round.song_limit_seconds ?? null;
    // Each new round = a fresh dedup window for the report/redo signals.
    session.reportedVideoFor    = null;
    session.lastRedoRequestedAt = round.redo_requested_at ?? null;
    session.playStartedAt       = Date.now();
    session.pauseStartedAt      = null;
    session.pausedAccumulatedMs = 0;
    console.log(`[round] ▶ playing round ${round.id} (${resolvedDurationSec}s)`);
  } catch (err) {
    console.warn(`[round] playback failed for round ${round.id}:`, err);
    return;
  }
  // Tell React clients we started playback, and stamp the chosen
  // YouTube video id so the report/redo flow has something to act on.
  if (session.roomId) {
    try {
      await supabase
        .from("tl_rooms")
        .update({ playing_since: session.playStartedAt, paused_at_ms: null })
        .eq("id", session.roomId);
    } catch (err) {
      console.warn(`[round] couldn't update DB on round-start:`, err);
    }
  }
  if (session.currentRoundId != null && session.currentVideoId) {
    try {
      await supabase
        .from("tl_rounds")
        .update({ bot_video_id: session.currentVideoId })
        .eq("id", session.currentRoundId);
    } catch (err) {
      console.warn(`[round] couldn't stamp bot_video_id on round ${session.currentRoundId}:`, err);
    }
  }
  maybeScheduleSongLimit(session, round.song_limit_seconds ?? null);

  // ── Per-turn message orchestration ───────────────────────────────
  // The team_id on this round drives whether we extend the current
  // turn message or finalize it and start a new one.
  const roundTeamId = round.team_id ?? null;
  const isNewTurn   = session.currentTurnTeamId !== roundTeamId;
  const newEntry: TurnHistoryEntry = {
    roundId:     round.id ?? -1,
    trackName:   track.name,
    trackArtist: track.artist,
    outcome:     (round.outcome === "correct" || round.outcome === "incorrect") ? round.outcome : null,
    forceLocked: !!round.force_locked,
  };

  if (isNewTurn) {
    // Finalize the previous turn (if there was one). The end reason is
    // best-effort inferred from the LAST round of the previous turn's
    // history: an incorrect outcome ends a turn; force_locked means
    // the opponent forced the stop; otherwise it was voluntary.
    if (session.currentTurnTeamId !== null && session.currentMessage) {
      const last = session.currentTurnHistory[session.currentTurnHistory.length - 1];
      const endReason: "wrong" | "force-lock" | "voluntary" =
        last?.outcome === "incorrect" ? "wrong"
        : last?.forceLocked           ? "force-lock"
        :                                "voluntary";
      await finalizePreviousTurnMessage(session, session.currentTurnTeamId, endReason);
    }
    // Reset turn state to this new team's turn.
    session.currentTurnTeamId   = roundTeamId;
    session.currentTurnHistory  = [newEntry];
    session.currentMessage      = null;
    // Snapshot starting scores so the per-turn delta is accurate.
    if (session.roomId) {
      try {
        const snap = await fetchGameSnapshot(session.roomId, roundTeamId);
        session.scoresAtTurnStart = new Map(snap.teams.map(t => [t.id, t.score + t.pending]));
      } catch (err) {
        console.warn(`[round] couldn't snapshot scores at turn start:`, err);
      }
    }
    await postNewTurnMessage(session);
  } else {
    // Same turn — just append the new song and update the existing
    // message in place. The previously-playing song's history entry
    // already exists (outcome will be filled in by onRoundUpdate).
    session.currentTurnHistory.push(newEntry);
    void tickGameNowPlaying(session);
  }

  startGameProgressTimer(session);
}

// Strip buttons from the previous round's Now-Playing message (if any),
// fetch a fresh game snapshot, and post the new Now-Playing message.
// Post a fresh per-turn message. Called on turn changes (first round of
// a new team) — NOT on every round insert. Continuing rounds within the
// same turn just edit the existing message via tickGameNowPlaying.
async function postNewTurnMessage(session: Session) {
  if (!session.roomId || !session.notificationChannelId) return;
  try {
    const channel = await client.channels.fetch(session.notificationChannelId);
    if (!channel || !channel.isSendable()) return;
    const snapshot = await fetchGameSnapshot(session.roomId, session.currentRoundTeamId);
    const sent     = await channel.send(buildActiveTurnMessage(session, snapshot));
    session.currentMessage = { channelId: sent.channelId, messageId: sent.id };
  } catch (err) {
    console.warn(`[round] couldn't post new-turn message:`, err);
  }
}

// Edit the previous turn's message into a summary state (strips buttons,
// shows song list with reveals, end-reason). Called when the turn passes
// or the game finishes.
async function finalizePreviousTurnMessage(
  session: Session,
  prevTeamId: number,
  endReason: "wrong" | "force-lock" | "voluntary" | "game-over",
) {
  const ref = session.currentMessage;
  if (!ref || !session.roomId) return;
  try {
    const channel = await client.channels.fetch(ref.channelId);
    if (!channel || !channel.isSendable() || !("messages" in channel)) return;
    const snapshot = await fetchGameSnapshot(session.roomId, prevTeamId);
    const team = snapshot.teams.find(t => t.id === prevTeamId) ?? null;
    const msg = await channel.messages.fetch(ref.messageId);
    await msg.edit(buildFinalizedTurnMessage(session, snapshot, team, endReason));
  } catch (err) {
    console.warn(`[round] couldn't finalize previous-turn message:`, err);
  }
}

// ── Slash commands ──────────────────────────────────────────────────────────
const musixCommand = new SlashCommandBuilder()
  .setName("musix")
  .setDescription("Control the musix Discord bot")
  .addSubcommand(sub =>
    sub
      .setName("join")
      .setDescription("Have the bot follow a musix room and join your voice channel")
      .addStringOption(opt =>
        opt
          .setName("room")
          .setDescription("The 6-character room code from musix.gokkehub.com")
          .setRequired(true)
          .setMinLength(6)
          .setMaxLength(6),
      ),
  )
  .addSubcommand(sub =>
    sub
      .setName("leave")
      .setDescription("Have the bot leave the voice channel and stop following the room"),
  )
  .addSubcommand(sub =>
    sub
      .setName("play")
      .setDescription("Play a song in your voice channel (search query, YouTube URL, or video ID)")
      .addStringOption(opt =>
        opt
          .setName("query")
          .setDescription("Song title, 'artist - title', YouTube URL, or video ID")
          .setRequired(true)
          .setAutocomplete(true)
          .setMinLength(2)
          .setMaxLength(200),
      ),
  )
  .addSubcommand(sub =>
    sub
      .setName("test")
      .setDescription("Alias of /musix play — kept for parity with the Phase 4 verification flow")
      .addStringOption(opt =>
        opt
          .setName("query")
          .setDescription("Song title, 'artist - title', YouTube URL, or video ID")
          .setRequired(true)
          .setAutocomplete(true)
          .setMinLength(2)
          .setMaxLength(200),
      ),
  )
  .toJSON();

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(BOT_TOKEN);
  // Guild-scoped registration syncs instantly — great for dev. Global
  // commands take up to an hour. Switch by unsetting DISCORD_DEV_GUILD_ID.
  if (DISCORD_DEV_GUILD_ID) {
    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, DISCORD_DEV_GUILD_ID),
      { body: [musixCommand] },
    );
    console.log(`[musix-bot] Slash commands registered to guild ${DISCORD_DEV_GUILD_ID} (instant).`);
  } else {
    await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      { body: [musixCommand] },
    );
    console.log("[musix-bot] Slash commands registered globally (propagation up to 1h).");
  }
}

// ── Command handlers ────────────────────────────────────────────────────────
async function handleJoin(ix: ChatInputCommandInteraction) {
  if (!ix.guildId || !ix.guild) {
    await ix.reply({ content: "This command only works in a server.", flags: MessageFlags.Ephemeral });
    return;
  }

  const roomCode = ix.options.getString("room", true).trim().toUpperCase();
  if (roomCode.length !== 6) {
    await ix.reply({ content: "Room code is 6 characters.", flags: MessageFlags.Ephemeral });
    return;
  }
  const room = await fetchRoom(roomCode);
  if (!room) {
    await ix.reply({
      content: `Couldn't find room **${roomCode}**. Make sure you typed the code from your lobby URL.`,
      flags:   MessageFlags.Ephemeral,
    });
    return;
  }
  if (room.settings?.audioMode !== "discord-bot") {
    await ix.reply({
      content: `Room **${roomCode}** isn't in Discord-bot audio mode. Switch the lobby's audio toggle to "🤖 Discord bot" and try again.`,
      flags:   MessageFlags.Ephemeral,
    });
    return;
  }

  // If a music queue is currently playing, snapshot it so the user can
  // resume after the musix game finishes (next /play picks up from the
  // interrupted song).
  preserveMusicQueueBeforeTeardown(ix.guildId);
  const prior = await teardownSession(ix.guildId);
  if (prior) console.log(`[musix-bot] /join replaced prior session: ${describeSession(prior)}`);

  // Defer — voice handshake can take a few seconds; Discord wants a reply
  // within 3s. defer buys us 15 minutes.
  await ix.deferReply();

  const conn = await setupVoiceConnection(ix);
  if (!conn) return;

  // Build the session first so the realtime callbacks below can close over
  // it — they need access to the live session state (current round, song
  // limit timer) for the room-update pause sync and Song Limiter.
  const session: Session = {
    mode:                    "game",
    roomId:                  roomCode,
    guildId:                 ix.guildId,
    voiceChannelId:          conn.voiceChannelId,
    invitedByUserId:         ix.user.id,
    startedAt:               Date.now(),
    realtime:                null,
    voice:                   conn.voice,
    player:                  conn.player,
    currentRoundId:          null,
    currentRoundTeamId:      null,
    currentRoundDurationSec: 0,
    currentVideoId:          null,
    currentTrackId:          null,
    currentSongLimitSeconds: null,
    reportedVideoFor:        null,
    lastRedoRequestedAt:     null,
    currentTurnTeamId:       null,
    currentTurnHistory:      [],
    scoresAtTurnStart:       new Map(),
    afkTimer:                null,
    songLimitTimer:          null,
    playStartedAt:           0,
    pauseStartedAt:          null,
    pausedAccumulatedMs:     0,
    notificationChannelId:   ix.channelId,
    currentMessage:          null,
    progressTimer:           null,
  };

  session.realtime = startRealtimeForRoom(roomCode, {
    onRoundInsert: (round) => { void playRoundTrack(session, round); },
    onRoundUpdate: (round) => {
      // Song Limiter token can change song_limit_seconds mid-round; outcome
      // changes don't drive playback but we refresh the message so the
      // scoreboard stays current.
      if (round.id === session.currentRoundId) {
        session.currentSongLimitSeconds = round.song_limit_seconds ?? null;
        maybeScheduleSongLimit(session, session.currentSongLimitSeconds);
        void handleVideoReportApprovedTransition(session, round);
        void handleRedoRequestedTransition(session, round);
      }
      // Mirror outcome/force_locked changes into the turn history so the
      // active turn message and (later) the finalized summary list the
      // right ✓/✗/🔒 marks beside each song.
      if (round.id != null) {
        const entry = session.currentTurnHistory.find(h => h.roundId === round.id);
        if (entry) {
          if (round.outcome === "correct" || round.outcome === "incorrect") {
            entry.outcome = round.outcome;
          }
          if (round.force_locked != null) {
            entry.forceLocked = !!round.force_locked;
          }
        }
      }
      void tickGameNowPlaying(session);
    },
    onRoomUpdate: (room) => {
      syncPauseFromRoom(session, room);
      // Game finished — finalize the current turn message with a game-over
      // summary so the channel doesn't leave an open scoreboard hanging.
      if (room.status === "finished" && session.currentTurnTeamId !== null && session.currentMessage) {
        const prevTeamId = session.currentTurnTeamId;
        // Mark consumed so we only fire once per status transition.
        session.currentTurnTeamId = null;
        void finalizePreviousTurnMessage(session, prevTeamId, "game-over");
      }
    },
  });

  sessions.set(ix.guildId, session);
  attachAfkDisconnect(session);

  // If the game's already in progress when we join, the round-INSERT
  // realtime event has already fired before we subscribed — schedule the
  // active round to play directly after the welcome video finishes.
  // Otherwise the bot would sit silent until the captain advances.
  const midGameRoundId = (room.status === "playing" && room.current_round_id != null)
    ? room.current_round_id
    : null;
  if (midGameRoundId != null) {
    conn.player.once(AudioPlayerStatus.Idle, () => {
      void (async () => {
        const activeRound = await fetchRoundById(midGameRoundId);
        if (activeRound && activeRound.outcome === null) {
          await playRoundTrack(session, activeRound);
        }
      })();
    });
  }

  // Welcome video — plays once when the bot joins, then yields the player
  // to the round audio (queued above via the Idle listener). If the
  // stream fails, fall back to the synth chime so we at least signal
  // "I'm here" before going silent.
  try {
    const welcomeResource = await createStreamResource(BOT_WELCOME_VIDEO_ID);
    conn.player.play(welcomeResource);
    console.log(`[musix-bot] playing welcome video ${BOT_WELCOME_VIDEO_ID}`);
  } catch (err) {
    console.warn(`[musix-bot] welcome video failed, falling back to chime:`, err);
    playTestTone(conn.player, 660, 0.8, "welcome chime");
  }

  await ix.editReply(
    `🎵 Joined <#${conn.voiceChannelId}> and following room **${roomCode}**. ` +
    `Each new round will play the song in voice automatically.`,
  );
  console.log(`[musix-bot] /join → ${describeSession(session)} by user ${ix.user.tag}`);
}

async function handleLeave(ix: ChatInputCommandInteraction) {
  if (!ix.guildId) {
    await ix.reply({ content: "This command only works in a server.", flags: MessageFlags.Ephemeral });
    return;
  }
  // Same queue-preservation as /musix join — if the bot's mid-song, putting
  // current back on the queue means the next /play picks up from the same
  // song instead of dropping it.
  preserveMusicQueueBeforeTeardown(ix.guildId);
  const cleared = await teardownSession(ix.guildId);
  if (!cleared) {
    await ix.reply({
      content: "I wasn't in a voice channel here. Nothing to leave.",
      flags:   MessageFlags.Ephemeral,
    });
    return;
  }
  const where = cleared.roomId ? `room **${cleared.roomId}**` : "the voice channel";
  await ix.reply(`👋 Left ${where}. ${cleared.mode === "music" ? "Queue saved — `/musix play` to resume." : ""}`.trim());
  console.log(`[musix-bot] /leave → cleared session: ${describeSession(cleared)}`);
}

// Shared core for /musix play and /musix test. Resolves a free-text query,
// a YouTube URL, or a bare 11-char video ID; auto-joins the caller's voice
// channel if no music-mode session is active; appends to the per-guild
// queue and kicks off playback if nothing is playing.
async function handlePlayQuery(ix: ChatInputCommandInteraction, label: "play" | "test") {
  if (!ix.guildId) {
    await ix.reply({ content: "This command only works in a server.", flags: MessageFlags.Ephemeral });
    return;
  }

  const query = ix.options.getString("query", true).trim();
  await ix.deferReply();

  let session: Session | undefined = sessions.get(ix.guildId);
  // If we're currently in a musix game, kick the bot out of game mode so
  // the queue takes over. The game's realtime sub and player stop; the
  // queue (which is per-guild and outlives sessions) carries on as soon as
  // the new music session is wired up below.
  if (session && session.mode === "game") {
    console.log(`[musix-bot] /${label} ejecting game session: ${describeSession(session)}`);
    await teardownSession(ix.guildId);
    session = undefined;
  }
  if (!session) {
    const conn = await setupVoiceConnection(ix);
    if (!conn) return;
    const fresh: Session = {
      mode:                    "music",
      roomId:                  null,
      guildId:                 ix.guildId,
      voiceChannelId:          conn.voiceChannelId,
      invitedByUserId:         ix.user.id,
      startedAt:               Date.now(),
      realtime:                null,
      voice:                   conn.voice,
      player:                  conn.player,
      currentRoundId:          null,
      currentRoundTeamId:      null,
      currentRoundDurationSec: 0,
      currentVideoId:          null,
      currentTrackId:          null,
      currentSongLimitSeconds: null,
      reportedVideoFor:        null,
      lastRedoRequestedAt:     null,
      currentTurnTeamId:       null,
      currentTurnHistory:      [],
      scoresAtTurnStart:       new Map(),
      afkTimer:                null,
      songLimitTimer:          null,
      playStartedAt:           0,
      pauseStartedAt:          null,
      pausedAccumulatedMs:     0,
      notificationChannelId:   null,
      currentMessage:          null,
      progressTimer:           null,
    };
    sessions.set(ix.guildId, fresh);
    attachQueueAutoAdvance(fresh);
    attachAfkDisconnect(fresh);
    session = fresh;
    console.log(`[musix-bot] /${label} created music session: ${describeSession(session)}`);
  }

  // Resolve the query into a QueueItem. URL/ID skips search and goes
  // straight to getBasicInfo; free text goes through search.
  const directId = extractVideoId(query);
  let resolved: ResolvedTrack | null;
  if (directId) {
    resolved = await resolveByVideoId(directId);
    if (!resolved) {
      await ix.editReply(`Couldn't load video metadata for **${directId}** — is the ID valid?`);
      return;
    }
  } else {
    resolved = await resolveTrack({ id: `${label}-${Date.now()}`, name: query, artists: [] });
    if (!resolved) {
      await ix.editReply(`Couldn't find a YouTube result for **${query}**.`);
      return;
    }
  }

  const item: QueueItem = {
    videoId:     resolved.videoId,
    title:       resolved.videoTitle,
    durationSec: resolved.durationSec,
    requestedBy: ix.user.username,
  };

  const queue = getOrCreateQueue(ix.guildId);
  if (ix.channelId) queue.notificationChannelId = ix.channelId;
  queue.upcoming.push(item);

  // If nothing is currently playing, advance immediately — that pops the
  // item we just queued (or the head of a preserved queue) into current.
  const idle = session.player.state.status === AudioPlayerStatus.Idle;
  const noCurrent = queue.current === null;
  if (idle && noCurrent) {
    // Either this song plays immediately (fresh queue) or a preserved
    // queue does and this song waits at the end. advanceQueue handles
    // playback + posting the Now-Playing message in both cases; the slash
    // reply is a brief acknowledgement.
    const willPlay = queue.upcoming[0]!;
    if (willPlay === item) {
      await ix.editReply(`▶ Starting playback — **${item.title}** (${fmtSec(item.durationSec)}).`);
    } else {
      await ix.editReply(
        `➕ Queued **${item.title}** at #${queue.upcoming.length}. ` +
        `Resuming queue from **${willPlay.title}**.`,
      );
    }
    void advanceQueue(session); // default notify:true → channel.send
  } else {
    const position = queue.upcoming.length;
    await ix.editReply(`➕ Queued **${item.title}** (${fmtSec(item.durationSec)}) at position #${position}.`);
  }
  console.log(`[musix-bot] /${label} → queued "${item.title}" (queue=${queue.upcoming.length}, current=${queue.current?.title ?? "(none)"})`);
}

async function handleButton(ix: ButtonInteraction) {
  if (!ix.customId.startsWith("musix-")) return;
  if (!ix.guildId) return;
  const session = sessions.get(ix.guildId);
  if (!session) {
    await ix.reply({ content: "No bot session active in this server.", flags: MessageFlags.Ephemeral });
    return;
  }

  // Game-mode buttons (musix-game-*) route separately.
  if (ix.customId.startsWith("musix-game-")) {
    if (session.mode !== "game") {
      await ix.reply({ content: "Game-mode controls only apply during a musix room.", flags: MessageFlags.Ephemeral });
      return;
    }
    if (!session.currentVideoId) {
      await ix.reply({ content: "No round is currently playing.", flags: MessageFlags.Ephemeral });
      return;
    }
    await ix.deferUpdate();
    if (ix.customId === "musix-game-restart") {
      await seekGameRound(session, 0);
    } else if (ix.customId === "musix-game-skip30") {
      const currentElapsedSec = Math.floor(computeElapsedMs(session) / 1000);
      await seekGameRound(session, currentElapsedSec + 30);
    }
    return;
  }

  const queue = queues.get(ix.guildId);
  if (session.mode !== "music" || !queue) {
    await ix.reply({ content: "No music session active in this server.", flags: MessageFlags.Ephemeral });
    return;
  }

  switch (ix.customId) {
    case "musix-pause": {
      session.player.pause();
      queue.pauseStartedAt = Date.now();
      if (queue.current) await ix.update(buildNowPlayingMessage(queue, queue.current));
      else               await ix.deferUpdate();
      return;
    }
    case "musix-resume": {
      if (queue.pauseStartedAt !== null) {
        queue.pausedAccumulatedMs += Date.now() - queue.pauseStartedAt;
        queue.pauseStartedAt = null;
      }
      session.player.unpause();
      if (queue.current) await ix.update(buildNowPlayingMessage(queue, queue.current));
      else               await ix.deferUpdate();
      return;
    }
    case "musix-skip": {
      // Stopping the player triggers Idle → advanceQueue, which strips
      // these buttons from the old message and posts a fresh now-playing.
      await ix.deferUpdate();
      session.player.stop();
      return;
    }
    case "musix-stop": {
      queue.upcoming = [];
      queue.current  = null;
      stopProgressTimer(queue);
      session.player.stop(true);
      await ix.update({ content: "⏹ Stopped. Queue cleared.", components: [] });
      queue.currentMessage = null;
      return;
    }
    case "musix-queue": {
      const list = queue.current ? [queue.current, ...queue.upcoming] : queue.upcoming;
      if (list.length === 0) {
        await ix.reply({ content: "Queue is empty.", flags: MessageFlags.Ephemeral });
        return;
      }
      const shown = list.slice(0, 10).map((item, i) =>
        i === 0
          ? `▶ **${item.title}** (${fmtSec(item.durationSec)})`
          : `${i}. ${item.title} (${fmtSec(item.durationSec)})`,
      ).join("\n");
      const extra = list.length > 10 ? `\n…and ${list.length - 10} more` : "";
      await ix.reply({ content: shown + extra, flags: MessageFlags.Ephemeral });
      return;
    }
    default:
      await ix.reply({ content: `Unknown button: ${ix.customId}`, flags: MessageFlags.Ephemeral });
  }
}

async function handleAutocomplete(ix: AutocompleteInteraction) {
  if (ix.commandName !== "musix") return;
  const focused = ix.options.getFocused(true);
  if (focused.name !== "query") {
    await ix.respond([]);
    return;
  }
  const partial = (focused.value as string).trim();
  if (partial.length < 2) {
    await ix.respond([]);
    return;
  }
  // If the user already pasted a URL / ID, we don't need to search — just
  // confirm the input as the only choice so they can submit cleanly.
  const directId = extractVideoId(partial);
  if (directId) {
    await ix.respond([{ name: `▶ Video ID ${directId}`, value: `https://www.youtube.com/watch?v=${directId}` }]);
    return;
  }
  const hits = await searchSuggestions(partial, 5);
  const choices = hits.map((h) => {
    const namePrefix = `${h.title} (${fmtSec(h.durationSec)})`;
    return {
      // Discord caps option names at 100 chars.
      name:  namePrefix.length > 100 ? namePrefix.slice(0, 97) + "..." : namePrefix,
      value: `https://www.youtube.com/watch?v=${h.id}`,
    };
  });
  await ix.respond(choices);
}

// ── Discord client ──────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

client.once(Events.ClientReady, async (c) => {
  console.log(`[musix-bot] Online as ${c.user.tag} (id ${c.user.id})`);
  try {
    await registerCommands();
  } catch (err) {
    console.error("[musix-bot] Failed to register commands:", err);
  }
});

client.on(Events.InteractionCreate, async (ix) => {
  if (ix.isAutocomplete()) {
    try { await handleAutocomplete(ix); }
    catch (err) { console.warn(`[musix-bot] autocomplete threw:`, err); }
    return;
  }
  if (ix.isButton()) {
    try { await handleButton(ix); }
    catch (err) {
      console.error(`[musix-bot] button ${ix.customId} threw:`, err);
      const message = "Something went wrong handling that button.";
      if (ix.replied || ix.deferred) await ix.followUp({ content: message, flags: MessageFlags.Ephemeral });
      else                            await ix.reply({ content: message, flags: MessageFlags.Ephemeral });
    }
    return;
  }
  if (!ix.isChatInputCommand()) return;
  if (ix.commandName !== "musix") return;
  const sub = ix.options.getSubcommand();
  try {
    if      (sub === "join")  await handleJoin(ix);
    else if (sub === "leave") await handleLeave(ix);
    else if (sub === "play")  await handlePlayQuery(ix, "play");
    else if (sub === "test")  await handlePlayQuery(ix, "test");
    else await ix.reply({ content: `Unknown subcommand: ${sub}`, flags: MessageFlags.Ephemeral });
  } catch (err) {
    console.error(`[musix-bot] /musix ${sub} threw:`, err);
    const message = "Something went wrong handling that command. Check the bot logs.";
    if (ix.replied || ix.deferred) await ix.followUp({ content: message, flags: MessageFlags.Ephemeral });
    else                            await ix.reply({ content: message, flags: MessageFlags.Ephemeral });
  }
});

// ── Lifecycle ───────────────────────────────────────────────────────────────
async function shutdown(signal: string) {
  console.log(`[musix-bot] ${signal} received — tearing down...`);
  for (const guildId of Array.from(sessions.keys())) {
    await teardownSession(guildId);
  }
  client.destroy();
  process.exit(0);
}
process.on("SIGINT",  () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

// Start the HTTP audio proxy first — it has no dependency on Discord
// being up. Browser clients in "all-clients-stream" audio mode will
// fetch from this server in parallel with the Discord voice path.
startHttpStreamServer();

client.login(BOT_TOKEN).catch(err => {
  console.error("[musix-bot] Login failed — check DISCORD_BOT_TOKEN:", err);
  process.exit(1);
});
