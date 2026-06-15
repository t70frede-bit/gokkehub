import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge, Button, Input, Modal, Panel, useToast } from "@gokkehub/ui";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { kr } from "@/lib/format";
import type { PokerUser } from "@/lib/types";

export default function AdminPlayers() {
  const { addToast } = useToast();
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [players, setPlayers] = useState<PokerUser[]>([]);
  const [adjust, setAdjust] = useState<PokerUser | null>(null);

  const reload = async () => {
    const { data } = await supabase.from("poker_users").select("*").order("username");
    setPlayers((data as PokerUser[]) ?? []);
  };

  useEffect(() => {
    reload();
    const channel = supabase
      .channel("poker_admin_players")
      .on("postgres_changes", { event: "*", schema: "public", table: "poker_users" }, reload)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const setRole = async (p: PokerUser, role: "player" | "admin") => {
    const { error } = await supabase.rpc("poker_set_role", { p_user: p.id, p_role: role });
    if (error) { addToast(error.message, "error"); return; }
    addToast(role === "admin" ? `${p.username} is now house` : `${p.username} is now a player`, "success");
  };

  return (
    <div className="space-y-4">
      <p className="text-xs" style={{ color: "rgb(var(--text-muted-rgb))" }}>
        Players appear here automatically the first time they sign in with Discord.
      </p>

      <div className="space-y-2">
        {players.map((p) => (
          <Panel key={p.id} variant="bare" className="p-3">
            <div className="flex items-center justify-between">
              <button className="flex items-center gap-2 min-w-0" onClick={() => navigate(`/players/${p.id}`)}>
                <span className="font-bold truncate" style={{ color: "rgb(var(--text-primary-rgb))" }}>{p.username}</span>
                {p.role === "admin" && <Badge variant="host">House</Badge>}
              </button>
              <div className="flex items-center gap-3 flex-shrink-0">
                <span className="font-bold tnum" style={{ color: "rgb(var(--color-primary-rgb))" }}>{kr(p.balance)}</span>
                <Button size="sm" variant="ghost" onClick={() => setAdjust(p)}>Adjust</Button>
              </div>
            </div>

            {/* Role toggle — don't let an admin demote themselves by accident. */}
            <div className="flex gap-1.5 mt-2.5">
              {(["player", "admin"] as const).map((r) => {
                const isSelf = p.id === profile?.id;
                const active = p.role === r;
                return (
                  <button key={r} disabled={active || (isSelf && r === "player")}
                    onClick={() => setRole(p, r)}
                    className="flex-1 py-1.5 rounded-md text-[11px] font-bold capitalize transition-all active:scale-[0.98] disabled:opacity-100"
                    style={{
                      background: active ? "rgba(var(--color-primary-rgb),0.16)" : "rgb(var(--surface-input-rgb))",
                      color: active ? "rgb(var(--color-primary-rgb))" : "rgb(var(--text-secondary-rgb))",
                      border: `1px solid ${active ? "rgba(var(--color-primary-rgb),0.6)" : "rgb(var(--border-rgb))"}`,
                      opacity: isSelf && r === "player" ? 0.4 : 1,
                    }}>
                    {r === "admin" ? "House" : "Player"}
                  </button>
                );
              })}
            </div>
          </Panel>
        ))}
      </div>

      {adjust && <AdjustModal player={adjust} onClose={() => setAdjust(null)} addToast={addToast} />}
    </div>
  );
}

function AdjustModal({ player, onClose, addToast }: {
  player: PokerUser; onClose: () => void; addToast: (m: string, v?: "error" | "success" | "info") => void;
}) {
  const [delta, setDelta] = useState<number | "">("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (delta === "" || delta === 0) return;
    setBusy(true);
    const { error } = await supabase.rpc("poker_admin_adjust_balance", {
      p_user: player.id, p_delta: Number(delta), p_note: note || null,
    });
    setBusy(false);
    if (error) { addToast(error.message, "error"); return; }
    addToast("Balance adjusted", "success");
    onClose();
  };

  return (
    <Modal open onClose={onClose}>
      <h2 className="font-display text-xl font-bold mb-1" style={{ color: "rgb(var(--text-primary-rgb))" }}>Adjust {player.username}</h2>
      <p className="text-sm mb-4" style={{ color: "rgb(var(--text-muted-rgb))" }}>Current balance {kr(player.balance)}</p>
      <div className="space-y-4">
        <Input label="Change (kr) — positive credits, negative debits" type="number" inputMode="numeric"
          value={delta} onChange={(e) => setDelta(e.target.value ? parseInt(e.target.value, 10) : "")} />
        <Input label="Note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. cash handed over" />
        <Button fullWidth loading={busy} disabled={delta === "" || delta === 0} onClick={submit}>Apply</Button>
        <p className="text-center text-xs" style={{ color: "rgb(var(--text-muted-rgb))" }}>
          A debit that would push the balance below 0 is rejected automatically.
        </p>
      </div>
    </Modal>
  );
}
