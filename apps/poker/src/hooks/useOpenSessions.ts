import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { GamePlayer, GameSession } from "@/lib/types";

export interface SessionWithCount extends GameSession {
  player_count: number;
}

// Live list of lobby + active sessions for the Games tab.
export function useOpenSessions() {
  const [sessions, setSessions] = useState<SessionWithCount[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    const { data: rows } = await supabase
      .from("poker_game_sessions")
      .select("*")
      .in("status", ["lobby", "active"])
      .order("created_at", { ascending: false });

    const list = (rows as GameSession[]) ?? [];
    const { data: players } = await supabase
      .from("poker_game_players")
      .select("session_id");
    const counts = new Map<string, number>();
    for (const p of (players as Pick<GamePlayer, "session_id">[]) ?? []) {
      counts.set(p.session_id, (counts.get(p.session_id) ?? 0) + 1);
    }
    setSessions(list.map((s) => ({ ...s, player_count: counts.get(s.id) ?? 0 })));
    setLoading(false);
  };

  useEffect(() => {
    reload();
    const channel = supabase
      .channel("poker_open_sessions")
      .on("postgres_changes", { event: "*", schema: "public", table: "poker_game_sessions" }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "poker_game_players" }, reload)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return { sessions, loading, reload };
}
