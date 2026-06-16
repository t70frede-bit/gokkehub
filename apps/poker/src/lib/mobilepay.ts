// MobilePay helpers.
//
// Each GROUP has its own MobilePay Box (set by the group admin), so the box URL
// is passed in per top-up rather than read from a global env. We pay into the
// box pay-in link: it prefills the amount; the tracking code can't be reliably
// prefilled into the box message, so the top-up screen shows it to paste.

export const TRACKING_PREFIX =
  (import.meta.env.VITE_TRACKING_PREFIX as string) || "GokkePoker";

/** The human-readable tracking reference, e.g. "GokkePoker #4829". */
export function trackingRef(code: string): string {
  return `${TRACKING_PREFIX} #${code}`;
}

/**
 * Box pay-in link with the amount prefilled.
 *
 * IMPORTANT: the box link's `amount` is in ØRE (1/100 kr) — verified against the
 * live page (amount=50 → 0,50 kr) — so we multiply kroner by 100.
 */
export function mobilePayBoxLink(boxUrl: string, amount: number, code: string): string {
  const ore = Math.round(amount * 100);
  const comment = encodeURIComponent(trackingRef(code));
  const sep = boxUrl.includes("?") ? "&" : "?";
  return `${boxUrl}${sep}amount=${ore}&comment=${comment}`;
}
