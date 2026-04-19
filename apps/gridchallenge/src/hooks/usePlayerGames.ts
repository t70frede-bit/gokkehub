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

  async function addGame(
    displayName: string,
    source: PlayerGame["source"] = "manual",
    steamAppId?: number,
  ) {
    if (!session) return;
    const normalized = normalizeGameKey(displayName);
    const { data, error } = await supabase
      .from("player_games")
      .upsert(
        {
          user_id:        session.userId,
          display_name:   displayName.trim(),
          normalized_key: normalized,
          source,
          steam_app_id:   steamAppId ?? null,
        },
        { onConflict: "user_id,normalized_key" },
      )
      .select()
      .single();

    if (!error && data) {
      setGames((prev) => {
        const filtered = prev.filter((g) => g.normalized_key !== normalized);
        return [...filtered, data as PlayerGame].sort((a, b) =>
          a.display_name.localeCompare(b.display_name),
        );
      });
    }
    return error;
  }

  async function removeGame(id: string) {
    await supabase.from("player_games").delete().eq("id", id);
    setGames((prev) => prev.filter((g) => g.id !== id));
  }

  async function toggleFavorite(id: string) {
    const game = games.find((g) => g.id === id);
    if (!game) return;
    const next = !game.is_favorite;
    await supabase.from("player_games").update({ is_favorite: next }).eq("id", id);
    setGames((prev) =>
      prev.map((g) => (g.id === id ? { ...g, is_favorite: next } : g)),
    );
  }

  /** Import multiple Steam games at once. Skips games already in the library. */
  async function bulkImport(
    items: Array<{ name: string; steamAppId: number }>,
  ): Promise<number> {
    if (!session || items.length === 0) return 0;
    const existingKeys = new Set(games.map((g) => g.normalized_key));
    const toInsert = items.filter(
      (item) => !existingKeys.has(normalizeGameKey(item.name)),
    );
    if (toInsert.length === 0) return 0;

    const rows = toInsert.map((item) => ({
      user_id:        session.userId,
      display_name:   item.name.trim(),
      normalized_key: normalizeGameKey(item.name),
      source:         "steam" as const,
      steam_app_id:   item.steamAppId,
      is_favorite:    false,
    }));

    const { data, error } = await supabase
      .from("player_games")
      .upsert(rows, { onConflict: "user_id,normalized_key" })
      .select();

    if (!error && data) {
      setGames((prev) => {
        const merged = new Map(prev.map((g) => [g.normalized_key, g]));
        for (const g of data as PlayerGame[]) {
          merged.set(g.normalized_key, g);
        }
        return Array.from(merged.values()).sort((a, b) =>
          a.display_name.localeCompare(b.display_name),
        );
      });
    }
    return toInsert.length;
  }

  return { games, loading, addGame, removeGame, toggleFavorite, bulkImport };
}
