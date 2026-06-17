import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { BountyClaim, BountyEntry } from "@/lib/types";

interface ChopVote { session_id: string; user_id: string; }

// Live bounty state for a session: entries, the knockout feed, and chop votes.
export function useBounty(sessionId: string | undefined) {
  const [entries, setEntries] = useState<BountyEntry[]>([]);
  const [claims, setClaims] = useState<BountyClaim[]>([]);
  const [votes, setVotes] = useState<ChopVote[]>([]);

  useEffect(() => {
    if (!sessionId) return;
    let active = true;
    const load = async () => {
      const [{ data: e }, { data: c }, { data: v }] = await Promise.all([
        supabase.from("poker_bounty_entries").select("*").eq("session_id", sessionId),
        supabase.from("poker_bounty_claims").select("*").eq("session_id", sessionId)
          .order("created_at", { ascending: false }),
        supabase.from("poker_bounty_chop_votes").select("session_id,user_id").eq("session_id", sessionId),
      ]);
      if (!active) return;
      setEntries((e as BountyEntry[]) ?? []);
      setClaims((c as BountyClaim[]) ?? []);
      setVotes((v as ChopVote[]) ?? []);
    };
    load();
    const channel = supabase
      .channel(`poker_bounty_${sessionId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "poker_bounty_entries", filter: `session_id=eq.${sessionId}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "poker_bounty_claims", filter: `session_id=eq.${sessionId}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "poker_bounty_chop_votes", filter: `session_id=eq.${sessionId}` }, load)
      .subscribe();
    return () => { active = false; supabase.removeChannel(channel); };
  }, [sessionId]);

  return { entries, claims, votes };
}
