// Per-group payment methods. Each group picks how players pay the "house".
// Where a provider supports a prefilled link we build one; otherwise we show the
// payment_value as instructions plus the (always-copyable) tracking code.
//
// Link formats researched 2026-06-16:
//   MobilePay Box (DK/FI): <box>/pay-in?amount=<øre>            (amount in øre)
//   Swish (SE):  https://app.swish.nu/1/p/sw/?sw=<no>&amt=<amt>&cur=SEK&msg=<ref>
//   PayPal.me:   https://paypal.me/<handle>/<amount>
//   Revolut/Vipps/other: no reliable prefilled deep link → manual.

import { trackingRef, TRACKING_PREFIX } from "@/lib/mobilepay";
import type { PaymentType } from "@/lib/types";

export { trackingRef, TRACKING_PREFIX };

export interface PaymentMethodSpec {
  type: PaymentType;
  label: string;
  /** What the group admin enters as payment_value. */
  valueLabel: string;
  valuePlaceholder: string;
  /** True if we can build a deep link that prefills the amount. */
  prefills: boolean;
  /** Optional helper shown under the input. */
  hint?: string;
}

export const PAYMENT_METHODS: PaymentMethodSpec[] = [
  { type: "mobilepay_box", label: "MobilePay Box", valueLabel: "Box pay-in link",
    valuePlaceholder: "https://qr.mobilepay.dk/box/…/pay-in", prefills: true,
    hint: "In MobilePay: open your Box → Request → Copy link, and paste it here. (The short box number alone won’t work.)" },
  { type: "swish", label: "Swish", valueLabel: "Swish number",
    valuePlaceholder: "e.g. 0701234567", prefills: true },
  { type: "paypal", label: "PayPal", valueLabel: "PayPal.me handle",
    valuePlaceholder: "e.g. yourname (from paypal.me/yourname)", prefills: true },
  { type: "revolut", label: "Revolut", valueLabel: "Revolut.me link",
    valuePlaceholder: "https://revolut.me/yourtag", prefills: false },
  { type: "vipps", label: "Vipps", valueLabel: "Vipps number",
    valuePlaceholder: "e.g. 12345678", prefills: false },
  { type: "other", label: "Other / bank", valueLabel: "Instructions or link",
    valuePlaceholder: "Reg 1234 · Acct 5678901234, or any link", prefills: false },
];

export function paymentLabel(type: PaymentType): string {
  return PAYMENT_METHODS.find((m) => m.type === type)?.label ?? type;
}

export interface PaymentTarget {
  /** A tappable deep link, when the provider supports one (else null). */
  href: string | null;
  /** True when href prefills the amount (so the user mostly just confirms). */
  prefilled: boolean;
  /** Whether payment_value is itself a URL worth surfacing as a plain link. */
  valueIsUrl: boolean;
}

const isUrl = (s: string) => /^https?:\/\//i.test(s.trim());

export function buildPayment(
  type: PaymentType,
  value: string | null,
  amount: number,
  code: string,
): PaymentTarget {
  const v = (value ?? "").trim();
  const ref = trackingRef(code);
  if (!v) return { href: null, prefilled: false, valueIsUrl: false };

  switch (type) {
    case "mobilepay_box": {
      const ore = Math.round(amount * 100); // box amount is in øre
      const sep = v.includes("?") ? "&" : "?";
      return { href: `${v}${sep}amount=${ore}&comment=${encodeURIComponent(ref)}`, prefilled: true, valueIsUrl: true };
    }
    case "swish": {
      const sw = v.replace(/[^0-9]/g, "");
      const href = `https://app.swish.nu/1/p/sw/?sw=${sw}&amt=${amount}&cur=SEK&msg=${encodeURIComponent(ref)}`;
      return { href, prefilled: true, valueIsUrl: false };
    }
    case "paypal": {
      const handle = v.replace(/^https?:\/\/(www\.)?paypal\.me\//i, "").replace(/^@/, "").replace(/\/+$/, "");
      return { href: `https://paypal.me/${handle}/${amount}`, prefilled: true, valueIsUrl: false };
    }
    case "revolut":
    case "vipps":
    case "other":
    default:
      // No reliable prefill — open the link if it is one; otherwise just show
      // the instructions and the copyable tracking code.
      return { href: isUrl(v) ? v : null, prefilled: false, valueIsUrl: isUrl(v) };
  }
}
