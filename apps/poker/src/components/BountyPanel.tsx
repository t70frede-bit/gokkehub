import { useEffect, useState } from "react";
import { Badge, Button, Input, Modal, Panel, useToast } from "@gokkehub/ui";
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
  const { entries, claims, votes } = useBounty(session.id);
  const [koOpen, setKoOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [winnerOpen, setWinnerOpen] = useState(false);
  const [winnerStack, setWinnerStack] = useState<number | "">("");
  const [chopOpen, setChopOpen] = useState(false);
  const [chopStack, setChopStack] = useState<number | "">("");

  const enabled = !!session.bounty_enabled;
  const activePlayers = players.filter((p) => !p.cashed_out_at);
  const iAmLast = enabled && activePlayers.length === 1 && activePlayers[0]?.user_id === userId;

  // Auto-open the "last one standing" prompt for the lone survivor.
  useEffect(() => {
    if (iAmLast) setWinnerOpen(true);
  }, [iAmLast]);

  if (!enabled) return null;

  const name = (id: string) => usernames[id] ?? "—";
  const myEntry = entries.some((e) => e.user_id === userId);
  const iAmActive = activePlayers.some((p) => p.user_id === userId);
  const activeIds = new Set(activePlayers.map((p) => p.user_id));
  const claimedIds = new Set(claims.map((c) => c.eliminated_id));
  const pending = claims.filter((c) => c.status === "pending");
  const confirmed = claims.filter((c) => c.status === "confirmed");
  const targets = entries.filter((e) => e.user_id !== userId && activeIds.has(e.user_id) && !claimedIds.has(e.user_id));
  const votedActive = votes.filter((v) => activeIds.has(v.user_id)).length;
  const iVoted = votes.some((v) => v.user_id === userId);

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

      {/* Chop: everyone still in agrees to split the pool + cash out → game ends */}
      {iAmActive && activePlayers.length >= 2 && (
        <div className="mt-2">
          {iVoted ? (
            <p className="text-center text-sm" style={{ color: "rgb(var(--text-muted-rgb))" }}>
              Agreed to chop · {votedActive}/{activePlayers.length}
              <button className="ml-2 underline" onClick={() => supabase.rpc("poker_unvote_chop", { p_session: session.id })}>undo</button>
            </p>
          ) : (
            <Button variant="ghost" fullWidth onClick={() => setChopOpen(true)}>
              Chop &amp; cash out ({votedActive}/{activePlayers.length})
            </Button>
          )}
        </div>
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

      {/* Last one standing → grab the pool + cash out + end the game */}
      <Modal open={winnerOpen && iAmLast} onClose={() => setWinnerOpen(false)}>
        <h2 className="font-display text-xl font-bold mb-1" style={{ color: "rgb(var(--text-primary-rgb))" }}>🏆 Last one standing!</h2>
        <p className="text-sm mb-4" style={{ color: "rgb(var(--text-muted-rgb))" }}>
          The remaining pool <b style={{ color: "rgb(var(--color-primary-rgb))" }}>{kr(session.bounty_pool ?? 0)}</b> is yours.
          Enter your final chip value to grab it and end the game.
        </p>
        <div className="space-y-4">
          <Input label="Your chip value (kr)" type="number" inputMode="numeric" min={0}
            value={winnerStack} onChange={(e) => setWinnerStack(e.target.value ? Math.max(0, parseInt(e.target.value, 10)) : "")} />
          <Button fullWidth loading={busy} disabled={winnerStack === ""} onClick={async () => {
            setBusy(true);
            const { error } = await supabase.rpc("poker_grab_bounty", { p_session: session.id, p_cashout: Number(winnerStack) });
            setBusy(false);
            if (error) { addToast(error.message, "error"); return; }
            addToast("You took the pool and ended the game", "success");
            setWinnerOpen(false);
          }}>
            Grab {kr(session.bounty_pool ?? 0)} + cash out
          </Button>
        </div>
      </Modal>

      {/* Chop: enter your chip value; when everyone agrees, the game ends */}
      <Modal open={chopOpen} onClose={() => setChopOpen(false)}>
        <h2 className="font-display text-xl font-bold mb-1" style={{ color: "rgb(var(--text-primary-rgb))" }}>Chop &amp; cash out</h2>
        <p className="text-sm mb-4" style={{ color: "rgb(var(--text-muted-rgb))" }}>
          If everyone still in agrees, the remaining pool ({kr(session.bounty_pool ?? 0)}) is split equally and you all cash out at your chip values — then the game ends. Enter your chip value.
        </p>
        <div className="space-y-4">
          <Input label="Your chip value (kr)" type="number" inputMode="numeric" min={0}
            value={chopStack} onChange={(e) => setChopStack(e.target.value ? Math.max(0, parseInt(e.target.value, 10)) : "")} />
          <Button fullWidth loading={busy} disabled={chopStack === ""} onClick={async () => {
            setBusy(true);
            const { data, error } = await supabase.rpc("poker_vote_chop", { p_session: session.id, p_cashout: Number(chopStack) });
            setBusy(false);
            if (error) { addToast(error.message, "error"); return; }
            addToast(data === "chopped" ? "Chopped — game over!" : "Agreed to chop — waiting for the others", "success");
            setChopOpen(false);
          }}>
            Agree to chop
          </Button>
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
