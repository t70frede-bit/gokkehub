// MobilePay helpers.
//
// We pay into a MobilePay **Box** (a free personal collection link) rather than a
// person-to-person deep link — the old `mobilepay://send` scheme is deprecated
// and unreliable. The box link prefills the amount; the tracking code can't be
// reliably prefilled into the box message, so the top-up screen shows it for the
// payer to paste (and we pass it as a best-effort `comment` in case it's honoured).

export const TRACKING_PREFIX =
  (import.meta.env.VITE_TRACKING_PREFIX as string) || "GokkePoker";

// Public, shareable MobilePay Box "pay-in" link (Box 3056KX). Overridable via env.
export const MOBILEPAY_BOX_URL =
  (import.meta.env.VITE_MOBILEPAY_BOX_URL as string) ||
  "https://qr.mobilepay.dk/box/063cb2bd-0e5d-4d3b-8539-b2f389efc3ad/pay-in";

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
export function mobilePayBoxLink(amount: number, code: string): string {
  const ore = Math.round(amount * 100);
  const comment = encodeURIComponent(trackingRef(code));
  return `${MOBILEPAY_BOX_URL}?amount=${ore}&comment=${comment}`;
}
