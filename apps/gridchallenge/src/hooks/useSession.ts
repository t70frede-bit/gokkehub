import { useEffect, useState } from "react";
import type { GokkeHubSession } from "../lib/types";

const SESSION_URL = "https://account.gokkehub.com/auth/me";
const STORAGE_KEY = "gridchallenge_session_cache";

interface SessionState {
  session: GokkeHubSession | null;
  loading: boolean;
}

let _cache: GokkeHubSession | null | undefined = undefined; // undefined = not yet fetched

export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>({
    session: _cache !== undefined ? _cache : null,
    loading: _cache === undefined,
  });

  useEffect(() => {
    if (_cache !== undefined) {
      setState({ session: _cache, loading: false });
      return;
    }

    let cancelled = false;

    fetch(SESSION_URL, { credentials: "include" })
      .then((r) => {
        if (!r.ok) return null;
        return r.json() as Promise<GokkeHubSession>;
      })
      .catch(() => null)
      .then((session) => {
        if (cancelled) return;
        _cache = session;
        try {
          if (session) {
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
          } else {
            sessionStorage.removeItem(STORAGE_KEY);
          }
        } catch { /* ignore quota errors */ }
        setState({ session, loading: false });
      });

    return () => { cancelled = true; };
  }, []);

  return state;
}

/** Call this after sign-out to bust the in-memory cache. */
export function clearSessionCache() {
  _cache = undefined;
  try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}
