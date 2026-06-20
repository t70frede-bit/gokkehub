import { useEffect, useState } from "react";
import { Button, Input, Modal, Panel, useToast } from "@gokkehub/ui";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { PAYMENT_METHODS } from "@/lib/payment";
import { JoinModePicker } from "@/pages/GroupsPage";
import type { GroupMemberRow, JoinMode, PaymentType } from "@/lib/types";

interface GroupRow {
  name: string;
  payment_type: PaymentType;
  payment_value: string | null;
  passcode: string | null;
  invite_token: string;
  join_invite: boolean;
  join_request: boolean;
  join_passcode: boolean;
}

export default function AdminGroupSettings() {
  const { activeGroup, refresh, profile } = useAuth();
  const { addToast } = useToast();
  const gid = activeGroup?.group_id;
  const [g, setG] = useState<GroupRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [members, setMembers] = useState<GroupMemberRow[]>([]);
  const [transferTo, setTransferTo] = useState<GroupMemberRow | null>(null);

  useEffect(() => {
    if (!gid) return;
    // passcode is intentionally NOT selected — it's write-only (hardening 017).
    supabase.from("poker_groups")
      .select("name, payment_type, payment_value, invite_token, join_invite, join_request, join_passcode")
      .eq("id", gid).single()
      .then(({ data }) => setG((data ? { ...(data as object), passcode: "" } as GroupRow : null)));
    supabase.rpc("poker_group_member_list", { p_group: gid })
      .then(({ data }) => setMembers((data as GroupMemberRow[]) ?? []));
  }, [gid]);

  const transfer = async () => {
    if (!transferTo || !gid) return;
    const { error } = await supabase.rpc("poker_transfer_ownership", { p_group: gid, p_user: transferTo.user_id });
    setTransferTo(null);
    if (error) { addToast(error.message, "error"); return; }
    addToast(`Ownership transferred to ${transferTo.username}`, "success");
    refresh();
  };

  if (!g) return <p className="text-sm" style={{ color: "rgb(var(--text-muted-rgb))" }}>Loading…</p>;

  const set = (patch: Partial<GroupRow>) => setG({ ...g, ...patch });
  const spec = PAYMENT_METHODS.find((m) => m.type === g.payment_type)!;
  const inviteLink = `${window.location.origin}/join/${g.invite_token}`;

  const joinMode: JoinMode = g.join_passcode ? "passcode" : g.join_request ? "request" : "invite";
  const setJoinMode = (m: JoinMode) =>
    set({ join_invite: m === "invite", join_request: m === "request", join_passcode: m === "passcode" });

  const save = async () => {
    // passcode is write-only: blank = keep the current one. Only validate a new one.
    if (joinMode === "passcode" && (g.passcode ?? "") !== "" && (g.passcode ?? "").length < 3) {
      addToast("Passcode too short.", "error"); return;
    }
    setBusy(true);
    const { error } = await supabase.rpc("poker_update_group", {
      p_group: gid, p_name: g.name, p_payment_type: g.payment_type, p_payment_value: g.payment_value,
      p_join_invite: g.join_invite, p_join_request: g.join_request, p_join_passcode: g.join_passcode,
      p_passcode: g.join_passcode ? g.passcode : null,
    });
    setBusy(false);
    if (error) { addToast(error.message, "error"); return; }
    addToast("Group updated", "success");
    refresh();
  };

  const copyInvite = () =>
    navigator.clipboard?.writeText(inviteLink).then(
      () => addToast("Invite link copied", "success"),
      () => addToast("Couldn't copy", "error"),
    );

  return (
    <div className="space-y-4">
      <Panel>
        <div className="space-y-4">
          <Input label="Group name" value={g.name} onChange={(e) => set({ name: e.target.value })} />

          <div>
            <p className="text-sm font-semibold mb-2" style={{ color: "rgb(var(--text-secondary-rgb))" }}>Payment method</p>
            <div className="grid grid-cols-3 gap-2">
              {PAYMENT_METHODS.map((m) => (
                <button key={m.type} onClick={() => set({ payment_type: m.type })}
                  className="py-2 rounded-md text-xs font-bold transition-all active:scale-[0.98]"
                  style={{
                    background: g.payment_type === m.type ? "rgba(var(--color-primary-rgb),0.18)" : "rgb(var(--surface-input-rgb))",
                    color: g.payment_type === m.type ? "rgb(var(--color-primary-rgb))" : "rgb(var(--text-secondary-rgb))",
                    border: `1px solid ${g.payment_type === m.type ? "rgba(var(--color-primary-rgb),0.7)" : "rgb(var(--border-rgb))"}`,
                  }}>
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <Input label={spec.valueLabel} autoCapitalize="none" value={g.payment_value ?? ""}
              onChange={(e) => set({ payment_value: e.target.value })} placeholder={spec.valuePlaceholder} />
            {spec.hint && <p className="text-xs mt-1" style={{ color: "rgb(var(--text-muted-rgb))" }}>{spec.hint}</p>}
          </div>

          <Button fullWidth loading={busy} onClick={save}>Save changes</Button>
        </div>
      </Panel>

      <Panel>
        <p className="text-xs uppercase font-bold tracking-wider mb-3" style={{ color: "rgb(var(--text-muted-rgb))", letterSpacing: "0.08em" }}>
          How people can join
        </p>
        <JoinModePicker value={joinMode} onChange={setJoinMode} />

        {joinMode === "passcode" && (
          <div className="mt-3">
            <Input label="Passcode (blank = keep current)" placeholder="••••••" value={g.passcode ?? ""} onChange={(e) => set({ passcode: e.target.value })} />
          </div>
        )}

        {joinMode === "invite" && (
          <button onClick={copyInvite}
            className="w-full mt-3 p-3 rounded-lg text-left transition-all active:scale-[0.99]"
            style={{ background: "rgb(var(--surface-input-rgb))", border: "1px dashed rgb(var(--border-rgb))" }}>
            <p className="text-xs uppercase font-bold" style={{ color: "rgb(var(--text-muted-rgb))" }}>Invite link · tap to copy</p>
            <p className="text-sm mono mt-1 break-all" style={{ color: "rgb(var(--color-primary-rgb))" }}>{inviteLink}</p>
          </button>
        )}

        <p className="text-xs mt-3" style={{ color: "rgb(var(--text-muted-rgb))" }}>
          Remember to press “Save changes” above after switching the join method.
        </p>
      </Panel>

      {/* Transfer ownership */}
      <Panel>
        <p className="text-xs uppercase font-bold tracking-wider mb-1" style={{ color: "rgb(var(--text-muted-rgb))", letterSpacing: "0.08em" }}>
          Transfer ownership
        </p>
        <p className="text-xs mb-3" style={{ color: "rgb(var(--text-muted-rgb))" }}>
          Make another member the admin. You’ll become a player.
        </p>
        {members.filter((m) => m.status === "active" && m.user_id !== profile?.id).length === 0 ? (
          <p className="text-sm" style={{ color: "rgb(var(--text-muted-rgb))" }}>No other members yet.</p>
        ) : (
          <div className="space-y-2">
            {members.filter((m) => m.status === "active" && m.user_id !== profile?.id).map((m) => (
              <div key={m.member_id} className="flex items-center justify-between py-2" style={{ borderTop: "1px solid rgb(var(--border-rgb))" }}>
                <span className="font-semibold" style={{ color: "rgb(var(--text-primary-rgb))" }}>{m.username}</span>
                <Button size="sm" variant="ghost" onClick={() => setTransferTo(m)}>Make owner</Button>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {transferTo && (
        <Modal open onClose={() => setTransferTo(null)}>
          <h2 className="font-display text-xl font-bold mb-2" style={{ color: "rgb(var(--text-primary-rgb))" }}>Transfer ownership?</h2>
          <p className="text-sm mb-4" style={{ color: "rgb(var(--text-muted-rgb))" }}>
            <b style={{ color: "rgb(var(--text-primary-rgb))" }}>{transferTo.username}</b> becomes the group admin and you become a player. You can be promoted back only by an admin.
          </p>
          <div className="space-y-2">
            <Button fullWidth variant="danger" onClick={transfer}>Yes, transfer to {transferTo.username}</Button>
            <button className="w-full text-center text-xs py-2" style={{ color: "rgb(var(--text-muted-rgb))" }} onClick={() => setTransferTo(null)}>Cancel</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
