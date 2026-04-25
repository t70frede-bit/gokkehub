import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button, Panel } from "@gokkehub/ui";
import { supabase } from "../lib/supabase";
import type { TlTeam } from "../lib/types";

export default function EndPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate   = useNavigate();
  const [teams,   setTeams]   = useState<TlTeam[]>([]);
  const [counts,  setCounts]  = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!roomId) return;
    (async () => {
      const teamsRes = await supabase.from("tl_teams").select("*").eq("room_id", roomId).order("sort_order");
      const ts = (teamsRes.data ?? []) as TlTeam[];
      setTeams(ts);
      const countMap: Record<number, number> = {};
      for (const t of ts) {
        const r = await supabase.from("tl_timeline").select("*", { count: "exact", head: true }).eq("team_id", t.id);
        countMap[t.id] = r.count ?? 0;
      }
      setCounts(countMap);
      setLoading(false);
    })();
  }, [roomId]);

  if (loading) return <div className="flex-1 flex items-center justify-center opacity-50">Loading…</div>;

  const sorted = [...teams].sort((a, b) => (counts[b.id] ?? 0) - (counts[a.id] ?? 0));
  const winner = sorted[0];

  return (
    <div className="flex-1 flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-4 text-center">
        <div className="text-6xl mb-2">🏆</div>
        <h1 className="text-3xl font-black">{winner?.name} wins!</h1>
        <p className="opacity-60">{counts[winner?.id] ?? 0} cards locked</p>

        <Panel className="p-4 text-left">
          {sorted.map((t, i) => (
            <div key={t.id} className="flex items-center gap-3 py-2"
              style={{ borderBottom: i < sorted.length - 1 ? "1px solid rgba(255,255,255,0.06)" : "none" }}>
              <span className="text-lg font-black opacity-40">#{i + 1}</span>
              <span className="flex-1 font-semibold">{t.name}</span>
              <span className="font-black"
                style={{ color: i === 0 ? "rgb(var(--color-secondary-rgb))" : "inherit" }}>
                {counts[t.id] ?? 0} cards
              </span>
            </div>
          ))}
        </Panel>

        <div className="flex gap-3 justify-center">
          <Button onClick={() => navigate("/")} variant="ghost">New game</Button>
          <Button onClick={() => navigate(`/lobby/${roomId}`)}>Play again</Button>
        </div>
      </div>
    </div>
  );
}
