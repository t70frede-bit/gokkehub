/**
 * Post-login redirect helpers — @gokkehub/auth/redirect
 * =======================================================
 * Pure functions (no DOM, no Workers runtime) shared by the account app's
 * OAuth handlers and every game app's "Sign in" link.
 *
 * A game sends the player to   account.gokkehub.com/login?redirect=<its URL>
 * and, after OAuth, the callback sends them back to that URL. Only https
 * URLs on gokkehub.com or one of its subdomains are accepted — anything else
 * (other hosts, look-alike domains, credentials in the URL) is an open
 * redirect and is dropped.
 */

export const ACCOUNT_ORIGIN = "https://account.gokkehub.com";

const ROOT_DOMAIN = "gokkehub.com";

/**
 * Return `raw` (normalised) if it is a safe post-login destination, else null.
 */
export function safeReturnUrl(raw: string | null | undefined): string | null {
  if (!raw || raw.length > 2048) return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  if (url.protocol !== "https:") return null;
  if (url.username || url.password || url.port) return null;

  const host = url.hostname.toLowerCase();
  if (host !== ROOT_DOMAIN && !host.endsWith(`.${ROOT_DOMAIN}`)) return null;

  return url.toString();
}

/**
 * The account-app login URL that returns the player to `returnTo` afterwards.
 * An unsafe `returnTo` is left out, so login still works and lands on /profile.
 */
export function loginUrl(returnTo?: string | null): string {
  const safe = safeReturnUrl(returnTo);
  return safe
    ? `${ACCOUNT_ORIGIN}/login?redirect=${encodeURIComponent(safe)}`
    : `${ACCOUNT_ORIGIN}/login`;
}
