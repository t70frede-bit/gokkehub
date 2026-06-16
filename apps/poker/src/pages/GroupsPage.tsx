import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge, Button, Input, Panel, useToast } from "@gokkehub/ui";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { PAYMENT_METHODS } from "@/lib/payment";
import type { PaymentType } from "@/lib/types";

export default function GroupsPage() {
  const { groups, activeGroup, setActiveGroup, refresh, logout } = useAuth();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const gate = !activeGroup; // no active group → this page is the entry gate

  const go = () => navigate("/");

  const switchTo = async (id: string) => {
    try { await setActiveGroup(id); go(); }
    catch (e) { addToast((e as Error).message, "error"); }
  };

  return (
    <div className={gate ? "min-h-screen" : ""} style={gate ? { background: "var(--bg-tint-1)" } : undefined}>
      <div className="w-full max-w-lg mx-auto px-4 py-6 space-y-5">
        {gate && (
          <div className="flex items-center justify-between">
            <h1 className="font-display text-2xl font-bold" style={{ color: "rgb(var(--text-primary-rgb))" }}>
              Gokke<span style={{ color: "rgb(var(--color-primary-rgb))" }}>Poker</span>
            </h1>
            <button onClick={logout} className="text-xs font-semibold rounded-md px-2.5 py-1.5"
              style={{ color: "rgb(var(--text-muted-rgb))", border: "1px solid rgb(var(--border-rgb))" }}>
              Sign out
            </button>
          </div>
        )}

        <p className="text-sm" style={{ color: "rgb(var(--text-muted-rgb))" }}>
          {gate ? "Join a poker group or create your own to get started." : "Your groups — switch, join another, or create one."}
        </p>

        {/* Your groups */}
        {groups.length > 0 && (
          <Panel>
            <p className="text-xs uppercase font-bold tracking-wider mb-3" style={{ color: "rgb(var(--text-muted-rgb))", letterSpacing: "0.08em" }}>
              Your groups
            </p>
            <div className="space-y-2">
              {groups.map((g) => (
                <div key={g.group_id} className="flex items-center justify-between py-2"
                  style={{ borderTop: "1px solid rgb(var(--border-rgb))" }}>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-semibold truncate" style={{ color: "rgb(var(--text-primary-rgb))" }}>{g.name}</span>
                    {g.role === "admin" && <Badge variant="host">House</Badge>}
                    {g.is_active && <Badge variant="primary">Active</Badge>}
                    {g.status === "pending" && <Badge variant="team" team="spectator">Pending</Badge>}
                  </div>
                  {g.status === "active" && !g.is_active && (
                    <Button size="sm" variant="ghost" onClick={() => switchTo(g.group_id)}>Switch</Button>
                  )}
                </div>
              ))}
            </div>
          </Panel>
        )}

        <JoinSection onJoined={async () => { await refresh(); go(); }} onRequested={refresh} addToast={addToast} />
        <CreateSection onCreated={async () => { await refresh(); go(); }} addToast={addToast} />
      </div>
    </div>
  );
}

// ── Join ──
function JoinSection({ onJoined, onRequested, addToast }: {
  onJoined: () => void; onRequested: () => void;
  addToast: (m: string, v?: "error" | "success" | "info") => void;
}) {
  const [name, setName] = useState("");
  const [passcode, setPasscode] = useState("");
  const [invite, setInvite] = useState("");
  const [busy, setBusy] = useState(false);

  const tokenFromInvite = (s: string) => s.trim().split("/join/").pop()!.trim();

  const joinPasscode = async () => {
    setBusy(true);
    const { error } = await supabase.rpc("poker_join_by_passcode", { p_name: name.trim(), p_passcode: passcode });
    setBusy(false);
    if (error) { addToast(error.message, "error"); return; }
    onJoined();
  };
  const joinInvite = async () => {
    setBusy(true);
    const { error } = await supabase.rpc("poker_join_by_invite", { p_token: tokenFromInvite(invite) });
    setBusy(false);
    if (error) { addToast(error.message, "error"); return; }
    onJoined();
  };
  const request = async () => {
    setBusy(true);
    const { error } = await supabase.rpc("poker_request_join", { p_name: name.trim() });
    setBusy(false);
    if (error) { addToast(error.message, "error"); return; }
    addToast("Request sent — an admin must approve you.", "success");
    onRequested();
  };

  return (
    <Panel>
      <h2 className="font-display text-lg font-bold mb-3" style={{ color: "rgb(var(--text-primary-rgb))" }}>Join a group</h2>

      <div className="space-y-3">
        <Input label="Invite link or code" autoCapitalize="none" value={invite}
          onChange={(e) => setInvite(e.target.value)} placeholder="https://poker.gokkehub.com/join/…" />
        <Button variant="ghost" fullWidth loading={busy} disabled={!invite.trim()} onClick={joinInvite}>Join via invite</Button>
      </div>

      <div className="my-4 h-px" style={{ background: "rgb(var(--border-rgb))" }} />

      <div className="space-y-3">
        <Input label="Group name" autoCapitalize="none" value={name} onChange={(e) => setName(e.target.value)} />
        <Input label="Passcode (if the group uses one)" value={passcode} onChange={(e) => setPasscode(e.target.value)} />
        <div className="grid grid-cols-2 gap-2">
          <Button variant="ghost" fullWidth loading={busy} disabled={!name.trim() || !passcode} onClick={joinPasscode}>Join with passcode</Button>
          <Button variant="ghost" fullWidth loading={busy} disabled={!name.trim()} onClick={request}>Request to join</Button>
        </div>
      </div>
    </Panel>
  );
}

