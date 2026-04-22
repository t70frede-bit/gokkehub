import { useState, useEffect, useRef, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button, GameCover, Panel, Input, Badge, Toggle, useToast } from "@gokkehub/ui";
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
  LateJoinMode,
  Lobby,
  LobbySettings,
  Player,
  PlayerGame,
  PoolMode,
  TeamColor,
} from "../lib/types";
import { TEAM_COLORS, TEAM_LABELS, TEAM_EMOJIS } from "../lib/types";

// ── Default settings ──────────────────────────────────────────────────────────

const DEFAULTS: LobbySettings = {
  boardWidth:       5,
  boardHeight:      5,
  winLength:        5,
  teamCount:        2,
  teamMode:         "manual",
  versusCount:      5,
  versusInterval:   5,
  freeSpace:        false,
  games:            [],
  types:            ["single", "group", "versus"],
  poolMode:         "standard",
  showClaimantName: false,
  streamerMode:     false,
  hideSpectators:   false,
  lateJoinMode:     "open",
  teamSwapEnabled:  false,
};

// ── Lobby game entry (built from player_games per lobby player) ───────────────

interface LobbyGame {
  normalizedKey: string;
  displayName:   string;
  steamAppId:    number | null;
  owners:        Player[];   // lobby players who own this game
  csvCount:      number;     // built-in challenge count for this game
  playerCount:   number;     // player-submitted challenge count
}

// ── Tooltip ───────────────────────────────────────────────────────────────────

function Tip({ children, label, wide }: { children: React.ReactNode; label: string; wide?: boolean }) {
  return (
    <span className="relative group/tip inline-flex items-center">
      {children}
      <span
        className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 rounded-md text-xs font-medium opacity-0 group-hover/tip:opacity-100 transition-opacity duration-150 z-50 text-center"
        style={{
          background: "rgba(15,10,30,0.96)",
          color: "rgb(220,215,240)",
          border: "1px solid rgba(255,255,255,0.12)",
          boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
          whiteSpace: wide ? "normal" : "nowrap",
          maxWidth: wide ? "180px" : undefined,
          lineHeight: 1.4,
        }}
      >
        {label}
      </span>
    </span>
  );
}

// ── Game search input ─────────────────────────────────────────────────────────

