import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { GameEvent, GamePlayer, GameSession } from "@/lib/types";

// Live state for a single session: the session row, its players and its events.
// Subscribes to all three so joins/rebuys/cashouts appear instantly for everyone.
export function useLiveSession(sessionId: string | undefined) {
  const [session, setSession] = useState<GameSession | null>(null);
  const [players, setPlayers] = useState<GamePlayer[]>([]);
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!sessionId) return;
    let active = true;

    const loadSession = async () => {
      const { data } = await supabase.from("poker_game_sessions").select("*").eq("id", sessionId).maybeSingle();
      if (active) setSession((data as GameSession) ?? null);
    };
    const loadPlayers = async () => {
      const { data } = await supabase
        .from("poker_game_players").select("*").eq("session_id", sessionId)
        .order("joined_at", { ascending: true });
      if (active) setPlayers((data as GamePlayer[]) ?? []);
    };
    const loadEvents = async () => {
      const { data } = await supabase
        .from("poker_game_events").select("*").eq("session_id", sessionId)
        .order("created_at", { ascending: true });
      if (active) setEvents((data as GameEvent[]) ?? []);
    };

    Promise.all([loadSession(), loadPlayers(), loadEvents()]).then(() => active && setLoading(false));

    const channel = supabase
      .channel(`poker_session_${sessionId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "poker_game_sessions", filter: `id=eq.${sessionId}` }, loadSession)
      .on("postgres_changes", { event: "*", schema: "public", table: "poker_game_players", filter: `session_id=eq.${sessionId}` }, loadPlayers)
      .on("postgres_changes", { event: "*", schema: "public", table: "poker_game_events", filter: `session_id=eq.${sessionId}` }, loadEvents)
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [sessionId]);

  return { session, players, events, loading };
}
