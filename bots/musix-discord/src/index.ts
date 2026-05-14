// musix Discord bot — Phase 2 (hello-world)
//
// Connects to Discord, registers `/musix join <room>` and `/musix leave`
// slash commands, validates rooms against Supabase, and subscribes to
// realtime updates for joined rooms. Logs everything to the console.
// No voice connection or audio playback yet — that lands in Phase 3.
//
// Run:
//   1. Copy .env.example to .env, fill in DISCORD_BOT_TOKEN +
//      DISCORD_CLIENT_ID + SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
//      (and DISCORD_DEV_GUILD_ID for fast slash-command sync).
//   2. pnpm install
//   3. pnpm dev

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

// ── Sessions ────────────────────────────────────────────────────────────────
// One session per guild. The bot can be in many guilds at once but only one
// active room per guild (you'd start a different /musix join to switch).

interface Session {
  roomId:           string;
  guildId:          string;
  voiceChannelId:   string;
  invitedByUserId:  string;
  startedAt:        number;
  realtime:         RealtimeChannel;
}

const sessions = new Map<string, Session>(); // key: guildId

function describeSession(s: Session) {
  return `room=${s.roomId} guild=${s.guildId} channel=${s.voiceChannelId}`;
}

async function teardownSession(guildId: string): Promise<Session | null> {
  const existing = sessions.get(guildId);
  if (!existing) return null;
  sessions.delete(guildId);
  await existing.realtime.unsubscribe().catch(err => {
    console.warn(`[musix-bot] unsubscribe failed for ${describeSession(existing)}:`, err);
  });
  return existing;
}

function startRealtimeForRoom(roomId: string): RealtimeChannel {
  // Subscribes to the same Postgres change streams the React clients use.
  // Phase 2: just log. Phase 3 will turn round changes into play/pause.
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

  const realtime = startRealtimeForRoom(roomCode);
  const session: Session = {
    roomId:          roomCode,
    guildId:         ix.guildId,
    voiceChannelId,
    invitedByUserId: ix.user.id,
    startedAt:       Date.now(),
    realtime,
  };
  sessions.set(ix.guildId, session);

  await ix.reply(
    `🎵 Following room **${roomCode}**. (Phase 2 stub — voice connection lands in Phase 3.) ` +
    `Your voice channel: <#${voiceChannelId}>`,
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
  await ix.reply(`👋 Left room **${cleared.roomId}**.`);
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
