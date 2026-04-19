import { useState, useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button, Panel, Input, Badge, Toggle, useToast } from "@gokkehub/ui";
import { useSession } from "../hooks/useSession";
import { supabase } from "../lib/supabase";
import {
  loadCsvChallenges,
  getCsvChallenges,
  buildChallengePool,
  selectBoardChallenges,
  customChallengeId,
} from "../lib/challenges";
import { getGameDisplayName, normalizeGameKey } from "../lib/gameKeys";
import type {
  Challenge,
  ChallengeType,
  CustomChallenge,
  Lobby,
  LobbySettings,
  Player,
  PoolMode,
} from "../lib/types";
import { TEAM_LABELS, TEAM_EMOJIS } from "../lib/types";

// ── Default settings ──────────────────────────────────────────────────────────

const DEFAULTS: LobbySettings = {
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

export default function LobbyPage() {
  const { lobbyId } = useParams<{ lobbyId: string }>();
  const navigate = useNavigate();
  useSession(); // load session for future use
  const { addToast } = useToast();

  const [_lobby, setLobby] = useState<Lobby | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [customChallenges, setCustomChallenges] = useState<CustomChallenge[]>([]);
  const [allGames, setAllGames] = useState<string[]>([]);
  const [settings, setSettings] = useState<LobbySettings>(DEFAULTS);
  const [isHost, setIsHost] = useState(false);
  const [myPlayerId, setMyPlayerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [startError, setStartError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [showCustomForm, setShowCustomForm] = useState(false);

  // Custom challenge form
  const [customText, setCustomText] = useState("");
  const [customType, setCustomType] = useState<ChallengeType>("single");
  const [customGame, setCustomGame] = useState("");
  const [submittingCustom, setSubmittingCustom] = useState(false);

  const settingsSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Init ─────────────────────────────────────────────────────────────────────

  useEffect(() => {
    const pid = sessionStorage.getItem("playerId");
    setMyPlayerId(pid);

    if (!lobbyId || !pid) {
      navigate("/");
      return;
    }

    Promise.all([
      loadCsvChallenges(),
      fetchLobby(pid),
    ]).then(([challenges]) => {
      const games = [...new Set(challenges.map((c) => c.game))].filter(Boolean).sort();
      setAllGames(games);
      setLoading(false);
    });

    const sub = supabase
      .channel(`lobby-room-${lobbyId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "players", filter: `lobby_id=eq.${lobbyId}` }, () => {
        fetchPlayers();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "custom_challenges", filter: `lobby_id=eq.${lobbyId}` }, () => {
        fetchCustomChallenges();
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "lobbies", filter: `id=eq.${lobbyId}` }, (payload) => {
        const updated = payload.new as Lobby;
        if (updated.status === "playing") {
          navigate(`/board/${lobbyId}`);
          return;
        }
        setLobby(updated);
        // Non-host: sync settings from host
        if (!isHost) {
          setSettings({ ...DEFAULTS, ...(updated.settings ?? {}) });
        }
      })
      .subscribe();

    // Watch for being kicked
    const kickSub = supabase
      .channel(`kick-${pid}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "players", filter: `id=eq.${pid}` }, (payload) => {
        if ((payload.new as Player).kicked) {
          addToast("You have been kicked from the lobby.", "error");
          navigate("/");
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(sub);
      supabase.removeChannel(kickSub);
    };
  }, [lobbyId]);

  async function fetchLobby(pid: string) {
    const { data: lobbyData, error } = await supabase
      .from("lobbies")
      .select("*")
      .eq("id", lobbyId!)
      .single();

    if (error || !lobbyData) {
      addToast("Lobby not found.", "error");
      navigate("/");
      return;
    }

    const lobby = lobbyData as Lobby;

    if (lobby.status === "playing") {
      navigate(`/board/${lobbyId}`);
      return;
    }

    setLobby(lobby);
    setSettings({ ...DEFAULTS, ...(lobby.settings ?? {}) });

    const { data: playerData } = await supabase
      .from("players")
      .select("*")
      .eq("id", pid)
      .single();

    if (!playerData || (playerData as Player).kicked) {
      addToast("Your player session was not found.", "error");
      navigate("/");
      return;
    }

    setIsHost((playerData as Player).is_host);

    await Promise.all([fetchPlayers(), fetchCustomChallenges()]);
  }

  async function fetchPlayers() {
    const { data } = await supabase
      .from("players")
      .select("*")
      .eq("lobby_id", lobbyId!)
      .eq("kicked", false)
      .order("created_at");
    setPlayers((data ?? []) as Player[]);
  }

  async function fetchCustomChallenges() {
    const { data } = await supabase
      .from("custom_challenges")
      .select("*")
      .eq("lobby_id", lobbyId!)
      .order("id");
    setCustomChallenges((data ?? []) as CustomChallenge[]);
  }

  // ── Settings sync (host only) ─────────────────────────────────────────────────

  function updateSettings(patch: Partial<LobbySettings>) {
    const next = { ...settings, ...patch };
    setSettings(next);

    if (!isHost) return;

    // Debounce DB write
    if (settingsSaveTimerRef.current) clearTimeout(settingsSaveTimerRef.current);
    settingsSaveTimerRef.current = setTimeout(async () => {
      await supabase.from("lobbies").update({ settings: next }).eq("id", lobbyId!);
    }, 400);
  }

  // ── Kick ─────────────────────────────────────────────────────────────────────

  async function kickPlayer(pid: string) {
    if (!confirm("Kick this player?")) return;
    await supabase.from("players").update({ kicked: true }).eq("id", pid);
  }

  // ── Submit custom challenge ───────────────────────────────────────────────────

  async function submitCustomChallenge() {
    if (!customText.trim() || !customGame.trim()) {
      addToast("Fill in challenge text and game name.", "error");
      return;
    }
    setSubmittingCustom(true);
    const playerName = sessionStorage.getItem("playerName") ?? "Unknown";
    const { error } = await supabase.from("custom_challenges").insert({
      lobby_id:    lobbyId,
      player_id:   myPlayerId,
      player_name: playerName,
      text:        customText.trim(),
      type:        customType,
      game:        normalizeGameKey(customGame),
    });
    if (error) {
      addToast("Failed to submit challenge.", "error");
    } else {
      setCustomText("");
      setCustomGame("");
    }
    setSubmittingCustom(false);
  }

  async function deleteCustomChallenge(id: number) {
    await supabase.from("custom_challenges").delete().eq("id", id);
  }

  // ── Start game ────────────────────────────────────────────────────────────────

  async function startGame() {
    setStarting(true);
    setStartError(null);

    const csv = getCsvChallenges();

    // Convert custom challenges to Challenge objects
    const customAsChallenge: Challenge[] = customChallenges.map((c) => ({
      id:     customChallengeId(c.id),
      text:   c.text,
      type:   c.type,
      game:   c.game,
      source: "custom",
    }));

    const pool = buildChallengePool(csv, customAsChallenge, settings);
    const selected = selectBoardChallenges(pool, settings);

    if (!selected) {
      const needed =
        settings.boardWidth * settings.boardHeight -
        (settings.freeSpace ? 1 : 0) -
        Math.min(settings.versusCount, pool.filter((c) => c.type === "versus").length);
      setStartError(
        `Not enough challenges. Need ${needed} non-versus but only have ${pool.filter((c) => c.type !== "versus").length}. Add more games or reduce board size.`,
      );
      setStarting(false);
      return;
    }

    const boardChallengeIds = selected.map((c) => ({ id: c.id, source: c.source }));

    const { error } = await supabase
      .from("lobbies")
      .update({
        status:              "playing",
        settings,
        board_challenge_ids: boardChallengeIds,
      })
      .eq("id", lobbyId!);

    if (error) {
      setStartError("Failed to start game: " + error.message);
      setStarting(false);
      return;
    }

    // Init versus state if needed
    const versusIds = selected.filter((c) => c.type === "versus").map((c) => c.id);
    if (versusIds.length > 0) {
      const firstNext = versusIds[Math.floor(Math.random() * versusIds.length)];
      await supabase.from("versus_state").upsert({
        lobby_id:               lobbyId,
        active_challenge_id:    null,
        next_challenge_id:      firstNext,
        next_versus_timestamp:  Date.now() + settings.versusInterval * 60 * 1000,
        unlocked_challenge_ids: [],
      });
    }

    navigate(`/board/${lobbyId}`);
  }

  // ── Copy join link ────────────────────────────────────────────────────────────

  function copyJoinLink() {
    const url = `${window.location.origin}/join?lobby=${lobbyId}`;
    navigator.clipboard.writeText(url).then(() => addToast("Join link copied!", "success"));
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <p style={{ color: "rgb(var(--text-muted-rgb))" }}>Loading lobby…</p>
      </div>
    );
  }

  const showCustomPanel = settings.poolMode === "standard+custom" || settings.poolMode === "custom";
  const activePlayers  = players.filter((p) => !p.is_spectator);
  const spectators     = players.filter((p) => p.is_spectator);

  return (
    <div className="min-h-dvh p-4 max-w-5xl mx-auto flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-extrabold text-2xl tracking-tight">
              Lobby{" "}
              <span
                style={{
                  background: "linear-gradient(135deg, rgb(var(--color-primary-rgb)), rgb(var(--color-accent-rgb)))",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                }}
              >
                {lobbyId?.toUpperCase()}
              </span>
            </h1>
            {isHost && <Badge variant="host">HOST</Badge>}
          </div>
          <p className="text-sm mt-0.5" style={{ color: "rgb(var(--text-muted-rgb))" }}>
            {isHost ? "Configure settings and start when ready" : "Waiting for host to start…"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={copyJoinLink}>
            📋 Copy Link
          </Button>
          <Button variant="ghost" size="sm" onClick={() => navigate("/")}>
            Leave
          </Button>
        </div>
      </div>

      <div className="grid md:grid-cols-[1fr_280px] gap-4">
        {/* Left: Settings (host) or read-only (non-host) */}
        <div className="flex flex-col gap-4">
          {isHost && (
            <Panel>
              <h2 className="font-bold text-lg mb-4">Game Settings</h2>
              <div className="flex flex-col gap-4">
                {/* Board size */}
                <div className="flex gap-3 flex-wrap">
                  <Input
                    label="Board width"
                    type="number" min={3} max={9}
                    value={settings.boardWidth}
                    onChange={(e) =>
                      updateSettings({ boardWidth: Math.max(3, Math.min(9, Number(e.target.value))) })
                    }
                  />
                  <Input
                    label="Board height"
                    type="number" min={3} max={9}
                    value={settings.boardHeight}
                    onChange={(e) =>
                      updateSettings({ boardHeight: Math.max(3, Math.min(9, Number(e.target.value))) })
                    }
                  />
                  <Input
                    label="Win length"
                    type="number" min={3} max={9}
                    value={settings.winLength}
                    onChange={(e) =>
                      updateSettings({ winLength: Math.max(3, Math.min(9, Number(e.target.value))) })
                    }
                  />
                  <Input
                    label="Teams"
                    type="number" min={2} max={4}
                    value={settings.teamCount}
                    onChange={(e) =>
                      updateSettings({ teamCount: Math.max(2, Math.min(4, Number(e.target.value))) })
                    }
                  />
                </div>

                {/* Challenge types */}
                <div>
                  <p className="text-sm font-medium mb-2">Challenge types</p>
                  <div className="flex gap-2 flex-wrap">
                    {(["single", "group", "versus"] as ChallengeType[]).map((t) => {
                      const on = settings.types.includes(t);
                      return (
                        <button
                          key={t}
                          onClick={() =>
                            updateSettings({
                              types: on
                                ? settings.types.filter((x) => x !== t)
                                : [...settings.types, t],
                            })
                          }
                          className="px-3 py-1.5 rounded-full text-sm font-semibold border transition-all"
                          style={{
                            borderColor: on ? "rgba(var(--color-primary-rgb), 0.8)" : "rgba(255,255,255,0.12)",
                            background:  on ? "rgba(var(--color-primary-rgb), 0.18)" : "transparent",
                          }}
                        >
                          {t === "single" ? "👤 Single" : t === "group" ? "👥 Group" : "⚔️ Versus"}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Versus settings */}
                {settings.types.includes("versus") && (
                  <div className="flex gap-3 flex-wrap">
                    <Input
                      label="Versus count"
                      type="number" min={0} max={20}
                      value={settings.versusCount}
                      onChange={(e) => updateSettings({ versusCount: Math.max(0, Number(e.target.value)) })}
                    />
                    <Input
                      label="Versus interval (min)"
                      type="number" min={1} max={60}
                      value={settings.versusInterval}
                      onChange={(e) =>
                        updateSettings({ versusInterval: Math.max(1, Math.min(60, Number(e.target.value))) })
                      }
                    />
                  </div>
                )}

                {/* Free space */}
                <button
                  onClick={() => updateSettings({ freeSpace: !settings.freeSpace })}
                  className="flex items-center gap-2 text-sm font-semibold px-3 py-2 rounded-lg border transition-all w-fit"
                  style={{
                    borderColor: settings.freeSpace ? "rgba(var(--color-primary-rgb),0.7)" : "rgba(255,255,255,0.12)",
                    background:  settings.freeSpace ? "rgba(var(--color-primary-rgb),0.15)" : "transparent",
                  }}
                >
                  {settings.freeSpace ? "✅ Free space ON" : "⬜ Free space OFF"}
                </button>

                {/* Challenge pool mode */}
                <div>
                  <p className="text-sm font-medium mb-2">Challenge pool</p>
                  <Toggle
                    options={[
                      { value: "standard",        label: "Official" },
                      { value: "standard+custom", label: "Official + Custom" },
                      { value: "custom",          label: "Custom only" },
                    ]}
                    value={settings.poolMode}
                    onChange={(v) => updateSettings({ poolMode: v as PoolMode })}
                  />
                </div>

                {/* Game filters */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium">Games</p>
                    <div className="flex gap-2">
                      <button
                        className="text-xs"
                        style={{ color: "rgb(var(--color-primary-rgb))" }}
                        onClick={() => updateSettings({ games: [] })}
                      >
                        All
                      </button>
                      <button
                        className="text-xs"
                        style={{ color: "rgb(var(--text-muted-rgb))" }}
                        onClick={() => updateSettings({ games: allGames })}
                      >
                        None
                      </button>
                    </div>
                  </div>
                  <div className="game-checkbox-grid">
                    {allGames.map((game) => {
                      // games: [] means ALL selected; explicit array means only those
                      const on = settings.games.length === 0 || settings.games.includes(game);
                      return (
                        <label key={game} className="game-checkbox-label">
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => {
                              if (settings.games.length === 0) {
                                // Was "all" — switch to explicit exclude
                                updateSettings({ games: allGames.filter((g) => g !== game) });
                              } else {
                                const next = on
                                  ? settings.games.filter((g) => g !== game)
                                  : [...settings.games, game];
                                updateSettings({ games: next });
                              }
                            }}
                          />
                          {on ? "✓ " : "  "}
                          {getGameDisplayName(game)}
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>
            </Panel>
          )}

          {/* Custom challenges panel */}
          {showCustomPanel && (
            <Panel>
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-bold text-lg">Custom Challenges</h2>
                <Button size="sm" variant="ghost" onClick={() => setShowCustomForm((v) => !v)}>
                  {showCustomForm ? "Hide form" : "➕ Add challenge"}
                </Button>
              </div>

              {showCustomForm && (
                <div className="flex flex-col gap-3 mb-4 p-3 rounded-lg" style={{ background: "rgba(var(--surface-raised-rgb),0.4)" }}>
                  <Input
                    label="Challenge text"
                    placeholder="What is the challenge?"
                    value={customText}
                    onChange={(e) => setCustomText(e.target.value)}
                  />
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <p className="text-xs font-medium mb-1" style={{ color: "rgb(var(--text-muted-rgb))" }}>Type</p>
                      <select
                        value={customType}
                        onChange={(e) => setCustomType(e.target.value as ChallengeType)}
                        className="w-full rounded-lg px-3 py-2 text-sm border"
                        style={{
                          background: "rgba(var(--surface-raised-rgb),0.6)",
                          borderColor: "rgba(var(--color-primary-rgb),0.3)",
                          color: "rgb(var(--color-text-rgb))",
                        }}
                      >
                        <option value="single">👤 Single</option>
                        <option value="group">👥 Group</option>
                        <option value="versus">⚔️ Versus</option>
                      </select>
                    </div>
                    <Input
                      label="Game"
                      placeholder="e.g. CS2"
                      value={customGame}
                      onChange={(e) => setCustomGame(e.target.value)}
                    />
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    loading={submittingCustom}
                    onClick={submitCustomChallenge}
                  >
                    Submit
                  </Button>
                </div>
              )}

              {customChallenges.length === 0 ? (
                <p className="text-sm" style={{ color: "rgb(var(--text-muted-rgb))" }}>
                  No custom challenges yet.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {customChallenges.map((c) => {
                    const canDelete = isHost || c.player_id === myPlayerId;
                    return (
                      <div
                        key={c.id}
                        className="flex items-start justify-between gap-2 p-2.5 rounded-lg"
                        style={{ background: "rgba(var(--surface-raised-rgb),0.35)" }}
                      >
                        <div>
                          <p className="text-sm font-semibold">{c.text}</p>
                          <p className="text-xs mt-0.5" style={{ color: "rgb(var(--text-muted-rgb))" }}>
                            {c.type === "single" ? "👤" : c.type === "group" ? "👥" : "⚔️"}{" "}
                            {getGameDisplayName(c.game)} — by {c.player_name}
                          </p>
                        </div>
                        {canDelete && (
                          <button
                            onClick={() => deleteCustomChallenge(c.id)}
                            className="text-xs px-2 py-1 rounded hover:bg-red-500/20 flex-shrink-0"
                            style={{ color: "rgb(var(--text-muted-rgb))" }}
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </Panel>
          )}

          {/* Non-host: show current settings read-only */}
          {!isHost && (
            <Panel>
              <h2 className="font-bold text-lg mb-3">Game Settings</h2>
              <div className="text-sm flex flex-col gap-1.5" style={{ color: "rgb(var(--text-muted-rgb))" }}>
                <p>Board: {settings.boardWidth}×{settings.boardHeight}, win length {settings.winLength}</p>
                <p>Teams: {settings.teamCount}</p>
                <p>Types: {settings.types.join(", ")}</p>
                <p>Pool: {settings.poolMode}</p>
                <p>Free space: {settings.freeSpace ? "yes" : "no"}</p>
              </div>
            </Panel>
          )}
        </div>

        {/* Right: Players + start button */}
        <div className="flex flex-col gap-4">
          <Panel>
            <h2 className="font-bold text-base mb-3">
              Players{" "}
              <span style={{ color: "rgb(var(--text-muted-rgb))" }}>({players.length})</span>
            </h2>
            {players.length === 0 ? (
              <p className="text-sm" style={{ color: "rgb(var(--text-muted-rgb))" }}>
                Waiting for players…
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {[...activePlayers, ...spectators].map((p) => {
                  const isGM = p.is_host && p.is_spectator;
                  return (
                    <div
                      key={p.id}
                      className="flex items-center justify-between gap-2"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-semibold text-sm truncate">{p.name}</span>
                        {p.is_host && <Badge variant="host">HOST</Badge>}
                        {isGM ? (
                          <Badge variant="gm">GM</Badge>
                        ) : p.is_spectator ? (
                          <Badge variant="team" team="spectator">👁️ Spectator</Badge>
                        ) : p.team ? (
                          <Badge variant="team" team={p.team}>
                            {TEAM_EMOJIS[p.team]} {TEAM_LABELS[p.team]}
                          </Badge>
                        ) : null}
                      </div>
                      {isHost && !p.is_host && (
                        <button
                          onClick={() => kickPlayer(p.id)}
                          className="text-xs px-2 py-0.5 rounded hover:bg-red-500/20 flex-shrink-0"
                          style={{ color: "rgb(var(--text-muted-rgb))" }}
                        >
                          Kick
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>

          {isHost && (
            <Panel>
              {startError && (
                <p className="text-sm text-red-400 mb-3">⚠️ {startError}</p>
              )}
              <Button
                variant="primary"
                fullWidth
                size="lg"
                loading={starting}
                onClick={startGame}
              >
                🎮 Start Game
              </Button>
              <p className="text-xs mt-2 text-center" style={{ color: "rgb(var(--text-muted-rgb))" }}>
                All settings are saved automatically
              </p>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
