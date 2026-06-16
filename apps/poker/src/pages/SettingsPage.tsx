import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Input, Panel, useToast } from "@gokkehub/ui";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";

export default function SettingsPage() {
  const { profile, session, activeGroup, avatarUrl, logout, refresh } = useAuth();
  const navigate = useNavigate();
  const { addToast } = useToast();

  const [username, setUsername] = useState(profile?.username ?? "");
  const [savingName, setSavingName] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const email = (session?.user?.email as string | undefined) ?? null;

  const saveName = async () => {
    if (username.trim() === profile?.username) return;
    setSavingName(true);
    const { error } = await supabase.rpc("poker_set_username", { p_username: username.trim() });
    setSavingName(false);
    if (error) { addToast(error.message, "error"); return; }
    addToast("Username updated", "success");
    refresh();
  };

  const leave = async () => {
    if (!activeGroup) return;
    setLeaving(true);
    const { error } = await supabase.rpc("poker_leave_group", { p_group: activeGroup.group_id });
    setLeaving(false);
    setConfirmLeave(false);
    if (error) { addToast(error.message, "error"); return; }
    addToast(`Left ${activeGroup.name}`, "success");
    await refresh();
    navigate("/");
  };

  return (
    <div className="space-y-5">
      <h1 className="font-display text-2xl font-bold" style={{ color: "rgb(var(--text-primary-rgb))" }}>Settings</h1>

      {/* Account */}
      <Panel>
        <div className="flex items-center gap-3 mb-4">
          <div className="rounded-full overflow-hidden flex items-center justify-center flex-shrink-0"
            style={{ width: 48, height: 48, border: "1px solid rgb(var(--border-rgb))", background: "rgb(var(--surface-raised-rgb))" }}>
            {avatarUrl
              ? <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
              : <span className="font-bold text-lg" style={{ color: "rgb(var(--color-primary-rgb))" }}>{(profile?.username ?? "?").charAt(0).toUpperCase()}</span>}
          </div>
          <div className="min-w-0">
            <p className="font-bold truncate" style={{ color: "rgb(var(--text-primary-rgb))" }}>{profile?.username}</p>
            {email && <p className="text-xs truncate" style={{ color: "rgb(var(--text-muted-rgb))" }}>{email}</p>}
          </div>
        </div>

        <Input label="Username" autoCapitalize="none" value={username} onChange={(e) => setUsername(e.target.value)} />
        <div className="mt-3">
          <Button fullWidth variant="ghost" loading={savingName}
            disabled={username.trim().length < 2 || username.trim() === profile?.username}
            onClick={saveName}>
            Save username
          </Button>
        </div>
      </Panel>

      {/* Group */}
      <Panel>
        <p className="text-xs uppercase font-bold tracking-wider mb-3" style={{ color: "rgb(var(--text-muted-rgb))", letterSpacing: "0.08em" }}>
          Group
        </p>
        <div className="flex items-center justify-between">
          <span className="text-sm" style={{ color: "rgb(var(--text-secondary-rgb))" }}>Active group</span>
          <span className="font-bold" style={{ color: "rgb(var(--text-primary-rgb))" }}>{activeGroup?.name ?? "—"}</span>
        </div>
        <div className="mt-3 space-y-2">
          <Button fullWidth variant="ghost" onClick={() => navigate("/groups")}>Switch / join groups</Button>
          {confirmLeave ? (
            <Button fullWidth variant="danger" loading={leaving} onClick={leave}>Confirm leave {activeGroup?.name}</Button>
          ) : (
            <button className="w-full text-center text-xs py-2" style={{ color: "rgb(var(--color-danger-rgb))" }}
              onClick={() => setConfirmLeave(true)}>
              Leave this group
            </button>
          )}
        </div>
        <p className="text-xs mt-2" style={{ color: "rgb(var(--text-muted-rgb))" }}>
          You can’t leave while you hold a balance, or if you’re the only admin (transfer ownership first).
        </p>
      </Panel>

      <Button fullWidth variant="danger" onClick={logout}>Sign out</Button>
    </div>
  );
}
