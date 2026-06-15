// Money is whole kroner (DKK) stored as integers.

export function kr(amount: number | null | undefined): string {
  if (amount == null) return "—";
  return `${amount.toLocaleString("da-DK")} kr`;
}

/** Signed amount with explicit + / − and colour intent baked in by the caller. */
export function krSigned(amount: number | null | undefined): string {
  if (amount == null) return "—";
  const sign = amount > 0 ? "+" : amount < 0 ? "−" : "";
  return `${sign}${Math.abs(amount).toLocaleString("da-DK")} kr`;
}

export function netColor(net: number | null | undefined): string {
  if (net == null || net === 0) return "rgb(var(--text-secondary-rgb))";
  return net > 0 ? "rgb(var(--color-success-rgb))" : "rgb(var(--color-danger-rgb))";
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("da-DK", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("da-DK", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const TX_LABELS: Record<string, string> = {
  deposit: "Top-up",
  withdrawal: "Withdrawal",
  buy_in: "Buy-in",
  cash_out: "Cash-out",
  rebuy: "Rebuy",
};
export const txLabel = (t: string) => TX_LABELS[t] ?? t;

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  rejected: "Rejected",
  cancelled: "Cancelled",
};
export const statusLabel = (s: string) => STATUS_LABELS[s] ?? s;
