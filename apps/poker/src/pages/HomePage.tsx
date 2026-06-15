import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Panel } from "@gokkehub/ui";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { kr } from "@/lib/format";
import type { GamePlayer, GameSession, Transaction } from "@/lib/types";

export default function HomePage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [requested, setRequested] = useState(0);
  const [limbo, setLimbo] = useState(0);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const uid = profile?.id;

  const reload = async () => {
    if (!uid) return;
    // Pending deposit requests → "Requested".
    const { data: txs } = await supabase
      .from("poker_transactions")
      .select("amount, type, status")
      .eq("user_id", uid)
      .eq("type", "deposit")
      .eq("status", "pending");
    setRequested(((txs as Pick<Transaction, "amount">[]) ?? []).reduce((s, t) => s + t.amount, 0));

    // Buy-ins currently in an active game → "In limbo".
    const { data: gps } = await supabase
      .from("poker_game_players")
      .select("session_id, total_buyin, cashed_out_at")
      .eq("user_id", uid)
      .is("cashed_out_at", null);
    const rows = (gps as Pick<GamePlayer, "session_id" | "total_buyin">[]) ?? [];
    if (rows.length === 0) {
      setLimbo(0);
      setActiveSessionId(null);
      return;
    }
    const ids = rows.map((r) => r.session_id);
    const { data: sessions } = await supabase
      .from("poker_game_sessions")
      .select("id, status")
      .in("id", ids)
      .eq("status", "active");
    const activeIds = new Set(((sessions as Pick<GameSession, "id">[]) ?? []).map((s) => s.id));
    const live = rows.filter((r) => activeIds.has(r.session_id));
    setLimbo(live.reduce((s, r) => s + r.total_buyin, 0));
    setActiveSessionId(live[0]?.session_id ?? null);
  };

  useEffect(() => {
    reload();
    if (!uid) return;
    const channel = supabase
      .channel("poker_home")
      .on("postgres_changes", { event: "*", schema: "public", table: "poker_transactions", filter: `user_id=eq.${uid}` }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "poker_game_players", filter: `user_id=eq.${uid}` }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "poker_game_sessions" }, reload)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  return (
    <div className="space-y-5">
      {/* Balance hero — always visible */}
      <Panel>
        <p className="text-xs uppercase font-bold tracking-wider" style={{ color: "rgb(var(--text-muted-rgb))", letterSpacing: "0.08em" }}>
          Balance
        </p>
        <p className="font-display font-bold tnum mt-1" style={{ fontSize: "var(--text-display)", color: "rgb(var(--color-primary-rgb))", lineHeight: 1 }}>
          {kr(profile?.balance ?? 0)}
        </p>
        <p className="text-sm mt-2" style={{ color: "rgb(var(--text-muted-rgb))" }}>
          Spendable funds — confirmed by the house.
        </p>

        {/* Conditional secondary lines */}
        {(limbo > 0 || requested > 0) && (
          <div className="mt-4 pt-4 space-y-2.5" style={{ borderTop: "1px solid rgb(var(--border-rgb))" }}>
            {limbo > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold" style={{ color: "rgb(var(--text-secondary-rgb))" }}>In limbo</span>
                <span className="text-sm font-bold tnum" style={{ color: "rgb(var(--text-primary-rgb))" }}>{kr(limbo)}</span>
              </div>
            )}
            {requested > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold" style={{ color: "rgb(var(--text-secondary-rgb))" }}>Requested</span>
                <span className="text-sm font-bold tnum" style={{ color: "rgb(var(--color-warning-rgb))" }}>{kr(requested)}</span>
              </div>
            )}
          </div>
        )}
      </Panel>

      <div className="grid grid-cols-2 gap-3">
        <Button fullWidth onClick={() => navigate("/topup")}>Top up</Button>
        <Button variant="ghost" fullWidth onClick={() => navigate(activeSessionId ? `/games/${activeSessionId}` : "/games")}>
          {activeSessionId ? "Back to table" : "Games"}
        </Button>
      </div>

      {requested > 0 && (
        <p className="text-center text-xs" style={{ color: "rgb(var(--text-muted-rgb))" }}>
          You have a top-up awaiting the house. It becomes spendable once confirmed.
        </p>
      )}
    </div>
  );
}
