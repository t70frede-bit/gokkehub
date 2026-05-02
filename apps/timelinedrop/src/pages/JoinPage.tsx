import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button, Input, Panel } from "@gokkehub/ui";
import { useSession } from "../hooks/useSession";
import { supabase } from "../lib/supabase";
import type {
  TlRoom,
  TlTeam,
  JoinRoomRequest,
  JoinRoomResponse,
  LateJoinMode,
} from "../lib/types";
import { DEFAULT_TL_SETTINGS } from "../lib/types";

interface RoomSnapshot {
  room:  TlRoom;
  teams: TlTeam[];
}

export default function JoinPage() {
  const navigate    = useNavigate();
  const [params]    = useSearchParams();
  const { session } = useSession();

  const roomId = (params.get("room") ?? "").toUpperCase();

  const [snap,    setSnap]    = useState<RoomSnapshot | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [name,      setName]      = useState(session?.displayName ?? "");
  const [teamId,    setTeamId]    = useState<number | null>(null);
  const [spectator, setSpectator] = useState(false);
  const [joining,   setJoining]   = useState(false);
  const [joinErr,   setJoinErr]   = useState<string | null>(null);

  // Pre-fill name from session
  useEffect(() => {
    if (session?.displayName && !name) setName(session.displayName);
  }, [session]);

  // Load room + teams
  useEffect(() => {
    if (!roomId) {
      setLoadErr("No room code in URL.");
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const [{ data: room, error: roomErr }, { data: teams }] = await Promise.all([
        supabase.from("tl_rooms").select("*").eq("id", roomId).maybeSingle(),
        supabase.from("tl_teams").select("*").eq("room_id", roomId).order("sort_order", { ascending: true }),
      ]);
      if (cancelled) return;
      if (roomErr || !room) {
        setLoadErr("Room not found. Check the code and try again.");
      } else if (room.status === "finished") {
        setLoadErr("This game has already ended.");
      } else {
        const r = room as TlRoom;
        const lateJoinMode: LateJoinMode = r.settings?.lateJoinMode ?? DEFAULT_TL_SETTINGS.lateJoinMode;
        const inProgress = r.status === "playing";

        if (inProgress && lateJoinMode === "closed") {
          setLoadErr("The host has closed this lobby to new players.");
        } else {
          if (inProgress && lateJoinMode === "spectator-only") setSpectator(true);
          const t = (teams ?? []) as TlTeam[];
          setSnap({ room: r, teams: t });
          if (!inProgress || lateJoinMode === "open") {
            setTeamId(t[0]?.id ?? null);
          }
        }
      }
      setLoading(false);
    })().catch(() => {
      if (!cancelled) {
        setLoadErr("Could not load room.");
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [roomId]);

  // Auto-rejoin if we already have a player ID for this room
  useEffect(() => {
    if (!snap) return;
    const savedId = localStorage.getItem(`tl_player_${roomId}`);
    if (!savedId) return;
    supabase.from("tl_players").select("*").eq("id", savedId).maybeSingle()
      .then(({ data }) => {
        if (data && data.room_id === roomId) {
          if (snap.room.status === "playing") navigate(`/game/${roomId}`);
          else navigate(`/lobby/${roomId}`);
        }
      });
  }, [snap, roomId, navigate]);

  async function handleJoin() {
    const trimmed = (session?.displayName ?? name).trim();
    if (!trimmed) { setJoinErr("Please enter your name."); return; }
    if (!snap)    { setJoinErr("Room not loaded."); return; }
    if (!spectator && teamId === null) { setJoinErr("Pick a team first."); return; }

    setJoining(true); setJoinErr(null);
    try {
      const body: JoinRoomRequest = {
        name:         trimmed,
        team_id:      spectator ? null : teamId,
        is_spectator: spectator,
      };
      const res = await fetch(`/room/${roomId}/join`, {
        method:      "POST",
        headers:     { "Content-Type": "application/json" },
        credentials: "include",
        body:        JSON.stringify(body),
      });
      const data = await res.json() as JoinRoomResponse | { error: string };
      if (!res.ok) {
        setJoinErr((data as { error: string }).error ?? "Could not join");
        return;
      }
      const { player_id } = data as JoinRoomResponse;
      localStorage.setItem(`tl_player_${roomId}`, player_id);
      if (snap.room.status === "playing") navigate(`/game/${roomId}`);
      else navigate(`/lobby/${roomId}`);
    } catch {
      setJoinErr("Network error — try again.");
    } finally {
      setJoining(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loading) {
    return <Centered><p className="opacity-50">Loading lobby…</p></Centered>;
  }

  if (loadErr) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <Panel className="w-full max-w-sm text-center p-6 space-y-4">
          <p className="text-3xl">😕</p>
          <p className="font-semibold">{loadErr}</p>
          <Button variant="ghost" className="w-full" onClick={() => navigate("/")}>
            ← Back to home
          </Button>
        </Panel>
      </div>
    );
  }

  const { room, teams } = snap!;
  const inProgress      = room.status === "playing";
  const lateJoinMode    = room.settings?.lateJoinMode ?? "open";
  const forcedSpectator = inProgress && lateJoinMode === "spectator-only";
  const streamerMode    = !!room.settings?.streamerMode;

  return (
    <div className="flex-1 flex items-center justify-center p-4">
      <Panel className="w-full max-w-md p-6 space-y-5">

        <div>
          <h1 className="font-extrabold text-2xl tracking-tight">Join Lobby</h1>
          <p className="text-sm mt-1 flex items-center gap-2 flex-wrap" style={{ color: "rgb(var(--text-muted-rgb))" }}>
            {streamerMode ? (
              <span className="text-xs">Private lobby</span>
            ) : (
              <>Code: <strong style={{ fontFamily: "var(--font-mono)" }}>{roomId}</strong></>
            )}
            {inProgress && (
              <span className="text-xs px-2 py-0.5 rounded-full"
                style={{ background: "rgba(40,180,60,0.15)", color: "rgb(40,180,60)" }}>
                In progress
              </span>
            )}
            {forcedSpectator && (
              <span className="text-xs px-2 py-0.5 rounded-full"
                style={{ background: "rgba(220,160,0,0.15)", color: "rgb(220,160,0)" }}>
                Spectators only
              </span>
            )}
          </p>
        </div>

        {/* Name */}
        {session ? (
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg"
            style={{ background: "rgba(var(--surface-raised-rgb),0.4)", border: "1px solid rgba(255,255,255,0.08)" }}>
            {session.avatarUrl && (
              <img src={session.avatarUrl} alt="" className="w-7 h-7 rounded-full object-cover" />
            )}
            <div>
              <p className="text-sm font-semibold">{session.displayName ?? session.email}</p>
              <p className="text-xs" style={{ color: "rgb(var(--text-muted-rgb))" }}>GokkeHub account</p>
            </div>
          </div>
        ) : (
          <Input
            label="Your name"
            placeholder="e.g. Frederik"
            value={name}
            onChange={e => setName(e.target.value)}
            maxLength={30}
            onKeyDown={e => e.key === "Enter" && !spectator && handleJoin()}
          />
        )}

        {/* Spectator notice or toggle */}
        {forcedSpectator ? (
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm"
            style={{ background: "rgba(220,160,0,0.1)", border: "1px solid rgba(220,160,0,0.25)", color: "rgb(220,160,0)" }}>
            👁️ Joining as spectator — host has limited late joins
          </div>
        ) : (
          <button
            onClick={() => setSpectator(v => !v)}
            className="flex items-center gap-3 text-sm font-medium"
          >
            <span className="w-10 h-6 rounded-full transition-colors relative flex-shrink-0"
              style={{ background: spectator ? "rgb(var(--color-primary-rgb))" : "rgba(255,255,255,0.15)" }}>
              <span className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform"
                style={{ transform: spectator ? "translateX(16px)" : "none" }} />
            </span>
            Join as spectator (no team, listen only)
          </button>
        )}

        {/* Team picker */}
        {!spectator && !forcedSpectator && (
          <div>
            <p className="text-sm font-medium mb-2" style={{ color: "rgb(var(--text-secondary-rgb))" }}>
              Pick your team
            </p>
            <div className="grid grid-cols-2 gap-2">
              {teams.map(t => {
                const selected = teamId === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setTeamId(t.id)}
                    className="px-3 py-3 rounded-xl text-sm font-semibold border transition-all text-left"
                    style={{
                      borderColor: selected ? "rgba(var(--color-primary-rgb),0.7)" : "rgba(255,255,255,0.12)",
                      background:  selected ? "rgba(var(--color-primary-rgb),0.15)" : "transparent",
                      color:       selected ? "rgb(var(--color-primary-rgb))" : "inherit",
                    }}
                  >
                    {t.name}
                  </button>
                );
              })}
            </div>
            {teams.length === 0 && (
              <p className="text-xs italic mt-2" style={{ color: "rgb(var(--text-muted-rgb))" }}>
                Host hasn't set up teams yet.
              </p>
            )}
          </div>
        )}

        {joinErr && <p className="text-sm text-red-400">{joinErr}</p>}

        <Button onClick={handleJoin} loading={joining} className="w-full" size="lg">
          {inProgress ? "Join in-progress game" : "Join lobby"}
        </Button>

        <button
          className="text-sm w-full text-center opacity-60 hover:opacity-100"
          onClick={() => navigate("/")}
        >
          ← Back to home
        </button>
      </Panel>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex-1 flex items-center justify-center">{children}</div>;
}
