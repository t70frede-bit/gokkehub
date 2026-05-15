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
  type ResolvedTrack,
} from "./resolver.js";

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

if (!ffmpegPath) {
  console.warn("[musix-bot] ffmpeg-static didn't resolve a binary path — voice playback won't work.");
}

// ── Supabase ────────────────────────────────────────────────────────────────
const supabase: SupabaseClient = createClient(SB_URL, SB_SERVICE, {
  auth:     { persistSession: false, autoRefreshToken: false },
  realtime: { params: { eventsPerSecond: 10 } },
});

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

function computeElapsedMs(q: QueueState): number {
  if (!q.playStartedAt) return 0;
  const now = Date.now();
  const pausedNow = q.pauseStartedAt ? now - q.pauseStartedAt : 0;
  return Math.max(0, now - q.playStartedAt - q.pausedAccumulatedMs - pausedNow);
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

function describeSession(s: Session) {
  return `mode=${s.mode} room=${s.roomId ?? "(none)"} guild=${s.guildId} channel=${s.voiceChannelId}`;
}

async function teardownSession(guildId: string): Promise<Session | null> {
  const existing = sessions.get(guildId);
  if (!existing) return null;
  sessions.delete(guildId);
  const q = queues.get(guildId);
  if (q) stopProgressTimer(q);
  try { existing.player.stop(true); }   catch (err) { console.warn("[voice] player stop failed:", err); }
  try { existing.voice.destroy();   }   catch (err) { console.warn("[voice] connection destroy failed:", err); }
  if (existing.realtime) {
    await existing.realtime.unsubscribe().catch(err => {
      console.warn(`[musix-bot] unsubscribe failed for ${describeSession(existing)}:`, err);
    });
  }
  return existing;
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
  id?:                  number;
  outcome?:             string | null;
  track?:               BotSpotifyTrack | null;
  song_limit_seconds?:  number | null;
}

interface RealtimeCallbacks {
  onRoundInsert: (round: BotRound) => void;
}

function startRealtimeForRoom(roomId: string, cb: RealtimeCallbacks): RealtimeChannel {
  // Subscribes to the same Postgres change streams the React clients use.
  // Round INSERTs drive song playback; room UPDATEs (Phase 5 step 2) will
  // drive pause/resume sync.
  const channel = supabase
    .channel(`bot-room:${roomId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "tl_rooms",  filter: `id=eq.${roomId}` },
      (payload) => {
        console.log(`[realtime] room ${roomId} ${payload.eventType}`, {
          status:           (payload.new as { status?: string } | null)?.status,
          current_round_id: (payload.new as { current_round_id?: number } | null)?.current_round_id,
          playing_since:    (payload.new as { playing_since?: number } | null)?.playing_since,
          paused_at_ms:     (payload.new as { paused_at_ms?: number } | null)?.paused_at_ms,
        });
      })
    .on("postgres_changes", { event: "*", schema: "public", table: "tl_rounds", filter: `room_id=eq.${roomId}` },
      (payload) => {
        const n = payload.new as BotRound | null;
        console.log(`[realtime] round ${n?.id ?? "?"} ${payload.eventType} (room ${roomId})`, {
          outcome: n?.outcome,
          track:   n?.track ? `${n.track.artist} — ${n.track.name}` : undefined,
          limit:   n?.song_limit_seconds,
        });
        if (payload.eventType === "INSERT" && n) {
          cb.onRoundInsert(n);
        }
      })
    .subscribe((status) => {
      console.log(`[realtime] room ${roomId} subscription → ${status}`);
    });
  return channel;
}

// Resolves the round's SpotifyTrack to a YouTube video and starts streaming
// it through the given player. Replaces whatever was playing before.
// Logs and returns on errors so a single bad song doesn't take the bot down.
async function playRoundTrack(player: AudioPlayer, round: BotRound) {
  if (!round.track) {
    console.warn(`[round] insert without a track on round ${round.id}; skipping`);
    return;
  }
  const { track } = round;
  try {
    const resolved = await resolveTrack({
      id:      track.id,
      name:    track.name,
      artists: [track.artist],
    });
    if (!resolved) {
      console.warn(`[round] no YouTube match for "${track.artist} — ${track.name}"`);
      return;
    }
    const resource = await createStreamResource(resolved.videoId);
    player.play(resource);
    console.log(`[round] ▶ playing "${resolved.videoTitle}" for round ${round.id}`);
  } catch (err) {
    console.warn(`[round] playback failed for round ${round.id}:`, err);
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

  const prior = await teardownSession(ix.guildId);
  if (prior) console.log(`[musix-bot] /join replaced prior session: ${describeSession(prior)}`);

  // Defer — voice handshake can take a few seconds; Discord wants a reply
  // within 3s. defer buys us 15 minutes.
  await ix.deferReply();

  const conn = await setupVoiceConnection(ix);
  if (!conn) return;

  // Subscribe to realtime; round INSERTs trigger song playback via the
  // YouTube resolver + yt-dlp stream. Phase 5 step 2 will add pause/resume
  // sync from tl_rooms.playing_since.
  const realtime = startRealtimeForRoom(roomCode, {
    onRoundInsert: (round) => { void playRoundTrack(conn.player, round); },
  });

  const session: Session = {
    mode:            "game",
    roomId:          roomCode,
    guildId:         ix.guildId,
    voiceChannelId:  conn.voiceChannelId,
    invitedByUserId: ix.user.id,
    startedAt:       Date.now(),
    realtime,
    voice:           conn.voice,
    player:          conn.player,
  };
  sessions.set(ix.guildId, session);

  playTestTone(conn.player, 660, 0.8, "welcome chime");

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
  const cleared = await teardownSession(ix.guildId);
  if (!cleared) {
    await ix.reply({
      content: "I wasn't following a room here. Nothing to leave.",
      flags:   MessageFlags.Ephemeral,
    });
    return;
  }
  await ix.reply(`👋 Left room **${cleared.roomId}** and disconnected from the voice channel.`);
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
  if (!session) {
    const conn = await setupVoiceConnection(ix);
    if (!conn) return;
    const fresh: Session = {
      mode:            "music",
      roomId:          null,
      guildId:         ix.guildId,
      voiceChannelId:  conn.voiceChannelId,
      invitedByUserId: ix.user.id,
      startedAt:       Date.now(),
      realtime:        null,
      voice:           conn.voice,
      player:          conn.player,
    };
    sessions.set(ix.guildId, fresh);
    attachQueueAutoAdvance(fresh);
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
  const queue   = queues.get(ix.guildId);
  if (!session || session.mode !== "music" || !queue) {
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

client.login(BOT_TOKEN).catch(err => {
  console.error("[musix-bot] Login failed — check DISCORD_BOT_TOKEN:", err);
  process.exit(1);
});
