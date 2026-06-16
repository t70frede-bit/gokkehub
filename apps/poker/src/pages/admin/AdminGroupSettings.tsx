import { useEffect, useState } from "react";
import { Button, Input, Panel, useToast } from "@gokkehub/ui";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { PAYMENT_METHODS } from "@/lib/payment";
import type { PaymentType } from "@/lib/types";

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
  const { activeGroup, refresh } = useAuth();
  const { addToast } = useToast();
  const gid = activeGroup?.group_id;
  const [g, setG] = useState<GroupRow | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!gid) return;
    supabase.from("poker_groups")
      .select("name, payment_type, payment_value, passcode, invite_token, join_invite, join_request, join_passcode")
      .eq("id", gid).single()
      .then(({ data }) => setG((data as GroupRow) ?? null));
  }, [gid]);

  if (!g) return <p className="text-sm" style={{ color: "rgb(var(--text-muted-rgb))" }}>Loading…</p>;

  const set = (patch: Partial<GroupRow>) => setG({ ...g, ...patch });
  const spec = PAYMENT_METHODS.find((m) => m.type === g.payment_type)!;
  const inviteLink = `${window.location.origin}/join/${g.invite_token}`;

  const save = async () => {
    if (g.join_passcode && (g.passcode ?? "").length < 3) { addToast("Passcode too short.", "error"); return; }
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

          <Input label={spec.valueLabel} autoCapitalize="none" value={g.payment_value ?? ""}
            onChange={(e) => set({ payment_value: e.target.value })} placeholder={spec.valuePlaceholder} />

          <Button fullWidth loading={busy} onClick={save}>Save changes</Button>
        </div>
      </Panel>

      <Panel>
        <p className="text-xs uppercase font-bold tracking-wider mb-3" style={{ color: "rgb(var(--text-muted-rgb))", letterSpacing: "0.08em" }}>
          How people can join
        </p>
        <div className="space-y-2">
          <CheckRow label="Invite link" checked={g.join_invite} onChange={(v) => set({ join_invite: v })} />
          <CheckRow label="Request (admin approves)" checked={g.join_request} onChange={(v) => set({ join_request: v })} />
          <CheckRow label="Group name + passcode" checked={g.join_passcode} onChange={(v) => set({ join_passcode: v })} />
        </div>
        {g.join_passcode && (
          <div className="mt-3">
            <Input label="Passcode" value={g.passcode ?? ""} onChange={(e) => set({ passcode: e.target.value })} />
          </div>
        )}

        {g.join_invite && (
          <button onClick={copyInvite}
            className="w-full mt-3 p-3 rounded-lg text-left transition-all active:scale-[0.99]"
            style={{ background: "rgb(var(--surface-input-rgb))", border: "1px dashed rgb(var(--border-rgb))" }}>
            <p className="text-xs uppercase font-bold" style={{ color: "rgb(var(--text-muted-rgb))" }}>Invite link · tap to copy</p>
            <p className="text-sm mono mt-1 break-all" style={{ color: "rgb(var(--color-primary-rgb))" }}>{inviteLink}</p>
          </button>
        )}
      </Panel>
    </div>
  );
}

function CheckRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!checked)} className="w-full flex items-center justify-between py-2 px-3 rounded-md"
      style={{ background: "rgb(var(--surface-input-rgb))", border: "1px solid rgb(var(--border-rgb))" }}>
      <span className="text-sm" style={{ color: "rgb(var(--text-primary-rgb))" }}>{label}</span>
      <span className="w-9 h-5 rounded-full flex items-center transition-all px-0.5"
        style={{ background: checked ? "rgb(var(--color-primary-rgb))" : "rgb(var(--border-rgb))", justifyContent: checked ? "flex-end" : "flex-start" }}>
        <span className="w-4 h-4 rounded-full" style={{ background: "rgb(var(--bg-rgb))" }} />
      </span>
    </button>
  );
}
