import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge, Button, Panel } from "@gokkehub/ui";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { useGroupGames } from "@/hooks/useGroupGames";
import { useUsernames } from "@/hooks/useUsernames";
import { kr, formatDate } from "@/lib/format";
import type { GamePlayer, GameSession, Transaction } from "@/lib/types";

export default function HomePage() {
  const { profile, balance, activeGroup } = useAuth();
  const navigate = useNavigate();
  const [requested, setRequested] = useState(0);
  const [limbo, setLimbo] = useState(0);

  const uid = profile?.id;
  const gid = activeGroup?.group_id;
  const { sessions } = useGroupGames(gid);
  const usernames = useUsernames(gid);

  const reload = async () => {
    if (!uid || !gid) return;
    const { data: txs } = await supabase
      .from("poker_transactions").select("amount")
      .eq("user_id", uid).eq("group_id", gid).eq("type", "deposit").eq("status", "pending");
    setRequested(((txs as Pick<Transaction, "amount">[]) ?? []).reduce((s, t) => s + t.amount, 0));

    const { data: gps } = await supabase
      .from("poker_game_players").select("session_id, total_buyin, cashed_out_at")
      .eq("user_id", uid).eq("group_id", gid).is("cashed_out_at", null);
    const rows = (gps as Pick<GamePlayer, "session_id" | "total_buyin">[]) ?? [];
    if (rows.length === 0) { setLimbo(0); return; }
    const { data: live } = await supabase
      .from("poker_game_sessions").select("id").in("id", rows.map((r) => r.session_id)).eq("status", "active");
    const liveIds = new Set(((live as Pick<GameSession, "id">[]) ?? []).map((s) => s.id));
    setLimbo(rows.filter((r) => liveIds.has(r.session_id)).reduce((s, r) => s + r.total_buyin, 0));
  };

  useEffect(() => {
    reload();
    if (!uid) return;
    const channel = supabase
      .channel("poker_home")
      .on("postgres_changes", { event: "*", schema: "public", table: "poker_transactions", filter: `user_id=eq.${uid}` }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "poker_game_players", filter: `user_id=eq.${uid}` }, reload)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, gid]);

  const name = (id: string) => usernames[id] ?? "—";

  return (
    <div className="space-y-5">
      {/* Balance hero */}
      <Panel>
        <p className="text-xs uppercase font-bold tracking-wider" style={{ color: "rgb(var(--text-muted-rgb))", letterSpacing: "0.08em" }}>Balance</p>
        <p className="font-display font-bold tnum mt-1" style={{ fontSize: "var(--text-display)", color: "rgb(var(--color-primary-rgb))", lineHeight: 1 }}>
          {kr(balance)}
        </p>
        <p className="text-sm mt-2" style={{ color: "rgb(var(--text-muted-rgb))" }}>
          Spendable in {activeGroup?.name ?? "this group"} — confirmed by the house.
        </p>
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

      {/* Money actions */}
      <div className="grid grid-cols-2 gap-3">
        <Button fullWidth onClick={() => navigate("/topup")}>Top up</Button>
        <Button variant="ghost" fullWidth disabled={balance <= 0} onClick={() => navigate("/withdraw")}>Cash out</Button>
      </div>

      {/* Games */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-display text-lg font-bold" style={{ color: "rgb(var(--text-primary-rgb))" }}>Games</h2>
          <Button size="sm" onClick={() => navigate("/games")}>Host</Button>
        </div>

        {sessions.length === 0 ? (
          <Panel><p className="text-sm text-center" style={{ color: "rgb(var(--text-muted-rgb))" }}>No games yet — host one to deal in.</p></Panel>
        ) : (
          <div className="space-y-2 max-h-[22rem] overflow-y-auto no-scrollbar pr-0.5">
            {sessions.map((s) => (
              <Panel key={s.id} variant="bare" className="p-3">
                <button className="w-full text-left" onClick={() => navigate(`/games/${s.id}`)}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <Badge variant={s.status === "active" ? "host" : "team"} team="spectator">
                        {s.status === "active" ? "Live" : "Done"}
                      </Badge>
                      <span className="text-sm font-semibold truncate" style={{ color: "rgb(var(--text-secondary-rgb))" }}>
                        {name(s.host_id)}'s table
                      </span>
                    </div>
                    <span className="text-xs tnum flex-shrink-0" style={{ color: "rgb(var(--text-muted-rgb))" }}>
                      {s.player_count} {s.player_count === 1 ? "player" : "players"}
                    </span>
                  </div>
                  <p className="text-xs mt-1" style={{ color: "rgb(var(--text-muted-rgb))" }}>
                    {s.status === "active"
                      ? `Buy-in ${kr(s.min_buyin)}–${kr(s.max_buyin)}`
                      : `Finished ${formatDate(s.finished_at)}`}
                  </p>
                </button>
              </Panel>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
