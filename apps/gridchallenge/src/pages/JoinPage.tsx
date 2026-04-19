import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button, Panel, Input, TeamCircle, useToast } from "@gokkehub/ui";
import { useSession } from "../hooks/useSession";
import { supabase } from "../lib/supabase";
import type { Lobby, TeamColor } from "../lib/types";
import { TEAM_COLORS } from "../lib/types";

function generatePlayerId(): string {
  return crypto.randomUUID?.() ?? `player-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

export default function JoinPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { session } = useSession();
  const { addToast } = useToast();

  const lobbyIdParam = params.get("lobby")?.toLowerCase() ?? "";

  const [lobby, setLobby] = useState<Lobby | null>(null);
  const [lobbyError, setLobbyError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState(session?.displayName ?? "");
  const [team, setTeam] = useState<TeamColor>("blue");
  const [spectator, setSpectator] = useState(false);
  const [joining, setJoining] = useState(false);

  // Pre-fill name from session
  useEffect(() => {
    if (session?.displayName && !name) setName(session.displayName);
  }, [session]);

  // Load lobby
  useEffect(() => {
    if (!lobbyIdParam) {
      setLobbyError("No lobby code in URL.");
      setLoading(false);
      return;
    }

    supabase
      .from("lobbies")
      .select("*")
      .eq("id", lobbyIdParam)
      .single()
      .then(({ data, error }) => {
        if (error || !data) {
          setLobbyError("Lobby not found. Check the code and try again.");
        } else if (data.status === "finished") {
          setLobbyError("This game has already ended.");
        } else {
          setLobby(data as Lobby);
        }
        setLoading(false);
      });
  }, [lobbyIdParam]);

  // Check if already in lobby (saved player ID)
  useEffect(() => {
    if (!lobby) return;
    const savedId = localStorage.getItem(`playerId_${lobbyIdParam}`);
    if (!savedId) return;

    supabase
      .from("players")
      .select("*")
      .eq("id", savedId)
      .single()
      .then(({ data }) => {
        if (data && !data.kicked) {
          // Rejoin
          sessionStorage.setItem("playerId", savedId);
          sessionStorage.setItem("playerName", data.name);
          sessionStorage.setItem("playerTeam", data.team ?? "");
          sessionStorage.setItem("isSpectator", data.is_spectator ? "true" : "false");
          sessionStorage.setItem("lobbyId", lobbyIdParam);

          if (lobby.status === "playing") {
            navigate(`/board/${lobbyIdParam}`);
          } else {
            navigate(`/lobby/${lobbyIdParam}`);
          }
        }
      });
  }, [lobby]);

  async function handleJoin() {
    const trimmedName = (session?.displayName ?? name).trim();
    if (!trimmedName) {
      addToast("Please enter your name.", "error");
      return;
    }
    if (!lobby) return;

    setJoining(true);

    const playerId = generatePlayerId();
    const assignedTeam = spectator ? null : team;

    const { error } = await supabase.from("players").insert({
      id:           playerId,
      lobby_id:     lobbyIdParam,
      name:         trimmedName,
      team:         assignedTeam,
      is_host:      false,
      is_spectator: spectator,
      kicked:       false,
      user_id:      session?.userId ?? null,
      avatar_url:   session?.avatarUrl ?? null,
    });

    if (error) {
      addToast("Failed to join: " + error.message, "error");
      setJoining(false);
      return;
    }

    sessionStorage.setItem("playerId",    playerId);
    sessionStorage.setItem("playerName",  trimmedName);
    sessionStorage.setItem("playerTeam",  assignedTeam ?? "");
    sessionStorage.setItem("isSpectator", spectator ? "true" : "false");
    sessionStorage.setItem("lobbyId",     lobbyIdParam);
    localStorage.setItem(`playerId_${lobbyIdParam}`,    playerId);
    localStorage.setItem(`playerName_${lobbyIdParam}`,  trimmedName);

    if (lobby.status === "playing") {
      navigate(`/board/${lobbyIdParam}`);
    } else {
      navigate(`/lobby/${lobbyIdParam}`);
    }
  }

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <p style={{ color: "rgb(var(--text-muted-rgb))" }}>Loading lobby…</p>
      </div>
    );
  }

  if (lobbyError) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center gap-4">
        <Panel className="max-w-sm w-full text-center p-6">
          <p className="text-2xl mb-2">😕</p>
          <p className="font-semibold mb-4">{lobbyError}</p>
          <Button variant="ghost" fullWidth onClick={() => navigate("/")}>
            Back to Home
          </Button>
        </Panel>
      </div>
    );
  }

  const teamCount = lobby!.settings.teamCount ?? 2;
  const availableTeams = TEAM_COLORS.slice(0, teamCount);

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center p-4">
      <Panel className="w-full max-w-sm flex flex-col gap-5">
        <div>
          <h1 className="font-bold text-2xl">Join Lobby</h1>
          <p className="text-sm mt-0.5" style={{ color: "rgb(var(--text-muted-rgb))" }}>
            Code: <strong>{lobbyIdParam.toUpperCase()}</strong>
            {lobby?.status === "playing" && (
              <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-400">
                In progress
              </span>
            )}
          </p>
        </div>

        {/* Name — show input only when not logged in */}
        {session ? (
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg" style={{ background: "rgba(var(--surface-raised-rgb),0.4)", border: "1px solid rgba(255,255,255,0.08)" }}>
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
            placeholder="Enter your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !spectator && handleJoin()}
          />
        )}

        {/* Spectator toggle */}
        <button
          onClick={() => setSpectator((v) => !v)}
          className="flex items-center gap-2 text-sm font-medium"
        >
          <span
            className="w-10 h-6 rounded-full transition-colors relative flex-shrink-0"
            style={{
              background: spectator ? "rgb(var(--color-primary-rgb))" : "rgba(255,255,255,0.15)",
            }}
          >
            <span
              className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform"
              style={{ transform: spectator ? "translateX(16px)" : "none" }}
            />
          </span>
          Join as spectator
        </button>

        {/* Team selection */}
        {!spectator && (
          <div>
            <p className="text-sm font-medium mb-2">Pick your team</p>
            <div className="flex gap-3 flex-wrap">
              {availableTeams.map((color) => (
                <TeamCircle
                  key={color}
                  team={color}
                  selected={team === color}
                  onClick={() => setTeam(color)}
                />
              ))}
            </div>
          </div>
        )}

        <Button variant="primary" fullWidth loading={joining} onClick={handleJoin}>
          {lobby?.status === "playing" ? "Join In Progress Game" : "Join Lobby"}
        </Button>

        <button
          className="text-sm text-center"
          style={{ color: "rgb(var(--text-muted-rgb))" }}
          onClick={() => navigate("/")}
        >
          ← Back to Home
        </button>
      </Panel>
    </div>
  );
}
