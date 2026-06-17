import { useState } from "react";
import { Badge, Button, Modal, Panel, useToast } from "@gokkehub/ui";
import { supabase } from "@/lib/supabase";
import { useBounty } from "@/hooks/useBounty";
import { kr } from "@/lib/format";
import type { GamePlayer, GameSession } from "@/lib/types";

// Shown only for bounty (tournament) games. Players are auto-enrolled when they
// sit down (handled server-side in join), so here we just record knockouts,
// show the live feed + pool, and let the host close/refund the remainder.
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
  const knockedOut = new Set(claims.map((c) => c.eliminated_id));
  const targets = entries.filter((e) => e.user_id !== userId && !knockedOut.has(e.user_id));
  void players;

  return (
    <Panel>
      <div className="flex items-center justify-between mb-1">
        <h2 className="font-display text-lg font-bold" style={{ color: "rgb(var(--text-primary-rgb))" }}>🎯 Mystery bounty</h2>
        <Badge variant="primary">Pool {kr(session.bounty_pool ?? 0)}</Badge>
      </div>
      <p className="text-xs mb-3" style={{ color: "rgb(var(--text-muted-rgb))" }}>
        {entries.length} in · {kr(session.bounty_buyin ?? 0)} each (paid on buy-in)
      </p>

      {myEntry && (
        <Button variant="ghost" fullWidth disabled={targets.length === 0} onClick={() => setKoOpen(true)}>
          Record a knockout
        </Button>
      )}

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
