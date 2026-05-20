// Persistence for game-mode bot sessions (Phase 6).
//
// The bot's live sessions live in an in-memory Map<guildId, Session> in
// index.ts. This module mirrors the minimal recovery-relevant fields to
// the tl_discord_sessions table (migration 019) so a restart can re-join
// the voice channel and re-subscribe to the room's realtime channel
// instead of going silent until someone re-runs /musix join.
//
// Dependency-injected supabase client (same pattern as resolver.ts) so
// this module doesn't need its own env wiring. index.ts calls
// setSessionStoreClient on boot.

import type { SupabaseClient } from "@supabase/supabase-js";

let supabaseClient: SupabaseClient | null = null;
export function setSessionStoreClient(c: SupabaseClient): void { supabaseClient = c; }

export interface PersistedSession {
  guild_id:           string;
  room_id:            string;
  voice_channel_id:   string;
  text_channel_id:    string | null;
  invited_by_user_id: string | null;
}

// Upsert (one row per guild). Called on /musix join and whenever the bot
// is moved to a different voice channel. Failures are logged, not thrown —
// a persistence hiccup shouldn't break live playback.
export async function upsertSession(row: PersistedSession): Promise<void> {
  if (!supabaseClient) return;
  const { error } = await supabaseClient
    .from("tl_discord_sessions")
    .upsert(
      { ...row, updated_at: new Date().toISOString() },
      { onConflict: "guild_id" },
    );
  if (error) console.warn(`[session-store] upsert failed for guild ${row.guild_id}:`, error.message);
}

// Delete a guild's persisted session. Called on /musix leave, AFK
// disconnect, kicked-from-voice, and mode-switch to /play. NOT called on
// graceful shutdown — those rows are intentionally left for recovery.
export async function deleteSession(guildId: string): Promise<void> {
  if (!supabaseClient) return;
  const { error } = await supabaseClient
    .from("tl_discord_sessions")
    .delete()
    .eq("guild_id", guildId);
  if (error) console.warn(`[session-store] delete failed for guild ${guildId}:`, error.message);
}

// Load every persisted session. Called once on boot to drive recovery.
export async function loadAllSessions(): Promise<PersistedSession[]> {
  if (!supabaseClient) return [];
  const { data, error } = await supabaseClient
    .from("tl_discord_sessions")
    .select("guild_id, room_id, voice_channel_id, text_channel_id, invited_by_user_id");
  if (error) {
    console.warn(`[session-store] loadAll failed:`, error.message);
    return [];
  }
  return (data ?? []) as PersistedSession[];
}
