import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge, Button, Input, Modal, Panel, useToast } from "@gokkehub/ui";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { kr } from "@/lib/format";
import type { GroupMemberRow } from "@/lib/types";

export default function AdminPlayers() {
  const { addToast } = useToast();
  const { activeGroup, profile } = useAuth();
  const navigate = useNavigate();
  const gid = activeGroup?.group_id;
  const [members, setMembers] = useState<GroupMemberRow[]>([]);
  const [adjust, setAdjust] = useState<GroupMemberRow | null>(null);

  const reload = async () => {
    if (!gid) return;
    const { data } = await supabase.rpc("poker_group_member_list", { p_group: gid });
    setMembers((data as GroupMemberRow[]) ?? []);
  };

  useEffect(() => {
    reload();
    const channel = supabase
      .channel("poker_admin_members")
      .on("postgres_changes", { event: "*", schema: "public", table: "poker_group_members" }, reload)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gid]);

  const setRole = async (m: GroupMemberRow, role: "player" | "admin") => {
    const { error } = await supabase.rpc("poker_set_member_role", { p_group: gid, p_user: m.user_id, p_role: role });
    if (error) { addToast(error.message, "error"); return; }
    addToast(role === "admin" ? `${m.username} is now house` : `${m.username} is now a player`, "success");
  };
  const approve = async (m: GroupMemberRow) => {
    const { error } = await supabase.rpc("poker_approve_member", { p_member: m.member_id });
    if (error) { addToast(error.message, "error"); return; }
    addToast(`${m.username} approved`, "success");
  };
  const reject = async (m: GroupMemberRow) => {
    const { error } = await supabase.rpc("poker_reject_member", { p_member: m.member_id });
    if (error) { addToast(error.message, "error"); return; }
  };

  const pending = members.filter((m) => m.status === "pending");
  const active = members.filter((m) => m.status === "active");
  const totalBalance = active.reduce((s, m) => s + m.balance, 0);

  return (
    <div className="space-y-4">
      {pending.length > 0 && (
        <Panel>
          <p className="text-xs uppercase font-bold tracking-wider mb-3" style={{ color: "rgb(var(--color-warning-rgb))", letterSpacing: "0.08em" }}>
            Join requests ({pending.length})
          </p>
          <div className="space-y-2">
            {pending.map((m) => (
              <div key={m.member_id} className="flex items-center justify-between py-2" style={{ borderTop: "1px solid rgb(var(--border-rgb))" }}>
                <span className="font-bold" style={{ color: "rgb(var(--text-primary-rgb))" }}>{m.username}</span>
                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={() => approve(m)}>Approve</Button>
                  <button className="text-xs" style={{ color: "rgb(var(--text-muted-rgb))" }} onClick={() => reject(m)}>Reject</button>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      <Panel variant="bare" className="p-3 flex items-center justify-between">
        <div>
          <p className="text-xs uppercase font-bold" style={{ color: "rgb(var(--text-muted-rgb))", letterSpacing: "0.06em" }}>
            Total held balance
          </p>
          <p className="text-[11px]" style={{ color: "rgb(var(--text-muted-rgb))" }}>
            {active.length} {active.length === 1 ? "player" : "players"} · what the house owes
          </p>
        </div>
        <span className="font-display font-bold tnum" style={{ fontSize: "var(--text-xl)", color: "rgb(var(--color-primary-rgb))" }}>
          {kr(totalBalance)}
        </span>
      </Panel>

      <p className="text-xs" style={{ color: "rgb(var(--text-muted-rgb))" }}>
        Members of {activeGroup?.name}. Players appear after they join.
      </p>

      <div className="space-y-2">
        {active.map((m) => (
          <Panel key={m.member_id} variant="bare" className="p-3">
            <div className="flex items-center justify-between">
              <button className="flex items-center gap-2 min-w-0" onClick={() => navigate(`/players/${m.user_id}`)}>
                <span className="font-bold truncate" style={{ color: "rgb(var(--text-primary-rgb))" }}>{m.username}</span>
                {m.role === "admin" && <Badge variant="host">House</Badge>}
              </button>
              <div className="flex items-center gap-3 flex-shrink-0">
                <span className="font-bold tnum" style={{ color: "rgb(var(--color-primary-rgb))" }}>{kr(m.balance)}</span>
                <Button size="sm" variant="ghost" onClick={() => setAdjust(m)}>Adjust</Button>
              </div>
            </div>

            <div className="flex gap-1.5 mt-2.5">
              {(["player", "admin"] as const).map((r) => {
                const isSelf = m.user_id === profile?.id;
                const activeRole = m.role === r;
                return (
                  <button key={r} disabled={activeRole || (isSelf && r === "player")}
                    onClick={() => setRole(m, r)}
                    className="flex-1 py-1.5 rounded-md text-[11px] font-bold capitalize transition-all active:scale-[0.98] disabled:opacity-100"
                    style={{
                      background: activeRole ? "rgba(var(--color-primary-rgb),0.16)" : "rgb(var(--surface-input-rgb))",
                      color: activeRole ? "rgb(var(--color-primary-rgb))" : "rgb(var(--text-secondary-rgb))",
                      border: `1px solid ${activeRole ? "rgba(var(--color-primary-rgb),0.6)" : "rgb(var(--border-rgb))"}`,
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

      {adjust && gid && <AdjustModal member={adjust} groupId={gid} onClose={() => setAdjust(null)} addToast={addToast} />}
    </div>
  );
}

function AdjustModal({ member, groupId, onClose, addToast }: {
  member: GroupMemberRow; groupId: string; onClose: () => void;
  addToast: (m: string, v?: "error" | "success" | "info") => void;
}) {
  const [delta, setDelta] = useState<number | "">("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (delta === "" || delta === 0) return;
    setBusy(true);
    const { error } = await supabase.rpc("poker_admin_adjust_balance", {
      p_group: groupId, p_user: member.user_id, p_delta: Number(delta), p_note: note || null,
    });
    setBusy(false);
    if (error) { addToast(error.message, "error"); return; }
    addToast("Balance adjusted", "success");
    onClose();
  };

  return (
    <Modal open onClose={onClose}>
      <h2 className="font-display text-xl font-bold mb-1" style={{ color: "rgb(var(--text-primary-rgb))" }}>Adjust {member.username}</h2>
      <p className="text-sm mb-4" style={{ color: "rgb(var(--text-muted-rgb))" }}>Current balance {kr(member.balance)}</p>
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
