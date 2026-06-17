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
  const { activeGroup } = useAuth();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const { sessions, loading } = useOpenSessions(activeGroup?.group_id);
  const usernames = useUsernames(activeGroup?.group_id);

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"cash" | "tournament">("cash");
  // Default placeholders only — the host can change these before creating.
  const [min, setMin] = useState(25);
  const [max, setMax] = useState(50);
  const [fixedBuyin, setFixedBuyin] = useState(100);
  const [bountyBuyin, setBountyBuyin] = useState(50);
  const [rebuys, setRebuys] = useState<"on" | "off">("on");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (mode === "cash" && max < min) { addToast("Max buy-in must be ≥ min.", "error"); return; }
    if (mode === "tournament" && (fixedBuyin <= 0 || bountyBuyin <= 0)) {
      addToast("Set a buy-in and a bounty buy-in.", "error"); return;
    }
    setBusy(true);
    const { data, error } = await supabase.rpc("poker_create_session", {
      p_mode: mode,
      p_min: mode === "tournament" ? fixedBuyin : min,
      p_max: mode === "tournament" ? fixedBuyin : max,
      p_rebuys: rebuys === "on",
      p_bounty_buyin: mode === "tournament" ? bountyBuyin : null,
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
          <div>
            <p className="text-sm font-semibold mb-2" style={{ color: "rgb(var(--text-secondary-rgb))" }}>Game mode</p>
            <Toggle options={[{ value: "cash", label: "Cash game" }, { value: "tournament", label: "Bounty" }]}
              value={mode} onChange={setMode} />
          </div>

          {mode === "cash" ? (
            <>
              <Input label="Min buy-in (kr)" type="number" inputMode="numeric" min={0}
                value={min} onChange={(e) => setMin(Math.max(0, parseInt(e.target.value || "0", 10)))} />
              <Input label="Max buy-in (kr)" type="number" inputMode="numeric" min={0}
                value={max} onChange={(e) => setMax(Math.max(0, parseInt(e.target.value || "0", 10)))} />
            </>
          ) : (
            <>
              <Input label="Table buy-in (kr) — chips in play" type="number" inputMode="numeric" min={1}
                value={fixedBuyin} onChange={(e) => setFixedBuyin(Math.max(0, parseInt(e.target.value || "0", 10)))} />
              <Input label="Bounty buy-in (kr) — into the mystery pool" type="number" inputMode="numeric" min={1}
                value={bountyBuyin} onChange={(e) => setBountyBuyin(Math.max(0, parseInt(e.target.value || "0", 10)))} />
              <p className="text-xs" style={{ color: "rgb(var(--text-muted-rgb))" }}>
                Each player pays <b style={{ color: "rgb(var(--text-primary-rgb))" }}>{kr(fixedBuyin + bountyBuyin)}</b> total
                — {kr(fixedBuyin)} to the table + {kr(bountyBuyin)} to the bounty pool.
              </p>
            </>
          )}

          <div>
            <p className="text-sm font-semibold mb-2" style={{ color: "rgb(var(--text-secondary-rgb))" }}>Rebuys</p>
            <Toggle options={[{ value: "on", label: "Enabled" }, { value: "off", label: "Disabled" }]}
              value={rebuys} onChange={setRebuys} />
          </div>
          <Button fullWidth loading={busy} onClick={create}>Create table</Button>
          <p className="text-center text-xs" style={{ color: "rgb(var(--text-muted-rgb))" }}>
            {mode === "tournament"
              ? `Bounty game: everyone pays ${fixedBuyin || 0} kr buy-in + ${bountyBuyin || 0} kr bounty (auto-joined). Knock players out to win from the pool.`
              : "Cash game: players buy in within your range. Goes live right away; ends when everyone cashes out."}
          </p>
        </div>
      </Modal>
    </div>
  );
}
