import { useState } from "react";
import { Badge, Button, Input, Modal, Panel, useToast } from "@gokkehub/ui";
import { supabase } from "@/lib/supabase";
import { useBounty } from "@/hooks/useBounty";
import { kr } from "@/lib/format";
import type { GamePlayer, GameSession } from "@/lib/types";

export default function BountyPanel({ session, players, usernames, userId, canManage, balance }: {
  session: GameSession;
  players: GamePlayer[];
  usernames: Record<string, string>;
  userId: string;
  canManage: boolean;
  balance: number;
}) {
  const { addToast } = useToast();
  const { entries, claims } = useBounty(session.id);
  const [enableOpen, setEnableOpen] = useState(false);
  const [buyin, setBuyin] = useState(25);
  const [koOpen, setKoOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const name = (id: string) => usernames[id] ?? "—";
  const enabled = !!session.bounty_enabled;
  const myEntry = entries.some((e) => e.user_id === userId);
  const meSeated = players.some((p) => p.user_id === userId && !p.cashed_out_at);
  const knockedOut = new Set(claims.map((c) => c.eliminated_id));
  const targets = entries.filter((e) => e.user_id !== userId && !knockedOut.has(e.user_id));

  const call = async (fn: () => PromiseLike<{ error: { message: string } | null }>, ok?: string) => {
    setBusy(true);
    const { error } = await fn();
    setBusy(false);
    if (error) { addToast(error.message, "error"); return false; }
    if (ok) addToast(ok, "success");
    return true;
  };

  // ── Not enabled: host can add it ──
  if (!enabled) {
    if (!canManage) return null;
    return (
      <>
        <Button variant="ghost" fullWidth onClick={() => setEnableOpen(true)}>+ Add mystery bounty</Button>
        <Modal open={enableOpen} onClose={() => setEnableOpen(false)}>
          <h2 className="font-display text-xl font-bold mb-1" style={{ color: "rgb(var(--text-primary-rgb))" }}>Mystery bounty</h2>
          <p className="text-sm mb-4" style={{ color: "rgb(var(--text-muted-rgb))" }}>
            Players opt in for a fixed buy-in. Knock someone out → draw a random slice of the pool (usually small, sometimes a jackpot).
          </p>
          <div className="space-y-4">
            <Input label="Bounty buy-in (kr)" type="number" inputMode="numeric" min={1}
              value={buyin} onChange={(e) => setBuyin(Math.max(1, parseInt(e.target.value || "1", 10)))} />
            <Button fullWidth loading={busy} onClick={async () => {
              if (await call(() => supabase.rpc("poker_enable_bounty", { p_session: session.id, p_buyin: buyin }), "Bounty added"))
                setEnableOpen(false);
            }}>Add bounty</Button>
          </div>
        </Modal>
      </>
    );
  }

  // ── Enabled ──
  return (
    <Panel>
      <div className="flex items-center justify-between mb-1">
        <h2 className="font-display text-lg font-bold" style={{ color: "rgb(var(--text-primary-rgb))" }}>🎯 Mystery bounty</h2>
        <Badge variant="primary">Pool {kr(session.bounty_pool ?? 0)}</Badge>
      </div>
      <p className="text-xs mb-3" style={{ color: "rgb(var(--text-muted-rgb))" }}>
        {entries.length} in · buy-in {kr(session.bounty_buyin ?? 0)}
      </p>

      {meSeated && !myEntry && (
        <Button fullWidth disabled={balance < (session.bounty_buyin ?? 0)}
          onClick={() => call(() => supabase.rpc("poker_buy_bounty", { p_session: session.id }), "You're in the bounty")}>
          Join bounty — {kr(session.bounty_buyin ?? 0)}
        </Button>
      )}

      {myEntry && (
        <Button variant="ghost" fullWidth disabled={targets.length === 0} onClick={() => setKoOpen(true)}>
          Record a knockout
        </Button>
      )}

      {/* Feed */}
      {claims.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {claims.map((c) => (
            <div key={c.id} className="flex items-center justify-between text-sm py-1.5" style={{ borderTop: "1px solid rgb(var(--border-rgb))" }}>
              <span style={{ color: "rgb(var(--text-secondary-rgb))" }}>
                <b style={{ color: "rgb(var(--text-primary-rgb))" }}>{name(c.eliminator_id)}</b> KO’d {name(c.eliminated_id)}
              </span>
              <span className="font-bold tnum" style={{ color: "rgb(var(--color-success-rgb))" }}>+{kr(c.amount)}</span>
            </div>
          ))}
        </div>
      )}

      {canManage && (session.bounty_pool ?? 0) > 0 && (
        <button className="block w-full text-center text-xs mt-3 py-1" style={{ color: "rgb(var(--text-muted-rgb))" }}
          onClick={() => call(() => supabase.rpc("poker_close_bounty", { p_session: session.id }), "Bounty closed — pool refunded")}>
          Close & refund remaining pool
        </button>
      )}

      {/* Knockout picker */}
      <Modal open={koOpen} onClose={() => setKoOpen(false)}>
        <h2 className="font-display text-xl font-bold mb-1" style={{ color: "rgb(var(--text-primary-rgb))" }}>Who did you knock out?</h2>
        <p className="text-sm mb-4" style={{ color: "rgb(var(--text-muted-rgb))" }}>You’ll draw a random bounty from the pool.</p>
        <div className="space-y-2">
          {targets.map((t) => (
            <Button key={t.user_id} variant="ghost" fullWidth loading={busy} onClick={async () => {
              setBusy(true);
              const { data, error } = await supabase.rpc("poker_record_knockout", { p_session: session.id, p_eliminated: t.user_id });
              setBusy(false);
              if (error) { addToast(error.message, "error"); return; }
              addToast(`💥 You knocked out ${name(t.user_id)} for ${kr(data as number)}!`, "success");
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
}
