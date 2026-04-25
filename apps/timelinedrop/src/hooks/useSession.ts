import { useEffect, useState } from "react";
import type { GokkeHubSession } from "../lib/types";

const SESSION_URL = "https://account.gokkehub.com/auth/me";

let _cache: GokkeHubSession | null | undefined = undefined;

export function useSession() {
  const [state, setState] = useState<{ session: GokkeHubSession | null; loading: boolean }>({
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
      .then(r => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((s: GokkeHubSession | null) => {
        if (cancelled) return;
        _cache = s;
        setState({ session: s, loading: false });
      });
    return () => { cancelled = true; };
  }, []);

  return state;
}
