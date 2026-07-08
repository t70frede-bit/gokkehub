import { useCallback, useState } from "react";
import type { JpRoom } from "../lib/types";

export type BuzzerPhase =
  | "no-question"   // nothing selected
  | "locked"        // question up, buzzers closed
  | "open"          // race is on
  | "you-buzzed"    // this device won the buzz
  | "locked-out"    // teamLockout: this team already answered wrong
  | "other-buzzed"; // someone else won

export function useBuzzer(
  room: JpRoom | null,
  playerId: string | null,
  teamId: number | null,
  teamLockout = false,
) {
  const [inFlight, setInFlight] = useState(false);

  const q     = room?.board_state.activeQuestion ?? null;
  const state = room?.board_state;

  let phase: BuzzerPhase = "no-question";
  if (room && room.status === "playing" && q) {
    if (q.buzzedBy !== null) {
      phase = q.buzzedBy === teamId ? "you-buzzed" : "other-buzzed";
    } else if (teamLockout && teamId !== null && (q.lockedOutTeamIds ?? []).includes(teamId)) {
      phase = "locked-out";
    } else {
      phase = state!.buzzersOpen ? "open" : "locked";
    }
  }

  const buzz = useCallback(async () => {
    if (!room || !playerId || inFlight || phase !== "open") return;
    setInFlight(true);
    try {
      const res = await fetch(`/room/${room.id}/buzz`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ player_id: playerId }),
      });
      if (!res.ok) console.error("Buzz failed", await res.text());
    } catch (e) {
      console.error("Buzz error", e);
    } finally {
      setInFlight(false);
    }
  }, [room, playerId, inFlight, phase]);

  return { phase, buzz, inFlight };
}
