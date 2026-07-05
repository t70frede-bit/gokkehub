import { useCallback, useEffect, useMemo, useState } from "react";
import type { JpQueueMode, JpRoom } from "../lib/types";

export type BuzzerPhase =
  | "no-question"   // nothing selected
  | "locked"        // question up, buzzers closed
  | "open"          // race is on
  | "you-buzzed"    // this device won the buzz (or was promoted from the queue)
  | "queueable"     // someone else is answering — Queue Lock-In lets you queue
  | "queued"        // you're in the queue, waiting on a wrong answer
  | "locked-out"    // your team already answered this tile wrong (Queue Lock-In)
  | "other-buzzed"; // someone else won and you can't queue

// Buzz button state + the buzz call. The server owns the race; the response
// (and the jp_rooms realtime update) tell us who actually won.
export function useBuzzer(
  room: JpRoom | null,
  playerId: string | null,
  teamId: number | null,
  queueMode: JpQueueMode = "rebuzz",
) {
  const [inFlight, setInFlight] = useState(false);
  const [queued, setQueued]     = useState(false);

  const q = room?.board_state.activeQuestion ?? null;

  // A queue entry only lives as long as this exact race.
  useEffect(() => {
    setQueued(false);
  }, [q?.tileKey, room?.board_state.buzzRound]);

  const phase: BuzzerPhase = useMemo(() => {
    const state = room?.board_state;
    if (!room || room.status !== "playing" || !q) return "no-question";
    if (q.buzzedBy !== null) {
      if (q.buzzedBy === teamId) return "you-buzzed";
      if (queueMode === "lockIn") {
        if (teamId !== null && (q.lockedOutTeamIds ?? []).includes(teamId)) return "locked-out";
        return queued ? "queued" : "queueable";
      }
      return "other-buzzed";
    }
    if (queueMode === "lockIn" && teamId !== null && (q.lockedOutTeamIds ?? []).includes(teamId)) {
      return "locked-out";
    }
    return state!.buzzersOpen ? "open" : "locked";
  }, [room, q, teamId, queueMode, queued]);

  const buzz = useCallback(async () => {
    if (!room || !playerId || inFlight) return;
    if (phase !== "open" && phase !== "queueable") return;
    const queueing = phase === "queueable";
    setInFlight(true);
    try {
      const res = await fetch(`/room/${room.id}/buzz`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ player_id: playerId }),
      });
      if (queueing && res.ok) setQueued(true);
      // Race winners arrive via the jp_rooms realtime update; nothing to do.
    } catch {
      // Swallow — a failed buzz just means they lost the race.
    } finally {
      setInFlight(false);
    }
  }, [room, playerId, inFlight, phase]);

  return { phase, buzz, inFlight };
}
