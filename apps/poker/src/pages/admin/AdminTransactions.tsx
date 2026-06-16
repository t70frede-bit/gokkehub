import { useEffect, useState } from "react";
import { Panel, useToast } from "@gokkehub/ui";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { useUsernames } from "@/hooks/useUsernames";
import { kr, txLabel, statusLabel, formatDateTime } from "@/lib/format";
import { trackingRef } from "@/lib/payment";
import type { Transaction, TxStatus } from "@/lib/types";

const FILTERS: (TxStatus | "all")[] = ["all", "pending", "confirmed", "cancelled", "rejected"];
const ALL_STATUSES: TxStatus[] = ["pending", "confirmed", "rejected", "cancelled"];

const statusColor: Record<TxStatus, string> = {
  pending: "rgb(var(--color-warning-rgb))",
  confirmed: "rgb(var(--color-success-rgb))",
  rejected: "rgb(var(--color-danger-rgb))",
  cancelled: "rgb(var(--text-muted-rgb))",
};

// Money leaving a player's balance shows with a minus.
const NEGATIVE = new Set(["withdrawal", "buy_in", "rebuy"]);

export default function AdminTransactions() {
  const { addToast } = useToast();
  const { activeGroup } = useAuth();
  const usernames = useUsernames(activeGroup?.group_id);
  const [filter, setFilter] = useState<TxStatus | "all">("pending");
  const [txs, setTxs] = useState<Transaction[]>([]);
  const gid = activeGroup?.group_id;

  const reload = async () => {
    if (!gid) return;
    const { data } = await supabase
      .from("poker_transactions")
      .select("*")
      .eq("group_id", gid)
      .order("created_at", { ascending: false })
      .limit(300);
    setTxs((data as Transaction[]) ?? []);
  };

  useEffect(() => {
    reload();
    const channel = supabase
      .channel("poker_admin_tx")
      .on("postgres_changes", { event: "*", schema: "public", table: "poker_transactions" }, reload)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gid]);

  const setStatus = async (tx: Transaction, status: TxStatus) => {
    if (tx.status === status) return;
    const { error } = await supabase.rpc("poker_set_transaction_status", { p_tx: tx.id, p_status: status });
    if (error) { addToast(error.message, "error"); return; }
    addToast(`Marked ${statusLabel(status).toLowerCase()}`, "success");
  };

  const shown = txs.filter((t) => filter === "all" || t.status === filter);
  const pendingCount = txs.filter((t) => t.status === "pending").length;

  return (
    <div className="space-y-4">
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1">
        {FILTERS.map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className="px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap capitalize transition-all"
            style={{
              background: filter === f ? "rgba(var(--color-primary-rgb),0.18)" : "rgb(var(--surface-raised-rgb))",
              color: filter === f ? "rgb(var(--color-primary-rgb))" : "rgb(var(--text-secondary-rgb))",
              border: `1px solid ${filter === f ? "rgba(var(--color-primary-rgb),0.7)" : "rgb(var(--border-rgb))"}`,
            }}>
            {f}{f === "pending" && pendingCount > 0 ? ` (${pendingCount})` : ""}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <Panel><p className="text-sm text-center" style={{ color: "rgb(var(--text-muted-rgb))" }}>Nothing here.</p></Panel>
      ) : (
        <div className="space-y-2">
          {shown.map((t) => {
            const neg = NEGATIVE.has(t.type);
            return (
              <Panel key={t.id} variant="bare" className="p-3">
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold truncate" style={{ color: "rgb(var(--text-primary-rgb))" }}>
                        {usernames[t.user_id] ?? "—"}
                      </span>
                      <span className="text-xs font-semibold" style={{ color: "rgb(var(--text-muted-rgb))" }}>{txLabel(t.type)}</span>
                    </div>
                    <p className="text-[11px] mono mt-0.5" style={{ color: "rgb(var(--text-muted-rgb))" }}>
                      {t.tracking_code ? trackingRef(t.tracking_code) + " · " : ""}{formatDateTime(t.created_at)}
                    </p>
                    {t.note && <p className="text-[11px] mt-0.5" style={{ color: "rgb(var(--text-muted-rgb))" }}>{t.note}</p>}
                  </div>
                  <div className="text-right flex-shrink-0 ml-3">
                    <p className="font-bold tnum" style={{ color: neg ? "rgb(var(--color-danger-rgb))" : "rgb(var(--text-primary-rgb))" }}>
                      {neg ? "−" : "+"}{kr(t.amount).replace(" kr", "")}
                    </p>
                    <p className="text-[11px] font-bold uppercase" style={{ color: statusColor[t.status] }}>{statusLabel(t.status)}</p>
                  </div>
                </div>

                {/* Quick status changer — tap a chip to set. Lets the admin
                    confirm/reject pending and revert accidental cancellations. */}
                <div className="flex gap-1.5 mt-2.5">
                  {ALL_STATUSES.map((s) => (
                    <button key={s} onClick={() => setStatus(t, s)} disabled={t.status === s}
                      className="flex-1 py-1.5 rounded-md text-[11px] font-bold capitalize transition-all active:scale-[0.98] disabled:opacity-100"
                      style={{
                        background: t.status === s ? "rgba(var(--color-primary-rgb),0.16)" : "rgb(var(--surface-input-rgb))",
                        color: t.status === s ? "rgb(var(--color-primary-rgb))" : "rgb(var(--text-secondary-rgb))",
                        border: `1px solid ${t.status === s ? "rgba(var(--color-primary-rgb),0.6)" : "rgb(var(--border-rgb))"}`,
                      }}>
                      {s}
                    </button>
                  ))}
                </div>
              </Panel>
            );
          })}
        </div>
      )}
    </div>
  );
}
