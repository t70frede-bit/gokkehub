import { useEffect, useState } from "react";
import { ACCOUNT_ORIGIN } from "@gokkehub/auth/redirect";
import type { GameHeaderSession } from "../components/GameHeader.tsx";

/**
 * Minimal "who is signed in" hook for pages that only need the header chip
 * (e.g. the gokkehub.com hub). Game apps keep their own useSession, which
 * also carries Spotify tokens etc.
 */
let cache: GameHeaderSession | null | undefined;

export function useAccountSession(): { session: GameHeaderSession | null; loading: boolean } {
  const [state, setState] = useState({
    session: cache ?? null,
    loading: cache === undefined,
  });

  useEffect(() => {
    if (cache !== undefined) return;
    let cancelled = false;
    fetch(`${ACCOUNT_ORIGIN}/auth/me`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((s: GameHeaderSession | null) => {
        cache = s;
        if (!cancelled) setState({ session: s, loading: false });
      });
    return () => { cancelled = true; };
  }, []);

  return state;
}
