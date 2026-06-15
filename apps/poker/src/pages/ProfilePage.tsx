import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Panel } from "@gokkehub/ui";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { kr, krSigned, netColor, formatDate } from "@/lib/format";
import type { HistoryRow, PlayerStats } from "@/lib/types";

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="text-center">
      <p className="text-xs uppercase font-bold" style={{ color: "rgb(var(--text-muted-rgb))" }}>{label}</p>
      <p className="font-bold tnum mt-0.5" style={{ color: color ?? "rgb(var(--text-primary-rgb))" }}>{value}</p>
    </div>
  );
}

export default function ProfilePage() {
  const { id } = useParams<{ id: string }>();
  const { profile, isAdmin } = useAuth();
  const navigate = useNavigate();

  const targetId = id ?? profile?.id;
  const isSelf = targetId === profile?.id;

  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [otherBalance, setOtherBalance] = useState<number | null>(null);

  useEffect(() => {
    if (!targetId) return;
    supabase.rpc("poker_player_stats", { p_user: targetId }).then(({ data }) => {
      setStats(((data as PlayerStats[]) ?? [])[0] ?? null);
    });
    supabase.rpc("poker_player_history", { p_user: targetId }).then(({ data }) => {
      setHistory((data as HistoryRow[]) ?? []);
    });
    // Admin viewing another player can read their balance (RLS allows it).
    if (isAdmin && !isSelf) {
      supabase.from("poker_users").select("balance").eq("id", targetId).single()
        .then(({ data }) => setOtherBalance((data as { balance: number } | null)?.balance ?? null));
    }
  }, [targetId, isAdmin, isSelf]);

  if (!stats) return <p className="text-sm" style={{ color: "rgb(var(--text-muted-rgb))" }}>Loading…</p>;

  // Balance: own always; admin can see others; otherwise hidden.
  const shownBalance = isSelf ? profile?.balance ?? null : isAdmin ? otherBalance : null;

  return (
    <div className="space-y-5">
      <div className="text-center">
        <h1 className="font-display text-2xl font-bold" style={{ color: "rgb(var(--text-primary-rgb))" }}>{stats.username}</h1>
        <p className="text-xs mt-1" style={{ color: "rgb(var(--text-muted-rgb))" }}>Member since {formatDate(stats.created_at)}</p>
      </div>

      {shownBalance !== null && (
        <Panel variant="bare" className="p-4 text-center">
          <p className="text-xs uppercase font-bold" style={{ color: "rgb(var(--text-muted-rgb))" }}>
            Balance {isAdmin && !isSelf ? "(admin view)" : ""}
          </p>
          <p className="font-display font-bold tnum mt-1" style={{ fontSize: "var(--text-2xl)", color: "rgb(var(--color-primary-rgb))" }}>{kr(shownBalance)}</p>
        </Panel>
      )}

      <Panel>
        <div className="grid grid-cols-3 gap-y-5">
          <Stat label="Games" value={String(stats.games_played)} />
          <Stat label="Won" value={kr(stats.total_won)} color="rgb(var(--color-success-rgb))" />
          <Stat label="Lost" value={kr(stats.total_lost)} color="rgb(var(--color-danger-rgb))" />
          <Stat label="All-time net" value={krSigned(stats.net_result)} color={netColor(stats.net_result)} />
          <Stat label="Best game" value={stats.best_game != null ? krSigned(stats.best_game) : "—"} color="rgb(var(--color-success-rgb))" />
          <Stat label="Worst game" value={stats.worst_game != null ? krSigned(stats.worst_game) : "—"} color="rgb(var(--color-danger-rgb))" />
        </div>
      </Panel>

      <Panel>
        <p className="text-xs uppercase font-bold tracking-wider mb-3" style={{ color: "rgb(var(--text-muted-rgb))", letterSpacing: "0.08em" }}>Game history</p>
        {history.length === 0 ? (
          <p className="text-sm text-center py-2" style={{ color: "rgb(var(--text-muted-rgb))" }}>No games yet.</p>
        ) : (
          <div className="space-y-2">
            {history.map((h) => (
              <div key={h.session_id} className="flex items-center justify-between py-2" style={{ borderTop: "1px solid rgb(var(--border-rgb))" }}>
                <div>
                  <p className="text-sm font-semibold" style={{ color: "rgb(var(--text-primary-rgb))" }}>{formatDate(h.finished_at)}</p>
                  <p className="text-xs tnum" style={{ color: "rgb(var(--text-muted-rgb))" }}>
                    in {kr(h.total_buyin)} · out {kr(h.cashout_value)}
                    {h.status !== "finished" && " · in progress"}
                  </p>
                </div>
                <span className="text-sm font-bold tnum" style={{ color: netColor(h.net_result) }}>{krSigned(h.net_result)}</span>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {!isSelf && (
        <button className="block w-full text-center text-xs" style={{ color: "rgb(var(--text-muted-rgb))" }} onClick={() => navigate(-1)}>
          ← Back
        </button>
      )}
    </div>
  );
}
