import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Input, Panel, useToast } from "@gokkehub/ui";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { kr, formatDateTime } from "@/lib/format";
import { mobilePayLink, trackingRef, MOBILEPAY_NUMBER } from "@/lib/mobilepay";
import type { Transaction } from "@/lib/types";

const QUICK = [5, 10, 25, 50];

export default function TopUpPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const [amount, setAmount] = useState<number | "">("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<Transaction | null>(null);
  const [pending, setPending] = useState<Transaction[]>([]);

  const loadPending = async () => {
    if (!profile) return;
    const { data } = await supabase
      .from("poker_transactions")
      .select("*")
      .eq("user_id", profile.id)
      .eq("type", "deposit")
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    setPending((data as Transaction[]) ?? []);
  };

  useEffect(() => { loadPending(); /* eslint-disable-next-line */ }, [profile?.id]);

  const request = async () => {
    if (!amount || amount <= 0) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("poker_request_topup", { p_amount: amount });
    setBusy(false);
    if (error) { addToast(error.message, "error"); return; }
    setCreated(data as Transaction);
    setAmount("");
    loadPending();
  };

  const cancel = async (id: string) => {
    const { error } = await supabase.rpc("poker_cancel_topup", { p_tx: id });
    if (error) { addToast(error.message, "error"); return; }
    if (created?.id === id) setCreated(null);
    loadPending();
  };

  // ── Code + MobilePay step ──
  if (created) {
    const ref = trackingRef(created.tracking_code!);
    return (
      <div className="space-y-5">
        <Panel>
          <p className="text-xs uppercase font-bold tracking-wider text-center" style={{ color: "rgb(var(--text-muted-rgb))", letterSpacing: "0.08em" }}>
            Pay this much
          </p>
          <p className="font-display font-bold tnum text-center mt-1" style={{ fontSize: "var(--text-3xl)", color: "rgb(var(--color-primary-rgb))" }}>
            {kr(created.amount)}
          </p>

          <div className="mt-5 p-4 rounded-lg text-center" style={{ background: "rgb(var(--surface-input-rgb))", border: "1px dashed rgb(var(--border-rgb))" }}>
            <p className="text-xs uppercase font-bold" style={{ color: "rgb(var(--text-muted-rgb))" }}>Tracking code</p>
            <p className="mono font-bold mt-1" style={{ fontSize: "var(--text-2xl)", color: "rgb(var(--text-primary-rgb))" }}>{ref}</p>
            <p className="text-xs mt-1" style={{ color: "rgb(var(--text-muted-rgb))" }}>
              Put this in the MobilePay comment so the house can match your payment.
            </p>
          </div>

          {MOBILEPAY_NUMBER ? (
            <a href={mobilePayLink(created.amount, created.tracking_code!)} className="block mt-5">
              <Button fullWidth>Open MobilePay</Button>
            </a>
          ) : (
            <p className="text-sm mt-5 text-center" style={{ color: "rgb(var(--color-danger-rgb))" }}>
              MobilePay number not configured (VITE_MOBILEPAY_NUMBER).
            </p>
          )}

          <div className="mt-4 flex items-center justify-center gap-2 text-sm" style={{ color: "rgb(var(--color-warning-rgb))" }}>
            <span className="inline-block w-2 h-2 rounded-full" style={{ background: "rgb(var(--color-warning-rgb))" }} />
            Payment pending — return here after paying.
          </div>
        </Panel>

        <Button variant="ghost" fullWidth onClick={() => navigate("/")}>Done</Button>
        <button className="block w-full text-center text-xs" style={{ color: "rgb(var(--text-muted-rgb))" }} onClick={() => cancel(created.id)}>
          Cancel this request
        </button>
      </div>
    );
  }

  // ── Amount picker step ──
  return (
    <div className="space-y-5">
      <Panel>
        <h2 className="font-display text-xl font-bold" style={{ color: "rgb(var(--text-primary-rgb))" }}>Request a top-up</h2>
        <p className="text-sm mt-1" style={{ color: "rgb(var(--text-muted-rgb))" }}>
          Pick an amount, pay via MobilePay, and the house confirms it into your balance.
        </p>

        <div className="grid grid-cols-4 gap-2 mt-4">
          {QUICK.map((q) => (
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
        </div>

        <div className="mt-3">
          <Input
            label="Or enter an amount (kr)"
            type="number" inputMode="numeric" min={1}
            value={amount}
            onChange={(e) => setAmount(e.target.value ? Math.max(0, parseInt(e.target.value, 10)) : "")}
          />
        </div>

        <div className="mt-4">
          <Button fullWidth loading={busy} disabled={!amount || amount <= 0} onClick={request}>
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
                  <p className="text-xs mono" style={{ color: "rgb(var(--text-muted-rgb))" }}>
                    {trackingRef(t.tracking_code!)} · {formatDateTime(t.created_at)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={() => setCreated(t)}>Pay</Button>
                  <button className="text-xs" style={{ color: "rgb(var(--text-muted-rgb))" }} onClick={() => cancel(t.id)}>Cancel</button>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}
