import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { GamePlayer, GameSession } from "@/lib/types";

export interface SessionRow extends GameSession { player_count: number; }

// All of a group's sessions (active first, then finished) with player counts.
// Live. Used by the Home games list.
export function useGroupGames(groupId: string | undefined) {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    if (!groupId) { setSessions([]); setLoading(false); return; }
    const { data: rows } = await supabase
      .from("poker_game_sessions").select("*").eq("group_id", groupId)
      .order("created_at", { ascending: false });
    const { data: players } = await supabase
      .from("poker_game_players").select("session_id").eq("group_id", groupId);
    const counts = new Map<string, number>();
    for (const p of (players as Pick<GamePlayer, "session_id">[]) ?? []) {
      counts.set(p.session_id, (counts.get(p.session_id) ?? 0) + 1);
    }
    const list = ((rows as GameSession[]) ?? []).map((s) => ({ ...s, player_count: counts.get(s.id) ?? 0 }));
    // Active tables first, then finished — both already newest-first within.
    list.sort((a, b) => Number(b.status === "active") - Number(a.status === "active"));
    setSessions(list);
    setLoading(false);
  };

  useEffect(() => {
    reload();
    const channel = supabase
      .channel(`poker_group_games_${groupId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "poker_game_sessions" }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "poker_game_players" }, reload)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  return { sessions, loading, reload };
}
