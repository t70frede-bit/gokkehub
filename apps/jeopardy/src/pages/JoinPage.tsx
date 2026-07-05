import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button, Input, Panel } from "@gokkehub/ui";
import { useSession } from "../hooks/useSession";
import { getStoredPlayerId, storePlayerId } from "../hooks/useRoom";
import { supabase } from "../lib/supabase";
import type { JoinRoomResponse, JpGame, JpPlayer, JpRoom, JpTeam } from "../lib/types";

// Receives the hub redirect: gokkehub.com/join → jeopardy.gokkehub.com/join?room=CODE
export default function JoinPage() {
  const navigate    = useNavigate();
  const [params]    = useSearchParams();
  const { session } = useSession();

  const roomId = (params.get("room") ?? "").toUpperCase();

  const [room,    setRoom]    = useState<JpRoom | null>(null);
  const [teams,   setTeams]   = useState<JpTeam[]>([]);
  const [players, setPlayers] = useState<JpPlayer[]>([]);
  const [teamMode, setTeamMode] = useState(false);
  const [teamId,  setTeamId]  = useState<number | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [name,    setName]    = useState("");
  const [joining, setJoining] = useState(false);
  const [joinErr, setJoinErr] = useState<string | null>(null);

  useEffect(() => {
    if (session?.displayName && !name) setName(session.displayName);
  }, [session]);

  useEffect(() => {
    if (!roomId) { setLoadErr("No room code in URL."); return; }
    // Already joined on this device? Go straight in.
    if (getStoredPlayerId(roomId)) {
      navigate(`/lobby/${roomId}`, { replace: true });
      return;
    }
    let cancelled = false;
    (async () => {
      const { data: roomRow, error } = await supabase.from("jp_rooms").select("*").eq("id", roomId).maybeSingle();
      if (cancelled) return;
      if (error || !roomRow) {
        setLoadErr("Room not found. Check the code and try again.");
        return;
      }
      const r = roomRow as JpRoom;
      if (r.status === "finished") {
        setLoadErr("This game has already ended.");
        return;
      }
      setRoom(r);
      const [{ data: game }, { data: teamRows }, { data: playerRows }] = await Promise.all([
        supabase.from("jp_games").select("config").eq("id", r.game_id).maybeSingle(),
        supabase.from("jp_teams").select("*").eq("room_id", roomId).order("sort_order", { ascending: true }),
        supabase.from("jp_players").select("*").eq("room_id", roomId),
      ]);
      if (cancelled) return;
      setTeamMode((game as Pick<JpGame, "config"> | null)?.config.teams?.mode === "teams");
      setTeams((teamRows ?? []) as JpTeam[]);
      setPlayers((playerRows ?? []) as JpPlayer[]);
    })();
    return () => { cancelled = true; };
  }, [roomId]);

  const join = async () => {
    if (!name.trim() || !room) return;
    setJoining(true);
    setJoinErr(null);
    const res  = await fetch(`/room/${roomId}/join`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body:    JSON.stringify({ name: name.trim(), team_id: teamId }),
    });
    const body = await res.json().catch(() => null) as (JoinRoomResponse & { error?: string }) | null;
    setJoining(false);
    if (!res.ok || !body?.player_id) {
      setJoinErr(body?.error ?? "Could not join room");
      return;
    }
    storePlayerId(roomId, body.player_id);
    navigate(room.status === "playing" ? `/play/${roomId}` : `/lobby/${roomId}`);
  };

  const memberCount = (id: number) => players.filter(p => p.team_id === id).length;

  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <Panel className="w-full max-w-md">
        <h1 className="text-2xl font-bold mb-1">Join game</h1>
        <p className="mb-5 text-sm" style={{ color: "rgb(var(--text-secondary-rgb))" }}>
          Room <span className="font-mono font-bold">{roomId || "—"}</span>
        </p>
        {loadErr ? (
          <p style={{ color: "rgb(var(--color-danger-rgb))" }}>{loadErr}</p>
        ) : (
          <div className="flex flex-col gap-4">
            <Input
              label="Your name"
              value={name}
              placeholder="Name"
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && join()}
            />
            {teamMode && teams.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-sm font-semibold" style={{ color: "rgb(var(--text-secondary-rgb))" }}>
                  Pick a team (or let the game balance it)
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {teams.map(t => (
                    <button key={t.id} type="button"
                      onClick={() => setTeamId(teamId === t.id ? null : t.id)}
                      className="rounded-md px-3 py-2 font-bold text-sm"
                      style={{
                        background: teamId === t.id ? "rgba(var(--color-primary-rgb), 0.18)" : "rgb(var(--surface-input-rgb))",
                        border: teamId === t.id
                          ? "1px solid rgb(var(--color-primary-rgb))"
                          : "1px solid rgb(var(--border-rgb))",
                        color: teamId === t.id ? "rgb(var(--color-primary-rgb))" : "rgb(var(--text-primary-rgb))",
                      }}>
                      {t.name}
                      <span className="block text-[10px] font-normal opacity-70">
                        {memberCount(t.id)} player{memberCount(t.id) === 1 ? "" : "s"}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <Button fullWidth loading={joining} disabled={!name.trim() || !room} onClick={join}>
              Join{teamId !== null ? ` ${teams.find(t => t.id === teamId)?.name}` : ""}
            </Button>
            {joinErr && <p className="text-sm" style={{ color: "rgb(var(--color-danger-rgb))" }}>{joinErr}</p>}
          </div>
        )}
      </Panel>
    </div>
  );
}
