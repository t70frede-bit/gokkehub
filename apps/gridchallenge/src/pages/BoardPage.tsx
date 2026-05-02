import { useState, useEffect, useRef } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Button, Panel, useToast } from "@gokkehub/ui";
import { supabase } from "../lib/supabase";
import {
  loadCsvChallenges,
  getCsvChallenges,
  checkBingo,
  customChallengeId,
} from "../lib/challenges";
import { getGameDisplayName } from "../lib/gameKeys";
import type {
  Challenge,
  Claim,
  Lobby,
  LobbyBoardState,
  LobbySettings,
  Player,
  SoloBoardState,
  TeamColor,
  VersusState,
} from "../lib/types";
import { TEAM_COLORS, TEAM_LABELS, TEAM_EMOJIS } from "../lib/types";

// ── Audio ─────────────────────────────────────────────────────────────────────

let audioCtx: AudioContext | null = null;
function playClaimSound() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, audioCtx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.25);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.25);
  } catch { /* audio not available */ }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt2(n: number) {
  return String(Math.floor(n)).padStart(2, "0");
}

function fmtCountdown(ms: number) {
  const total = Math.max(0, ms);
  return `${fmt2(total / 60000)}:${fmt2((total % 60000) / 1000)}`;
}

// ── Default settings ──────────────────────────────────────────────────────────

