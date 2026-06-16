import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge, Button, Input, Modal, Panel, Toggle, useToast } from "@gokkehub/ui";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { useOpenSessions } from "@/hooks/useOpenSessions";
import { useUsernames } from "@/hooks/useUsernames";
import { kr } from "@/lib/format";
import type { GameSession } from "@/lib/types";

export default function GamesPage() {
  const { profile, activeGroup } = useAuth();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const { sessions, loading } = useOpenSessions(activeGroup?.group_id);
  const usernames = useUsernames(activeGroup?.group_id);

  const [open, setOpen] = useState(false);
  // Default placeholders only — the host can change these before creating.
  const [min, setMin] = useState(25);
  const [max, setMax] = useState(50);
  const [rebuys, setRebuys] = useState<"on" | "off">("on");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (max < min) { addToast("Max buy-in must be ≥ min.", "error"); return; }
    setBusy(true);
    const { data, error } = await supabase.rpc("poker_create_session", {
      p_min: min, p_max: max, p_rebuys: rebuys === "on",
    });
    setBusy(false);
    if (error) { addToast(error.message, "error"); return; }
    setOpen(false);
    navigate(`/games/${(data as GameSession).id}`);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold" style={{ color: "rgb(var(--text-primary-rgb))" }}>Games</h1>
        <Button size="sm" onClick={() => setOpen(true)}>Host</Button>
      </div>

      {loading ? (
        <p className="text-sm" style={{ color: "rgb(var(--text-muted-rgb))" }}>Loading…</p>
      ) : sessions.length === 0 ? (
        <Panel>
          <p className="text-center text-sm" style={{ color: "rgb(var(--text-muted-rgb))" }}>
            No open tables. Host one to get the cards out.
          </p>
        </Panel>
      ) : (
        <div className="space-y-3">
          {sessions.map((s) => (
            <Panel key={s.id} variant="bare" className="p-4 cursor-pointer" >
              <button className="w-full text-left" onClick={() => navigate(`/games/${s.id}`)}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant="host">Live</Badge>
                    <span className="text-sm font-semibold" style={{ color: "rgb(var(--text-secondary-rgb))" }}>
                      {usernames[s.host_id] ?? "—"}'s table
                    </span>
                  </div>
                  <span className="text-sm font-bold tnum" style={{ color: "rgb(var(--text-primary-rgb))" }}>
                    {s.player_count} {s.player_count === 1 ? "player" : "players"}
                  </span>
                </div>
                <p className="text-xs mt-2" style={{ color: "rgb(var(--text-muted-rgb))" }}>
                  Buy-in {kr(s.min_buyin)}–{kr(s.max_buyin)} · Rebuys {s.rebuys_enabled ? "on" : "off"}
                </p>
              </button>
            </Panel>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)}>
        <h2 className="font-display text-xl font-bold mb-4" style={{ color: "rgb(var(--text-primary-rgb))" }}>Host a session</h2>
        <div className="space-y-4">
          <Input label="Min buy-in (kr)" type="number" inputMode="numeric" min={0}
            value={min} onChange={(e) => setMin(Math.max(0, parseInt(e.target.value || "0", 10)))} />
          <Input label="Max buy-in (kr)" type="number" inputMode="numeric" min={0}
            value={max} onChange={(e) => setMax(Math.max(0, parseInt(e.target.value || "0", 10)))} />
          <div>
            <p className="text-sm font-semibold mb-2" style={{ color: "rgb(var(--text-secondary-rgb))" }}>Rebuys</p>
            <Toggle options={[{ value: "on", label: "Enabled" }, { value: "off", label: "Disabled" }]}
              value={rebuys} onChange={setRebuys} />
          </div>
          <Button fullWidth loading={busy} onClick={create}>Create table</Button>
          <p className="text-center text-xs" style={{ color: "rgb(var(--text-muted-rgb))" }}>
            You’ll host as {profile?.username}. The table goes live right away — players join by buying in, and it ends when everyone cashes out.
          </p>
        </div>
      </Modal>
    </div>
  );
}
