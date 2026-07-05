import { useCallback, useState } from "react";
import type { HostAction } from "../lib/types";

// Dispatches host actions to the server-side state machine
// (functions/room/[id]/action.ts). Only the host player id is accepted there.
export function useHostController(roomId: string | undefined, playerId: string | null) {
  const [busy,  setBusy]  = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dispatch = useCallback(async (action: HostAction): Promise<boolean> => {
    if (!roomId || !playerId) return false;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/room/${roomId}/action`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ player_id: playerId, action }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: string } | null;
        setError(body?.error ?? `Action failed (${res.status})`);
        return false;
      }
      return true;
    } catch {
      setError("Network error");
      return false;
    } finally {
      setBusy(false);
    }
  }, [roomId, playerId]);

  return { dispatch, busy, error };
}
