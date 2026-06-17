import { useEffect, useState } from "react";
import { Button, Modal, useToast } from "@gokkehub/ui";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import type { BountyClaim } from "@/lib/types";

// Pops anywhere in the app when someone has claimed a knockout on YOU. You accept
// (cash out at 0, they get your bounty) or dispute it. The host can also resolve
// it from the bounty panel.
export default function KnockoutPrompt() {
  const { profile } = useAuth();
  const { addToast } = useToast();
  const [claims, setClaims] = useState<BountyClaim[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!profile) return;
    let active = true;
    const load = async () => {
      const { data } = await supabase.from("poker_bounty_claims").select("*")
        .eq("eliminated_id", profile.id).eq("status", "pending");
      const list = (data as BountyClaim[]) ?? [];
      if (!active) return;
      setClaims(list);
      if (list.length) {
        const { data: us } = await supabase.rpc("poker_usernames", { p_group: list[0].group_id });
        const m: Record<string, string> = {};
        for (const r of (us as { user_id: string; username: string }[]) ?? []) m[r.user_id] = r.username;
        if (active) setNames(m);
      }
    };
    load();
    const channel = supabase.channel(`poker_ko_me_${profile.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "poker_bounty_claims", filter: `eliminated_id=eq.${profile.id}` }, load)
      .subscribe();
    return () => { active = false; supabase.removeChannel(channel); };
  }, [profile?.id]);

  if (claims.length === 0) return null;
  const c = claims[0];
  const elim = names[c.eliminator_id] ?? "Someone";

  const act = async (ok: boolean) => {
    setBusy(true);
    const { error } = await supabase.rpc(ok ? "poker_confirm_knockout" : "poker_reject_knockout", { p_claim: c.id });
    setBusy(false);
    if (error) { addToast(error.message, "error"); return; }
    addToast(ok ? "You're out — bounty awarded" : "Knockout disputed", ok ? "info" : "success");
    setClaims((prev) => prev.slice(1));
  };

  return (
    <Modal open onClose={() => { /* must choose */ }}>
      <h2 className="font-display text-xl font-bold mb-1" style={{ color: "rgb(var(--text-primary-rgb))" }}>Knocked out?</h2>
      <p className="text-sm mb-4" style={{ color: "rgb(var(--text-muted-rgb))" }}>
        <b style={{ color: "rgb(var(--text-primary-rgb))" }}>{elim}</b> says they knocked you out. Accepting cashes you out at <b>0</b> and gives them a bounty from the pool.
      </p>
      <div className="space-y-2">
        <Button variant="danger" fullWidth loading={busy} onClick={() => act(true)}>Accept — I’m out</Button>
        <button className="block w-full text-center text-xs py-2" style={{ color: "rgb(var(--text-muted-rgb))" }}
          onClick={() => act(false)}>That’s not right — dispute</button>
      </div>
    </Modal>
  );
}