const DEFAULT_SETTINGS: LobbySettings = {
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

// ── Component ─────────────────────────────────────────────────────────────────

export default function BoardPage() {
  const { lobbyId }    = useParams<{ lobbyId?: string }>();
  const [params]       = useSearchParams();
  const navigate       = useNavigate();
  const { addToast }   = useToast();

  const isLobbyMode = !!lobbyId;

  // ── State ────────────────────────────────────────────────────────────────────

  const [challengeIds, setChallengeIds]   = useState<string[]>([]);
  const [challengeMap, setChallengeMap]   = useState<Map<string, Challenge>>(new Map());
  const [settings, setSettings]           = useState<LobbySettings>(DEFAULT_SETTINGS);
  const settingsRef = useRef<LobbySettings>(DEFAULT_SETTINGS);
  function applySettings(s: LobbySettings) {
    settingsRef.current = s;
    setSettings(s);
  }
  const [loaded, setLoaded]               = useState(false);

  // Claims
  const [boardState, setBoardState]       = useState<LobbyBoardState | SoloBoardState>({});
  const boardStateRef = useRef<LobbyBoardState | SoloBoardState>({});
  function updateBoardState(next: typeof boardState) {
    boardStateRef.current = next;
    setBoardState(next);
  }

  // Optimistic claims (Feature 6)
  const [pendingClaims, setPendingClaims] = useState<Map<string, { team: TeamColor; playerName: string }>>(new Map());

  // Unclaim confirmation (Feature 7)
  const [unclaimConfirmId, setUnclaimConfirmId] = useState<string | null>(null);

  // Versus
  const [activeVersusId, setActiveVersusId]   = useState<string | null>(null);
  const [nextVersusId, setNextVersusId]       = useState<string | null>(null);
  const [nextVersusTime, setNextVersusTime]   = useState<number | null>(null);
  const [unlockedVersus, setUnlockedVersus]   = useState<Set<string>>(new Set());
  const activeVersusRef  = useRef<string | null>(null);
  const nextVersusRef    = useRef<string | null>(null);
  const nextVersusTimeRef = useRef<number | null>(null);
  const unlockedVersusRef = useRef<Set<string>>(new Set());

  // Versus skip/vote (Feature 3)
  const [skipVotes, setSkipVotes]             = useState<string[]>([]);
  const [skipConfirmId, setSkipConfirmId]     = useState<string | null>(null);

  // Lobby
  const [myPlayerId, setMyPlayerId]     = useState<string | null>(null);
  const [myTeam, setMyTeam]             = useState<TeamColor | null>(null);
  const [isHost, setIsHost]             = useState(false);
  const [isSpectator, setIsSpectator]   = useState(false);
  const [lobbyPlayers, setLobbyPlayers] = useState<Player[]>([]);
  const lobbyPlayersRef = useRef<Player[]>([]);

  // Claim log
  const [claimLog, setClaimLog]         = useState<Claim[]>([]);
  const [showClaimLog, setShowClaimLog] = useState(false);

  // Victory
  const [winnerTeam, setWinnerTeam]       = useState<string | null>(null);
  const [winnerIds, setWinnerIds]         = useState<string[]>([]);
  const [bingoShown, setBingoShown]       = useState(false);
  const bingoShownRef = useRef(false);

  const [, setTick]               = useState(0);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [fullscreen, setFullscreen]     = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [tileSize, setTileSize] = useState(130);

  const versusTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Keep lobbyPlayersRef in sync
  useEffect(() => { lobbyPlayersRef.current = lobbyPlayers; }, [lobbyPlayers]);

  // ── Dynamic tile size for fullscreen ─────────────────────────────────────────
  useEffect(() => {
    if (!fullscreen || !settings) { setTileSize(130); return; }
    const cols = settings.boardWidth;
    const rows = settings.boardHeight;
    const GAP = 6;
    const STRIP = 40;
    const PAD = 16;
    const calc = () => {
      const availW = window.innerWidth  - PAD * 2 - GAP * (cols - 1);
      const availH = window.innerHeight - STRIP - PAD * 2 - GAP * (rows - 1);
      setTileSize(Math.floor(Math.min(availW / cols, availH / rows)));
    };
    calc();
    window.addEventListener("resize", calc);
    return () => window.removeEventListener("resize", calc);
  }, [fullscreen, settings]);

  // Close unclaim confirm when clicking elsewhere
  useEffect(() => {
    if (!unclaimConfirmId) return;
    const handler = () => setUnclaimConfirmId(null);
    document.addEventListener("click", handler, { capture: true, once: true });
    return () => document.removeEventListener("click", handler, { capture: true });
  }, [unclaimConfirmId]);

  // ── Sync refs ────────────────────────────────────────────────────────────────

  useEffect(() => { activeVersusRef.current = activeVersusId; }, [activeVersusId]);
  useEffect(() => { nextVersusRef.current = nextVersusId; }, [nextVersusId]);
  useEffect(() => { nextVersusTimeRef.current = nextVersusTime; }, [nextVersusTime]);
  useEffect(() => { unlockedVersusRef.current = unlockedVersus; }, [unlockedVersus]);

  // ── INIT ──────────────────────────────────────────────────────────────────────

  useEffect(() => {
    loadCsvChallenges().then(() => {
      if (isLobbyMode) {
        initLobbyMode();
      } else {
        initSoloMode();
      }
    });

    return () => {
      if (versusTimerRef.current) clearInterval(versusTimerRef.current);
    };
  }, []);

  // ── SOLO MODE ─────────────────────────────────────────────────────────────────

  function initSoloMode() {
    const urlIds = params.get("ids");
    let ids: string[] = [];

    if (urlIds) {
      ids = urlIds.split(",").filter(Boolean);
    } else {
      try {
        ids = JSON.parse(localStorage.getItem("solo_board_ids") ?? "[]");
      } catch { ids = []; }
    }

    if (ids.length === 0) {
      addToast("No board found. Please generate one first.", "error");
      navigate("/");
      return;
    }

    const settingsRaw = localStorage.getItem("solo_settings");
    const s: LobbySettings = settingsRaw ? { ...DEFAULT_SETTINGS, ...JSON.parse(settingsRaw) } : DEFAULT_SETTINGS;
    applySettings(s);

    const csv = getCsvChallenges();
    const map = buildChallengeMapFromCsv(ids, csv, []);
    setChallengeMap(map);
    setChallengeIds(ids);

    let savedState: SoloBoardState = {};
    try {
      savedState = JSON.parse(localStorage.getItem("solo_board_state") ?? "{}");
    } catch { savedState = {}; }
    updateBoardState(savedState);

    try {
      const vs = JSON.parse(localStorage.getItem("solo_versus_state") ?? "{}");
      const now = Date.now();
      const nxt = vs.nextVersusTime && vs.nextVersusTime > now ? vs.nextVersusTime : now + s.versusInterval * 60 * 1000;
      setNextVersusTime(nxt);
      nextVersusTimeRef.current = nxt;
      if (vs.activeVersusId) { setActiveVersusId(vs.activeVersusId); activeVersusRef.current = vs.activeVersusId; }
      if (vs.nextVersusId)   { setNextVersusId(vs.nextVersusId);     nextVersusRef.current   = vs.nextVersusId; }
      if (vs.unlockedVersus) {
        const s = new Set<string>(vs.unlockedVersus);
        setUnlockedVersus(s);
        unlockedVersusRef.current = s;
      }
    } catch { /* ignore */ }

    setLoaded(true);
    startVersusTimer(s.versusInterval, ids, false, map, savedState);
  }

  // ── LOBBY MODE ────────────────────────────────────────────────────────────────

  async function initLobbyMode() {
    const pid = sessionStorage.getItem("playerId");
    if (!pid) { navigate(`/join?lobby=${lobbyId}`); return; }
    setMyPlayerId(pid);

    let { data: lobbyData } = await supabase.from("lobbies").select("*").eq("id", lobbyId!).single();
    if (!lobbyData) { addToast("Lobby not found.", "error"); navigate("/"); return; }

    const lobby = lobbyData as Lobby;
    const s: LobbySettings = { ...DEFAULT_SETTINGS, ...(lobby.settings ?? {}) };
    applySettings(s);

    let playerData: Player | null = null;
    for (let i = 0; i < 2; i++) {
      const { data } = await supabase.from("players").select("*").eq("id", pid).single();
      if (data) { playerData = data as Player; break; }
      if (i === 0) await new Promise((r) => setTimeout(r, 600));
    }
    if (!playerData || playerData.kicked) { navigate(`/join?lobby=${lobbyId}`); return; }

    setMyTeam(playerData.team);
    setIsHost(playerData.is_host);
    setIsSpectator(playerData.is_spectator);

    const { data: playersData } = await supabase.from("players").select("*").eq("lobby_id", lobbyId!).eq("kicked", false);
    const players = (playersData ?? []) as Player[];
    setLobbyPlayers(players);
    lobbyPlayersRef.current = players;

    const boardIds = (lobby.board_challenge_ids ?? []).map((r) => r.id);

    let customMap: Map<string, Challenge> = new Map();
    const customRefIds = (lobby.board_challenge_ids ?? [])
      .filter((r) => r.source === "custom")
      .map((r) => {
        const num = r.id.startsWith("custom_") ? r.id.slice(7) : r.id;
        return Number(num);
      });

    if (customRefIds.length > 0) {
      const { data: customs } = await supabase.from("custom_challenges").select("*").eq("lobby_id", lobbyId!);
      (customs ?? []).forEach((c: any) => {
        const id = customChallengeId(c.id);
        customMap.set(id, { id, text: c.text, type: c.type, game: c.game, source: "custom" });
      });
    }

    const csv = getCsvChallenges();
    const map = buildChallengeMapFromCsv(boardIds, csv, [...customMap.values()]);
    setChallengeMap(map);
    setChallengeIds(boardIds);

    const { data: claimsData } = await supabase.from("claims").select("*").eq("lobby_id", lobbyId!);
    const claims = (claimsData ?? []) as Claim[];

    const state: LobbyBoardState = {};
    claims.forEach((c) => {
      state[c.challenge_id] = { team: c.team, playerName: c.player_name, playerId: c.player_id };
    });
    updateBoardState(state);
    setClaimLog(claims.sort((a, b) => new Date(a.claimed_at).getTime() - new Date(b.claimed_at).getTime()));

    const { data: vsData } = await supabase.from("versus_state").select("*").eq("lobby_id", lobbyId!).single();
    if (vsData) {
      const vs = vsData as VersusState;
      const nxt = vs.next_versus_timestamp ?? Date.now() + s.versusInterval * 60 * 1000;
      setNextVersusTime(nxt);            nextVersusTimeRef.current = nxt;
      setActiveVersusId(vs.active_challenge_id ?? null);  activeVersusRef.current = vs.active_challenge_id ?? null;
      setNextVersusId(vs.next_challenge_id ?? null);      nextVersusRef.current   = vs.next_challenge_id ?? null;
      const unlocked = new Set<string>((vs.unlocked_challenge_ids ?? []).map(String));
      setUnlockedVersus(unlocked);       unlockedVersusRef.current = unlocked;
      setSkipVotes(vs.skip_votes ?? []);
    }

    setLoaded(true);
    subscribeToLobbyUpdates(pid, playerData.is_host, s.versusInterval, boardIds, map);
    startVersusTimer(s.versusInterval, boardIds, playerData.is_host, map, state);
  }

  // ── Challenge map builder ─────────────────────────────────────────────────────

  function buildChallengeMapFromCsv(_ids: string[], csv: Challenge[], customs: Challenge[]): Map<string, Challenge> {
    const map = new Map<string, Challenge>();
    for (const c of csv)     map.set(c.id, c);
    for (const c of customs) map.set(c.id, c);
    return map;
  }

  // ── Subscriptions ─────────────────────────────────────────────────────────────

  function subscribeToLobbyUpdates(
    pid: string,
    host: boolean,
    versusInterval: number,
    ids: string[],
    map: Map<string, Challenge>,
  ) {
    supabase
      .channel(`board-${lobbyId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "claims", filter: `lobby_id=eq.${lobbyId}` }, (payload) => {
        const claim = payload.new as Claim;
        // Remove from pending if this is our own confirmed claim
        setPendingClaims((prev) => {
          if (!prev.has(claim.challenge_id)) return prev;
          const next = new Map(prev);
          next.delete(claim.challenge_id);
          return next;
        });
        setBoardState((prev) => {
          const next = { ...prev, [claim.challenge_id]: { team: claim.team, playerName: claim.player_name, playerId: claim.player_id } } as LobbyBoardState;
          boardStateRef.current = next;
          handleVersusCompletionLobby(claim.challenge_id, claim.team, next, host, versusInterval, ids, map);
          checkBingoBoardState(next, ids, map);
          return next;
        });
        setClaimLog((l) => [...l, claim]);
        playClaimSound();
        const text = map.get(claim.challenge_id)?.text ?? claim.challenge_id;
        addToast(`${TEAM_EMOJIS[claim.team] || ""} ${claim.player_name} claimed: ${text}`, "info");
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "claims", filter: `lobby_id=eq.${lobbyId}` }, (payload) => {
        const cid = (payload.old as any).challenge_id as string;
        setBoardState((prev) => {
          const next = { ...prev } as LobbyBoardState;
          delete next[cid];
          boardStateRef.current = next;
          return next;
        });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "players", filter: `lobby_id=eq.${lobbyId}` }, () => {
        supabase.from("players").select("*").eq("lobby_id", lobbyId!).eq("kicked", false).then(({ data }) => {
          const players = (data ?? []) as Player[];
          setLobbyPlayers(players);
          lobbyPlayersRef.current = players;
          const me = players.find((p) => p.id === pid);
          if (me) setMyTeam(me.team);
        });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "versus_state", filter: `lobby_id=eq.${lobbyId}` }, (payload) => {
        const vs = payload.new as VersusState;
        const votes = vs.skip_votes ?? [];
        setSkipVotes(votes);

        if (!host) {
          setActiveVersusId(vs.active_challenge_id ?? null);  activeVersusRef.current = vs.active_challenge_id ?? null;
          setNextVersusId(vs.next_challenge_id ?? null);      nextVersusRef.current   = vs.next_challenge_id ?? null;
          const nxt = vs.next_versus_timestamp ?? null;
          setNextVersusTime(nxt);                             nextVersusTimeRef.current = nxt;
          const unlocked = new Set<string>((vs.unlocked_challenge_ids ?? []).map(String));
          setUnlockedVersus(unlocked);                        unlockedVersusRef.current = unlocked;
        } else {
          // Host: check if skip vote threshold is met
          if (votes.length > 0 && vs.next_challenge_id) {
            const nonSpectators = lobbyPlayersRef.current.filter((p) => !p.is_spectator);
            const threshold = Math.max(1, Math.floor(nonSpectators.length / 2));
            if (votes.length >= threshold) {
              supabase.from("versus_state").upsert({
                lobby_id:   lobbyId,
                skip_votes: [],
              }).then(() => {});
              activateNextVersus(ids, map, true);
            }
          }
        }
      })
      .subscribe();

    // Settings changes from host
    supabase
      .channel(`lobby-settings-${lobbyId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "lobbies", filter: `id=eq.${lobbyId}` }, (payload) => {
        const updated = payload.new as Lobby;
        if (!host) {
          applySettings({ ...DEFAULT_SETTINGS, ...(updated.settings ?? {}) });
        }
      })
      .subscribe();

    // Kick watch
    supabase
      .channel(`kick-board-${pid}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "players", filter: `id=eq.${pid}` }, (payload) => {
        if ((payload.new as Player).kicked) {
          addToast("You have been kicked.", "error");
          navigate("/");
        }
      })
      .subscribe();
  }

  // ── Versus timer ──────────────────────────────────────────────────────────────

  function startVersusTimer(
    _interval: number,
    ids: string[],
    host: boolean,
    map: Map<string, Challenge>,
    initialState: LobbyBoardState | SoloBoardState,
  ) {
    if (versusTimerRef.current) clearInterval(versusTimerRef.current);

    if (!nextVersusRef.current) {
      pickNextVersus(ids, map, initialState);
    }

    versusTimerRef.current = setInterval(() => {
      setTick((t) => t + 1);

      const active = activeVersusRef.current;
      const nextTime = nextVersusTimeRef.current;

      if (active) return;

      if (isLobbyMode && !host) return;

      if (nextTime && Date.now() >= nextTime) {
        activateNextVersus(ids, map, host);
      }
    }, 1000);
  }

  function pickNextVersus(
    ids: string[],
    map: Map<string, Challenge>,
    state: LobbyBoardState | SoloBoardState,
  ): string | null {
    const candidates = ids.filter((id) => {
      const ch = map.get(id);
      if (!ch || ch.type !== "versus") return false;
      const claim = (state as any)[id];
      return !claim || (typeof claim === "object" ? !claim.team : !claim);
    });
    if (candidates.length === 0) {
      setNextVersusId(null);
      nextVersusRef.current = null;
      return null;
    }
    const next = candidates[Math.floor(Math.random() * candidates.length)];
    setNextVersusId(next);
    nextVersusRef.current = next;
    return next;
  }

  function activateNextVersus(_ids: string[], _map: Map<string, Challenge>, host: boolean) {
    const next = nextVersusRef.current;
    if (!next) return;

    setActiveVersusId(next);   activeVersusRef.current = next;
    setNextVersusId(null);     nextVersusRef.current = null;
    setUnlockedVersus((prev) => { const s = new Set(prev); s.add(String(next)); unlockedVersusRef.current = s; return s; });
    setSkipConfirmId(null);

    if (isLobbyMode && host) {
      supabase.from("versus_state").upsert({
        lobby_id:               lobbyId,
        active_challenge_id:    next,
        next_challenge_id:      null,
        next_versus_timestamp:  nextVersusTimeRef.current,
        unlocked_challenge_ids: [...unlockedVersusRef.current],
        skip_votes:             [],
      }).then(() => {});
    } else if (!isLobbyMode) {
      saveSoloVersusState();
    }
  }

  function handleVersusCompletionLobby(
    cid: string,
    team: string,
    newState: LobbyBoardState | SoloBoardState,
    host: boolean,
    interval: number,
    ids: string[],
    map: Map<string, Challenge>,
  ) {
    if (String(cid) !== String(activeVersusRef.current)) return;
    if (!team) return;

    setActiveVersusId(null); activeVersusRef.current = null;
    setUnlockedVersus((prev) => { const s = new Set(prev); s.add(String(cid)); unlockedVersusRef.current = s; return s; });

    if (!isLobbyMode || host) {
      const nxt = Date.now() + interval * 60 * 1000;
      setNextVersusTime(nxt); nextVersusTimeRef.current = nxt;
      pickNextVersus(ids, map, newState);

      if (isLobbyMode && host) {
        supabase.from("versus_state").upsert({
          lobby_id:               lobbyId,
          active_challenge_id:    null,
          next_challenge_id:      nextVersusRef.current,
          next_versus_timestamp:  nxt,
          unlocked_challenge_ids: [...unlockedVersusRef.current],
          skip_votes:             [],
        }).then(() => {});
      } else if (!isLobbyMode) {
        saveSoloVersusState();
      }
    }
  }

  // ── Solo board helpers ────────────────────────────────────────────────────────

  function saveSoloBoardState(state: SoloBoardState) {
    try { localStorage.setItem("solo_board_state", JSON.stringify(state)); } catch { /* ignore */ }
  }

  function saveSoloVersusState() {
    try {
      localStorage.setItem("solo_versus_state", JSON.stringify({
        activeVersusId:  activeVersusRef.current,
        nextVersusId:    nextVersusRef.current,
        nextVersusTime:  nextVersusTimeRef.current,
        unlockedVersus:  [...unlockedVersusRef.current],
      }));
    } catch { /* ignore */ }
  }

  // ── Bingo check ───────────────────────────────────────────────────────────────

  function checkBingoBoardState(state: LobbyBoardState | SoloBoardState, ids: string[], _map: Map<string, Challenge>) {
    if (bingoShownRef.current) return;
    const flatState: Record<string, string> = {};
    for (const [id, val] of Object.entries(state)) {
      flatState[id] = typeof val === "string" ? val : (val as any)?.team ?? "";
    }
    const s = settingsRef.current;
    const result = checkBingo(
      ids,
      flatState,
      s.boardWidth,
      s.boardHeight,
      s.winLength,
      s.freeSpace,
    );
    if (result) {
      bingoShownRef.current = true;
      setBingoShown(true);
      setWinnerTeam(result.team);
      setWinnerIds(result.winnerIds);
      playClaimSound();
    }
  }

  // ── Cell click handlers ───────────────────────────────────────────────────────

  function handleCellClick(challengeId: string) {
    if (isSpectator) return;
    const ch = challengeMap.get(challengeId);
    if (!ch) return;

    // Close any open unclaim confirm when clicking elsewhere
    if (unclaimConfirmId && unclaimConfirmId !== challengeId) {
      setUnclaimConfirmId(null);
      return;
    }

    if (ch.type === "versus") {
      const active = activeVersusRef.current;
      const unlocked = unlockedVersusRef.current;
      const isActive = String(active) === String(challengeId);
      const isUnlocked = unlocked.has(String(challengeId));
      const isClaimed = isCellClaimed(challengeId);
      if (!isActive && !isUnlocked && !isClaimed) return;
    }

    if (isLobbyMode) {
      const existing = (boardStateRef.current as LobbyBoardState)[challengeId];
      if (existing?.playerId === myPlayerId || (isHost && existing)) {
        // Show inline unclaim confirmation (Feature 7)
        setUnclaimConfirmId(challengeId);
      } else if (!existing) {
        claimLobbyCell(challengeId);
      } else {
        claimLobbyCell(challengeId); // versus override
      }
    } else {
      const state = boardStateRef.current as SoloBoardState;
      const next = { ...state };
      if (next[challengeId] === "blue") {
        delete next[challengeId];
      } else {
        next[challengeId] = "blue";
      }
      updateBoardState(next);
      saveSoloBoardState(next);
      handleVersusCompletionSolo(challengeId, next[challengeId] ?? "");
      checkBingoBoardState(next, challengeIds, challengeMap);
    }
  }

  function handleCellRightClick(e: React.MouseEvent, challengeId: string) {
    e.preventDefault();
    if (isSpectator) return;
    const ch = challengeMap.get(challengeId);
    if (!ch) return;

    if (isLobbyMode) {
      const existing = (boardStateRef.current as LobbyBoardState)[challengeId];
      if (existing?.playerId === myPlayerId || (isHost && existing)) {
        setUnclaimConfirmId(challengeId);
      }
    } else {
      const state = boardStateRef.current as SoloBoardState;
      const next = { ...state };
      if (next[challengeId] === "red") {
        delete next[challengeId];
      } else {
        next[challengeId] = "red";
      }
      updateBoardState(next);
      saveSoloBoardState(next);
      handleVersusCompletionSolo(challengeId, next[challengeId] ?? "");
      checkBingoBoardState(next, challengeIds, challengeMap);
    }
  }

  function handleVersusCompletionSolo(cid: string, team: string) {
    if (String(cid) !== String(activeVersusRef.current)) return;
    if (!team) return;

    const nxt = Date.now() + settings.versusInterval * 60 * 1000;
    setActiveVersusId(null); activeVersusRef.current = null;
    setNextVersusTime(nxt);  nextVersusTimeRef.current = nxt;
    setUnlockedVersus((prev) => { const s = new Set(prev); s.add(String(cid)); unlockedVersusRef.current = s; return s; });
    pickNextVersus(challengeIds, challengeMap, boardStateRef.current);
    saveSoloVersusState();
  }

  // Feature 6: Optimistic tile claiming
  async function claimLobbyCell(challengeId: string) {
    if (!myTeam) return;
    const playerName = sessionStorage.getItem("playerName") ?? "Player";

    // Optimistic update
    setPendingClaims((prev) => {
      const next = new Map(prev);
      next.set(challengeId, { team: myTeam!, playerName });
      return next;
    });

    const { error } = await supabase.from("claims").upsert({
      lobby_id:     lobbyId,
      challenge_id: String(challengeId),
      player_id:    myPlayerId,
      player_name:  playerName,
      team:         myTeam,
    });

    if (error) {
      // Revert optimistic update
      setPendingClaims((prev) => {
        const next = new Map(prev);
        next.delete(challengeId);
        return next;
      });
      addToast("Failed to claim tile.", "error");
    }
    // On success: subscription will confirm and remove from pending
  }

  async function unclaimLobbyCell(challengeId: string) {
    setUnclaimConfirmId(null);
    await supabase.from("claims").delete().eq("lobby_id", lobbyId!).eq("challenge_id", String(challengeId));
  }

  // ── Timer cell click (host manual advance / skip) ─────────────────────────────

  function handleTimerClick(challengeId: string, e: React.MouseEvent) {
    e.stopPropagation();
    const active = activeVersusRef.current;
    const next   = nextVersusRef.current;

    if (String(active) === String(challengeId)) {
      // Demote active → back to next-up (non-host solo or host)
      if (isLobbyMode && !isHost) return;
      setActiveVersusId(null); activeVersusRef.current = null;
      setNextVersusId(challengeId); nextVersusRef.current = challengeId;
      const nxt = Date.now() + settings.versusInterval * 60 * 1000;
      setNextVersusTime(nxt); nextVersusTimeRef.current = nxt;
      if (isLobbyMode) writeVersusStateToDb();
    } else if (String(next) === String(challengeId)) {
      if (isLobbyMode && !isHost) return;
      // Host: show skip confirmation (Feature 3)
      if (isLobbyMode && isHost) {
        setSkipConfirmId(challengeId);
      } else {
        activateNextVersus(challengeIds, challengeMap, isHost);
      }
    }
  }

  // Feature 3: Player vote to skip countdown
  async function voteToSkip(e: React.MouseEvent) {
    e.stopPropagation();
    if (!myPlayerId || !isLobbyMode || isHost) return;
    if (skipVotes.includes(myPlayerId)) return; // already voted

    const newVotes = [...skipVotes, myPlayerId];

    await supabase.from("versus_state").upsert({
      lobby_id:   lobbyId,
      skip_votes: newVotes,
    });
  }

  async function writeVersusStateToDb() {
    await supabase.from("versus_state").upsert({
      lobby_id:               lobbyId,
      active_challenge_id:    activeVersusRef.current,
      next_challenge_id:      nextVersusRef.current,
      next_versus_timestamp:  nextVersusTimeRef.current,
      unlocked_challenge_ids: [...unlockedVersusRef.current],
      skip_votes:             [],
    });
  }

  // ── In-game team swap (host only, gated by teamSwapEnabled setting) ──────────

  async function assignTeamInGame(playerId: string, team: TeamColor) {
    await supabase.from("players").update({ team }).eq("id", playerId);
  }

  function nextTeamInGame(current: TeamColor | null): TeamColor {
    const available = TEAM_COLORS.slice(0, settingsRef.current.teamCount);
    const idx = current ? available.indexOf(current) : -1;
    return available[(idx + 1) % available.length];
  }

  // ── Reset ─────────────────────────────────────────────────────────────────────

  async function resetBoard() {
    setShowResetConfirm(false);
    if (isLobbyMode) {
      if (!isHost) { addToast("Only the host can reset the board.", "error"); return; }
      await supabase.from("claims").delete().eq("lobby_id", lobbyId!);
    }
    updateBoardState({});
    setPendingClaims(new Map());
    setClaimLog([]);
    bingoShownRef.current = false;
    setBingoShown(false);
    setWinnerTeam(null);
    setWinnerIds([]);
    setActiveVersusId(null);  activeVersusRef.current = null;
    setNextVersusId(null);    nextVersusRef.current = null;
    setUnlockedVersus(new Set()); unlockedVersusRef.current = new Set();
    setSkipVotes([]);
    const nxt = Date.now() + settings.versusInterval * 60 * 1000;
    setNextVersusTime(nxt);   nextVersusTimeRef.current = nxt;
    pickNextVersus(challengeIds, challengeMap, {});

    if (!isLobbyMode) {
      saveSoloBoardState({});
      saveSoloVersusState();
    } else {
      writeVersusStateToDb();
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  function isCellClaimed(id: string): boolean {
    if (pendingClaims.has(id)) return true;
    const state = boardStateRef.current;
    const val = (state as any)[id];
    if (!val) return false;
    if (typeof val === "string") return !!val;
    return !!(val as any).team;
  }

  // Feature 6: Check pending claims first
  function getCellTeam(id: string): string {
    if (pendingClaims.has(id)) return pendingClaims.get(id)!.team;
    const state = boardState;
    const val = (state as any)[id];
    if (!val) return "";
    if (typeof val === "string") return val;
    return (val as any).team ?? "";
  }

  function getCellPlayerName(id: string): string {
    if (pendingClaims.has(id)) return pendingClaims.get(id)!.playerName;
    const state = boardState;
    const val = (state as any)[id];
    if (typeof val === "object" && val) return val.playerName ?? "";
    return "";
  }

  function getScoreCounts(): Record<string, number> {
    const counts: Record<string, number> = {};
    TEAM_COLORS.forEach((t) => { counts[t] = 0; });
    // Count confirmed + pending
    Object.values(boardState).forEach((val) => {
      const team = typeof val === "string" ? val : (val as any)?.team;
      if (team && counts[team] !== undefined) counts[team]++;
    });
    pendingClaims.forEach(({ team }) => {
      if (counts[team] !== undefined) counts[team]++;
    });
    return counts;
  }

  function getCountdown(): string {
    if (!nextVersusTime) return "--:--";
    return fmtCountdown(nextVersusTime - Date.now());
  }

  // ── Fullscreen ────────────────────────────────────────────────────────────────

  const containerRef = useRef<HTMLDivElement>(null);

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen().then(() => setFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setFullscreen(false)).catch(() => {});
    }
  }

  useEffect(() => {
    const handler = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────────

  if (!loaded) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <p style={{ color: "rgb(var(--text-muted-rgb))" }}>Loading board…</p>
      </div>
    );
  }

  const teamCount   = settings.teamCount;
  const boardW      = settings.boardWidth;
  const boardH      = settings.boardHeight;
  const totalCells  = boardW * boardH;
  const centerIndex = Math.floor(totalCells / 2);
  const scores      = getScoreCounts();

  // Feature 3: skip vote threshold display
  const nonSpectatorCount = lobbyPlayers.filter((p) => !p.is_spectator).length;
  const skipThreshold = Math.max(1, Math.floor(nonSpectatorCount / 2));

  function cellTextSize(text: string): string {
    const base = fullscreen ? tileSize * 0.13 : 11;
    const len  = text.length;
    const scale = len > 80 ? 0.55 : len > 60 ? 0.7 : len > 40 ? 0.85 : 1;
    return `${Math.max(Math.round(base * scale), 9)}px`;
  }

  // Feature 2: visible players in bar (hide spectators if setting on)
  const visiblePlayers = lobbyPlayers.filter((p) =>
    !settings.hideSpectators || !p.is_spectator
  );

  return (
    <div
      ref={containerRef}
      className={`min-h-dvh flex flex-col bg-[rgb(var(--color-bg-rgb))] ${fullscreen ? "fullscreen-board" : ""}`}
    >
      {/* Fullscreen score strip */}
      {fullscreen && (
        <div className="fullscreen-score-strip">
          <div className="flex items-center gap-3">
            {TEAM_COLORS.slice(0, teamCount).map((team) => (
              <div key={team} className={`score-team team-${team}`}>
                {TEAM_EMOJIS[team]} {scores[team] ?? 0}
              </div>
            ))}
          </div>
          <button
            onClick={toggleFullscreen}
            className="text-lg opacity-60 hover:opacity-100 transition-opacity"
            title="Exit fullscreen"
          >
            🗗
          </button>
        </div>
      )}

      {/* Toolbar — hidden in fullscreen */}
      {!fullscreen && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => {
              if (!isLobbyMode || confirm("Leave this game and return to home?")) navigate("/");
            }}>
              ← Back
            </Button>
            {/* Feature 2: hide lobby code in streamer mode */}
            {isLobbyMode && !settings.streamerMode && (
              <span className="text-sm font-bold" style={{ color: "rgb(var(--text-muted-rgb))" }}>
                🌐 {lobbyId?.toUpperCase()}
              </span>
            )}
            {!isLobbyMode && (
              <span className="text-sm" style={{ color: "rgb(var(--text-muted-rgb))" }}>Solo</span>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="score-bar">
              {TEAM_COLORS.slice(0, teamCount).map((team) => (
                <div key={team} className={`score-team team-${team}`}>
                  {TEAM_EMOJIS[team]} {scores[team] ?? 0}
                </div>
              ))}
            </div>
            <Button variant="ghost" size="sm" onClick={() => setSoundEnabled((v) => !v)}>
              {soundEnabled ? "🔔" : "🔕"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setShowClaimLog((v) => !v)}>
              📋
            </Button>
            <Button variant="ghost" size="sm" onClick={toggleFullscreen}>
              ⛶
            </Button>
            {(!isLobbyMode || isHost) && (
              <Button variant="danger" size="sm" onClick={() => setShowResetConfirm(true)}>
                Reset
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Player bar — hidden in fullscreen */}
      {isLobbyMode && !fullscreen && (
        <div className="px-4 py-2 border-b border-white/10">
          <div className="player-bar">
            {visiblePlayers.map((p) => {
              const canSwap = isHost && settings.teamSwapEnabled && !p.is_spectator && !p.is_host;
              return (
                <span
                  key={p.id}
                  className={`player-bar-item ${p.is_spectator ? "spectator" : `team-${p.team}`}`}
                  style={canSwap ? { cursor: "pointer", outline: "1px dashed rgba(255,255,255,0.25)", borderRadius: "4px" } : undefined}
                  title={canSwap ? "Click to cycle team" : undefined}
                  onClick={() => { if (canSwap) assignTeamInGame(p.id, nextTeamInGame(p.team)); }}
                >
                  {p.is_spectator ? "👁️" : (TEAM_EMOJIS[p.team!] ?? "")} {p.name}
                  {p.id === myPlayerId && " (you)"}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Main board area */}
      <div className={`flex flex-1 ${fullscreen ? "overflow-hidden items-center justify-center" : "overflow-hidden"}`}>
        {/* Board */}
        <div className={`flex flex-col items-center justify-center ${fullscreen ? "" : "flex-1 p-3 overflow-auto"}`}>
          <div
            className="bingo-grid"
            style={fullscreen ? {
              gridTemplateColumns: `repeat(${boardW}, ${tileSize}px)`,
              width: `${boardW * tileSize + (boardW - 1) * 6}px`,
            } : {
              maxWidth: `${Math.min(boardW * 130, 900)}px`,
              gridTemplateColumns: `repeat(${boardW}, 1fr)`,
              width: "100%",
            }}
          >
            {Array.from({ length: totalCells }).map((_, idx) => {
              if (settings.freeSpace && idx === centerIndex) {
                return (
                  <div key="free" className="bingo-cell free-space" style={fullscreen ? { width: tileSize, height: tileSize } : undefined}>
                    <div className="bingo-cell-text">FREE</div>
                  </div>
                );
              }

              const challengeIndex = settings.freeSpace && idx > centerIndex ? idx - 1 : idx;
              const id = challengeIds[challengeIndex];
              if (!id) return <div key={idx} className="bingo-cell free-space" />;

              const ch = challengeMap.get(id);
              if (!ch) return <div key={idx} className="bingo-cell free-space" />;

              const team       = getCellTeam(id);
              const playerName = getCellPlayerName(id);
              const isPending  = pendingClaims.has(id);
              const isVersus   = ch.type === "versus";
              const isActive   = String(activeVersusId) === String(id);
              const isNextUp   = String(nextVersusId) === String(id);
              const isUnavail  = isVersus && !isActive && !isNextUp && !unlockedVersus.has(String(id)) && !isCellClaimed(id);
              const isWinner   = winnerIds.includes(id);
              const hasUnclaimConfirm = unclaimConfirmId === id;

              let cellClass = "bingo-cell";
              if (team) cellClass += ` claimed-${team}`;
              if (isPending) cellClass += " opacity-70";
              if (isActive) cellClass += " active-versus";
              else if (isNextUp) cellClass += " next-up-versus";
              if (isUnavail) cellClass += " unavailable";
              if (isWinner) cellClass += " bingo-winner";
              cellClass += ` type-${ch.type}`;

              return (
                <div
                  key={id}
                  className={cellClass}
                  style={fullscreen ? { width: tileSize, height: tileSize } : undefined}
                  onClick={() => handleCellClick(id)}
                  onContextMenu={(e) => handleCellRightClick(e, id)}
                >
                  {/* Feature 7: Unclaim confirmation popover */}
                  {hasUnclaimConfirm && (
                    <div
                      className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 rounded-[9px] z-10"
                      style={{ background: "rgba(0,0,0,0.82)" }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <p className="text-xs font-bold text-white">Unclaim?</p>
                      <div className="flex gap-2">
                        <button
                          className="text-xs px-2 py-1 rounded-md font-semibold"
                          style={{ background: "rgba(193,18,31,0.8)", color: "white" }}
                          onClick={(e) => { e.stopPropagation(); unclaimLobbyCell(id); }}
                        >
                          Yes
                        </button>
                        <button
                          className="text-xs px-2 py-1 rounded-md font-semibold"
                          style={{ background: "rgba(255,255,255,0.2)", color: "white" }}
                          onClick={(e) => { e.stopPropagation(); setUnclaimConfirmId(null); }}
                        >
                          No
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Versus timer / skip UI */}
                  {isVersus && (isNextUp || isActive) && (
                    <div className="flex flex-col items-center gap-1 w-full">
                      <div
                        className="bingo-cell-timer"
                        onClick={(e) => handleTimerClick(id, e)}
                        title={isActive ? "Host: click to demote" : "Host: click to skip countdown"}
                        style={{ cursor: isHost ? "pointer" : "default" }}
                      >
                        {isActive ? "ACTIVE" : `Next in ${getCountdown()}`}
                      </div>
                      {/* Feature 3: Player vote to skip */}
                      {isNextUp && isLobbyMode && !isHost && !isSpectator && (
                        <button
                          className="text-xs px-2 py-0.5 rounded-full font-semibold"
                          style={{
                            background: skipVotes.includes(myPlayerId ?? "") ? "rgba(255,160,40,0.5)" : "rgba(255,160,40,0.2)",
                            color: "rgb(255,200,60)",
                            border: "1px solid rgba(255,160,40,0.4)",
                          }}
                          onClick={(e) => voteToSkip(e)}
                          title={`Vote to skip countdown (${skipVotes.length}/${skipThreshold} needed)`}
                        >
                          ⚡ Skip {skipVotes.length}/{skipThreshold}
                        </button>
                      )}
                    </div>
                  )}

                  <div className="bingo-cell-icon" style={fullscreen ? { fontSize: `${Math.round(tileSize * 0.18)}px` } : undefined}>
                    {ch.type === "single" ? "👤" : ch.type === "group" ? "👥" : "⚔️"}
                  </div>
                  <div className="bingo-cell-text" style={{ fontSize: cellTextSize(ch.text) }}>{ch.text}</div>
                  <div className="bingo-cell-game" style={fullscreen ? { fontSize: `${Math.round(tileSize * 0.09)}px` } : undefined}>
                    {getGameDisplayName(ch.game)}
                  </div>
                  {/* Feature 8: Claimant name gated on setting */}
                  {playerName && (isLobbyMode ? settings.showClaimantName : true) && (
                    <div className="bingo-cell-claimer">{playerName}</div>
                  )}
                </div>
              );
            })}
          </div>

          <p className="text-xs mt-3" style={{ color: "rgb(var(--text-muted-rgb))" }}>
            {isSpectator
              ? "👁️ Spectating — you cannot claim tiles"
              : isLobbyMode
              ? `Click to claim for ${TEAM_EMOJIS[myTeam!] ?? ""} ${TEAM_LABELS[myTeam!] ?? myTeam} · Right-click / click own tile to unclaim`
              : "Left-click = Blue · Right-click = Red"}
          </p>
        </div>

        {/* Claim log sidebar */}
        {showClaimLog && (
          <div
            className="w-72 flex flex-col border-l border-white/10 p-3 overflow-y-auto"
            style={{ background: "rgba(var(--surface-base-rgb),0.8)" }}
          >
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-bold text-sm">Claim Log</h3>
              <button
                className="text-xs px-2 py-0.5"
                style={{ color: "rgb(var(--text-muted-rgb))" }}
                onClick={() => setShowClaimLog(false)}
              >
                ✕
              </button>
            </div>
            {claimLog.length === 0 ? (
              <p className="text-xs" style={{ color: "rgb(var(--text-muted-rgb))" }}>No claims yet.</p>
            ) : (
              [...claimLog].reverse().map((c, i) => {
                const time = new Date(c.claimed_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
                const text = challengeMap.get(c.challenge_id)?.text ?? c.challenge_id;
                return (
                  <div key={i} className="claim-log-entry">
                    <span className="claim-log-time">{time}</span>
                    <span>
                      {TEAM_EMOJIS[c.team] ?? ""}{" "}
                      <strong>{c.player_name}</strong>: {text}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* Victory overlay */}
      {bingoShown && winnerTeam && (
        <div
          className="fixed inset-0 flex items-center justify-center z-50"
          style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(8px)" }}
        >
          <div className="text-center p-8 rounded-xl flex flex-col items-center gap-4"
            style={{
              background: "rgb(var(--surface-overlay-rgb))",
              border:     "1px solid rgb(var(--border-rgb))",
              borderTop:  "3px solid rgb(var(--color-primary-rgb))",
              boxShadow:  "var(--shadow-elevated)",
            }}
          >
            <div className="text-6xl">{TEAM_EMOJIS[winnerTeam as TeamColor] ?? "🏆"}</div>
            <h1 className="text-6xl font-extrabold bingo-heading">BINGO!</h1>
            <p className="text-xl font-bold">
              {TEAM_LABELS[winnerTeam as TeamColor] ?? winnerTeam} Team wins!
            </p>
            <Button
              variant="primary"
              onClick={() => { setBingoShown(false); bingoShownRef.current = false; setWinnerTeam(null); setWinnerIds([]); }}
            >
              Continue
            </Button>
          </div>
        </div>
      )}

      {/* Reset confirm */}
      {showResetConfirm && (
        <div
          className="fixed inset-0 flex items-center justify-center z-50"
          style={{ background: "rgba(0,0,0,0.7)" }}
        >
          <Panel className="max-w-xs w-full p-6 text-center flex flex-col gap-4">
            <p className="font-bold text-lg">Reset the board?</p>
            <p className="text-sm" style={{ color: "rgb(var(--text-muted-rgb))" }}>
              This will clear all claims. It cannot be undone.
            </p>
            <div className="flex gap-3">
              <Button variant="ghost" fullWidth onClick={() => setShowResetConfirm(false)}>Cancel</Button>
              <Button variant="danger" fullWidth onClick={resetBoard}>Reset</Button>
            </div>
          </Panel>
        </div>
      )}

      {/* Feature 3: Host skip countdown confirmation */}
      {skipConfirmId && (
        <div
          className="fixed inset-0 flex items-center justify-center z-50"
          style={{ background: "rgba(0,0,0,0.7)" }}
        >
          <Panel className="max-w-xs w-full p-6 text-center flex flex-col gap-4">
            <p className="text-2xl">⚔️</p>
            <p className="font-bold text-lg">Skip countdown?</p>
            <p className="text-sm" style={{ color: "rgb(var(--text-muted-rgb))" }}>
              Open this versus challenge immediately.
            </p>
            <div className="flex gap-3">
              <Button variant="ghost" fullWidth onClick={() => setSkipConfirmId(null)}>Cancel</Button>
              <Button variant="primary" fullWidth onClick={() => {
                setSkipConfirmId(null);
                activateNextVersus(challengeIds, challengeMap, true);
              }}>
                Skip
              </Button>
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
}
