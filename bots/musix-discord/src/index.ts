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
  entersState,
  AudioPlayer,
  VoiceConnection,
} from "@discordjs/voice";
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";

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

// ── Sessions ────────────────────────────────────────────────────────────────
// One session per guild. The bot can be in many guilds at once but only one
// active room per guild (a new /musix join replaces the prior session).

interface Session {
  roomId:           string;
  guildId:          string;
  voiceChannelId:   string;
  invitedByUserId:  string;
  startedAt:        number;
  realtime:         RealtimeChannel;
  voice:            VoiceConnection;
  player:           AudioPlayer;
}

const sessions = new Map<string, Session>(); // key: guildId

function describeSession(s: Session) {
  return `room=${s.roomId} guild=${s.guildId} channel=${s.voiceChannelId}`;
}

async function teardownSession(guildId: string): Promise<Session | null> {
  const existing = sessions.get(guildId);
  if (!existing) return null;
  sessions.delete(guildId);
  try { existing.player.stop(true); }   catch (err) { console.warn("[voice] player stop failed:", err); }
  try { existing.voice.destroy();   }   catch (err) { console.warn("[voice] connection destroy failed:", err); }
  await existing.realtime.unsubscribe().catch(err => {
    console.warn(`[musix-bot] unsubscribe failed for ${describeSession(existing)}:`, err);
  });
  return existing;
}

function startRealtimeForRoom(roomId: string, onNewRound: () => void): RealtimeChannel {
  // Subscribes to the same Postgres change streams the React clients use.
  // Phase 3: round INSERTs trigger a test tone via the passed-in callback.
  // Phase 5 will replace the test tone with the actual track resolver.
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
        const n = payload.new as { id?: number; outcome?: string | null; track?: { artist?: string; name?: string } } | null;
        console.log(`[realtime] round ${n?.id ?? "?"} ${payload.eventType} (room ${roomId})`, {
          outcome: n?.outcome,
          track:   n?.track ? `${n.track.artist} — ${n.track.name}` : undefined,
        });
        if (payload.eventType === "INSERT") {
          onNewRound();
        }
      })
    .subscribe((status) => {
      console.log(`[realtime] room ${roomId} subscription → ${status}`);
    });
  return channel;
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

  // User must be in a voice channel.
  const member = ix.guild.members.cache.get(ix.user.id)
    ?? (await ix.guild.members.fetch(ix.user.id).catch(() => null));
  const voiceChannelId = member?.voice?.channelId ?? null;
  if (!voiceChannelId) {
    await ix.reply({
      content: "Join a voice channel first, then run `/musix join` again.",
      flags:   MessageFlags.Ephemeral,
    });
    return;
  }

  // Validate the room code.
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

  // Tear down any prior session in this guild before starting a new one.
  const prior = await teardownSession(ix.guildId);
  if (prior) {
    console.log(`[musix-bot] /join replaced prior session: ${describeSession(prior)}`);
  }

  // Defer — joining voice can take a few seconds (handshake, opus init, etc.)
  // and Discord requires a reply within 3s. defer buys us 15 minutes.
  await ix.deferReply();

  // Join the voice channel.
  let voice: VoiceConnection;
  try {
    voice = joinVoiceChannel({
      channelId:      voiceChannelId,
      guildId:        ix.guildId,
      adapterCreator: ix.guild.voiceAdapterCreator,
      selfDeaf:       true,   // bot doesn't need to hear others
      selfMute:       false,
    });
    await entersState(voice, VoiceConnectionStatus.Ready, 15_000);
  } catch (err) {
    console.error("[musix-bot] voice connection failed:", err);
    try { (voice!).destroy(); } catch { /* may not exist */ }
    await ix.editReply(
      "Couldn't connect to the voice channel. Make sure the bot has **Connect** + **Speak** " +
      "permissions on that channel, then try again.",
    );
    return;
  }

  // Audio player — one per session. Subscribing the connection routes
  // whatever the player plays into the channel.
  const player = createAudioPlayer();
  voice.subscribe(player);

  // Log voice lifecycle events. Phase 6 will reconnect on transient
  // disconnects; for now we just observe.
  voice.on(VoiceConnectionStatus.Disconnected, () =>
    console.log(`[voice] disconnected from guild ${ix.guildId}`));
  voice.on(VoiceConnectionStatus.Destroyed, () =>
    console.log(`[voice] destroyed for guild ${ix.guildId}`));

  // Subscribe to realtime; round INSERTs trigger a test tone.
  const realtime = startRealtimeForRoom(roomCode, () => {
    playTestTone(player, 440, 1.2, "round-start tone");
  });

  const session: Session = {
    roomId:          roomCode,
    guildId:         ix.guildId,
    voiceChannelId,
    invitedByUserId: ix.user.id,
    startedAt:       Date.now(),
    realtime,
    voice,
    player,
  };
  sessions.set(ix.guildId, session);

  // Welcome chime — proves the audio pipeline is alive right after /join.
  playTestTone(player, 660, 0.8, "welcome chime");

  await ix.editReply(
    `🎵 Joined <#${voiceChannelId}> and following room **${roomCode}**. ` +
    `(Phase 3 — you'll hear a chime now and a tone on each new round. ` +
    `Real song playback ships in Phase 4.)`,
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
  if (!ix.isChatInputCommand()) return;
  if (ix.commandName !== "musix") return;
  const sub = ix.options.getSubcommand();
  try {
    if (sub === "join")  await handleJoin(ix);
    else if (sub === "leave") await handleLeave(ix);
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
