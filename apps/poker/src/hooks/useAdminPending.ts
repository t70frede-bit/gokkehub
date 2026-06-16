import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

// Count of things needing the group admin's attention: pending top-up requests
// + pending join requests. Drives the badge on the Admin tab. Live.
export function useAdminPending(groupId: string | undefined, isAdmin: boolean): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!groupId || !isAdmin) { setCount(0); return; }

    const reload = async () => {
      const [tx, mem] = await Promise.all([
        supabase.from("poker_transactions").select("id", { count: "exact", head: true })
          .eq("group_id", groupId).eq("type", "deposit").eq("status", "pending"),
        supabase.from("poker_group_members").select("id", { count: "exact", head: true })
          .eq("group_id", groupId).eq("status", "pending"),
      ]);
      setCount((tx.count ?? 0) + (mem.count ?? 0));
    };
    reload();

    const channel = supabase
      .channel(`poker_admin_pending_${groupId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "poker_transactions", filter: `group_id=eq.${groupId}` }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "poker_group_members", filter: `group_id=eq.${groupId}` }, reload)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [groupId, isAdmin]);

  return count;
}
