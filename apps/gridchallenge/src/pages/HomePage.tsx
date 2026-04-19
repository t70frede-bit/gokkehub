import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Panel, Input, Modal, TeamCircle, Toggle, useToast } from "@gokkehub/ui";
import { useSession } from "../hooks/useSession";
import { supabase } from "../lib/supabase";
import {
  loadCsvChallenges,
  getCsvChallenges,
  buildChallengePool,
  selectBoardChallenges,
} from "../lib/challenges";
import { getGameDisplayName } from "../lib/gameKeys";
import type {
  ChallengeType,
  LobbySettings,
  TeamColor,
} from "../lib/types";
import { TEAM_COLORS } from "../lib/types";

// ── Helpers ────────────────────────────────────────────────────────────────────

function generateLobbyId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

function generatePlayerId(): string {
  return crypto.randomUUID?.() ?? `player-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

// ── Default settings ───────────────────────────────────────────────────────────

const DEFAULT_SETTINGS: LobbySettings = {
  boardWidth:     5,
  boardHeight:    5,
  winLength:      5,
  teamCount:      2,
  teamMode:       "manual",
  versusCount:    5,
  versusInterval: 5,
  freeSpace:      false,
  games:          [],
  types:          ["single", "group", "versus"],
  poolMode:       "standard",
};

// ── Component ──────────────────────────────────────────────────────────────────

export default function HomePage() {
  const navigate = useNavigate();
  const { session } = useSession();
  const { addToast } = useToast();

  // Panels
  const [panel, setPanel] = useState<"menu" | "join" | "solo">("menu");
  const [showHostModal, setShowHostModal] = useState(false);

  // Solo settings
  const [soloSettings, setSoloSettings] = useState<LobbySettings>(DEFAULT_SETTINGS);
  const [allGames, setAllGames] = useState<string[]>([]);
  const [selectedGames, setSelectedGames] = useState<Set<string>>(new Set());
  const [selectedTypes, setSelectedTypes] = useState<Set<ChallengeType>>(
    new Set(["single", "group", "versus"] as ChallengeType[]),
  );
  const [challengesLoaded, setChallengesLoaded] = useState(false);

  // Join
  const [joinCode, setJoinCode] = useState("");
  const [joinLoading, setJoinLoading] = useState(false);

  // Host modal
  const [hostName, setHostName] = useState(session?.displayName ?? "");
  const [hostRole, setHostRole] = useState<"player" | "gm">("player");
  const [hostTeam, setHostTeam] = useState<TeamColor>("blue");
  const [hostLoading, setHostLoading] = useState(false);

  // Load CSV + derive game list
  useEffect(() => {
    loadCsvChallenges().then((challenges) => {
      const games = [...new Set(challenges.map((c) => c.game))].filter(Boolean).sort();
      setAllGames(games);
      setSelectedGames(new Set(games));
      setChallengesLoaded(true);
    });
  }, []);

  // Pre-fill host name from session
  useEffect(() => {
    if (session?.displayName && !hostName) setHostName(session.displayName);
  }, [session]);

  // ── Solo generate ────────────────────────────────────────────────────────────

  function generateSolo() {
    const csv = getCsvChallenges();
    const filteredPool = buildChallengePool(csv, [], {
      games: [...selectedGames],
      types: [...selectedTypes] as ChallengeType[],
      poolMode: "standard",
    });

    const settings: LobbySettings = {
      ...soloSettings,
      games: [...selectedGames],
      types: [...selectedTypes] as ChallengeType[],
    };

    const selected = selectBoardChallenges(filteredPool, settings);
    if (!selected) {
      const needed = settings.boardWidth * settings.boardHeight - (settings.freeSpace ? 1 : 0) - settings.versusCount;
      addToast(`Not enough non-versus challenges (need ${needed}). Try adding more games or reducing board size.`, "error");
      return;
    }

    const ids = selected.map((c) => c.id);
    try {
      localStorage.setItem("solo_board_ids", JSON.stringify(ids));
      localStorage.setItem("solo_settings", JSON.stringify(settings));
      localStorage.removeItem("solo_board_state");
      localStorage.removeItem("solo_versus_state");
    } catch { /* ignore quota */ }

    navigate(`/board?ids=${ids.join(",")}`);
  }

  // ── Join lobby ───────────────────────────────────────────────────────────────

  async function handleJoin() {
    const code = joinCode.trim().toLowerCase();
    if (!code) return;
    setJoinLoading(true);
    navigate(`/join?lobby=${code}`);
  }

  // ── Create lobby ─────────────────────────────────────────────────────────────

  async function handleCreateLobby() {
    const name = session?.displayName?.trim() || hostName.trim();
    if (!name) {
      addToast("Please enter your name.", "error");
      return;
    }

    setHostLoading(true);

    const lobbyId    = generateLobbyId();
    const playerId   = generatePlayerId();
    const isGM       = hostRole === "gm";
    const settings: LobbySettings = { ...DEFAULT_SETTINGS };

    const { error: lobbyErr } = await supabase.from("lobbies").insert({
      id:              lobbyId,
      host_player_id:  playerId,
      status:          "waiting",
      settings,
      board_challenge_ids: null,
    });

    if (lobbyErr) {
      addToast("Failed to create lobby: " + lobbyErr.message, "error");
      setHostLoading(false);
      return;
    }

    const { error: playerErr } = await supabase.from("players").insert({
      id:           playerId,
      lobby_id:     lobbyId,
      name,
      team:         isGM ? null : hostTeam,
      is_host:      true,
      is_spectator: isGM,
      kicked:       false,
      user_id:      session?.userId ?? null,
      avatar_url:   session?.avatarUrl ?? null,
    });

    if (playerErr) {
      addToast("Failed to register host: " + playerErr.message, "error");
      setHostLoading(false);
      return;
    }

    sessionStorage.setItem("playerId",   playerId);
    sessionStorage.setItem("playerName", name);
    sessionStorage.setItem("playerTeam", isGM ? "" : hostTeam);
    sessionStorage.setItem("isSpectator", isGM ? "true" : "false");
    sessionStorage.setItem("lobbyId", lobbyId);

    navigate(`/lobby/${lobbyId}`);
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center p-4 gap-6">
      {/* Title */}
      <div className="text-center">
        <h1
          className="text-4xl md:text-5xl font-extrabold tracking-tight mb-1"
          style={{
            background: "linear-gradient(135deg, rgb(var(--color-primary-rgb)), rgb(var(--color-accent-rgb)))",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
          }}
        >
          GridChallenge
        </h1>
        <p className="text-sm" style={{ color: "rgb(var(--text-muted-rgb))" }}>
          Party bingo with your favourite games
        </p>
        {session && (
          <p className="text-xs mt-1" style={{ color: "rgb(var(--text-muted-rgb))" }}>
            Signed in as <strong>{session.displayName ?? session.email}</strong>
          </p>
        )}
      </div>

      {/* Main menu cards */}
      {panel === "menu" && (
        <div className="flex flex-col sm:flex-row gap-4 w-full max-w-lg">
          <Panel className="flex-1 flex flex-col items-center gap-3 p-6 text-center cursor-pointer hover:scale-[1.02] transition-transform">
            <span className="text-3xl">🌐</span>
            <h2 className="font-bold text-lg">Host Game</h2>
            <p className="text-sm" style={{ color: "rgb(var(--text-muted-rgb))" }}>
              Create an online lobby for your group
            </p>
            <Button
              variant="primary"
              className="w-full mt-auto"
              onClick={() => setShowHostModal(true)}
            >
              Host
            </Button>
          </Panel>

          <Panel className="flex-1 flex flex-col items-center gap-3 p-6 text-center cursor-pointer hover:scale-[1.02] transition-transform">
            <span className="text-3xl">🔗</span>
            <h2 className="font-bold text-lg">Join Game</h2>
            <p className="text-sm" style={{ color: "rgb(var(--text-muted-rgb))" }}>
              Enter a lobby code to join
            </p>
            <Button
              variant="ghost"
              className="w-full mt-auto"
              onClick={() => setPanel("join")}
            >
              Join
            </Button>
          </Panel>

          <Panel className="flex-1 flex flex-col items-center gap-3 p-6 text-center cursor-pointer hover:scale-[1.02] transition-transform">
            <span className="text-3xl">👤</span>
            <h2 className="font-bold text-lg">Solo</h2>
            <p className="text-sm" style={{ color: "rgb(var(--text-muted-rgb))" }}>
              Practice challenges on your own
            </p>
            <Button
              variant="ghost"
              className="w-full mt-auto"
              onClick={() => setPanel("solo")}
            >
              Solo
            </Button>
          </Panel>
        </div>
      )}

      {/* Join panel */}
      {panel === "join" && (
        <Panel className="w-full max-w-sm flex flex-col gap-4">
          <button
            className="text-sm flex items-center gap-1"
            style={{ color: "rgb(var(--text-muted-rgb))" }}
            onClick={() => setPanel("menu")}
          >
            ← Back
          </button>
          <h2 className="font-bold text-xl">Join a Lobby</h2>
          <Input
            label="Lobby code"
            placeholder="e.g. abc123"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleJoin()}
          />
          <Button variant="primary" fullWidth loading={joinLoading} onClick={handleJoin}>
            Join
          </Button>
        </Panel>
      )}

      {/* Solo panel */}
      {panel === "solo" && (
        <Panel className="w-full max-w-xl flex flex-col gap-5">
          <button
            className="text-sm flex items-center gap-1"
            style={{ color: "rgb(var(--text-muted-rgb))" }}
            onClick={() => setPanel("menu")}
          >
            ← Back
          </button>
          <h2 className="font-bold text-xl">Solo Game</h2>

          {!challengesLoaded ? (
            <p className="text-sm" style={{ color: "rgb(var(--text-muted-rgb))" }}>Loading challenges…</p>
          ) : (
            <>
              {/* Board size */}
              <div className="flex gap-3 items-end">
                <Input
                  label="Board width"
                  type="number"
                  min={3} max={9}
                  value={soloSettings.boardWidth}
                  onChange={(e) => setSoloSettings((s) => ({ ...s, boardWidth: Math.max(3, Math.min(9, Number(e.target.value))) }))}
                />
                <Input
                  label="Board height"
                  type="number"
                  min={3} max={9}
                  value={soloSettings.boardHeight}
                  onChange={(e) => setSoloSettings((s) => ({ ...s, boardHeight: Math.max(3, Math.min(9, Number(e.target.value))) }))}
                />
                <Input
                  label="Win length"
                  type="number"
                  min={3} max={9}
                  value={soloSettings.winLength}
                  onChange={(e) => setSoloSettings((s) => ({ ...s, winLength: Math.max(3, Math.min(9, Number(e.target.value))) }))}
                />
              </div>

              {/* Challenge types */}
              <div>
                <p className="text-sm font-medium mb-2">Challenge types</p>
                <div className="flex gap-2 flex-wrap">
                  {(["single", "group", "versus"] as ChallengeType[]).map((t) => (
                    <button
                      key={t}
                      onClick={() =>
                        setSelectedTypes((prev) => {
                          const next = new Set(prev);
                          next.has(t) ? next.delete(t) : next.add(t);
                          return next;
                        })
                      }
                      className="px-3 py-1.5 rounded-full text-sm font-semibold border transition-all"
                      style={{
                        borderColor: selectedTypes.has(t)
                          ? "rgba(var(--color-primary-rgb), 0.8)"
                          : "rgba(255,255,255,0.12)",
                        background: selectedTypes.has(t)
                          ? "rgba(var(--color-primary-rgb), 0.18)"
                          : "transparent",
                      }}
                    >
                      {t === "single" ? "👤 Single" : t === "group" ? "👥 Group" : "⚔️ Versus"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Versus settings */}
              {selectedTypes.has("versus") && (
                <div className="flex gap-3">
                  <Input
                    label="Versus count"
                    type="number" min={0} max={20}
                    value={soloSettings.versusCount}
                    onChange={(e) => setSoloSettings((s) => ({ ...s, versusCount: Math.max(0, Number(e.target.value)) }))}
                  />
                  <Input
                    label="Versus interval (min)"
                    type="number" min={1} max={60}
                    value={soloSettings.versusInterval}
                    onChange={(e) => setSoloSettings((s) => ({ ...s, versusInterval: Math.max(1, Math.min(60, Number(e.target.value))) }))}
                  />
                </div>
              )}

              {/* Free space */}
              <button
                onClick={() => setSoloSettings((s) => ({ ...s, freeSpace: !s.freeSpace }))}
                className="flex items-center gap-2 text-sm font-semibold px-3 py-2 rounded-lg border transition-all w-fit"
                style={{
                  borderColor: soloSettings.freeSpace ? "rgba(var(--color-primary-rgb),0.7)" : "rgba(255,255,255,0.12)",
                  background: soloSettings.freeSpace ? "rgba(var(--color-primary-rgb),0.15)" : "transparent",
                }}
              >
                {soloSettings.freeSpace ? "✅ Free space ON" : "⬜ Free space OFF"}
              </button>

              {/* Games */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium">Games</p>
                  <div className="flex gap-2">
                    <button
                      className="text-xs"
                      style={{ color: "rgb(var(--color-primary-rgb))" }}
                      onClick={() => setSelectedGames(new Set(allGames))}
                    >
                      All
                    </button>
                    <button
                      className="text-xs"
                      style={{ color: "rgb(var(--text-muted-rgb))" }}
                      onClick={() => setSelectedGames(new Set())}
                    >
                      None
                    </button>
                  </div>
                </div>
                <div className="game-checkbox-grid">
                  {allGames.map((game) => (
                    <label key={game} className="game-checkbox-label">
                      <input
                        type="checkbox"
                        checked={selectedGames.has(game)}
                        onChange={() =>
                          setSelectedGames((prev) => {
                            const next = new Set(prev);
                            next.has(game) ? next.delete(game) : next.add(game);
                            return next;
                          })
                        }
                      />
                      {selectedGames.has(game) ? "✓ " : "  "}
                      {getGameDisplayName(game)}
                    </label>
                  ))}
                </div>
              </div>

              <Button variant="primary" fullWidth onClick={generateSolo}>
                Generate Board
              </Button>
            </>
          )}
        </Panel>
      )}

      {/* Host modal */}
      <Modal open={showHostModal} onClose={() => setShowHostModal(false)}>
          <div className="flex flex-col gap-4">
            <h2 className="font-bold text-xl">Create Lobby</h2>

            {/* Show name input only when not signed in */}
            {session ? (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: "rgba(var(--surface-raised-rgb),0.4)" }}>
                {session.avatarUrl && <img src={session.avatarUrl} alt="" className="w-6 h-6 rounded-full" />}
                <span className="text-sm font-semibold">{session.displayName ?? session.email}</span>
              </div>
            ) : (
              <Input
                label="Your name"
                placeholder="Enter your name"
                value={hostName}
                onChange={(e) => setHostName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreateLobby()}
              />
            )}

            <div>
              <p className="text-sm font-medium mb-2">Your role</p>
              <Toggle
                options={[
                  { value: "player", label: "Player" },
                  { value: "gm", label: "Game Master (spectator)" },
                ]}
                value={hostRole}
                onChange={(v) => setHostRole(v as "player" | "gm")}
              />
            </div>

            {hostRole === "player" && (
              <div>
                <p className="text-sm font-medium mb-2">Your team</p>
                <div className="flex gap-3 flex-wrap">
                  {TEAM_COLORS.slice(0, 4).map((color) => (
                    <TeamCircle
                      key={color}
                      team={color}
                      selected={hostTeam === color}
                      onClick={() => setHostTeam(color)}
                    />
                  ))}
                </div>
              </div>
            )}

            <Button
              variant="primary"
              fullWidth
              loading={hostLoading}
              onClick={handleCreateLobby}
            >
              Create Lobby
            </Button>
          </div>
      </Modal>

      {/* Account link */}
      <p className="text-xs" style={{ color: "rgb(var(--text-muted-rgb))" }}>
        {session ? (
          <a href="https://account.gokkehub.com/profile" className="underline">
            Manage account & challenges
          </a>
        ) : (
          <a href="https://account.gokkehub.com" className="underline">
            Sign in with GokkeHub for more features
          </a>
        )}
      </p>
    </div>
  );
}
