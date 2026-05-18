import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button, Panel } from "@gokkehub/ui";
import { supabase } from "../lib/supabase";
import { useHeaderControls } from "../App";
import type { TlTeam, TlRoom, TlRoomSettings } from "../lib/types";

export default function EndPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate   = useNavigate();
  const myPlayerId = roomId ? localStorage.getItem(`tl_player_${roomId}`) : null;
  const [teams,   setTeams]   = useState<TlTeam[]>([]);
  const [counts,  setCounts]  = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(true);
  const [hostId,  setHostId]  = useState<string | null>(null);
  const [hideCode, setHideCode] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  // Mirror LobbyPage/GamePage: hide the room code in the global header
  // when streamer or gamemaster mode is on, so the end-game podium can
  // be streamed without leaking the join code.
  const { setHideRoomCode } = useHeaderControls();
  useEffect(() => {
    setHideRoomCode(hideCode);
    return () => setHideRoomCode(false);
  }, [hideCode, setHideRoomCode]);

  useEffect(() => {
    if (!roomId) return;
    (async () => {
      const [teamsRes, roomRes] = await Promise.all([
        supabase.from("tl_teams").select("*").eq("room_id", roomId).order("sort_order"),
        supabase.from("tl_rooms").select("host_id, settings").eq("id", roomId).single(),
      ]);
      const ts = (teamsRes.data ?? []) as TlTeam[];
      setTeams(ts);
      const room = roomRes.data as Pick<TlRoom, "host_id" | "settings"> | null;
      setHostId(room?.host_id ?? null);
      const s = (room?.settings ?? {}) as TlRoomSettings;
      setHideCode(!!(s.streamerMode || s.gamemasterMode));
      const countMap: Record<number, number> = {};
      for (const t of ts) {
        const r = await supabase.from("tl_timeline").select("*", { count: "exact", head: true }).eq("team_id", t.id);
        countMap[t.id] = r.count ?? 0;
      }
      setCounts(countMap);
      setLoading(false);
    })();
  }, [roomId]);

  async function playAgain() {
    if (!roomId || !myPlayerId) return;
    setResetting(true);
    setResetError(null);
    try {
      const res = await fetch(`/room/${roomId}/reset`, {
        method:      "POST",
        headers:     { "Content-Type": "application/json" },
        credentials: "include",
        body:        JSON.stringify({ player_id: myPlayerId }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        let msg = `Reset failed (${res.status})`;
        try { msg = (JSON.parse(text).error as string) || msg; } catch { /* ignore */ }
        setResetError(msg);
        setResetting(false);
        return;
      }
      navigate(`/lobby/${roomId}`);
    } catch (e) {
      setResetError(e instanceof Error ? e.message : "Network error");
      setResetting(false);
    }
  }

  if (loading) return <div className="flex-1 flex items-center justify-center opacity-50">Loading…</div>;

  const sorted = [...teams].sort((a, b) => (counts[b.id] ?? 0) - (counts[a.id] ?? 0));
  const winner = sorted[0];
  const isHost = !!(myPlayerId && hostId && myPlayerId === hostId);

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
          <Button
            onClick={playAgain}
            disabled={!isHost || resetting}
            title={!isHost ? "Only the host can restart this room" : undefined}
          >
            {resetting ? "Resetting…" : "Play again"}
          </Button>
        </div>
        {resetError && (
          <p className="text-sm" style={{ color: "rgb(var(--color-danger-rgb, 220,60,60))" }}>
            {resetError}
          </p>
        )}
        {!isHost && (
          <p className="text-xs opacity-50">Waiting for the host to start a new game…</p>
        )}
      </div>
    </div>
  );
}
