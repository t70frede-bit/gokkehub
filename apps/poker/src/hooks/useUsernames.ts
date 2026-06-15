import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

// Fetches the id -> username directory once. Used to label players/events that
// the RLS-restricted poker_users table won't expose to non-admins.
export function useUsernames(): Record<string, string> {
  const [map, setMap] = useState<Record<string, string>>({});

  useEffect(() => {
    supabase.rpc("poker_usernames").then(({ data }) => {
      if (!data) return;
      const next: Record<string, string> = {};
      for (const row of data as { user_id: string; username: string }[]) {
        next[row.user_id] = row.username;
      }
      setMap(next);
    });
  }, []);

  return map;
}
