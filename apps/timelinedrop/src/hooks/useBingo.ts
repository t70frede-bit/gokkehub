import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { TlBingoBoard, TlBingoMark } from "../lib/types";

// Realtime boards + marks for a Music Bingo room. Room, teams, players and
// the current song still come from useRoom; this only adds the bingo
// tables (migration 032). Every change triggers a full reload of the
// changed table — they're tiny (≤ 8 boards, a few hundred marks), and a
// reload sidesteps realtime ordering and DELETE-payload edge cases.
export function useBingo(roomId: string | undefined) {
  const [boards, setBoards] = useState<TlBingoBoard[]>([]);
  const [marks,  setMarks]  = useState<TlBingoMark[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;

    const loadBoards = () => supabase.from("tl_bingo_boards").select("*").eq("room_id", roomId)
      .then(r => { if (!cancelled) setBoards((r.data ?? []) as TlBingoBoard[]); });
    const loadMarks = () => supabase.from("tl_bingo_marks").select("*").eq("room_id", roomId).order("id")
      .then(r => { if (!cancelled) setMarks((r.data ?? []) as TlBingoMark[]); });

    Promise.all([loadBoards(), loadMarks()]).then(() => { if (!cancelled) setLoaded(true); });

    const channel = supabase
      .channel(`bingo:${roomId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tl_bingo_boards", filter: `room_id=eq.${roomId}` },
        () => { void loadBoards(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "tl_bingo_marks", filter: `room_id=eq.${roomId}` },
        () => { void loadMarks(); })
      .subscribe();

    return () => {
      cancelled = true;
      channel.unsubscribe();
    };
  }, [roomId]);

  return { boards, marks, loaded };
}
