import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { normalizeGameKey } from "../lib/gameKeys";
import type { PublicSessionData } from "@gokkehub/auth/types";
import type { PlayerGame } from "../lib/types";

const BULK_CHUNK = 200;

export function usePlayerGames(session: PublicSessionData | null) {
  const [games, setGames] = useState<PlayerGame[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!session) { setGames([]); return; }

    let cancelled = false;
    setLoading(true);

    supabase
      .from("player_games")
      .select("*")
      .eq("user_id", session.userId)
      .order("display_name")
      .then(({ data, error }) => {
        if (!cancelled) {
          if (!error) setGames((data ?? []) as PlayerGame[]);
          setLoading(false);
        }
      });

    // Realtime: keep library in sync across tabs/devices
    const channel = supabase
      .channel(`player-games-${session.userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "player_games", filter: `user_id=eq.${session.userId}` },
        (payload) => {
          if (payload.eventType === "INSERT") {
            setGames((prev) => {
              if (prev.some((g) => g.id === (payload.new as PlayerGame).id)) return prev;
              return [...prev, payload.new as PlayerGame].sort((a, b) =>
                a.display_name.localeCompare(b.display_name),
              );
            });
          } else if (payload.eventType === "UPDATE") {
            setGames((prev) =>
              prev.map((g) => g.id === (payload.new as PlayerGame).id ? payload.new as PlayerGame : g),
            );
          } else if (payload.eventType === "DELETE") {
            setGames((prev) => prev.filter((g) => g.id !== (payload.old as PlayerGame).id));
          }
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [session?.userId]);

  async function addGame(
    displayName: string,
    source: PlayerGame["source"] = "manual",
    steamAppId?: number,
  ) {
    if (!session) return;
    const normalized = normalizeGameKey(displayName);
    const { error } = await supabase
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
      );
    // Realtime subscription handles the state update
    return error ?? undefined;
  }

  async function removeGame(id: string) {
    // Optimistic remove
    setGames((prev) => prev.filter((g) => g.id !== id));
    const { error } = await supabase.from("player_games").delete().eq("id", id);
    if (error) {
      // Revert on failure
      supabase.from("player_games").select("*").eq("id", id).single().then(({ data }) => {
        if (data) setGames((prev) => [...prev, data as PlayerGame].sort((a, b) => a.display_name.localeCompare(b.display_name)));
      });
    }
  }

  async function toggleFavorite(id: string) {
    const game = games.find((g) => g.id === id);
    if (!game) return;
    const next = !game.is_favorite;
    // Optimistic update
    setGames((prev) => prev.map((g) => (g.id === id ? { ...g, is_favorite: next } : g)));
    const { error } = await supabase
      .from("player_games")
      .update({ is_favorite: next })
      .eq("id", id);
    if (error) {
      // Rollback
      setGames((prev) => prev.map((g) => (g.id === id ? { ...g, is_favorite: !next } : g)));
    }
  }

  async function bulkImport(items: Array<{ name: string; steamAppId: number }>): Promise<number> {
    if (!session || items.length === 0) return 0;

    const existingKeys = new Set(games.map((g) => g.normalized_key));
    const toInsert = items
      .filter((item) => !existingKeys.has(normalizeGameKey(item.name)))
      .map((item) => ({
        user_id:        session.userId,
        display_name:   item.name.trim(),
        normalized_key: normalizeGameKey(item.name),
        source:         "steam" as const,
        steam_app_id:   item.steamAppId,
        is_favorite:    false,
      }));

    if (toInsert.length === 0) return 0;

    // Chunk into batches to avoid payload limits.
    // No .select() — RLS SELECT policy may differ from INSERT policy.
    // State is updated from toInsert directly; realtime subscription keeps it live.
    for (let i = 0; i < toInsert.length; i += BULK_CHUNK) {
      const chunk = toInsert.slice(i, i + BULK_CHUNK);
      const { error } = await supabase
        .from("player_games")
        .upsert(chunk, { onConflict: "user_id,normalized_key", ignoreDuplicates: true });
      if (error) return -1;
      setGames((prev) => {
        const merged = new Map(prev.map((g) => [g.normalized_key, g]));
        for (const g of chunk as PlayerGame[]) merged.set(g.normalized_key, g);
        return Array.from(merged.values()).sort((a, b) =>
          a.display_name.localeCompare(b.display_name),
        );
      });
    }
    return toInsert.length;
  }

  return { games, loading, addGame, removeGame, toggleFavorite, bulkImport };
}
