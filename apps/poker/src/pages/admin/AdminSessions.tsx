import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge, Panel, useToast } from "@gokkehub/ui";
import { supabase } from "@/lib/supabase";
import { useUsernames } from "@/hooks/useUsernames";
import { formatDateTime } from "@/lib/format";
import type { GamePlayer, GameSession } from "@/lib/types";

interface Row extends GameSession { player_count: number; }

export default function AdminSessions() {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const usernames = useUsernames();
  const [rows, setRows] = useState<Row[]>([]);

  const reload = async () => {
    const { data: sessions } = await supabase
      .from("poker_game_sessions").select("*").order("created_at", { ascending: false }).limit(200);
    const { data: players } = await supabase.from("poker_game_players").select("session_id");
    const counts = new Map<string, number>();
    for (const p of (players as Pick<GamePlayer, "session_id">[]) ?? []) {
      counts.set(p.session_id, (counts.get(p.session_id) ?? 0) + 1);
    }
    setRows(((sessions as GameSession[]) ?? []).map((s) => ({ ...s, player_count: counts.get(s.id) ?? 0 })));
  };

  useEffect(() => {
    reload();
    const channel = supabase
      .channel("poker_admin_sessions")
      .on("postgres_changes", { event: "*", schema: "public", table: "poker_game_sessions" }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "poker_game_players" }, reload)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const del = async (id: string) => {
    const { error } = await supabase.rpc("poker_delete_session", { p_session: id });
    if (error) { addToast(error.message, "error"); return; }
    addToast("Deleted", "success");
  };

  return (
    <div className="space-y-2">
      {rows.length === 0 && (
        <Panel><p className="text-sm text-center" style={{ color: "rgb(var(--text-muted-rgb))" }}>No sessions yet.</p></Panel>
      )}
      {rows.map((s) => (
        <Panel key={s.id} variant="bare" className="p-3">
          <div className="flex items-center justify-between">
            <button className="text-left min-w-0" onClick={() => navigate(`/games/${s.id}`)}>
              <div className="flex items-center gap-2">
                <Badge variant={s.status === "active" ? "host" : s.status === "lobby" ? "primary" : "team"} team="spectator">
                  {s.status}
                </Badge>
                <span className="font-semibold truncate" style={{ color: "rgb(var(--text-primary-rgb))" }}>
                  {usernames[s.host_id] ?? "—"}
                </span>
              </div>
              <p className="text-[11px] mt-1" style={{ color: "rgb(var(--text-muted-rgb))" }}>
                {s.player_count} players · {formatDateTime(s.finished_at ?? s.created_at)}
              </p>
            </button>
            {s.status === "lobby" && s.player_count === 0 && (
              <button className="text-xs font-semibold flex-shrink-0 ml-3" style={{ color: "rgb(var(--color-danger-rgb))" }} onClick={() => del(s.id)}>
                Delete
              </button>
            )}
          </div>
        </Panel>
      ))}
    </div>
  );
}