function GameSearchInput({
  options,
  onSelect,
  placeholder = "Search games…",
  enableSteam = false,
}: {
  options: { key: string; name: string }[];
  onSelect: (key: string, name: string) => void;
  placeholder?: string;
  enableSteam?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen]   = useState(false);
  const [steamItems, setSteamItems] = useState<{ key: string; name: string }[]>([]);
  const steamTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const localMatches = useMemo(() => {
    if (!query.trim()) return options.slice(0, 6);
    const q = query.toLowerCase();
    return options.filter((o) => o.name.toLowerCase().includes(q)).slice(0, 6);
  }, [query, options]);

  useEffect(() => {
    if (!enableSteam || query.length < 3) { setSteamItems([]); return; }
    if (steamTimer.current) clearTimeout(steamTimer.current);
    steamTimer.current = setTimeout(async () => {
      try {
        const res  = await fetch(`/steam/search?q=${encodeURIComponent(query)}`);
        const data = await res.json() as { items?: { appid: number; name: string }[] };
        const known = new Set(options.map((o) => o.key));
        setSteamItems(
          (data.items ?? [])
            .filter((r) => !known.has(normalizeGameKey(r.name)))
            .slice(0, 4)
            .map((r) => ({ key: normalizeGameKey(r.name), name: r.name })),
        );
      } catch { setSteamItems([]); }
    }, 400);
    return () => { if (steamTimer.current) clearTimeout(steamTimer.current); };
  }, [query, enableSteam, options]);

  const allResults = [
    ...localMatches,
    ...steamItems.filter((s) => !localMatches.some((l) => l.key === s.key)),
  ];

  function pick(key: string, name: string) {
    onSelect(key, name);
    setQuery(name);
    setOpen(false);
    setSteamItems([]);
  }

  return (
    <div className="relative">
      <input
        value={query}
        placeholder={placeholder}
        className="w-full rounded-lg px-3 py-2 text-sm border"
        style={{
          background:   "rgba(var(--surface-raised-rgb),0.6)",
          borderColor:  "rgba(var(--color-primary-rgb),0.3)",
          color:        "rgb(var(--color-text-rgb))",
          outline:      "none",
        }}
        onChange={(e) => { setQuery(e.target.value); setSteamItems([]); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
      />
      {open && (
        <div
          className="absolute z-50 top-full left-0 right-0 mt-1 rounded-lg flex flex-col overflow-auto"
          style={{
            background:  "rgba(15,10,30,0.98)",
            border:      "1px solid rgba(255,255,255,0.12)",
            boxShadow:   "0 8px 24px rgba(0,0,0,0.5)",
            maxHeight:   "220px",
          }}
        >
          {allResults.length === 0 && !query.trim() && (
            <p className="text-xs px-3 py-2" style={{ color: "rgb(var(--text-muted-rgb))" }}>
              Type to search games…
            </p>
          )}
          {allResults.map((o) => (
            <button
              key={o.key}
              className="text-sm px-3 py-2 text-left hover:bg-white/10 transition-colors"
              style={{ color: "rgb(var(--text-primary-rgb))" }}
              onMouseDown={(e) => { e.preventDefault(); pick(o.key, o.name); }}
            >
              {o.name}
            </button>
          ))}
          {query.trim() && (
            <button
              className="text-sm px-3 py-2 text-left hover:bg-white/10 transition-colors"
              style={{
                color:      "rgb(var(--color-primary-rgb))",
                borderTop:  allResults.length > 0 ? "1px solid rgba(255,255,255,0.08)" : undefined,
              }}
              onMouseDown={(e) => { e.preventDefault(); pick(normalizeGameKey(query), query.trim()); }}
            >
              + Add "{query.trim()}" as custom game
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function LobbyPage() {
  const { lobbyId } = useParams<{ lobbyId: string }>();
  const navigate = useNavigate();
  const { session } = useSession();
  const { addToast } = useToast();

  const [_lobby, setLobby]                   = useState<Lobby | null>(null);
  const [players, setPlayers]                = useState<Player[]>([]);
  const [customChallenges, setCustomChallenges] = useState<CustomChallenge[]>([]);
  const [allGames, setAllGames]              = useState<string[]>([]);
  const [settings, setSettings]             = useState<LobbySettings>(DEFAULTS);
  const [isHost, setIsHost]                 = useState(false);
  const [myPlayerId, setMyPlayerId]         = useState<string | null>(null);
  const [loading, setLoading]               = useState(true);
  const [startError, setStartError]         = useState<string | null>(null);
  const [starting, setStarting]             = useState(false);
  const [showCustomForm, setShowCustomForm] = useState(false);

  // Lobby games (Feature 4)
  const [lobbyGames, setLobbyGames]           = useState<LobbyGame[]>([]);
  const [expandedGameKey, setExpandedGameKey] = useState<string | null>(null);
  const [addingGameKey, setAddingGameKey]     = useState<string | null>(null);
  const [syncingSteam, setSyncingSteam]       = useState(false);

  // Custom challenge form
  const [customText, setCustomText]       = useState("");
  const [customType, setCustomType]       = useState<ChallengeType>("single");
  const [customGame, setCustomGame]       = useState<{ key: string; name: string } | null>(null);
  const [customFormKey, setCustomFormKey] = useState(0);
  const [submittingCustom, setSubmittingCustom] = useState(false);

  // Add game panel
  const [showAddGame, setShowAddGame]     = useState(false);
  const [addingNewGame, setAddingNewGame] = useState(false);
  const [addGameKey, setAddGameKey]       = useState(0);

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
        fetchPlayers().then((updated) => { if (updated) fetchCommunityGames(updated); });
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
        if (!isHost) {
          setSettings({ ...DEFAULTS, ...(updated.settings ?? {}) });
        }
      })
      .subscribe();

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

    const [fetched] = await Promise.all([fetchPlayers(), fetchCustomChallenges()]);
    if (fetched) await fetchCommunityGames(fetched);
  }

  async function fetchPlayers(): Promise<Player[] | null> {
    const { data } = await supabase
      .from("players")
      .select("*")
      .eq("lobby_id", lobbyId!)
      .eq("kicked", false)
      .order("created_at");
    const list = (data ?? []) as Player[];
    setPlayers(list);
    return list;
  }

  async function fetchCustomChallenges() {
    const { data } = await supabase
      .from("custom_challenges")
      .select("*")
      .eq("lobby_id", lobbyId!)
      .order("id");
    setCustomChallenges((data ?? []) as CustomChallenge[]);
  }

  // ── Lobby games (Feature 4) ───────────────────────────────────────────────────

  async function fetchCommunityGames(currentPlayers: Player[]) {
    const loggedInPlayers = currentPlayers.filter((p) => p.user_id);
    if (loggedInPlayers.length === 0) {
      setLobbyGames([]);
      return;
    }

    const userIds = loggedInPlayers.map((p) => p.user_id!);

    const [{ data: pgData }, { data: pcData }] = await Promise.all([
      supabase.from("player_games").select("*").in("user_id", userIds),
      supabase.from("player_challenges").select("game, user_id").in("user_id", userIds),
    ]);

    const csv = getCsvChallenges();
    const csvCountByGame = new Map<string, number>();
    for (const ch of csv) {
      csvCountByGame.set(ch.game, (csvCountByGame.get(ch.game) ?? 0) + 1);
    }

    const pcCountByGame = new Map<string, number>();
    for (const pc of (pcData ?? [])) {
      pcCountByGame.set(pc.game, (pcCountByGame.get(pc.game) ?? 0) + 1);
    }

    // Build map: normalizedKey → { game info, owning players }
    const gameMap = new Map<string, { displayName: string; steamAppId: number | null; ownerUserIds: Set<string> }>();
    for (const pg of (pgData ?? []) as PlayerGame[]) {
      const existing = gameMap.get(pg.normalized_key);
      if (existing) {
        existing.ownerUserIds.add(pg.user_id);
      } else {
        gameMap.set(pg.normalized_key, {
          displayName: pg.display_name,
          steamAppId:  pg.steam_app_id,
          ownerUserIds: new Set([pg.user_id]),
        });
      }
    }

    const playersByUserId = new Map<string, Player>();
    for (const p of loggedInPlayers) {
      if (p.user_id) playersByUserId.set(p.user_id, p);
    }

    const list: LobbyGame[] = [];
    for (const [key, info] of gameMap) {
      const owners = [...info.ownerUserIds]
        .map((uid) => playersByUserId.get(uid))
        .filter(Boolean) as Player[];
      list.push({
        normalizedKey: key,
        displayName:   info.displayName,
        steamAppId:    info.steamAppId,
        owners,
        csvCount:      csvCountByGame.get(key) ?? 0,
        playerCount:   pcCountByGame.get(key) ?? 0,
      });
    }

    // Sort: most owners first, then alphabetically
    list.sort((a, b) => b.owners.length - a.owners.length || a.displayName.localeCompare(b.displayName));
    setLobbyGames(list);
  }

  // Quick-add a lobby game to your own library (logged-in only)
  async function quickAddGame(game: LobbyGame) {
    if (!session?.userId) return;
    setAddingGameKey(game.normalizedKey);
    const { error } = await supabase.from("player_games").upsert({
      user_id:        session.userId,
      display_name:   game.displayName,
      normalized_key: game.normalizedKey,
      source:         "manual",
      steam_app_id:   game.steamAppId,
      is_favorite:    false,
    }, { onConflict: "user_id,normalized_key" });
    setAddingGameKey(null);
    if (error) {
      addToast("Failed to add game to library.", "error");
    } else {
      addToast(`Added "${game.displayName}" to your library.`, "success");
      await fetchCommunityGames(players);
    }
  }

  // ── Steam library bulk sync ───────────────────────────────────────────────────

  async function syncSteamLibrary() {
    if (!session?.steamId || !session?.userId) return;
    setSyncingSteam(true);
    try {
      const res = await fetch(`/steam/games?input=${encodeURIComponent(session.steamId)}`);
      const data = (await res.json()) as { games?: Array<{ appid: number; name: string }>; error?: string };
      if (data.error || !data.games) {
        addToast(data.error ?? "Failed to fetch Steam library.", "error");
        return;
      }
      const existingKeys = new Set(
        lobbyGames
          .filter((g) => g.owners.some((o) => o.user_id === session.userId))
          .map((g) => g.normalizedKey),
      );
      const toInsert = data.games
        .filter((g) => !existingKeys.has(normalizeGameKey(g.name)))
        .map((g) => ({
          user_id:        session.userId,
          display_name:   g.name.trim(),
          normalized_key: normalizeGameKey(g.name),
          source:         "steam" as const,
          steam_app_id:   g.appid,
          is_favorite:    false,
        }));
      if (toInsert.length === 0) {
        addToast(`Library up to date — all ${data.games.length} Steam games already synced.`, "success");
        return;
      }
      const CHUNK = 200;
      let failed = false;
      for (let i = 0; i < toInsert.length; i += CHUNK) {
        const { error } = await supabase
          .from("player_games")
          .upsert(toInsert.slice(i, i + CHUNK), { onConflict: "user_id,normalized_key", ignoreDuplicates: true });
        if (error) { failed = true; break; }
      }
      if (failed) {
        addToast("Failed to save games — check your connection and try again.", "error");
      } else {
        addToast(`Imported ${toInsert.length} new game${toInsert.length !== 1 ? "s" : ""} from Steam.`, "success");
        const fetched = await fetchPlayers();
        if (fetched) await fetchCommunityGames(fetched);
      }
    } catch {
      addToast("Could not connect to Steam.", "error");
    } finally {
      setSyncingSteam(false);
    }
  }

  // ── Settings sync (host only) ─────────────────────────────────────────────────

  function updateSettings(patch: Partial<LobbySettings>) {
    const next = { ...settings, ...patch };
    setSettings(next);

    if (!isHost) return;

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

  // ── Team reassignment (host only) ─────────────────────────────────────────────

  async function assignTeam(playerId: string, team: TeamColor) {
    await supabase.from("players").update({ team }).eq("id", playerId);
  }

  function nextTeam(current: TeamColor | null): TeamColor {
    const available = TEAM_COLORS.slice(0, settings.teamCount);
    const idx = current ? available.indexOf(current) : -1;
    return available[(idx + 1) % available.length];
  }

  // ── Submit custom challenge ───────────────────────────────────────────────────

  async function submitCustomChallenge() {
    if (!customText.trim() || !customGame) {
      addToast("Fill in challenge text and select a game.", "error");
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
      game:        customGame.key,
    });
    if (error) {
      addToast("Failed to submit challenge.", "error");
    } else {
      setCustomText("");
      setCustomGame(null);
      setCustomFormKey((k) => k + 1);
    }
    setSubmittingCustom(false);
  }

  async function addGameFromSearch(key: string, name: string) {
    if (!session?.userId) {
      addToast("Log in at account.gokkehub.com to save games to your library.", "error");
      return;
    }
    setAddingNewGame(true);
    const { error } = await supabase.from("player_games").upsert({
      user_id:        session.userId,
      display_name:   name,
      normalized_key: key,
      source:         "manual",
      steam_app_id:   null,
      is_favorite:    false,
    }, { onConflict: "user_id,normalized_key" });
    setAddingNewGame(false);
    if (error) {
      addToast("Failed to add game.", "error");
    } else {
      addToast(`Added "${name}" to your library.`, "success");
      setShowAddGame(false);
      setAddGameKey((k) => k + 1);
      const fetched = await fetchPlayers();
      if (fetched) await fetchCommunityGames(fetched);
    }
  }

  async function deleteCustomChallenge(id: number) {
    await supabase.from("custom_challenges").delete().eq("id", id);
  }

  // ── Start game ────────────────────────────────────────────────────────────────

  async function startGame() {
    setStarting(true);
    setStartError(null);

    const csv = getCsvChallenges();

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

  function copyInviteLink() {
    const url = `${window.location.origin}/join?lobby=${lobbyId}`;
    navigator.clipboard.writeText(url).then(() => addToast("Invite link copied!", "success"));
  }

  // ── Team coverage warnings ────────────────────────────────────────────────────

  function getTeamWarnings(game: LobbyGame): string[] {
    const warnings: string[] = [];
    const activeTeams = TEAM_COLORS.slice(0, settings.teamCount);
    const activePlayers = players.filter((p) => !p.is_spectator);
    for (const team of activeTeams) {
      const teamPlayers = activePlayers.filter((p) => p.team === team);
      if (teamPlayers.length === 0) continue;
      const hasOwner = teamPlayers.some((p) =>
        game.owners.some((o) => o.id === p.id),
      );
      if (!hasOwner) {
        warnings.push(`${TEAM_EMOJIS[team]} ${TEAM_LABELS[team]} has no players with this game`);
      }
    }
    return warnings;
  }

  // ── Derived ───────────────────────────────────────────────────────────────────

  const showCustomPanel = settings.poolMode === "standard+custom" || settings.poolMode === "custom";
  const activePlayers   = players.filter((p) => !p.is_spectator);
  const spectators      = players.filter((p) => p.is_spectator);

  // My user_id — to know if I already own a lobby game
  const myOwnedKeys = useMemo(() => {
    if (!session?.userId) return new Set<string>();
    return new Set(
      lobbyGames
        .filter((g) => g.owners.some((o) => o.user_id === session.userId))
        .map((g) => g.normalizedKey),
    );
  }, [lobbyGames, session]);

  // Combined game options for search inputs (CSV games + lobby games, deduplicated)
  const gameOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const key of allGames) map.set(key, getGameDisplayName(key));
    for (const g of lobbyGames) map.set(g.normalizedKey, g.displayName);
    return [...map.entries()]
      .map(([key, name]) => ({ key, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [allGames, lobbyGames]);

  // ── Render ────────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <p style={{ color: "rgb(var(--text-muted-rgb))" }}>Loading lobby…</p>
      </div>
    );
  }

  return (
    <div className="min-h-dvh p-4 max-w-5xl mx-auto flex flex-col gap-4">

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-extrabold text-2xl tracking-tight">
              {settings.streamerMode ? (
                "Lobby"
              ) : (
                <>
                  Lobby{" "}
                  <span style={{
                    background: "linear-gradient(135deg, rgb(var(--color-primary-rgb)), rgb(var(--color-accent-rgb)))",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                    backgroundClip: "text",
                  }}>
                    {lobbyId?.toUpperCase()}
                  </span>
                </>
              )}
            </h1>
            {isHost && <Badge variant="host">HOST</Badge>}
          </div>
          <p className="text-sm mt-0.5" style={{ color: "rgb(var(--text-muted-rgb))" }}>
            {isHost ? "Configure settings and start when ready" : "Waiting for host to start…"}
          </p>
        </div>
        <div className="flex gap-2">
          {settings.streamerMode ? (
            <Button variant="ghost" size="sm" onClick={copyInviteLink}>🔗 Copy Invite Link</Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={copyJoinLink}>📋 Copy Link</Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => navigate("/")}>Leave</Button>
        </div>
      </div>

      {/* ── Main 2-column grid ── */}
      <div className="grid md:grid-cols-[1fr_280px] gap-4">

        {/* Left: Settings */}
        <div className="flex flex-col gap-4">
          {isHost && (
            <Panel>
              <h2 className="font-bold text-lg mb-4">Game Settings</h2>
              <div className="flex flex-col gap-4">

                {/* Board size */}
                <div className="flex gap-3 flex-wrap">
                  <Input label="Board width"  type="number" min={3} max={9} value={settings.boardWidth}
                    onChange={(e) => updateSettings({ boardWidth:  Math.max(3, Math.min(9, Number(e.target.value))) })} />
                  <Input label="Board height" type="number" min={3} max={9} value={settings.boardHeight}
                    onChange={(e) => updateSettings({ boardHeight: Math.max(3, Math.min(9, Number(e.target.value))) })} />
                  <Input label="Win length"   type="number" min={3} max={9} value={settings.winLength}
                    onChange={(e) => updateSettings({ winLength:   Math.max(3, Math.min(9, Number(e.target.value))) })} />
                  <Input label="Teams"        type="number" min={2} max={4} value={settings.teamCount}
                    onChange={(e) => updateSettings({ teamCount:   Math.max(2, Math.min(4, Number(e.target.value))) })} />
                </div>

                {/* Challenge types */}
                <div>
                  <p className="text-sm font-medium mb-2">Challenge types</p>
                  <div className="flex gap-2 flex-wrap">
                    {(["single", "group", "versus"] as ChallengeType[]).map((t) => {
                      const on = settings.types.includes(t);
                      return (
                        <button key={t}
                          onClick={() => updateSettings({ types: on ? settings.types.filter((x) => x !== t) : [...settings.types, t] })}
                          className="px-3 py-1.5 rounded-full text-sm font-semibold border transition-all"
                          style={{
                            borderColor: on ? "rgba(var(--color-primary-rgb),0.8)" : "rgba(255,255,255,0.12)",
                            background:  on ? "rgba(var(--color-primary-rgb),0.18)" : "transparent",
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
                    <Input label="Versus count" type="number" min={0} max={20} value={settings.versusCount}
                      onChange={(e) => updateSettings({ versusCount: Math.max(0, Number(e.target.value)) })} />
                    <Input label="Versus interval (min)" type="number" min={1} max={60} value={settings.versusInterval}
                      onChange={(e) => updateSettings({ versusInterval: Math.max(1, Math.min(60, Number(e.target.value))) })} />
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

                {/* Late join */}
                <div>
                  <p className="text-sm font-medium mb-2">Late join</p>
                  <Toggle
                    options={[
                      { value: "open",           label: "Open" },
                      { value: "spectator-only", label: "Spectators only" },
                      { value: "closed",         label: "Closed" },
                    ]}
                    value={settings.lateJoinMode}
                    onChange={(v) => updateSettings({ lateJoinMode: v as LateJoinMode })}
                  />
                </div>

                {/* Streamer / display toggles */}
                <div className="flex flex-wrap gap-2">
                  {[
                    { key: "streamerMode",     label: settings.streamerMode     ? "📡 Streamer mode ON"       : "📡 Streamer mode OFF",     val: settings.streamerMode },
                    { key: "hideSpectators",   label: settings.hideSpectators   ? "👁️ Spectators hidden"      : "👁️ Show spectators",       val: settings.hideSpectators },
                    { key: "showClaimantName", label: settings.showClaimantName ? "🏷️ Show claimant name ON" : "🏷️ Show claimant name OFF", val: settings.showClaimantName },
                    { key: "teamSwapEnabled",  label: settings.teamSwapEnabled  ? "🔄 Team swap ON"           : "🔄 Team swap OFF",          val: settings.teamSwapEnabled },
                  ].map(({ key, label, val }) => (
                    <button key={key}
                      onClick={() => updateSettings({ [key]: !val } as Partial<LobbySettings>)}
                      className="flex items-center gap-2 text-sm font-semibold px-3 py-2 rounded-lg border transition-all"
                      style={{
                        borderColor: val ? "rgba(var(--color-primary-rgb),0.7)" : "rgba(255,255,255,0.12)",
                        background:  val ? "rgba(var(--color-primary-rgb),0.15)" : "transparent",
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>

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

                {/* Game filters (CSV games) */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium">Games</p>
                    <div className="flex gap-2">
                      <button className="text-xs" style={{ color: "rgb(var(--color-primary-rgb))" }}
                        onClick={() => updateSettings({ games: [] })}>All</button>
                      <button className="text-xs" style={{ color: "rgb(var(--text-muted-rgb))" }}
                        onClick={() => updateSettings({ games: allGames })}>None</button>
                    </div>
                  </div>
                  <div className="game-checkbox-grid">
                    {allGames.map((game) => {
                      const on = settings.games.length === 0 || settings.games.includes(game);
                      return (
                        <label key={game} className="game-checkbox-label">
                          <input type="checkbox" checked={on} onChange={() => {
                            if (settings.games.length === 0) {
                              updateSettings({ games: allGames.filter((g) => g !== game) });
                            } else {
                              updateSettings({ games: on ? settings.games.filter((g) => g !== game) : [...settings.games, game] });
                            }
                          }} />
                          {on ? "✓ " : "  "}{getGameDisplayName(game)}
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
                  <Input label="Challenge text" placeholder="What is the challenge?"
                    value={customText} onChange={(e) => setCustomText(e.target.value)} />
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <p className="text-xs font-medium mb-1" style={{ color: "rgb(var(--text-muted-rgb))" }}>Type</p>
                      <select value={customType} onChange={(e) => setCustomType(e.target.value as ChallengeType)}
                        className="w-full rounded-lg px-3 py-2 text-sm border"
                        style={{ background: "rgba(var(--surface-raised-rgb),0.6)", borderColor: "rgba(var(--color-primary-rgb),0.3)", color: "rgb(var(--color-text-rgb))" }}
                      >
                        <option value="single">👤 Single</option>
                        <option value="group">👥 Group</option>
                        <option value="versus">⚔️ Versus</option>
                      </select>
                    </div>
                    <div className="flex-1">
                      <p className="text-xs font-medium mb-1" style={{ color: "rgb(var(--text-muted-rgb))" }}>Game</p>
                      <GameSearchInput
                        key={customFormKey}
                        options={gameOptions}
                        onSelect={(key, name) => setCustomGame({ key, name })}
                        placeholder={customGame?.name ?? "Search or type a game…"}
                        enableSteam
                      />
                    </div>
                  </div>
                  <Button variant="primary" size="sm" loading={submittingCustom} onClick={submitCustomChallenge}>Submit</Button>
                </div>
              )}

              {customChallenges.length === 0 ? (
                <p className="text-sm" style={{ color: "rgb(var(--text-muted-rgb))" }}>No custom challenges yet.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {customChallenges.map((c) => {
                    const canDelete = isHost || c.player_id === myPlayerId;
                    return (
                      <div key={c.id} className="flex items-start justify-between gap-2 p-2.5 rounded-lg"
                        style={{ background: "rgba(var(--surface-raised-rgb),0.35)" }}>
                        <div>
                          <p className="text-sm font-semibold">{c.text}</p>
                          <p className="text-xs mt-0.5" style={{ color: "rgb(var(--text-muted-rgb))" }}>
                            {c.type === "single" ? "👤" : c.type === "group" ? "👥" : "⚔️"}{" "}
                            {getGameDisplayName(c.game)} — by {c.player_name}
                          </p>
                        </div>
                        {canDelete && (
                          <button onClick={() => deleteCustomChallenge(c.id)}
                            className="text-xs px-2 py-1 rounded hover:bg-red-500/20 flex-shrink-0"
                            style={{ color: "rgb(var(--text-muted-rgb))" }}>✕</button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </Panel>
          )}

          {/* Non-host read-only settings */}
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

        {/* Right: Players + start */}
        <div className="flex flex-col gap-4">
          <Panel>
            <h2 className="font-bold text-base mb-3">
              Players <span style={{ color: "rgb(var(--text-muted-rgb))" }}>({players.length})</span>
            </h2>
            {players.length === 0 ? (
              <p className="text-sm" style={{ color: "rgb(var(--text-muted-rgb))" }}>Waiting for players…</p>
            ) : (
              <div className="flex flex-col gap-2">
                {[...activePlayers, ...spectators].map((p) => {
                  const isGM = p.is_host && p.is_spectator;
                  return (
                    <div key={p.id} className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-semibold text-sm truncate">{p.name}</span>
                        {p.is_host && <Badge variant="host">HOST</Badge>}
                        {isGM ? (
                          <Badge variant="gm">GM</Badge>
                        ) : p.is_spectator ? (
                          <Badge variant="team" team="spectator">👁️ Spectator</Badge>
                        ) : isHost && !p.is_host ? (
                          <button
                            onClick={() => assignTeam(p.id, nextTeam(p.team))}
                            className="rounded transition-opacity hover:opacity-70"
                            title="Click to cycle team"
                          >
                            <Badge variant="team" team={p.team ?? "blue"}>
                              {p.team ? `${TEAM_EMOJIS[p.team]} ${TEAM_LABELS[p.team]}` : "No team"}
                            </Badge>
                          </button>
                        ) : p.team ? (
                          <Badge variant="team" team={p.team}>
                            {TEAM_EMOJIS[p.team]} {TEAM_LABELS[p.team]}
                          </Badge>
                        ) : null}
                      </div>
                      {isHost && !p.is_host && (
                        <button onClick={() => kickPlayer(p.id)}
                          className="text-xs px-2 py-0.5 rounded hover:bg-red-500/20 flex-shrink-0"
                          style={{ color: "rgb(var(--text-muted-rgb))" }}>Kick</button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>

          {isHost && (
            <Panel>
              {startError && <p className="text-sm text-red-400 mb-3">⚠️ {startError}</p>}
              <Button variant="primary" fullWidth size="lg" loading={starting} onClick={startGame}>
                🎮 Start Game
              </Button>
              <p className="text-xs mt-2 text-center" style={{ color: "rgb(var(--text-muted-rgb))" }}>
                All settings are saved automatically
              </p>
            </Panel>
          )}
        </div>
      </div>

      {/* ── Lobby Games (Feature 4) ── */}
      {lobbyGames.length > 0 && (
        <Panel>
          <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
            <div>
              <h2 className="font-bold text-lg">Lobby Games</h2>
              <p className="text-xs mt-0.5" style={{ color: "rgb(var(--text-muted-rgb))" }}>
                Games from players in this lobby · {lobbyGames.length} game{lobbyGames.length !== 1 ? "s" : ""}
              </p>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <button
                onClick={() => { setShowAddGame((v) => !v); }}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-all"
                style={{
                  background: showAddGame ? "rgba(var(--color-primary-rgb),0.18)" : "rgba(255,255,255,0.06)",
                  border: `1px solid ${showAddGame ? "rgba(var(--color-primary-rgb),0.5)" : "rgba(255,255,255,0.12)"}`,
                  color: showAddGame ? "rgb(var(--color-primary-rgb))" : "rgb(var(--text-muted-rgb))",
                }}
              >
                ➕ Add game
              </button>
              {session?.steamId && (
                <button
                  onClick={syncSteamLibrary}
                  disabled={syncingSteam}
                  className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-all disabled:opacity-60"
                  style={{
                    background: "rgba(26,159,255,0.12)",
                    border: "1px solid rgba(26,159,255,0.3)",
                    color: "rgba(26,159,255,0.9)",
                  }}
                >
                  {syncingSteam ? "Syncing…" : "⬇ Sync Steam"}
                </button>
              )}
              {isHost && (
                <div className="flex gap-2 text-xs" style={{ color: "rgb(var(--text-muted-rgb))" }}>
                  <button onClick={() => updateSettings({ games: [] })}
                    style={{ color: "rgb(var(--color-primary-rgb))" }}>All</button>
                  <button onClick={() => updateSettings({ games: lobbyGames.map((g) => g.normalizedKey) })}
                    style={{ color: "rgb(var(--text-muted-rgb))" }}>None</button>
                </div>
              )}
            </div>
          </div>

          {/* Add game search panel */}
          {showAddGame && (
            <div
              className="mb-4 p-3 rounded-lg flex flex-col gap-2"
              style={{ background: "rgba(var(--surface-raised-rgb),0.4)", border: "1px solid rgba(255,255,255,0.08)" }}
            >
              <p className="text-xs font-medium" style={{ color: "rgb(var(--text-muted-rgb))" }}>
                Search for a game to add to your library
              </p>
              <GameSearchInput
                key={addGameKey}
                options={gameOptions}
                onSelect={(key, name) => { if (!addingNewGame) addGameFromSearch(key, name); }}
                placeholder="Search by name or Steam…"
                enableSteam
              />
              {!session?.userId && (
                <p className="text-xs" style={{ color: "rgb(var(--text-muted-rgb))" }}>
                  You need to be{" "}
                  <a
                    href={`${window.location.protocol}//${window.location.hostname.replace("partybingo.", "account.")}/`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "rgb(var(--color-primary-rgb))" }}
                  >
                    logged in
                  </a>
                  {" "}to save games to your library.
                </p>
              )}
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: "12px" }}>
            {lobbyGames.map((game) => {
              const warnings  = getTeamWarnings(game);
              const hasWarn   = warnings.length > 0;
              const isOn      = settings.games.length === 0 || settings.games.includes(game.normalizedKey);
              const iOwn      = myOwnedKeys.has(game.normalizedKey);
              const isAdding  = addingGameKey === game.normalizedKey;
              const isExpanded = expandedGameKey === game.normalizedKey;
              const totalChallenges = game.csvCount + game.playerCount;
              // Grey out when using official pool and game has no official challenges
              const noOfficialChallenges = settings.poolMode === "standard" && game.csvCount === 0;

              return (
                <div key={game.normalizedKey} className="flex flex-col gap-1">
                  <div
                    className="group relative cursor-pointer"
                    style={{
                      opacity: isOn ? 1 : 0.4,
                      filter: noOfficialChallenges ? "grayscale(70%)" : undefined,
                    }}
                    onClick={() => setExpandedGameKey(isExpanded ? null : game.normalizedKey)}
                  >
                    {/* Cover art */}
                    <div className="relative rounded-sm overflow-hidden" style={{ aspectRatio: "2/3" }}>
                      <GameCover steamAppId={game.steamAppId} name={game.displayName} />

                      {/* Dim overlay when not selected */}
                      {!isOn && (
                        <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.5)" }} />
                      )}

                      {/* Hover overlay */}
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all duration-150" />

                      {/* Host checkbox (top-left) */}
                      {isHost && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (settings.games.length === 0) {
                              updateSettings({ games: lobbyGames.map((g) => g.normalizedKey).filter((k) => k !== game.normalizedKey) });
                            } else {
                              updateSettings({ games: isOn ? settings.games.filter((k) => k !== game.normalizedKey) : [...settings.games, game.normalizedKey] });
                            }
                          }}
                          className="absolute top-1.5 left-1.5 w-6 h-6 rounded flex items-center justify-center text-xs font-bold transition-all group/tip"
                          style={{
                            background: isOn ? "rgba(var(--color-primary-rgb),0.9)" : "rgba(0,0,0,0.6)",
                            color: "white",
                            opacity: isOn ? 1 : 0,
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
                          onMouseLeave={(e) => (e.currentTarget.style.opacity = isOn ? "1" : "0")}
                        >
                          {isOn ? "✓" : "+"}
                          <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 rounded-md text-xs font-medium opacity-0 group-hover/tip:opacity-100 transition-opacity duration-150 z-50 whitespace-nowrap" style={{ background: "rgba(15,10,30,0.96)", color: "rgb(220,215,240)", border: "1px solid rgba(255,255,255,0.12)", boxShadow: "0 4px 16px rgba(0,0,0,0.5)" }}>
                            {isOn ? "Exclude from board" : "Include in board"}
                          </span>
                        </button>
                      )}

                      {/* Red ! warning badge (top-right) */}
                      {hasWarn && (
                        <div
                          className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full flex items-center justify-center text-xs font-black group/tip"
                          style={{ background: "rgba(220,30,30,0.9)", color: "white" }}
                        >
                          !
                          <span className="pointer-events-none absolute bottom-full right-0 mb-2 px-2 py-1 rounded-md text-xs font-medium opacity-0 group-hover/tip:opacity-100 transition-opacity duration-150 z-50 text-left" style={{ background: "rgba(15,10,30,0.96)", color: "rgb(220,215,240)", border: "1px solid rgba(255,255,255,0.12)", boxShadow: "0 4px 16px rgba(0,0,0,0.5)", whiteSpace: "normal", maxWidth: "160px", lineHeight: 1.4 }}>
                            {warnings.join(" · ")}
                          </span>
                        </div>
                      )}

                      {/* Challenge count badge (bottom-left) */}
                      {totalChallenges > 0 && (
                        <div
                          className="absolute bottom-1.5 left-1.5 text-xs font-bold px-1.5 py-0.5 rounded-full group/tip"
                          style={{ background: "rgba(var(--color-primary-rgb),0.9)", color: "white" }}
                        >
                          ⚡{totalChallenges}
                          <span className="pointer-events-none absolute bottom-full left-0 mb-2 px-2 py-1 rounded-md text-xs font-medium opacity-0 group-hover/tip:opacity-100 transition-opacity duration-150 z-50 whitespace-nowrap" style={{ background: "rgba(15,10,30,0.96)", color: "rgb(220,215,240)", border: "1px solid rgba(255,255,255,0.12)", boxShadow: "0 4px 16px rgba(0,0,0,0.5)" }}>
                            {game.csvCount > 0 && game.playerCount > 0
                              ? `${game.csvCount} official + ${game.playerCount} player challenges`
                              : game.csvCount > 0
                              ? `${game.csvCount} official challenge${game.csvCount !== 1 ? "s" : ""}`
                              : `${game.playerCount} player challenge${game.playerCount !== 1 ? "s" : ""}`}
                          </span>
                        </div>
                      )}

                      {/* Quick-add button (bottom-right, logged-in non-owner only) */}
                      {session && !iOwn && (
                        <button
                          onClick={(e) => { e.stopPropagation(); quickAddGame(game); }}
                          disabled={isAdding}
                          className="absolute bottom-1.5 right-1.5 w-6 h-6 rounded-full flex items-center justify-center text-sm font-bold opacity-0 group-hover:opacity-100 transition-all group/tip"
                          style={{ background: "rgba(0,0,0,0.7)", color: "rgba(26,159,255,0.9)" }}
                        >
                          {isAdding ? "…" : "+"}
                          <span className="pointer-events-none absolute bottom-full right-0 mb-2 px-2 py-1 rounded-md text-xs font-medium opacity-0 group-hover/tip:opacity-100 transition-opacity duration-150 z-50 whitespace-nowrap" style={{ background: "rgba(15,10,30,0.96)", color: "rgb(220,215,240)", border: "1px solid rgba(255,255,255,0.12)", boxShadow: "0 4px 16px rgba(0,0,0,0.5)" }}>
                            Add to your library
                          </span>
                        </button>
                      )}
                    </div>

                    {/* Game name + owner count */}
                    <p className="text-xs font-semibold leading-tight line-clamp-1 mt-1"
                      style={{ color: "rgb(var(--text-primary-rgb))" }}>
                      {game.displayName}
                    </p>
                    <Tip label={`${game.owners.length} player${game.owners.length !== 1 ? "s" : ""} in lobby own this game`}>
                      <span className="text-xs" style={{ color: "rgb(var(--text-muted-rgb))" }}>
                        👤 {game.owners.length}
                        {hasWarn && <span className="ml-1" style={{ color: "rgb(220,60,60)" }}>⚠</span>}
                      </span>
                    </Tip>
                    {noOfficialChallenges && (
                      <span className="text-xs" style={{ color: "rgb(var(--text-muted-rgb))", opacity: 0.7 }}>
                        No official challenges
                      </span>
                    )}
                  </div>

                  {/* Expanded: owner list + challenges */}
                  {isExpanded && (
                    <div
                      className="rounded-lg p-2.5 flex flex-col gap-2 text-xs"
                      style={{ background: "rgba(var(--surface-raised-rgb),0.5)", border: "1px solid rgba(255,255,255,0.08)" }}
                    >
                      {/* Owners */}
                      <div>
                        <p className="font-semibold mb-1" style={{ color: "rgb(var(--text-muted-rgb))" }}>Owners</p>
                        {game.owners.length === 0 ? (
                          <p style={{ color: "rgb(var(--text-muted-rgb))" }}>None</p>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {game.owners.map((o) => (
                              <span key={o.id}
                                className="px-1.5 py-0.5 rounded-full font-medium"
                                style={{
                                  background: o.team ? `rgba(var(--team-${o.team}-rgb, 100,100,200),0.2)` : "rgba(255,255,255,0.08)",
                                  color: "rgb(var(--text-primary-rgb))",
                                  border: "1px solid rgba(255,255,255,0.1)",
                                }}
                              >
                                {o.team ? TEAM_EMOJIS[o.team] : "👁️"} {o.name}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Team warnings */}
                      {hasWarn && (
                        <div className="flex flex-col gap-0.5">
                          {warnings.map((w, i) => (
                            <p key={i} style={{ color: "rgb(220,80,80)" }}>⚠ {w}</p>
                          ))}
                        </div>
                      )}

                      {/* Challenge counts */}
                      <div className="flex gap-3">
                        {game.csvCount > 0 && (
                          <span style={{ color: "rgb(var(--text-muted-rgb))" }}>
                            ⚡ {game.csvCount} official
                          </span>
                        )}
                        {game.playerCount > 0 && (
                          <span style={{ color: "rgb(var(--text-muted-rgb))" }}>
                            ✍️ {game.playerCount} player
                          </span>
                        )}
                        {totalChallenges === 0 && (
                          <span style={{ color: "rgb(var(--text-muted-rgb))" }}>No challenges yet</span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* No logged-in players hint */}
          {lobbyGames.length === 0 && players.some((p) => !p.user_id) && (
            <p className="text-sm text-center py-4" style={{ color: "rgb(var(--text-muted-rgb))" }}>
              No logged-in players have games in their library yet.
            </p>
          )}
        </Panel>
      )}

      {/* Hint when no lobby games */}
      {lobbyGames.length === 0 && !loading && (
        <div className="rounded-xl p-4 flex flex-col items-center gap-3 text-center text-sm" style={{ border: "1.5px dashed rgba(255,255,255,0.08)" }}>
          <p style={{ color: "rgb(var(--text-muted-rgb))" }}>
            🎮 No lobby games yet — players need to be logged in with games in their{" "}
            <a href={`${window.location.protocol}//${window.location.hostname.replace("partybingo.", "account.")}/library`}
              target="_blank" rel="noopener noreferrer"
              style={{ color: "rgb(var(--color-primary-rgb))" }}>
              library
            </a>.
          </p>
          {session?.steamId && (
            <button
              onClick={syncSteamLibrary}
              disabled={syncingSteam}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-all disabled:opacity-60"
              style={{
                background: "rgba(26,159,255,0.12)",
                border: "1px solid rgba(26,159,255,0.3)",
                color: "rgba(26,159,255,0.9)",
              }}
            >
              {syncingSteam ? "Syncing…" : "⬇ Sync your Steam library now"}
            </button>
          )}
        </div>
      )}

    </div>
  );
}
