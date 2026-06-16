import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Input, Panel, useToast } from "@gokkehub/ui";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { kr, formatDateTime } from "@/lib/format";
import type { Transaction } from "@/lib/types";

const QUICK = [25, 50, 100];

export default function WithdrawPage() {
  const { profile, balance, activeGroup } = useAuth();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const [amount, setAmount] = useState<number | "">("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Transaction[]>([]);
  const gid = activeGroup?.group_id;

  const loadPending = async () => {
    if (!profile || !gid) return;
    const { data } = await supabase
      .from("poker_transactions").select("*")
      .eq("user_id", profile.id).eq("group_id", gid)
      .eq("type", "withdrawal").eq("status", "pending")
      .order("created_at", { ascending: false });
    setPending((data as Transaction[]) ?? []);
  };

  useEffect(() => { loadPending(); /* eslint-disable-next-line */ }, [profile?.id, gid]);

  const request = async () => {
    if (!amount || amount <= 0) return;
    if (amount > balance) { addToast("That's more than your balance.", "error"); return; }
    setBusy(true);
    const { error } = await supabase.rpc("poker_request_withdrawal", { p_amount: amount });
    setBusy(false);
    if (error) { addToast(error.message, "error"); return; }
    addToast("Withdrawal requested", "success");
    setAmount("");
    loadPending();
  };

  const cancel = async (id: string) => {
    const { error } = await supabase.rpc("poker_cancel_topup", { p_tx: id }); // cancels any pending request
    if (error) { addToast(error.message, "error"); return; }
    loadPending();
  };

  return (
    <div className="space-y-5">
      <Panel>
        <h2 className="font-display text-xl font-bold" style={{ color: "rgb(var(--text-primary-rgb))" }}>Cash out / withdraw</h2>
        <p className="text-sm mt-1" style={{ color: "rgb(var(--text-muted-rgb))" }}>
          Request money back from the house. They’ll pay you and confirm it — your balance drops once confirmed.
        </p>
        <p className="text-sm mt-2 font-semibold" style={{ color: "rgb(var(--text-secondary-rgb))" }}>
          Available: <span className="tnum" style={{ color: "rgb(var(--color-primary-rgb))" }}>{kr(balance)}</span>
        </p>

        <div className="grid grid-cols-4 gap-2 mt-4">
          {QUICK.filter((q) => q <= balance).map((q) => (
            <button key={q} onClick={() => setAmount(q)}
              className="py-3 rounded-md text-sm font-bold tnum transition-all active:scale-[0.98]"
              style={{
                background: amount === q ? "rgba(var(--color-primary-rgb), 0.18)" : "rgb(var(--surface-input-rgb))",
                color: amount === q ? "rgb(var(--color-primary-rgb))" : "rgb(var(--text-primary-rgb))",
                border: `1px solid ${amount === q ? "rgba(var(--color-primary-rgb),0.7)" : "rgb(var(--border-rgb))"}`,
              }}>
              {q}
            </button>
          ))}
          <button onClick={() => setAmount(balance)} disabled={balance <= 0}
            className="py-3 rounded-md text-sm font-bold transition-all active:scale-[0.98]"
            style={{
              background: amount === balance && balance > 0 ? "rgba(var(--color-primary-rgb), 0.18)" : "rgb(var(--surface-input-rgb))",
              color: amount === balance && balance > 0 ? "rgb(var(--color-primary-rgb))" : "rgb(var(--text-primary-rgb))",
              border: `1px solid ${amount === balance && balance > 0 ? "rgba(var(--color-primary-rgb),0.7)" : "rgb(var(--border-rgb))"}`,
            }}>
            All
          </button>
        </div>

        <div className="mt-3">
          <Input label="Or enter an amount (kr)" type="number" inputMode="numeric" min={1} max={balance}
            value={amount} onChange={(e) => setAmount(e.target.value ? Math.max(0, parseInt(e.target.value, 10)) : "")} />
        </div>

        <div className="mt-4">
          <Button fullWidth loading={busy} disabled={!amount || amount <= 0 || amount > balance} onClick={request}>
            Request {amount ? kr(Number(amount)) : ""}
          </Button>
        </div>
      </Panel>

      {pending.length > 0 && (
        <Panel>
          <p className="text-xs uppercase font-bold tracking-wider mb-3" style={{ color: "rgb(var(--text-muted-rgb))", letterSpacing: "0.08em" }}>
            Awaiting the house
          </p>
          <div className="space-y-2">
            {pending.map((t) => (
              <div key={t.id} className="flex items-center justify-between py-2" style={{ borderTop: "1px solid rgb(var(--border-rgb))" }}>
                <div>
                  <p className="font-bold tnum" style={{ color: "rgb(var(--text-primary-rgb))" }}>{kr(t.amount)}</p>
                  <p className="text-xs" style={{ color: "rgb(var(--text-muted-rgb))" }}>{formatDateTime(t.created_at)}</p>
                </div>
                <button className="text-xs" style={{ color: "rgb(var(--text-muted-rgb))" }} onClick={() => cancel(t.id)}>Cancel</button>
              </div>
            ))}
          </div>
        </Panel>
      )}

      <Button variant="ghost" fullWidth onClick={() => navigate("/")}>Done</Button>
    </div>
  );
}