// ── Create ──
function CreateSection({ onCreated, addToast }: {
  onCreated: () => void; addToast: (m: string, v?: "error" | "success" | "info") => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [ptype, setPtype] = useState<PaymentType>("mobilepay_box");
  const [pvalue, setPvalue] = useState("");
  const [invite, setInvite] = useState(true);
  const [request, setRequest] = useState(true);
  const [passOn, setPassOn] = useState(false);
  const [passcode, setPasscode] = useState("");
  const [busy, setBusy] = useState(false);

  const spec = PAYMENT_METHODS.find((m) => m.type === ptype)!;

  const create = async () => {
    if (name.trim().length < 2) { addToast("Pick a group name.", "error"); return; }
    if (passOn && passcode.length < 3) { addToast("Passcode too short.", "error"); return; }
    setBusy(true);
    const { error } = await supabase.rpc("poker_create_group", {
      p_name: name.trim(), p_payment_type: ptype, p_payment_value: pvalue.trim() || null,
      p_join_invite: invite, p_join_request: request, p_join_passcode: passOn,
      p_passcode: passOn ? passcode : null,
    });
    setBusy(false);
    if (error) { addToast(error.message, "error"); return; }
    onCreated();
  };

  if (!open) {
    return <Button fullWidth onClick={() => setOpen(true)}>Create a group</Button>;
  }

  return (
    <Panel>
      <h2 className="font-display text-lg font-bold mb-3" style={{ color: "rgb(var(--text-primary-rgb))" }}>Create a group</h2>
      <div className="space-y-4">
        <Input label="Group name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Friday Poker" />

        <div>
          <p className="text-sm font-semibold mb-2" style={{ color: "rgb(var(--text-secondary-rgb))" }}>Payment method</p>
          <div className="grid grid-cols-3 gap-2">
            {PAYMENT_METHODS.map((m) => (
              <button key={m.type} onClick={() => setPtype(m.type)}
                className="py-2 rounded-md text-xs font-bold transition-all active:scale-[0.98]"
                style={{
                  background: ptype === m.type ? "rgba(var(--color-primary-rgb),0.18)" : "rgb(var(--surface-input-rgb))",
                  color: ptype === m.type ? "rgb(var(--color-primary-rgb))" : "rgb(var(--text-secondary-rgb))",
                  border: `1px solid ${ptype === m.type ? "rgba(var(--color-primary-rgb),0.7)" : "rgb(var(--border-rgb))"}`,
                }}>
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <Input label={spec.valueLabel} autoCapitalize="none" value={pvalue}
          onChange={(e) => setPvalue(e.target.value)} placeholder={spec.valuePlaceholder} />

        <div>
          <p className="text-sm font-semibold mb-2" style={{ color: "rgb(var(--text-secondary-rgb))" }}>How can people join?</p>
          <div className="space-y-2">
            <CheckRow label="Invite link" checked={invite} onChange={setInvite} />
            <CheckRow label="Request (admin approves)" checked={request} onChange={setRequest} />
            <CheckRow label="Group name + passcode" checked={passOn} onChange={setPassOn} />
          </div>
        </div>

        {passOn && (
          <Input label="Passcode" value={passcode} onChange={(e) => setPasscode(e.target.value)} />
        )}

        <Button fullWidth loading={busy} onClick={create}>Create group</Button>
        <button className="block w-full text-center text-xs" style={{ color: "rgb(var(--text-muted-rgb))" }} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </Panel>
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
