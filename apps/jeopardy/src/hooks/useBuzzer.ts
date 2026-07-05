import { useCallback, useMemo, useState } from "react";
import type { JpRoom } from "../lib/types";

export type BuzzerPhase =
  | "no-question"   // nothing selected
  | "locked"        // question up, buzzers closed
  | "open"          // race is on
  | "you-buzzed"    // this device won the buzz
  | "other-buzzed"; // someone else won

// Buzz button state + the buzz call. The server owns the race; the response
// (and the jp_rooms realtime update) tell us who actually won.
export function useBuzzer(room: JpRoom | null, playerId: string | null, teamId: number | null) {
  const [inFlight, setInFlight] = useState(false);

  const phase: BuzzerPhase = useMemo(() => {
    const state = room?.board_state;
    const q     = state?.activeQuestion;
    if (!room || room.status !== "playing" || !q) return "no-question";
    if (q.buzzedBy !== null) {
      return q.buzzedBy === teamId ? "you-buzzed" : "other-buzzed";
    }
    return state!.buzzersOpen ? "open" : "locked";
  }, [room, teamId]);

  const buzz = useCallback(async () => {
    if (!room || !playerId || inFlight || phase !== "open") return;
    setInFlight(true);
    try {
      await fetch(`/room/${room.id}/buzz`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ player_id: playerId }),
      });
      // Winner arrives via the jp_rooms realtime update; nothing to do here.
    } catch {
      // Swallow — a failed buzz just means they lost the race.
    } finally {
      setInFlight(false);
    }
  }, [room, playerId, inFlight, phase]);

  return { phase, buzz, inFlight };
}
