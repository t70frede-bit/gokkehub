import { useEffect, useState } from "react";
import { Button, Input, Modal, useToast } from "@gokkehub/ui";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { kr, krSigned, netColor } from "@/lib/format";
import type { GamePlayer, GameSession } from "@/lib/types";

interface Stale { player: GamePlayer; session: GameSession; }

// On login, nudge a player who joined a table >24h ago and never cashed out:
// they enter their final chip value (or 0) to close out their seat. The session
// finishes once everyone has cashed out.
export default function StaleCashoutPrompt() {
  const { profile } = useAuth();
  const { addToast } = useToast();
  const [stale, setStale] = useState<Stale[]>([]);
  const [value, setValue] = useState<number | "">("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!profile) return;
    let active = true;
    (async () => {
      const { data: gps } = await supabase
        .from("poker_game_players").select("*")
        .eq("user_id", profile.id).is("cashed_out_at", null);
      const rows = (gps as GamePlayer[]) ?? [];
      if (rows.length === 0) { if (active) setStale([]); return; }

      const { data: sessions } = await supabase
        .from("poker_game_sessions").select("*")
        .in("id", rows.map((r) => r.session_id)).eq("status", "active");
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      const byId = new Map((sessions as GameSession[] ?? []).map((s) => [s.id, s]));
      const list: Stale[] = [];
      for (const p of rows) {
        const s = byId.get(p.session_id);
        if (s && new Date(s.created_at).getTime() < cutoff) list.push({ player: p, session: s });
      }
      if (active) setStale(list);
    })();
    return () => { active = false; };
  }, [profile?.id]);

  if (stale.length === 0) return null;
  const current = stale[0];
  const net = value === "" ? null : Number(value) - current.player.total_buyin;
  const skip = () => { setStale(stale.slice(1)); setValue(""); };

  const cashout = async () => {
    const v = value === "" ? 0 : Number(value);
    if (v < 0) return;
    setBusy(true);
    const { error } = await supabase.rpc("poker_cashout", {
      p_session: current.session.id, p_cashout: v, p_photo_url: null,
    });
    setBusy(false);
    if (error) { addToast(error.message, "error"); return; }
    addToast("Cashed out", "success");
    skip();
  };

  return (
    <Modal open onClose={skip}>
      <h2 className="font-display text-xl font-bold mb-1" style={{ color: "rgb(var(--text-primary-rgb))" }}>
        Cash out your last game?
      </h2>
      <p className="text-sm mb-4" style={{ color: "rgb(var(--text-muted-rgb))" }}>
        You joined a table over 24 hours ago and never cashed out. Enter the chip value you left
        with — or 0 if you’ve got nothing to take.
      </p>
      <p className="text-sm mb-3" style={{ color: "rgb(var(--text-secondary-rgb))" }}>
        Bought in for <b style={{ color: "rgb(var(--text-primary-rgb))" }}>{kr(current.player.total_buyin)}</b>
      </p>

      <div className="space-y-4">
        <Input label="Chip value (kr)" type="number" inputMode="numeric" min={0}
          value={value} onChange={(e) => setValue(e.target.value ? Math.max(0, parseInt(e.target.value, 10)) : "")} />
        {net !== null && (
          <p className="text-sm font-bold tnum text-center" style={{ color: netColor(net) }}>
            Net result {krSigned(net)}
          </p>
        )}
        <Button fullWidth loading={busy} onClick={cashout}>
          Cash out with {kr(value === "" ? 0 : Number(value))}
        </Button>
        <button className="block w-full text-center text-xs" style={{ color: "rgb(var(--text-muted-rgb))" }} onClick={skip}>
          Remind me later
        </button>
      </div>
    </Modal>
  );
}
