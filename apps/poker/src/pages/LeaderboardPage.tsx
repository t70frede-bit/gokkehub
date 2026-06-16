import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Panel } from "@gokkehub/ui";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { kr, krSigned, netColor } from "@/lib/format";
import type { LeaderboardRow } from "@/lib/types";

type Cat = "won" | "net" | "games" | "win" | "loss";

const CATS: { key: Cat; label: string }[] = [
  { key: "won", label: "Most won" },
  { key: "net", label: "Best net" },
  { key: "games", label: "Most games" },
  { key: "win", label: "Top win" },
  { key: "loss", label: "Hall of shame" },
];

function valueFor(cat: Cat, r: LeaderboardRow): number {
  switch (cat) {
    case "won": return r.total_won;
    case "net": return r.net_result;
    case "games": return r.games_played;
    case "win": return r.biggest_win;
    case "loss": return r.biggest_loss; // most negative first
  }
}

function render(cat: Cat, r: LeaderboardRow) {
  const v = valueFor(cat, r);
  if (cat === "games") return <span className="tnum" style={{ color: "rgb(var(--text-primary-rgb))" }}>{v}</span>;
  if (cat === "won") return <span className="tnum" style={{ color: "rgb(var(--color-success-rgb))" }}>{kr(v)}</span>;
  return <span className="tnum" style={{ color: netColor(v) }}>{krSigned(v)}</span>;
}

export default function LeaderboardPage() {
  const navigate = useNavigate();
  const { activeGroup } = useAuth();
  const [cat, setCat] = useState<Cat>("won");
  const [rows, setRows] = useState<LeaderboardRow[]>([]);

  useEffect(() => {
    if (!activeGroup) return;
    supabase.rpc("poker_leaderboard", { p_group: activeGroup.group_id })
      .then(({ data }) => setRows((data as LeaderboardRow[]) ?? []));
  }, [activeGroup]);

  const sorted = [...rows].sort((a, b) =>
    cat === "loss" ? valueFor(cat, a) - valueFor(cat, b) : valueFor(cat, b) - valueFor(cat, a),
  ).filter((r) => r.games_played > 0 || cat === "games");

  return (
    <div className="space-y-5">
      <h1 className="font-display text-2xl font-bold" style={{ color: "rgb(var(--text-primary-rgb))" }}>Leaderboard</h1>

      <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1">
        {CATS.map((c) => (
          <button key={c.key} onClick={() => setCat(c.key)}
            className="px-3 py-2 rounded-full text-xs font-bold whitespace-nowrap transition-all active:scale-[0.98]"
            style={{
              background: cat === c.key ? "rgba(var(--color-primary-rgb),0.18)" : "rgb(var(--surface-raised-rgb))",
              color: cat === c.key ? "rgb(var(--color-primary-rgb))" : "rgb(var(--text-secondary-rgb))",
              border: `1px solid ${cat === c.key ? "rgba(var(--color-primary-rgb),0.7)" : "rgb(var(--border-rgb))"}`,
            }}>
            {c.label}
          </button>
        ))}
      </div>

      {cat === "loss" && (
        <p className="text-xs text-center" style={{ color: "rgb(var(--text-muted-rgb))" }}>
          😬 Worst single-game beating. Worn with pride, hopefully.
        </p>
      )}

      <Panel variant="bare" className="p-2">
        {sorted.length === 0 ? (
          <p className="text-sm text-center py-6" style={{ color: "rgb(var(--text-muted-rgb))" }}>No games played yet.</p>
        ) : (
          sorted.map((r, i) => (
            <button key={r.user_id} onClick={() => navigate(`/players/${r.user_id}`)}
              className="w-full flex items-center justify-between px-3 py-3 rounded-lg transition-colors"
              style={{ borderBottom: i < sorted.length - 1 ? "1px solid rgb(var(--border-rgb))" : "none" }}>
              <div className="flex items-center gap-3">
                <span className="w-6 text-center font-bold tnum" style={{ color: i < 3 ? "rgb(var(--color-primary-rgb))" : "rgb(var(--text-muted-rgb))" }}>{i + 1}</span>
                <span className="font-semibold" style={{ color: "rgb(var(--text-primary-rgb))" }}>{r.username}</span>
              </div>
              <span className="text-sm font-bold">{render(cat, r)}</span>
            </button>
          ))
        )}
      </Panel>
    </div>
  );
}
