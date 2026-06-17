import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { BountyClaim, BountyEntry } from "@/lib/types";

// Live bounty state for a session: who's opted in + the knockout feed.
export function useBounty(sessionId: string | undefined) {
  const [entries, setEntries] = useState<BountyEntry[]>([]);
  const [claims, setClaims] = useState<BountyClaim[]>([]);

  useEffect(() => {
    if (!sessionId) return;
    let active = true;
    const load = async () => {
      const [{ data: e }, { data: c }] = await Promise.all([
        supabase.from("poker_bounty_entries").select("*").eq("session_id", sessionId),
        supabase.from("poker_bounty_claims").select("*").eq("session_id", sessionId)
          .order("created_at", { ascending: false }),
      ]);
      if (!active) return;
      setEntries((e as BountyEntry[]) ?? []);
      setClaims((c as BountyClaim[]) ?? []);
    };
    load();
    const channel = supabase
      .channel(`poker_bounty_${sessionId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "poker_bounty_entries", filter: `session_id=eq.${sessionId}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "poker_bounty_claims", filter: `session_id=eq.${sessionId}` }, load)
      .subscribe();
    return () => { active = false; supabase.removeChannel(channel); };
  }, [sessionId]);

  return { entries, claims };
}
