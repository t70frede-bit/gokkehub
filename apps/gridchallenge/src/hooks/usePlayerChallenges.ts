import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { normalizeGameKey } from "../lib/gameKeys";
import type { GokkeHubSession, PlayerChallenge, ChallengeType } from "../lib/types";

export function usePlayerChallenges(session: GokkeHubSession | null) {
  const [challenges, setChallenges] = useState<PlayerChallenge[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!session) { setChallenges([]); return; }
    setLoading(true);
    supabase
      .from("player_challenges")
      .select("*")
      .eq("user_id", session.userId)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setChallenges((data ?? []) as PlayerChallenge[]);
        setLoading(false);
      });
  }, [session?.userId]);

  async function addChallenge(
    text: string,
    type: ChallengeType,
    gameKey: string,
  ) {
    if (!session) return;
    const normalized = normalizeGameKey(gameKey);
    const { data, error } = await supabase
      .from("player_challenges")
      .insert({
        user_id:      session.userId,
        player_name:  session.displayName ?? "Unknown",
        text:         text.trim(),
        type,
        game:         normalized,
        upvote_count: 0,
      })
      .select()
      .single();

    if (!error && data) {
      setChallenges((prev) => [data as PlayerChallenge, ...prev]);
    }
    return error;
  }

  async function removeChallenge(id: string) {
    await supabase.from("player_challenges").delete().eq("id", id);
    setChallenges((prev) => prev.filter((c) => c.id !== id));
  }

  return { challenges, loading, addChallenge, removeChallenge };
}
