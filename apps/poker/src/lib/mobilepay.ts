// MobilePay deep-link helpers. The recipient number and the tracking-code prefix
// (the "app name") are environment variables, per spec.

export const TRACKING_PREFIX =
  (import.meta.env.VITE_TRACKING_PREFIX as string) || "GokkePoker";

export const MOBILEPAY_NUMBER =
  (import.meta.env.VITE_MOBILEPAY_NUMBER as string) || "";

/** The human-readable tracking reference, e.g. "GokkePoker #4829". */
export function trackingRef(code: string): string {
  return `${TRACKING_PREFIX} #${code}`;
}

/**
 * Build the MobilePay deep link.
 *   mobilepay://send?phone=XXXXXXXX&amount=XXX&comment=AppName+%234829
 */
export function mobilePayLink(amount: number, code: string): string {
  const comment = encodeURIComponent(trackingRef(code)); // "GokkePoker+%234829"
  return `mobilepay://send?phone=${MOBILEPAY_NUMBER}&amount=${amount}&comment=${comment}`;
}
