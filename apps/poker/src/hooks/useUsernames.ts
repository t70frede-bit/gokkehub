import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

// id -> username directory for a group's members. Used to label players/events
// without exposing the RLS-restricted poker_users table.
export function useUsernames(groupId: string | undefined): Record<string, string> {
  const [map, setMap] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!groupId) return;
    supabase.rpc("poker_usernames", { p_group: groupId }).then(({ data }) => {
      if (!data) return;
      const next: Record<string, string> = {};
      for (const row of data as { user_id: string; username: string }[]) {
        next[row.user_id] = row.username;
      }
      setMap(next);
    });
  }, [groupId]);

  return map;
}
