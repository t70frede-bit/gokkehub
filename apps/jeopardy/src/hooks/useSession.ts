import { useEffect, useState } from "react";
import type { GokkeHubSession } from "../lib/types";
import { loginUrl } from "@gokkehub/auth/redirect";

const SESSION_URL = "https://account.gokkehub.com/auth/me";

/**
 * Local dev identity. The real session cookie is Domain=.gokkehub.com + Secure,
 * so it is never sent to http://localhost — without this you are permanently
 * signed out locally. Set VITE_DEV_USER_ID in apps/jeopardy/.env to your own
 * user id (it must match DEV_USER_ID in .dev.vars so the Functions agree).
 *
 * `import.meta.env.DEV` is inlined as `false` by Vite in a production build,
 * so this whole branch is dead code — it cannot ship.
 */
export const DEV_SESSION: GokkeHubSession | null =
  import.meta.env.DEV && import.meta.env.VITE_DEV_USER_ID
    ? {
        userId:      import.meta.env.VITE_DEV_USER_ID as string,
        displayName: (import.meta.env.VITE_DEV_USER_NAME as string) || "Dev Host",
        email:       null,
        avatarUrl:   null,
      }
    : null;

let _cache: GokkeHubSession | null | undefined = undefined;

export function useSession() {
  const [state, setState] = useState<{ session: GokkeHubSession | null; loading: boolean }>({
    session: DEV_SESSION ?? (_cache !== undefined ? _cache : null),
    loading: DEV_SESSION ? false : _cache === undefined,
  });

  useEffect(() => {
    if (DEV_SESSION) return;
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

/**
 * Send an unauthenticated visitor to the account app to log in. In local dev
 * with a DEV_SESSION there is nothing to log into — bouncing to the live site
 * would just throw away whatever you were testing.
 */
export function goToLogin(): void {
  if (DEV_SESSION) {
    console.warn("[jeopardy] Already signed in as the local dev user — skipping the login redirect.");
    return;
  }
  window.location.href = loginUrl(window.location.href);
}
