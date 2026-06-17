import { useState } from "react";
import { Badge, Button, Modal, Panel, useToast } from "@gokkehub/ui";
import { supabase } from "@/lib/supabase";
import { useBounty } from "@/hooks/useBounty";
import { kr } from "@/lib/format";
import type { GamePlayer, GameSession } from "@/lib/types";

// Bounty (tournament) games. Players auto-enrol on sit-down (server-side).
// Recording a knockout creates a PENDING claim; the KO'd player or the host
// confirms it (handled by the global KnockoutPrompt + the host list here).
export default function BountyPanel({ session, players, usernames, userId, canManage }: {
  session: GameSession;
  players: GamePlayer[];
  usernames: Record<string, string>;
  userId: string;
  canManage: boolean;
}) {
  const { addToast } = useToast();
  const { entries, claims } = useBounty(session.id);
  const [koOpen, setKoOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!session.bounty_enabled) return null;

  const name = (id: string) => usernames[id] ?? "—";
  const myEntry = entries.some((e) => e.user_id === userId);
  const iAmActive = players.some((p) => p.user_id === userId && !p.cashed_out_at);
  const activeIds = new Set(players.filter((p) => !p.cashed_out_at).map((p) => p.user_id));
  const claimedIds = new Set(claims.map((c) => c.eliminated_id));
  const pending = claims.filter((c) => c.status === "pending");
  const confirmed = claims.filter((c) => c.status === "confirmed");
  const targets = entries.filter((e) => e.user_id !== userId && activeIds.has(e.user_id) && !claimedIds.has(e.user_id));

  return (
    <Panel>
      <div className="flex items-center justify-between mb-1">
        <h2 className="font-display text-lg font-bold" style={{ color: "rgb(var(--text-primary-rgb))" }}>🎯 Mystery bounty</h2>
        <Badge variant="primary">Pool {kr(session.bounty_pool ?? 0)}</Badge>
      </div>
      <p className="text-xs mb-3" style={{ color: "rgb(var(--text-muted-rgb))" }}>
        {entries.length} in · {kr(session.bounty_buyin ?? 0)} each · winnings to {session.bounty_payout === "stack" ? "stack" : "balance"}
      </p>

      {myEntry && iAmActive && (
        <Button variant="ghost" fullWidth disabled={targets.length === 0} onClick={() => setKoOpen(true)}>
          Record a knockout
        </Button>
      )}

      {/* Host/admin: resolve pending knockouts */}
      {canManage && pending.length > 0 && (
        <div className="mt-3 space-y-2">
          <p className="text-xs uppercase font-bold" style={{ color: "rgb(var(--color-warning-rgb))" }}>Pending knockouts</p>
          {pending.map((c) => (
            <div key={c.id} className="flex items-center justify-between py-1.5" style={{ borderTop: "1px solid rgb(var(--border-rgb))" }}>
              <span className="text-sm" style={{ color: "rgb(var(--text-secondary-rgb))" }}>
                <b style={{ color: "rgb(var(--text-primary-rgb))" }}>{name(c.eliminator_id)}</b> → {name(c.eliminated_id)}
              </span>
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={() => resolve(c.id, true)}>Confirm</Button>
                <button className="text-xs" style={{ color: "rgb(var(--text-muted-rgb))" }} onClick={() => resolve(c.id, false)}>Reject</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Confirmed feed */}
      {confirmed.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {confirmed.map((c) => (
            <div key={c.id} className="flex items-center justify-between text-sm py-1.5" style={{ borderTop: "1px solid rgb(var(--border-rgb))" }}>
              <span style={{ color: "rgb(var(--text-secondary-rgb))" }}>
                <b style={{ color: "rgb(var(--text-primary-rgb))" }}>{name(c.eliminator_id)}</b> KO’d {name(c.eliminated_id)}
              </span>
              <span className="font-bold tnum" style={{ color: "rgb(var(--color-success-rgb))" }}>+{kr(c.amount ?? 0)}</span>
            </div>
          ))}
        </div>
      )}

      {canManage && (session.bounty_pool ?? 0) > 0 && (
        <button className="block w-full text-center text-xs mt-3 py-1" style={{ color: "rgb(var(--text-muted-rgb))" }}
          onClick={async () => {
            const { error } = await supabase.rpc("poker_close_bounty", { p_session: session.id });
            if (error) { addToast(error.message, "error"); return; }
            addToast("Bounty closed — pool refunded", "success");
          }}>
          Close & refund remaining pool
        </button>
      )}

      <Modal open={koOpen} onClose={() => setKoOpen(false)}>
        <h2 className="font-display text-xl font-bold mb-1" style={{ color: "rgb(var(--text-primary-rgb))" }}>Who did you knock out?</h2>
        <p className="text-sm mb-4" style={{ color: "rgb(var(--text-muted-rgb))" }}>
          They’ll be asked to confirm (or the host can). Then they’re out and you draw the bounty.
        </p>
        <div className="space-y-2">
          {targets.map((t) => (
            <Button key={t.user_id} variant="ghost" fullWidth loading={busy} onClick={async () => {
              setBusy(true);
              const { error } = await supabase.rpc("poker_record_knockout", { p_session: session.id, p_eliminated: t.user_id });
              setBusy(false);
              if (error) { addToast(error.message, "error"); return; }
              addToast(`Knockout submitted — waiting for ${name(t.user_id)} or the host to confirm`, "success");
              setKoOpen(false);
            }}>
              {name(t.user_id)}
            </Button>
          ))}
          {targets.length === 0 && (
            <p className="text-sm text-center" style={{ color: "rgb(var(--text-muted-rgb))" }}>No one left to knock out.</p>
          )}
        </div>
      </Modal>
    </Panel>
  );

  async function resolve(claimId: string, ok: boolean) {
    const { error } = await supabase.rpc(ok ? "poker_confirm_knockout" : "poker_reject_knockout", { p_claim: claimId });
    if (error) { addToast(error.message, "error"); return; }
    addToast(ok ? "Knockout confirmed" : "Knockout rejected", "success");
  }
}
