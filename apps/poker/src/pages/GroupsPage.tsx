import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge, Button, Input, Panel, useToast } from "@gokkehub/ui";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { PAYMENT_METHODS } from "@/lib/payment";
import type { JoinMode, PaymentType } from "@/lib/types";

export default function GroupsPage() {
  const { groups, activeGroup, setActiveGroup, refresh, logout } = useAuth();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const gate = !activeGroup; // no active group → this page is the entry gate
  const [mode, setMode] = useState<"join" | "create">("join");

  const go = () => navigate("/");
  const switchTo = async (id: string) => {
    try { await setActiveGroup(id); go(); }
    catch (e) { addToast((e as Error).message, "error"); }
  };

  return (
    <div className={gate ? "pwa-safe-top min-h-screen" : ""} style={gate ? { background: "var(--bg-tint-1)" } : undefined}>
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

        {mode === "join" ? (
          <>
            <p className="text-sm" style={{ color: "rgb(var(--text-muted-rgb))" }}>
              {gate ? "Join a poker group to get started." : "Switch groups, or join another."}
            </p>

            {groups.length > 0 && (
              <Panel>
                <p className="text-xs uppercase font-bold tracking-wider mb-3" style={{ color: "rgb(var(--text-muted-rgb))", letterSpacing: "0.08em" }}>
                  Your groups
                </p>
                <div className="space-y-2">
                  {groups.map((g) => (
                    <div key={g.group_id} className="flex items-center justify-between py-2" style={{ borderTop: "1px solid rgb(var(--border-rgb))" }}>
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

            <OrDivider />
            <Button variant="ghost" fullWidth onClick={() => setMode("create")}>Create a group</Button>
          </>
        ) : (
          <>
            <p className="text-sm" style={{ color: "rgb(var(--text-muted-rgb))" }}>Create your own poker group.</p>
            <CreateSection onCreated={async () => { await refresh(); go(); }} addToast={addToast} />
            <OrDivider />
            <Button variant="ghost" fullWidth onClick={() => setMode("join")}>Join via invite or code</Button>
          </>
        )}
      </div>
    </div>
  );
}

function OrDivider() {
  return (
    <div className="flex items-center gap-3" style={{ color: "rgb(var(--text-muted-rgb))" }}>
      <div className="flex-1 h-px" style={{ background: "rgb(var(--border-rgb))" }} />
      <span className="text-xs font-bold uppercase" style={{ letterSpacing: "0.08em" }}>or</span>
      <div className="flex-1 h-px" style={{ background: "rgb(var(--border-rgb))" }} />
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

      <div className="my-4"><OrDivider /></div>

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
  const [name, setName] = useState("");
  const [ptype, setPtype] = useState<PaymentType>("mobilepay_box");
  const [pvalue, setPvalue] = useState("");
  const [joinMode, setJoinMode] = useState<JoinMode>("invite");
  const [passcode, setPasscode] = useState("");
  const [busy, setBusy] = useState(false);

  const spec = PAYMENT_METHODS.find((m) => m.type === ptype)!;

  const create = async () => {
    if (name.trim().length < 2) { addToast("Pick a group name.", "error"); return; }
    if (joinMode === "passcode" && passcode.length < 3) { addToast("Passcode too short.", "error"); return; }
    setBusy(true);
    const { error } = await supabase.rpc("poker_create_group", {
      p_name: name.trim(), p_payment_type: ptype, p_payment_value: pvalue.trim() || null,
      p_join_invite: joinMode === "invite",
      p_join_request: joinMode === "request",
      p_join_passcode: joinMode === "passcode",
      p_passcode: joinMode === "passcode" ? passcode : null,
    });
    setBusy(false);
    if (error) { addToast(error.message, "error"); return; }
    onCreated();
  };

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

        <div>
          <Input label={spec.valueLabel} autoCapitalize="none" value={pvalue}
            onChange={(e) => setPvalue(e.target.value)} placeholder={spec.valuePlaceholder} />
          {spec.hint && <p className="text-xs mt-1" style={{ color: "rgb(var(--text-muted-rgb))" }}>{spec.hint}</p>}
        </div>

        <div>
          <p className="text-sm font-semibold mb-2" style={{ color: "rgb(var(--text-secondary-rgb))" }}>How can people join?</p>
          <JoinModePicker value={joinMode} onChange={setJoinMode} />
        </div>

        {joinMode === "passcode" && (
          <Input label="Passcode" value={passcode} onChange={(e) => setPasscode(e.target.value)} />
        )}

        <Button fullWidth loading={busy} onClick={create}>Create group</Button>
      </div>
    </Panel>
  );
}

const JOIN_MODES: { value: JoinMode; label: string }[] = [
  { value: "invite", label: "Invite link" },
  { value: "request", label: "Admin approves" },
  { value: "passcode", label: "Name + passcode" },
];

export function JoinModePicker({ value, onChange }: { value: JoinMode; onChange: (v: JoinMode) => void }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {JOIN_MODES.map((m) => (
        <button key={m.value} onClick={() => onChange(m.value)}
          className="py-2 rounded-md text-xs font-bold transition-all active:scale-[0.98]"
          style={{
            background: value === m.value ? "rgba(var(--color-primary-rgb),0.18)" : "rgb(var(--surface-input-rgb))",
            color: value === m.value ? "rgb(var(--color-primary-rgb))" : "rgb(var(--text-secondary-rgb))",
            border: `1px solid ${value === m.value ? "rgba(var(--color-primary-rgb),0.7)" : "rgb(var(--border-rgb))"}`,
          }}>
          {m.label}
        </button>
      ))}
    </div>
  );
}
