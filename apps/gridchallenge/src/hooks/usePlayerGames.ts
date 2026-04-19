import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { normalizeGameKey } from "../lib/gameKeys";
import type { GokkeHubSession, PlayerGame } from "../lib/types";

export function usePlayerGames(session: GokkeHubSession | null) {
  const [games, setGames] = useState<PlayerGame[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!session) { setGames([]); return; }
    setLoading(true);
    supabase
      .from("player_games")
      .select("*")
      .eq("user_id", session.userId)
      .order("display_name")
      .then(({ data }) => {
        setGames((data ?? []) as PlayerGame[]);
        setLoading(false);
      });
  }, [session?.userId]);

  async function addGame(displayName: string, source: PlayerGame["source"] = "manual", steamAppId?: number) {
    if (!session) return;
    const normalized = normalizeGameKey(displayName);
    const { data, error } = await supabase
      .from("player_games")
      .upsert({
        user_id:        session.userId,
        display_name:   displayName.trim(),
        normalized_key: normalized,
        source,
        steam_app_id:   steamAppId ?? null,
      }, { onConflict: "user_id,normalized_key" })
      .select()
      .single();

    if (!error && data) {
      setGames((prev) => {
        const filtered = prev.filter((g) => g.normalized_key !== normalized);
        return [...filtered, data as PlayerGame].sort((a, b) => a.display_name.localeCompare(b.display_name));
      });
    }
    return error;
  }

  async function removeGame(id: string) {
    await supabase.from("player_games").delete().eq("id", id);
    setGames((prev) => prev.filter((g) => g.id !== id));
  }

  return { games, loading, addGame, removeGame };
}
