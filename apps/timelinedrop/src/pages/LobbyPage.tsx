import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Badge, Button, CopyInviteButton, Input, Modal, Panel, Toggle } from "@gokkehub/ui";
import { useRoom } from "../hooks/useRoom";
import { supabase } from "../lib/supabase";
import { useHeaderControls, DEFAULT_HEADER_CONTROLS } from "../App";
import type { TlPlayer, TlTeam, TlRoomSettings, LateJoinMode, JudgeMode, Difficulty, SongSource, AudioMode, TimerMode, TokenEconomy, TlPlaylistCatalogEntry } from "../lib/types";
import { DEFAULT_TL_SETTINGS } from "../lib/types";

// Discord bot invite URL — hardcoded to the GokkeHub bot's client_id with
// permissions 36700160 (Connect + Speak + Use Voice Activity) and both
// scopes the bot needs (bot + applications.commands for slash commands).
// The URL isn't secret; it just opens Discord's "add this bot to a server"
// flow. Surface it in the Audio panel when discord-bot mode is selected so
// the host doesn't have to hunt for it.
const DISCORD_BOT_INVITE_URL =
  "https://discord.com/oauth2/authorize?client_id=1495063496587481249&permissions=36700160&integration_type=0&scope=bot+applications.commands";

// Map a team to its colour. Explicit team.color (migration 023) wins;
// otherwise fall back to the positional palette by sort_order so legacy
// rooms (color === null) keep their old look.
type TeamColor = "red" | "blue" | "green" | "yellow";
const TEAM_PALETTE: TeamColor[] = ["red", "blue", "green", "yellow"];
function isTeamColor(v: unknown): v is TeamColor {
  return v === "red" || v === "blue" || v === "green" || v === "yellow";
}
function getTeamColor(teamOrSortOrder: { sort_order: number; color?: string | null } | number): TeamColor {
  if (typeof teamOrSortOrder === "number") {
    return TEAM_PALETTE[teamOrSortOrder % TEAM_PALETTE.length];
  }
  const explicit = teamOrSortOrder.color;
  if (isTeamColor(explicit)) return explicit;
  return TEAM_PALETTE[teamOrSortOrder.sort_order % TEAM_PALETTE.length];
}
function getInitial(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase();
}

export default function LobbyPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate   = useNavigate();
  const myPlayerId = roomId ? localStorage.getItem(`tl_player_${roomId}`) ?? undefined : undefined;

  const { state, error } = useRoom(roomId, myPlayerId);

  const [playlistUrl,    setPlaylistUrl]    = useState("");
  const [addingPlaylist, setAddingPlaylist] = useState(false);
  const [playlistError,  setPlaylistError]  = useState<string | null>(null);
  const [playlistMsg,    setPlaylistMsg]    = useState<string | null>(null);
  const [catalogOpen,    setCatalogOpen]    = useState(false);
  const [catalog,        setCatalog]        = useState<TlPlaylistCatalogEntry[] | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError,   setCatalogError]   = useState<string | null>(null);
  const [catalogAddingId,setCatalogAddingId] = useState<number | null>(null);
  const [catalogGenre,   setCatalogGenre]   = useState<string | null>(null);
  const [starting,       setStarting]       = useState(false);
  const [startError,     setStartError]     = useState<string | null>(null);
  // "Advanced settings" collapse on the host's settings panel
  const [advancedOpen,   setAdvancedOpen]   = useState(false);
  // Lobby tabs — host-only toggle between team formation and full
  // settings panel. Default is "teams" so the lobby opens on the
  // join-your-team view; settings live one click away.
  const [lobbyView,      setLobbyView]      = useState<"teams" | "settings">("teams");
  // Action sheet state — tap a player tile to open
  const [selectedPlayer, setSelectedPlayer] = useState<TlPlayer | null>(null);
  // Manual-artists editor state
  const [editingArtists, setEditingArtists] = useState<TlPlayer | null>(null);

  // ── Auto-redirect to game when host starts ───────────────────────────────────
  useEffect(() => {
    if (state?.room.status === "playing") navigate(`/game/${roomId}`);
  }, [state?.room.status, roomId, navigate]);

  // Drive the global header's code chip + invite button.
  //  - hideRoomCode: streamer OR gamemaster (don't pin the code on screen)
  //  - hideInvite:   gamemaster only (streamer can still share the link)
  // Only set once room data has loaded (stateLoaded) so the chip never
  // flashes the code for the frame before settings arrive — the context
  // defaults to hidden. Reset to that default on unmount.
  const { setHeaderControls } = useHeaderControls();
  const stateLoaded     = !!state;
  const streamerMode    = !!state?.room.settings?.streamerMode;
  const gamemasterMode  = !!(state?.room.settings?.gamemasterMode || state?.room.settings?.singleScreenMode);
  useEffect(() => {
    if (!stateLoaded) return;
    setHeaderControls({
      hideRoomCode: streamerMode || gamemasterMode,
      hideInvite:   gamemasterMode,
    });
    return () => setHeaderControls(DEFAULT_HEADER_CONTROLS);
  }, [stateLoaded, streamerMode, gamemasterMode, setHeaderControls]);

  if (error)  return <Centered>Error: {error}</Centered>;
  if (!state) return <Centered>Loading…</Centered>;

  const { room, teams, players } = state;
  const isHost     = state.myPlayer?.is_host ?? false;
  const settings   = { ...DEFAULT_TL_SETTINGS, ...(room.settings ?? {}) };
  const trackCount = room.track_pool?.length ?? 0;
  // Gamemaster mode is also true for legacy singleScreenMode rooms so they
  // still get the host-acts-as-everyone behaviour. Drives which Lobby
  // Settings get hidden — late-join, team-swap, vote judging, multi-client
  // audio modes are all noise when one human is the entire room.
  const gamemastering = !!(settings.gamemasterMode || settings.singleScreenMode);

  const teamSwap = settings.teamSwapEnabled || isHost;

  // True when the room's host has linked Spotify (spotify_id populated at
  // join/create via migration 027). Drives whether Spotify-dependent
  // settings — playlist mode, spotify-taste mode, the in-browser Spotify
  // SDK audio option — show up at all. The host needs Spotify for
  // playback to work in those modes; the API import flow needs their
  // OAuth token too. Without it, exposing the options just leads to
  // mysterious failures at Start time.
  const hostPlayer    = players.find(p => p.is_host);
  const hostHasSpotify = !!hostPlayer?.spotify_id;

  // Auto-correct a stuck Spotify SDK audio mode when host has no Spotify
  // (e.g. host disconnected after room create, or admin-flipped the
  // setting in a way that landed here). Silently re-saves to a viable
  // YouTube mode. Runs only for the host, only when the gate would
  // otherwise leave them in an unplayable state.
  useEffect(() => {
    if (!isHost) return;
    if (hostHasSpotify) return;
    if (settings.audioMode !== "browser") return;
    void saveSettings({ audioMode: gamemastering ? "all-clients-stream" : "all-clients-stream" });
  // saveSettings is stable; we want this to fire on the gate flipping.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost, hostHasSpotify, settings.audioMode, gamemastering]);

  // Visible players (apply hideSpectators when configured)
  const visiblePlayers = players.filter(p => !(settings.hideSpectators && !isHost && p.is_spectator && p.id !== myPlayerId));

  // ── Handlers ────────────────────────────────────────────────────────────────

  async function addPlaylist() {
    if (!playlistUrl.trim()) return;
    setAddingPlaylist(true); setPlaylistError(null); setPlaylistMsg(null);
    try {
      const res = await fetch(`/room/${roomId}/playlist`, {
        method:      "POST",
        headers:     { "Content-Type": "application/json" },
        credentials: "include",
        body:        JSON.stringify({ url: playlistUrl.trim() }),
      });
      // Read as text first so a Cloudflare-edge 5xx HTML page (e.g.
      // "Too many subrequests") doesn't crash res.json() and dump the
      // user into a generic "Network error" message. Try to parse as
      // JSON; fall back to the raw text excerpt so the actual cause
      // surfaces instead of being silently swallowed.
      const raw = await res.text();
      let parsed: { added?: number; total?: number; name?: string; error?: string } = {};
      try { parsed = JSON.parse(raw); } catch { /* not JSON */ }
      if (!res.ok) {
        const detail = parsed.error
          ?? (raw ? `HTTP ${res.status}: ${raw.slice(0, 300)}` : `HTTP ${res.status}`);
        setPlaylistError(detail);
        return;
      }
      setPlaylistMsg(`Added ${parsed.added ?? 0} songs from "${parsed.name ?? "playlist"}" (${parsed.total ?? 0} total)`);
      setPlaylistUrl("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setPlaylistError(`Couldn't reach the server: ${msg}`);
    } finally {
      setAddingPlaylist(false);
    }
  }

  // Lazy-load the catalog on first modal open. Caches in component state
  // so re-opens are instant. No realtime — the catalog is admin-curated
  // and changes infrequently; a hard reload picks up new entries.
  async function openCatalog() {
    setCatalogOpen(true);
    if (catalog !== null) return;
    setCatalogLoading(true); setCatalogError(null);
    try {
      const res = await fetch("/catalog", { credentials: "include" });
      const data = await res.json().catch(() => ({})) as { items?: TlPlaylistCatalogEntry[]; error?: string };
      if (!res.ok) { setCatalogError(data.error ?? `HTTP ${res.status}`); return; }
      setCatalog(data.items ?? []);
    } catch (err) {
      setCatalogError(err instanceof Error ? err.message : String(err));
    } finally {
      setCatalogLoading(false);
    }
  }

  // Add a catalog playlist by building the canonical Spotify URL and
  // calling the same /room/:id/playlist import endpoint the URL-paste
  // path uses. One round-trip; the server already handles dedupe,
  // shuffling, and the playlistImports record.
  async function addCatalogPlaylist(entry: TlPlaylistCatalogEntry) {
    if (!myPlayerId) return;
    setCatalogAddingId(entry.id);
    setPlaylistError(null); setPlaylistMsg(null);
    try {
      const res = await fetch(`/room/${roomId}/catalog-import`, {
        method:      "POST",
        headers:     { "Content-Type": "application/json" },
        credentials: "include",
        body:        JSON.stringify({ player_id: myPlayerId, catalog_id: entry.id }),
      });
      const raw = await res.text();
      let parsed: { added?: number; total?: number; name?: string; matched?: number; attempted?: number; error?: string } = {};
      try { parsed = JSON.parse(raw); } catch { /* not JSON */ }
      if (!res.ok) {
        setPlaylistError(parsed.error ?? `HTTP ${res.status}: ${raw.slice(0, 200)}`);
        return;
      }
      const matchedNote = parsed.matched && parsed.attempted && parsed.matched < parsed.attempted
        ? ` (${parsed.matched} of ${parsed.attempted} matched on Spotify)`
        : "";
      setPlaylistMsg(`Added ${parsed.added ?? 0} songs from "${parsed.name ?? entry.name}"${matchedNote}`);
      setCatalogOpen(false);
    } catch (err) {
      setPlaylistError(err instanceof Error ? err.message : String(err));
    } finally {
      setCatalogAddingId(null);
    }
  }

  async function setCaptain(player: TlPlayer) {
    const wasCapt   = player.is_captain;
    const teammates = players.filter(p => p.team_id === player.team_id);
    for (const p of teammates) {
      if (p.is_captain) await supabase.from("tl_players").update({ is_captain: false }).eq("id", p.id);
    }
    if (!wasCapt) await supabase.from("tl_players").update({ is_captain: true }).eq("id", player.id);
  }

  async function changeTeam(targetId: string, teamId: number | null) {
    if (!myPlayerId) return;
    // player_id = caller (auth: am I host? am I moving myself?);
    // target_id = who's being moved. Pre-fix this endpoint used a single
    // field for both, which silently rejected host-driven swaps because
    // the target's is_host flag failed the gate.
    await fetch(`/room/${roomId}/team`, {
      method:      "POST",
      headers:     { "Content-Type": "application/json" },
      credentials: "include",
      body:        JSON.stringify({ player_id: myPlayerId, target_id: targetId, team_id: teamId }),
    });
  }

  async function kickPlayer(targetId: string) {
    if (!myPlayerId) return;
    await fetch(`/room/${roomId}/kick`, {
      method:      "POST",
      headers:     { "Content-Type": "application/json" },
      credentials: "include",
      body:        JSON.stringify({ player_id: myPlayerId, target_id: targetId }),
    });
  }

  async function renameTeam(teamId: number, name: string) {
    if (!myPlayerId) return;
    await fetch(`/room/${roomId}/rename-team`, {
      method:      "POST",
      headers:     { "Content-Type": "application/json" },
      credentials: "include",
      body:        JSON.stringify({ player_id: myPlayerId, team_id: teamId, name }),
    });
  }

  async function cycleTeamColor(team: TlTeam) {
    if (!myPlayerId) return;
    const current = getTeamColor(team);
    // Skip any colour another team is already using so two teams can't
    // end up the same colour. Server enforces this too — this is the
    // UX-level fast path so the swatch doesn't visibly land on a
    // duplicate and then bounce back.
    const taken = new Set(teams.filter(t => t.id !== team.id).map(t => getTeamColor(t)));
    let idx = TEAM_PALETTE.indexOf(current);
    let next: TeamColor = current;
    for (let step = 0; step < TEAM_PALETTE.length; step++) {
      idx = (idx + 1) % TEAM_PALETTE.length;
      if (!taken.has(TEAM_PALETTE[idx])) { next = TEAM_PALETTE[idx]; break; }
    }
    if (next === current) return;  // every other slot is taken (only with 4 teams + 4 colours)
    await fetch(`/room/${roomId}/team-color`, {
      method:      "POST",
      headers:     { "Content-Type": "application/json" },
      credentials: "include",
      body:        JSON.stringify({ player_id: myPlayerId, team_id: team.id, color: next }),
    });
  }

  async function addPlaceholderMember(teamId: number, name: string) {
    if (!myPlayerId) return;
    await fetch(`/room/${roomId}/add-member`, {
      method:      "POST",
      headers:     { "Content-Type": "application/json" },
      credentials: "include",
      body:        JSON.stringify({ player_id: myPlayerId, team_id: teamId, name }),
    });
  }

  async function removePlaylist(playlistId: string) {
    if (!myPlayerId) return;
    await fetch(`/room/${roomId}/remove-playlist`, {
      method:      "POST",
      headers:     { "Content-Type": "application/json" },
      credentials: "include",
      body:        JSON.stringify({ player_id: myPlayerId, playlist_id: playlistId }),
    });
  }

  async function saveSettings(patch: TlRoomSettings) {
    if (!myPlayerId) return;
    await fetch(`/room/${roomId}/settings`, {
      method:      "POST",
      headers:     { "Content-Type": "application/json" },
      credentials: "include",
      body:        JSON.stringify({ player_id: myPlayerId, settings: patch }),
    });
  }

  // Songs from group taste are now auto-generated when the host clicks Start.
  // (The standalone /curate endpoint still exists for refilling mid-game.)

  async function startGame() {
    setStarting(true); setStartError(null);
    try {
      const res = await fetch(`/room/${roomId}/start`, {
        method:      "POST",
        headers:     { "Content-Type": "application/json" },
        credentials: "include",
        body:        JSON.stringify({ player_id: myPlayerId }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) { setStartError(data.error ?? "Failed to start"); return; }
    } catch {
      setStartError("Network error");
    } finally {
      setStarting(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  // Start-Game panel — extracted so it can be rendered in BOTH the Teams
  // tab (where it's always been) and the Settings tab (so the host
  // doesn't have to switch tabs just to start the game).
  const startPanel = isHost ? (() => {
    const minTracks = Math.max(5, teams.length + 1);
    const isPlaylistMode = settings.songSource === "playlist";
    const tracksTooFew   = isPlaylistMode && trackCount < minTracks;
    return (
      <Panel className="p-4">
        {startError && <p className="text-sm text-red-400 mb-3">⚠️ {startError}</p>}
        <Button
          onClick={startGame}
          loading={starting}
          disabled={tracksTooFew}
          className="w-full"
          size="lg"
        >
          {starting && !isPlaylistMode
            ? "🎵 Generating songs… this can take a few seconds"
            : tracksTooFew
              ? `Add a playlist first (${trackCount}/${minTracks})`
              : "🎮 Start Game"}
        </Button>
        <p className="text-xs mt-2 text-center" style={{ color: "rgb(var(--text-muted-rgb))" }}>
          {isPlaylistMode
            ? `Each team starts with one card; minimum is ${minTracks} tracks`
            : "Songs auto-generate from group taste when you press Start"}
        </p>
      </Panel>
    );
  })() : null;

  return (
    <div className="p-4 max-w-5xl mx-auto w-full flex flex-col gap-4">

      {/* ── Page sub-header (room code lives in the global GameHeader) ──── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h1 className="font-extrabold tracking-tight" style={{ fontSize: "var(--text-xl)", fontFamily: "var(--font-display)" }}>
            Lobby
          </h1>
          {isHost && <Badge variant="host">HOST</Badge>}
          <p className="ml-1" style={{ color: "rgb(var(--text-muted-rgb))", fontSize: "var(--text-sm)" }}>
            {isHost
              ? (lobbyView === "teams" ? "Form teams, then open Settings to configure the game" : "Configure settings, then go back to Teams to start")
              : "Waiting for host to start…"}
          </p>
        </div>
        <div className="flex gap-2 items-center">
          {/* Show the copy/QR control in streamer mode too — the streamer
              still needs to invite friends; only the always-on code chip
              is hidden. Gamemaster mode is solo, so no invite there. */}
          {!gamemastering && roomId && (
            <CopyInviteButton
              url={`https://gokkehub.com/join?room=${encodeURIComponent(roomId)}`}
              size="md"
            />
          )}
          <Button variant="ghost" size="sm" onClick={() => navigate("/")}>Leave</Button>
        </div>
      </div>

      {/* Host-only Teams/Settings tab bar — own row, full-width on mobile
          + tab-style styling so it reads as a primary navigation control
          and not an afterthought next to the Leave button. Players miss
          the previous tiny inline version. */}
      {isHost && (
        <div className="flex w-full rounded-lg p-1"
          style={{
            background: "rgba(var(--surface-raised-rgb),0.5)",
            border:     "1px solid rgba(255,255,255,0.08)",
          }}>
          {(["teams", "settings"] as const).map(v => {
            const active = lobbyView === v;
            return (
              <button
                key={v}
                onClick={() => setLobbyView(v)}
                className="flex-1 px-5 py-2.5 rounded-md text-sm font-bold transition-all"
                style={{
                  background: active ? "rgba(var(--color-primary-rgb),0.22)" : "transparent",
                  color:      active ? "rgb(var(--color-primary-rgb))" : "rgb(var(--text-secondary-rgb))",
                  boxShadow:  active ? "0 1px 3px rgba(0,0,0,0.3)" : "none",
                }}
              >
                {v === "teams" ? "👥 Teams" : "⚙ Game Settings"}
              </button>
            );
          })}
        </div>
      )}

      {/* ── Main grid — layout flips based on host's tab:
              • Teams view (default): single column, players panel full-width.
              • Settings view (host-only): settings panel full-width.
              • Non-host: original 2-column layout (info on left, players right). */}
      <div className={
        !isHost                  ? "grid md:grid-cols-[1fr_340px] gap-4"
        : lobbyView === "teams"  ? "max-w-2xl mx-auto w-full"
        :                          "w-full"
      }>

        {/* Left column — settings (host on settings tab) OR info (non-host) */}
        {(isHost ? lobbyView === "settings" : true) && (
        <div className="flex flex-col gap-4">

          {/* Settings panel */}
          {isHost ? (
            <Panel className="p-5">
              <h2 className="font-bold text-lg mb-4">Game Settings</h2>
              {gamemastering && (
                <div className="mb-4 px-3 py-2 rounded-md flex items-center gap-2 text-sm"
                  style={{
                    background: "rgba(var(--color-primary-rgb),0.10)",
                    border:     "1px solid rgba(var(--color-primary-rgb),0.35)",
                    color:      "rgb(var(--text-secondary-rgb))",
                  }}>
                  <span>🎲</span>
                  <span><strong>Gamemaster mode</strong> — you drive every team, room code is hidden, multi-player options are pruned.</span>
                </div>
              )}
              <div className="flex flex-col gap-4">

                {/* Cards to win — pill row replaces the dropdown */}
                <div>
                  <p className="text-sm font-medium mb-2">Cards to win</p>
                  <div className="flex gap-2 flex-wrap">
                    {[5, 7, 10, 12, 15].map(n => {
                      const active = room.win_target === n;
                      return (
                        <button
                          key={n}
                          onClick={async () => {
                            // Route through the host-only settings endpoint —
                            // a direct supabase update on tl_rooms gets
                            // silently denied by RLS so only the default 10
                            // ever stuck. See plan_lobby_overhaul / playtest
                            // feedback batch 2026-05-23.
                            if (!myPlayerId) return;
                            await fetch(`/room/${roomId}/settings`, {
                              method:      "POST",
                              headers:     { "Content-Type": "application/json" },
                              credentials: "include",
                              body:        JSON.stringify({ player_id: myPlayerId, settings: {}, win_target: n }),
                            });
                          }}
                          className="px-4 py-1.5 rounded-md text-sm font-bold transition-all border"
                          style={{
                            borderColor: active ? "rgba(var(--color-primary-rgb),0.7)" : "rgba(255,255,255,0.12)",
                            background:  active ? "rgba(var(--color-primary-rgb),0.18)" : "transparent",
                            color:       active ? "rgb(var(--color-primary-rgb))" : "inherit",
                            fontFamily:  "var(--font-mono)",
                          }}
                        >
                          {n}
                        </button>
                      );
                    })}
                  </div>
                  {/* How a winner is decided when a team first hits the
                      target. "First to X" ends the game immediately;
                      "Tiebreaker" lets every other team take one more
                      turn — if there's a strict leader after that
                      cycle they win, otherwise another cycle. */}
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {([
                      { value: "first",      label: "🏁 First to target",  hint: "Game ends the moment a team reaches the card count" },
                      { value: "tiebreaker", label: "⚖️ Tiebreaker rounds", hint: "After someone hits target, every other team plays one more turn" },
                    ] as const).map(({ value, label, hint }) => {
                      const active = (settings.winMode ?? "first") === value;
                      return (
                        <button
                          key={value}
                          onClick={() => saveSettings({ winMode: value })}
                          title={hint}
                          className="text-left rounded-lg p-3 transition-all border"
                          style={{
                            borderColor: active ? "rgba(var(--color-primary-rgb),0.7)" : "rgba(255,255,255,0.12)",
                            background:  active ? "rgba(var(--color-primary-rgb),0.15)" : "transparent",
                          }}
                        >
                          <p className="text-sm font-semibold">{label}</p>
                          <p className="text-xs mt-0.5" style={{ color: "rgb(var(--text-muted-rgb))" }}>{hint}</p>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Judging mode — vote-all and next-team-captain are pruned
                    in gamemaster mode since they assume multiple humans. */}
                <div>
                  <p className="text-sm font-medium mb-2">Who decides if the guess was right?</p>
                  <div className="grid grid-cols-2 gap-2">
                    {([
                      { value: "team-captain",      label: "👑 Own team",      hint: "Active team's captain self-judges" },
                      { value: "next-team-captain", label: "🎯 Next team",      hint: "Captain of the team after this one" },
                      { value: "host",              label: "⚖️ Host",          hint: "The host always decides" },
                      { value: "vote-all",          label: "🗳️ Everyone votes", hint: "Timer-bounded vote from all players" },
                    ] as const)
                      .filter(o => !(gamemastering && (o.value === "vote-all" || o.value === "next-team-captain")))
                      .map(({ value, label, hint }) => {
                      const active = settings.judgeMode === value;
                      return (
                        <button
                          key={value}
                          onClick={() => saveSettings({ judgeMode: value as JudgeMode })}
                          title={hint}
                          className="text-left rounded-lg p-3 transition-all border"
                          style={{
                            borderColor: active ? "rgba(var(--color-primary-rgb),0.7)" : "rgba(255,255,255,0.12)",
                            background:  active ? "rgba(var(--color-primary-rgb),0.15)" : "transparent",
                          }}
                        >
                          <p className="text-sm font-semibold">{label}</p>
                          <p className="text-xs mt-0.5" style={{ color: "rgb(var(--text-muted-rgb))" }}>{hint}</p>
                        </button>
                      );
                    })}
                  </div>
                  {settings.judgeMode === "vote-all" && (
                    <div className="flex items-center gap-3 mt-3">
                      <label className="text-sm" style={{ color: "rgb(var(--text-secondary-rgb))" }}>
                        Voting time:
                      </label>
                      <input
                        type="number"
                        min={5} max={120}
                        value={settings.voteTimerSeconds}
                        onChange={e => {
                          const n = Math.max(5, Math.min(120, Number(e.target.value) || 20));
                          saveSettings({ voteTimerSeconds: n });
                        }}
                        className="w-20 rounded-lg px-3 py-1.5 text-sm"
                        style={{
                          background: "rgba(var(--surface-raised-rgb),0.5)",
                          border:     "1px solid rgba(255,255,255,0.1)",
                          color:      "inherit",
                          fontFamily: "var(--font-mono)",
                        }}
                      />
                      <span className="text-sm" style={{ color: "rgb(var(--text-muted-rgb))" }}>seconds</span>
                    </div>
                  )}
                </div>

                {/* Turn timer */}
                <div>
                  <p className="text-sm font-medium mb-2">Turn timer</p>
                  <div className="grid grid-cols-3 gap-2">
                    {([
                      { value: "song-length", label: "🎵 Song length",  hint: "Turn ends when the song does" },
                      { value: "fixed",       label: "⏱ Fixed",         hint: "Set your own seconds" },
                      { value: "none",        label: "♾ No timer",      hint: "Captain plays at their pace" },
                    ] as const).map(({ value, label, hint }) => {
                      const active = (settings.timerMode ?? "song-length") === value;
                      return (
                        <button
                          key={value}
                          onClick={() => saveSettings({ timerMode: value as TimerMode })}
                          title={hint}
                          className="text-left rounded-lg p-3 transition-all border"
                          style={{
                            borderColor: active ? "rgba(var(--color-primary-rgb),0.7)" : "rgba(255,255,255,0.12)",
                            background:  active ? "rgba(var(--color-primary-rgb),0.15)" : "transparent",
                          }}
                        >
                          <p className="text-sm font-semibold">{label}</p>
                          <p className="text-xs mt-0.5" style={{ color: "rgb(var(--text-muted-rgb))" }}>{hint}</p>
                        </button>
                      );
                    })}
                  </div>
                  {(settings.timerMode ?? "song-length") === "fixed" && (
                    <div className="flex items-center gap-3 mt-3">
                      <label className="text-sm" style={{ color: "rgb(var(--text-secondary-rgb))" }}>
                        Seconds per turn:
                      </label>
                      <input
                        type="number"
                        min={10} max={600}
                        value={settings.timerSeconds ?? 120}
                        onChange={e => {
                          const n = Math.max(10, Math.min(600, Number(e.target.value) || 120));
                          saveSettings({ timerSeconds: n });
                        }}
                        className="w-24 rounded-lg px-3 py-1.5 text-sm"
                        style={{
                          background: "rgba(var(--surface-raised-rgb),0.5)",
                          border:     "1px solid rgba(255,255,255,0.1)",
                          color:      "inherit",
                          fontFamily: "var(--font-mono)",
                        }}
                      />
                      <span className="text-sm" style={{ color: "rgb(var(--text-muted-rgb))" }}>seconds</span>
                    </div>
                  )}
                </div>

                {/* Token economy — three modes (see TlRoomSettings) */}
                <div>
                  <p className="text-sm font-medium mb-2">How do teams get tokens?</p>
                  <div className="grid grid-cols-3 gap-2">
                    {([
                      { value: "standard", label: "📜 Standard",   hint: "Both guesses correct → 1 Skip token" },
                      { value: "bonus",    label: "🎁 Bonus",      hint: "Both correct → 1 random token" },
                      { value: "shop",     label: "🏪 Shop",       hint: "Each correct = +1 point, buy tokens" },
                    ] as const).map(({ value, label, hint }) => {
                      const active = (settings.tokenEconomy ?? "bonus") === value;
                      return (
                        <button
                          key={value}
                          onClick={() => saveSettings({ tokenEconomy: value as TokenEconomy })}
                          title={hint}
                          className="text-left rounded-lg p-3 transition-all border"
                          style={{
                            borderColor: active ? "rgba(var(--color-primary-rgb),0.7)" : "rgba(255,255,255,0.12)",
                            background:  active ? "rgba(var(--color-primary-rgb),0.15)" : "transparent",
                          }}
                        >
                          <p className="text-sm font-semibold">{label}</p>
                          <p className="text-xs mt-0.5" style={{ color: "rgb(var(--text-muted-rgb))" }}>{hint}</p>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Advanced settings — collapsed by default. Most rooms never
                    touch these. Difficulty + skipRecentlyHeard moved into the
                    Songs panel since they only apply to group-taste mode. */}
                <div>
                  <button
                    onClick={() => setAdvancedOpen(o => !o)}
                    className="text-sm font-semibold flex items-center gap-2"
                    style={{ color: "rgb(var(--text-secondary-rgb))" }}
                  >
                    <span style={{ display: "inline-block", transition: "transform 120ms ease", transform: advancedOpen ? "rotate(90deg)" : "none" }}>▸</span>
                    Advanced settings
                  </button>

                  {advancedOpen && (
                    <div className="mt-3 flex flex-col gap-4 pt-3"
                      style={{ borderTop: "1px dashed rgb(var(--border-rgb))" }}
                    >
                      {/* Late join — hidden in gamemaster mode (one human = no one to "join late"). */}
                      {!gamemastering && (
                        <div>
                          <p className="text-sm font-medium mb-2">Late join</p>
                          <Toggle
                            options={[
                              { value: "open",            label: "Open" },
                              { value: "spectator-only",  label: "Spectators only" },
                              { value: "closed",          label: "Closed" },
                            ]}
                            value={settings.lateJoinMode}
                            onChange={v => saveSettings({ lateJoinMode: v as LateJoinMode })}
                          />
                        </div>
                      )}

                      {/* Pill toggles. Team-swap is gamemaster-irrelevant
                          (one player drives everyone). singleScreenMode is
                          superseded by the Gamemaster role at Create-Room
                          time; legacy rooms keep working via back-compat in
                          actsAsCaptain. */}
                      <div className="flex flex-wrap gap-2">
                        {([
                          { key: "streamerMode",     on: "📡 Streamer mode ON",  off: "📡 Streamer mode OFF", show: true },
                          { key: "hideSpectators",   on: "👁️ Spectators hidden", off: "👁️ Show spectators",   show: !gamemastering },
                          { key: "teamSwapEnabled",  on: "🔄 Team swap ON",      off: "🔄 Team swap OFF",     show: !gamemastering },
                        ] as const).filter(t => t.show).map(({ key, on, off }) => {
                          const val = !!settings[key];
                          return (
                            <button
                              key={key}
                              onClick={() => saveSettings({ [key]: !val } as TlRoomSettings)}
                              className="text-sm font-semibold px-3 py-2 rounded-md border transition-all"
                              style={{
                                borderColor: val ? "rgba(var(--color-primary-rgb),0.7)" : "rgba(255,255,255,0.12)",
                                background:  val ? "rgba(var(--color-primary-rgb),0.15)" : "transparent",
                              }}
                            >
                              {val ? on : off}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </Panel>
          ) : (
            <Panel className="p-5">
              <h2 className="font-bold text-lg mb-3">Game Settings</h2>
              <div className="text-sm flex flex-col gap-1.5" style={{ color: "rgb(var(--text-muted-rgb))" }}>
                <p>Cards to win: <strong style={{ color: "rgb(var(--text-secondary-rgb))" }}>{room.win_target}</strong></p>
                <p>Late join: <strong style={{ color: "rgb(var(--text-secondary-rgb))" }}>{settings.lateJoinMode}</strong></p>
                <p>Team swap: <strong style={{ color: "rgb(var(--text-secondary-rgb))" }}>{settings.teamSwapEnabled ? "on" : "off"}</strong></p>
                <p>Judging: <strong style={{ color: "rgb(var(--text-secondary-rgb))" }}>{settings.judgeMode.replace(/-/g, " ")}</strong></p>
              </div>
            </Panel>
          )}

          {/* Songs — single source-of-truth toggle. Group taste auto-generates
              when the host clicks Start; Playlist mode requires the host to
              paste a Spotify URL up front. */}
          {isHost && (
            <Panel className="p-5">
              <h2 className="font-bold text-lg mb-3">Songs</h2>

              {/* Source toggle. Spotify options drop off when the host
                  hasn't linked Spotify on their profile — the import +
                  playback paths both need their OAuth token. The lobby
                  surfaces a small hint below the toggle when this kicks
                  in so the host knows why options vanished. */}
              <Toggle
                options={hostHasSpotify ? [
                  { value: "group-taste",   label: "🎧 Last.fm taste" },
                  { value: "spotify-taste", label: "🎵 Spotify taste" },
                  { value: "playlist",      label: "📚 Playlist" },
                ] : [
                  { value: "group-taste",   label: "🎧 Last.fm taste" },
                  { value: "playlist",      label: "📚 Playlist" },
                ]}
                value={settings.songSource}
                onChange={v => saveSettings({ songSource: v as SongSource })}
              />

              {/* Group taste branch */}
              {settings.songSource === "group-taste" && (
                <div className="mt-4 flex flex-col gap-4">
                  {(() => {
                    const activePlayers = visiblePlayers.filter(p => !p.is_spectator);
                    if (activePlayers.length === 0) return null;
                    const linked = activePlayers.filter(p => !!p.lastfm_username || (p.manual_artists?.length ?? 0) > 0);
                    const allLinked = linked.length === activePlayers.length;
                    return (
                      <div className="px-3 py-2 rounded-md flex items-center gap-2"
                        style={{
                          background: allLinked ? "rgba(34,197,94,0.10)" : "rgba(255,255,255,0.04)",
                          border:     `1px solid ${allLinked ? "rgba(34,197,94,0.35)" : "rgba(255,255,255,0.08)"}`,
                        }}>
                        <span className="text-base">🎧</span>
                        <p className="text-xs flex-1" style={{ color: allLinked ? "rgba(34,197,94,0.85)" : "rgb(var(--text-muted-rgb))" }}>
                          <strong>{linked.length} of {activePlayers.length}</strong> players have Last.fm connected
                          {!allLinked && <span> · songs come from those who have</span>}
                        </p>
                      </div>
                    );
                  })()}
                  <div>
                    <p className="text-sm font-medium mb-2">Difficulty</p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {([
                        { value: "easy",    label: "🟢 Easy",    hint: "Songs everyone knows" },
                        { value: "medium",  label: "🟡 Medium",  hint: "Mix of known + similar" },
                        { value: "hard",    label: "🟠 Hard",    hint: "Rare picks from your taste" },
                        { value: "hardest", label: "🔴 Hardest", hint: "Genre-matched unknowns" },
                      ] as const).map(({ value, label, hint }) => {
                        const active = settings.difficulty === value;
                        return (
                          <button
                            key={value}
                            onClick={() => saveSettings({ difficulty: value as Difficulty })}
                            title={hint}
                            className="text-left rounded-md p-2.5 transition-all border"
                            style={{
                              borderColor: active ? "rgba(var(--color-primary-rgb),0.7)" : "rgba(255,255,255,0.12)",
                              background:  active ? "rgba(var(--color-primary-rgb),0.15)" : "transparent",
                            }}
                          >
                            <p className="text-sm font-semibold">{label}</p>
                            <p className="text-[10px] mt-0.5" style={{ color: "rgb(var(--text-muted-rgb))" }}>{hint}</p>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <button
                    onClick={() => saveSettings({ skipRecentlyHeard: !settings.skipRecentlyHeard })}
                    className="text-sm font-semibold px-3 py-2 rounded-md border transition-all self-start"
                    style={{
                      borderColor: settings.skipRecentlyHeard ? "rgba(var(--color-primary-rgb),0.7)" : "rgba(255,255,255,0.12)",
                      background:  settings.skipRecentlyHeard ? "rgba(var(--color-primary-rgb),0.15)" : "transparent",
                    }}
                  >
                    🆕 {settings.skipRecentlyHeard ? "Skip recently heard ON" : "Skip recently heard OFF"}
                  </button>

                  <p className="text-xs px-3 py-2 rounded-md"
                    style={{
                      background: "rgba(var(--color-primary-rgb),0.08)",
                      border:     "1px solid rgba(var(--color-primary-rgb),0.25)",
                      color:      "rgb(var(--text-secondary-rgb))",
                    }}>
                    🎵 Songs auto-generate when you press Start. Each player's Last.fm + the
                    difficulty above shape the playlist. The host needs Spotify connected on
                    their{" "}
                    <a href="https://account.gokkehub.com/profile" target="_blank" rel="noreferrer" className="underline">
                      profile
                    </a> for playback.
                  </p>
                </div>
              )}

              {/* Spotify taste branch — each player's own Spotify /me/top
                  feeds the candidate pool. Last.fm artist.getSimilar is
                  still used for the adjacency leap (medium/hard
                  difficulty), but no per-player Last.fm account is needed.
                  Players just have to be Spotify-authed at join time. */}
              {settings.songSource === "spotify-taste" && (
                <div className="mt-4 flex flex-col gap-4">
                  {(() => {
                    const activePlayers = visiblePlayers.filter(p => !p.is_spectator);
                    if (activePlayers.length === 0) return null;
                    const linked = activePlayers.filter(p => !!p.spotify_id);
                    const allLinked = linked.length === activePlayers.length;
                    return (
                      <div className="px-3 py-2 rounded-md flex items-center gap-2"
                        style={{
                          background: allLinked ? "rgba(34,197,94,0.10)" : "rgba(255,255,255,0.04)",
                          border:     `1px solid ${allLinked ? "rgba(34,197,94,0.35)" : "rgba(255,255,255,0.08)"}`,
                        }}>
                        <span className="text-base">🎵</span>
                        <p className="text-xs flex-1" style={{ color: allLinked ? "rgba(34,197,94,0.85)" : "rgb(var(--text-muted-rgb))" }}>
                          <strong>{linked.length} of {activePlayers.length}</strong> players have Spotify connected
                          {!allLinked && <span> · songs come from those who have</span>}
                        </p>
                      </div>
                    );
                  })()}
                  <div>
                    <p className="text-sm font-medium mb-2">Difficulty</p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {([
                        { value: "easy",    label: "🟢 Easy",    hint: "Songs everyone knows" },
                        { value: "medium",  label: "🟡 Medium",  hint: "Mix of known + similar" },
                        { value: "hard",    label: "🟠 Hard",    hint: "Rare picks from your taste" },
                        { value: "hardest", label: "🔴 Hardest", hint: "Genre-matched unknowns" },
                      ] as const).map(({ value, label, hint }) => {
                        const active = settings.difficulty === value;
                        return (
                          <button
                            key={value}
                            onClick={() => saveSettings({ difficulty: value as Difficulty })}
                            title={hint}
                            className="text-left rounded-md p-2.5 transition-all border"
                            style={{
                              borderColor: active ? "rgba(var(--color-primary-rgb),0.7)" : "rgba(255,255,255,0.12)",
                              background:  active ? "rgba(var(--color-primary-rgb),0.15)" : "transparent",
                            }}
                          >
                            <p className="text-sm font-semibold">{label}</p>
                            <p className="text-[10px] mt-0.5" style={{ color: "rgb(var(--text-muted-rgb))" }}>{hint}</p>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <button
                    onClick={() => saveSettings({ skipRecentlyHeard: !settings.skipRecentlyHeard })}
                    className="text-sm font-semibold px-3 py-2 rounded-md border transition-all self-start"
                    style={{
                      borderColor: settings.skipRecentlyHeard ? "rgba(var(--color-primary-rgb),0.7)" : "rgba(255,255,255,0.12)",
                      background:  settings.skipRecentlyHeard ? "rgba(var(--color-primary-rgb),0.15)" : "transparent",
                    }}
                  >
                    🆕 {settings.skipRecentlyHeard ? "Skip recently heard ON" : "Skip recently heard OFF"}
                  </button>
                  <p className="text-xs px-3 py-2 rounded-md"
                    style={{
                      background: "rgba(var(--color-primary-rgb),0.08)",
                      border:     "1px solid rgba(var(--color-primary-rgb),0.25)",
                      color:      "rgb(var(--text-secondary-rgb))",
                    }}>
                    🎵 Each player's Spotify top tracks feed the pool; Last.fm fills in
                    similar artists for the harder difficulties. Players need to be
                    Spotify-authed when they join (link Spotify on your{" "}
                    <a href="https://account.gokkehub.com/profile" target="_blank" rel="noreferrer" className="underline">
                      profile
                    </a>). No Last.fm account needed.
                  </p>
                </div>
              )}

              {/* Playlist branch — Spotify only. YouTube playlist import is
                  temporarily disabled (see YOUTUBE_PLAYLIST_ENABLED in
                  functions/room/[id]/playlist.ts); supporting code is
                  left in place so re-enabling is a single flag flip + UI
                  label change. */}
              {settings.songSource === "playlist" && (
                <div className="mt-4 flex flex-col gap-3">
                  {/* Primary CTA — browse the curated catalog. URL paste is
                      the secondary path for hosts who already have a
                      specific playlist in mind. */}
                  <button
                    onClick={openCatalog}
                    className="w-full text-left rounded-lg px-4 py-3 transition-all border"
                    style={{
                      borderColor: "rgba(var(--color-primary-rgb),0.5)",
                      background:  "rgba(var(--color-primary-rgb),0.10)",
                      color:       "rgb(var(--color-primary-rgb))",
                    }}
                  >
                    <p className="font-bold">📚 Browse catalog</p>
                    <p className="text-xs opacity-70 mt-0.5">Curated playlists, tagged by genre + difficulty</p>
                  </button>

                  {/* URL paste path needs Spotify (the source URL is itself
                      a Spotify playlist). Hide silently when host has no
                      Spotify — catalog above works without it. */}
                  {hostHasSpotify && (
                    <div>
                      <p className="text-sm font-medium mb-2">Or paste a Spotify playlist URL</p>
                      <div className="flex gap-2">
                        <Input
                          value={playlistUrl}
                          onChange={e => setPlaylistUrl(e.target.value)}
                          placeholder="https://open.spotify.com/playlist/…"
                          className="flex-1"
                          onKeyDown={e => e.key === "Enter" && addPlaylist()}
                        />
                        <Button onClick={addPlaylist} loading={addingPlaylist} size="sm" variant="ghost">Add</Button>
                      </div>
                    </div>
                  )}

                  {playlistError && <p className="text-sm text-red-400">{playlistError}</p>}
                  {playlistMsg   && <p className="text-sm text-green-400">{playlistMsg}</p>}

                  {/* Help note — Spotify rejects the playlist API when the
                      caller doesn't own the playlist (or it's not public &
                      owned by the requester's app). Cheapest fix is to
                      duplicate the playlist into the host's own account. */}
                  <div className="text-xs px-3 py-2 rounded-md leading-relaxed"
                    style={{
                      background: "rgba(var(--color-primary-rgb),0.06)",
                      border:     "1px solid rgba(var(--color-primary-rgb),0.20)",
                      color:      "rgb(var(--text-secondary-rgb))",
                    }}>
                    💡 The playlist must be created by <strong>you</strong>, or copied to your own playlist:
                    <div className="mt-1 opacity-80">
                      Spotify → select playlist → <code style={{ fontFamily: "var(--font-mono)" }}>…</code> → Add to other playlist → + New playlist → copy that playlist's URL.
                    </div>
                  </div>

                  <p className="text-xs">
                    <strong style={{ color: "rgb(var(--text-secondary-rgb))" }}>{trackCount}</strong>{" "}
                    <span style={{ color: "rgb(var(--text-muted-rgb))" }}>
                      song{trackCount === 1 ? "" : "s"} loaded. Add more playlists to mix them in.
                    </span>
                  </p>

                  {/* Loaded playlists — host can ✕ a whole imported playlist
                      (removes every track that came from it). Only meaningful
                      before the game starts. Empty when no imports recorded
                      yet (e.g. older rooms before playlistImports landed). */}
                  {(settings.playlistImports?.length ?? 0) > 0 && room.status === "lobby" && (
                    <div className="flex flex-col gap-1.5">
                      <p className="text-xs uppercase tracking-wider opacity-60">Loaded playlists</p>
                      {(settings.playlistImports ?? []).map(p => (
                        <div key={p.id} className="flex items-center gap-2 text-xs px-3 py-2 rounded-md"
                          style={{
                            background: "rgba(255,255,255,0.03)",
                            border:     "1px solid rgba(255,255,255,0.08)",
                          }}>
                          <span className="flex-1 truncate font-semibold" title={p.name}>{p.name}</span>
                          <span className="opacity-50 font-mono flex-shrink-0">
                            {p.track_ids.length} song{p.track_ids.length === 1 ? "" : "s"}
                          </span>
                          <button
                            onClick={() => removePlaylist(p.id)}
                            className="px-2 py-0.5 rounded text-[11px] flex-shrink-0 opacity-70 hover:opacity-100"
                            style={{
                              background: "rgba(220,60,60,0.15)",
                              border:     "1px solid rgba(220,60,60,0.35)",
                              color:      "rgb(220,140,140)",
                            }}
                            title="Remove this whole playlist from the room"
                          >
                            ✕ Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </Panel>
          )}

          {/* Audio source. Renamed in v0.3 to be clearer to players:
              "Browser" → "Spotify (Local audio)"  (only viable if host has Spotify connected)
              "All clients" → "YouTube (Shared audio)"  (each player streams locally via the bot proxy)
              "Discord bot" stays as-is.

              In gamemaster mode the Discord-bot option is hidden — there's
              no second human to share a voice channel with. Spotify and
              YouTube both still make sense for one person on one device. */}
          {isHost && (
            <Panel className="p-5">
              <h2 className="font-bold text-lg mb-3">Audio</h2>
              <Toggle
                options={([
                  { value: "browser",            label: "🎵 Spotify (Local audio)" },
                  { value: "discord-bot",        label: "🤖 Discord bot" },
                  { value: "all-clients-stream", label: "🎧 YouTube (Shared audio)" },
                ] as const).filter(o => {
                  // Discord-bot hidden in gamemaster (no second human).
                  if (gamemastering && o.value === "discord-bot") return false;
                  // Spotify SDK playback needs the host to be Spotify-
                  // linked; otherwise the SDK init silently fails for
                  // every player.
                  if (!hostHasSpotify && o.value === "browser") return false;
                  return true;
                })}
                value={settings.audioMode}
                onChange={v => saveSettings({ audioMode: v as AudioMode })}
              />
              {settings.audioMode === "browser" && (
                <p className="text-xs mt-3 px-3 py-2 rounded-md"
                  style={{
                    background: "rgba(var(--color-primary-rgb),0.08)",
                    border:     "1px solid rgba(var(--color-primary-rgb),0.25)",
                    color:      "rgb(var(--text-secondary-rgb))",
                  }}>
                  🎵 Your browser plays each song via the Spotify Web Playback SDK (your{" "}
                  <a href="https://account.gokkehub.com/profile" target="_blank" rel="noreferrer" className="underline">
                    Spotify account
                  </a> must be connected). Share your tab audio in Discord — or play together
                  in person — so the other players hear the same thing.
                </p>
              )}
              {settings.audioMode === "all-clients-stream" && (
                <div className="mt-3 flex flex-col gap-3">
                  <p className="text-xs px-3 py-2 rounded-md"
                    style={{
                      background: "rgba(var(--color-primary-rgb),0.08)",
                      border:     "1px solid rgba(var(--color-primary-rgb),0.25)",
                      color:      "rgb(var(--text-secondary-rgb))",
                    }}>
                    🎧 Every player's browser streams the song directly from YouTube via the
                    shared musix-bot proxy. Each player controls their own volume and can pause
                    locally — no host coordination needed.
                  </p>
                </div>
              )}
              {settings.audioMode === "discord-bot" && (
                <div className="mt-3 flex flex-col gap-3">
                  <p className="text-xs px-3 py-2 rounded-md"
                    style={{
                      background: "rgba(var(--color-secondary-rgb),0.10)",
                      border:     "1px solid rgba(var(--color-secondary-rgb),0.30)",
                      color:      "rgb(var(--text-secondary-rgb))",
                    }}>
                    🤖 A Discord bot will play the songs directly into your voice channel.
                    Spotify is used for song selection; audio is streamed via YouTube.
                  </p>
                  <ol className="text-xs space-y-2 pl-4 list-decimal"
                    style={{ color: "rgb(var(--text-secondary-rgb))" }}>
                    <li>
                      <a
                        href={DISCORD_BOT_INVITE_URL}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md font-semibold transition-colors hover:opacity-90"
                        style={{
                          background: "rgba(88, 101, 242, 0.18)",
                          border:     "1px solid rgba(88, 101, 242, 0.55)",
                          color:      "#8b9bff",
                          fontSize:   "var(--text-xs)",
                        }}
                      >
                        Invite GokkeHub bot to your server →
                      </a>
                      <span className="opacity-70 ml-1.5">(one-time per server)</span>
                    </li>
                    <li>Join the voice channel you want to play in.</li>
                    <li>
                      Run{" "}
                      <code className="px-1.5 py-0.5 rounded"
                        style={{ background: "rgba(255,255,255,0.08)", fontFamily: "var(--font-mono)" }}>
                        /musix join {roomId}
                      </code>{" "}
                      — the bot joins and waits for the game to start.
                    </li>
                  </ol>
                </div>
              )}
            </Panel>
          )}
          {/* Start panel mirrored from the Teams tab so the host can launch
              the game without flipping tabs. startPanel is null for
              non-hosts (no-op render). */}
          {startPanel}
        </div>
        )}

        {/* Right: Players + Start — hidden when host is on the Settings tab */}
        {(isHost ? lobbyView === "teams" : true) && (
        <div className="flex flex-col gap-4">
          {/* Music-coverage status moved into Settings → Songs → Group taste,
              where it's actually actionable (no point telling players how
              many are linked when the songs are coming from a playlist). */}

          {/* Team panels — one per team. Host can click-to-rename in any
              mode; "+ Add member" appears only in gamemaster mode where
              the placeholder players are purely for visual reference. */}
          <div className="flex flex-col gap-3">
            {teams.map(team => {
              const teamPlayers = visiblePlayers.filter(p => p.team_id === team.id && !p.is_spectator);
              return (
                <TeamPanel
                  key={team.id}
                  team={team}
                  color={getTeamColor(team)}
                  players={teamPlayers}
                  myPlayerId={myPlayerId}
                  isHost={isHost}
                  onTileClick={(p) => setSelectedPlayer(p)}
                  onRename={isHost ? (name) => renameTeam(team.id, name) : undefined}
                  onAddMember={isHost && gamemastering ? (name) => addPlaceholderMember(team.id, name) : undefined}
                  onCycleColor={isHost ? () => cycleTeamColor(team) : undefined}
                />
              );
            })}
          </div>

          {/* Spectator panel */}
          {(() => {
            const spectators = visiblePlayers.filter(p => p.is_spectator);
            if (spectators.length === 0) return null;
            return (
              <SpectatorPanel
                players={spectators}
                myPlayerId={myPlayerId}
                isHost={isHost}
                onTileClick={(p) => setSelectedPlayer(p)}
              />
            );
          })()}

          {/* Start panel — also rendered in the Settings tab via startPanel const */}
          {startPanel}
        </div>
        )}
      </div>

      {/* Player action sheet — opened by tapping any tile */}
      {selectedPlayer && (
        <PlayerActionSheet
          player={selectedPlayer}
          teams={teams}
          isHost={isHost}
          isMe={selectedPlayer.id === myPlayerId}
          teamSwap={teamSwap}
          hostId={room.host_id}
          onClose={() => setSelectedPlayer(null)}
          onChangeTeam={async (teamId) => {
            await changeTeam(selectedPlayer.id, teamId);
            setSelectedPlayer(null);
          }}
          onToggleSpectator={async () => {
            await changeTeam(selectedPlayer.id, null);
            setSelectedPlayer(null);
          }}
          onSetCaptain={async () => {
            await setCaptain(selectedPlayer);
            setSelectedPlayer(null);
          }}
          onKick={async () => {
            await kickPlayer(selectedPlayer.id);
            setSelectedPlayer(null);
          }}
          onEditMusic={() => {
            setEditingArtists(selectedPlayer);
            setSelectedPlayer(null);
          }}
        />
      )}

      {/* Manual artists editor modal */}
      {editingArtists && (
        <ManualArtistsModal
          player={editingArtists}
          onClose={() => setEditingArtists(null)}
          onSave={async (list) => {
            await supabase.from("tl_players").update({ manual_artists: list }).eq("id", editingArtists.id);
            setEditingArtists(null);
          }}
        />
      )}

      {/* Playlist catalog browser — lazy-loaded on first open. Filter
          chips by genre tag, grid of cards. Click a card → adds via the
          existing /room/:id/playlist endpoint and closes the modal.
          Per-player effective difficulty deferred to a follow-up; the
          baseline + the proposed-difficulty hint cover the v1 use case. */}
      {catalogOpen && (
        <Modal open onClose={() => setCatalogOpen(false)} maxWidth="720px">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="font-extrabold"
              style={{ fontFamily: "var(--font-display)", fontSize: "var(--text-2xl)" }}>
              📚 Playlist catalog
            </h2>
            {catalog && (
              <span className="text-xs opacity-60">{catalog.length} playlists</span>
            )}
          </div>

          {catalogLoading && <p className="text-sm opacity-60">Loading catalog…</p>}
          {catalogError   && <p className="text-sm text-red-400">{catalogError}</p>}

          {catalog && catalog.length > 0 && (() => {
            const allGenres = Array.from(new Set(catalog.flatMap(c => c.genre_tags))).sort();
            const visible   = catalogGenre
              ? catalog.filter(c => c.genre_tags.includes(catalogGenre))
              : catalog;
            return (
              <>
                <div className="flex flex-wrap gap-1.5 mb-4">
                  <button
                    onClick={() => setCatalogGenre(null)}
                    className="text-xs px-2.5 py-1 rounded-full"
                    style={{
                      background: catalogGenre === null ? "rgba(var(--color-primary-rgb),0.22)" : "rgba(255,255,255,0.04)",
                      border:     `1px solid rgba(var(--color-primary-rgb),${catalogGenre === null ? 0.5 : 0.15})`,
                      color:      "rgb(var(--color-primary-rgb))",
                      fontWeight: catalogGenre === null ? 700 : 400,
                    }}
                  >
                    All ({catalog.length})
                  </button>
                  {allGenres.map(g => {
                    const count = catalog.filter(c => c.genre_tags.includes(g)).length;
                    const active = catalogGenre === g;
                    return (
                      <button
                        key={g}
                        onClick={() => setCatalogGenre(active ? null : g)}
                        className="text-xs px-2.5 py-1 rounded-full"
                        style={{
                          background: active ? "rgba(var(--color-primary-rgb),0.22)" : "rgba(255,255,255,0.04)",
                          border:     `1px solid rgba(var(--color-primary-rgb),${active ? 0.5 : 0.15})`,
                          color:      "rgb(var(--color-primary-rgb))",
                          fontWeight: active ? 700 : 400,
                        }}
                      >
                        {g} ({count})
                      </button>
                    );
                  })}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[55vh] overflow-y-auto scrollbar-themed pr-1">
                  {visible.map(entry => {
                    const adding = catalogAddingId === entry.id;
                    return (
                      <div key={entry.id} className="rounded-lg p-3 border"
                        style={{
                          borderColor: "rgba(var(--color-primary-rgb),0.25)",
                          background:  "rgba(var(--surface-raised-rgb),0.5)",
                        }}>
                        <div className="flex items-baseline justify-between gap-2 mb-1">
                          <p className="font-bold text-sm truncate" title={entry.name}>{entry.name}</p>
                          <span className="text-[10px] uppercase tracking-wider opacity-50 flex-shrink-0">
                            {entry.owner_name}
                          </span>
                        </div>
                        <p className="text-xs opacity-60 mb-2 line-clamp-2">{entry.description}</p>
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 flex-wrap text-[10px]">
                            <span style={{ color: "rgb(var(--color-primary-rgb))" }} title="Baseline difficulty">
                              {"⭐".repeat(entry.baseline_difficulty)}
                            </span>
                            {entry.track_list && (
                              <span className="opacity-60" title="Songs in the curated list">
                                · {entry.track_list.length} tracks
                              </span>
                            )}
                            {entry.genre_tags.slice(0, 3).map(t => (
                              <span key={t} className="px-1.5 py-0.5 rounded-full opacity-70"
                                style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}>
                                {t}
                              </span>
                            ))}
                          </div>
                          <button
                            onClick={() => addCatalogPlaylist(entry)}
                            disabled={adding}
                            className="text-xs font-bold px-2.5 py-1 rounded disabled:opacity-50 flex-shrink-0"
                            style={{
                              background: "rgba(var(--color-primary-rgb),0.18)",
                              color:      "rgb(var(--color-primary-rgb))",
                              border:     "1px solid rgba(var(--color-primary-rgb),0.4)",
                            }}
                          >
                            {adding ? "Adding…" : "+ Add"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            );
          })()}

          <button
            onClick={() => setCatalogOpen(false)}
            className="mt-4 w-full text-center"
            style={{ fontSize: "var(--text-sm)", color: "rgb(var(--text-muted-rgb))" }}
          >
            Close
          </button>
        </Modal>
      )}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex-1 flex items-center justify-center opacity-50">{children}</div>;
}

// ── Team panel: a coloured card holding all of a team's players as tiles ────

interface TeamPanelProps {
  team:        TlTeam;
  color:       TeamColor;
  players:     TlPlayer[];
  myPlayerId:  string | undefined;
  isHost:      boolean;
  onTileClick: (p: TlPlayer) => void;
  /** Host-only inline rename. Receives the new (trimmed) name. */
  onRename?:    (name: string) => Promise<void>;
  /** When provided, the host can add a placeholder player to this team
   *  from the panel (used in gamemaster mode so the lobby shows the
   *  actual teammates' names even though only the gamemaster's device
   *  is connected). */
  onAddMember?: (name: string) => Promise<void>;
  /** Host-only colour cycle. Clicking the swatch advances through the
   *  4-colour palette and persists via /room/:id/team-color. */
  onCycleColor?: () => Promise<void>;
}

function TeamPanel({ team, color, players, myPlayerId, isHost, onTileClick, onRename, onAddMember, onCycleColor }: TeamPanelProps) {
  const isEmpty = players.length === 0;
  const captain = players.find(p => p.is_captain);

  // Inline rename state — host clicks the heading to enter edit mode;
  // Enter or blur commits, Escape cancels. Kept entirely local so the
  // input is uncontrolled in terms of the team prop until the server
  // round-trip completes.
  const [editingName, setEditingName] = useState(false);
  const [draftName,   setDraftName]   = useState(team.name);
  const [savingName,  setSavingName]  = useState(false);
  async function commitRename() {
    const next = draftName.trim().slice(0, 30);
    if (!next || next === team.name) { setEditingName(false); setDraftName(team.name); return; }
    setSavingName(true);
    try { await onRename?.(next); } finally { setSavingName(false); setEditingName(false); }
  }

  // Add-member state — small input row appended after the player tile
  // grid when onAddMember is wired in. Empty submission no-ops.
  const [adding,      setAdding]      = useState(false);
  const [memberName,  setMemberName]  = useState("");
  const [addingMember, setAddingMember] = useState(false);
  async function commitAdd() {
    const trimmed = memberName.trim().slice(0, 30);
    if (!trimmed) { setAdding(false); setMemberName(""); return; }
    setAddingMember(true);
    try { await onAddMember?.(trimmed); } finally {
      setAddingMember(false);
      setMemberName("");
      setAdding(false);
    }
  }

  // Reset local draft if the team is renamed externally (realtime echo).
  useEffect(() => {
    if (!editingName) setDraftName(team.name);
  }, [team.name, editingName]);

  return (
    <Panel
      className="p-4"
      style={{
        borderTop:  `3px solid rgb(var(--team-${color}-rgb))`,
        background: "rgb(var(--surface-raised-rgb))",
      }}
    >
      <div className="flex items-center gap-2 mb-3">
        {onCycleColor ? (
          <button
            type="button"
            onClick={() => { void onCycleColor(); }}
            className="w-4 h-4 rounded-full flex-shrink-0 transition-transform active:scale-90"
            style={{
              background: `rgb(var(--team-${color}-rgb))`,
              boxShadow:  "0 0 0 1px rgba(255,255,255,0.18)",
            }}
            title="Click to cycle through team colours"
            aria-label="Cycle team colour"
          />
        ) : (
          <span
            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
            style={{ background: `rgb(var(--team-${color}-rgb))` }}
          />
        )}
        {editingName && onRename ? (
          <input
            autoFocus
            value={draftName}
            disabled={savingName}
            onChange={e => setDraftName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={e => {
              if (e.key === "Enter") { void commitRename(); }
              else if (e.key === "Escape") { setEditingName(false); setDraftName(team.name); }
            }}
            maxLength={30}
            className="font-bold text-sm flex-1 min-w-0 px-2 py-0.5 rounded outline-none"
            style={{
              background: "rgba(var(--surface-input-rgb), 0.7)",
              border:     `1px solid rgba(var(--team-${color}-rgb), 0.5)`,
              color:      "inherit",
            }}
          />
        ) : (
          <h3
            className={"font-bold text-sm flex-1 truncate" + (onRename && isHost ? " cursor-text hover:opacity-80" : "")}
            onClick={() => { if (onRename && isHost) setEditingName(true); }}
            title={onRename && isHost ? "Click to rename" : undefined}
          >
            {team.name}
          </h3>
        )}
        <span className="text-xs font-bold" style={{ color: "rgb(var(--text-muted-rgb))" }}>
          {players.length}
        </span>
        {isEmpty && (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
            style={{ background: "rgba(220,160,0,0.18)", color: "rgb(220,160,0)" }}>
            EMPTY
          </span>
        )}
        {!captain && !isEmpty && (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
            style={{ background: "rgba(220,160,0,0.18)", color: "rgb(220,160,0)" }}>
            NO CAPTAIN
          </span>
        )}
      </div>

      {isEmpty && !onAddMember ? (
        <div
          className="rounded-lg flex items-center justify-center py-5 text-xs"
          style={{
            border: `1px dashed rgba(var(--team-${color}-rgb), 0.4)`,
            color:  "rgb(var(--text-muted-rgb))",
          }}
        >
          No players yet
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {players.map(p => (
            <PlayerTile
              key={p.id}
              player={p}
              color={color}
              isMe={p.id === myPlayerId}
              clickable={isHost || (p.id === myPlayerId)}
              onClick={() => onTileClick(p)}
            />
          ))}
          {onAddMember && (
            adding ? (
              <div className="flex items-center gap-1 px-2 py-1.5 rounded-lg col-span-2 sm:col-span-1"
                style={{ border: `1px dashed rgba(var(--team-${color}-rgb), 0.5)` }}>
                <input
                  autoFocus
                  value={memberName}
                  disabled={addingMember}
                  onChange={e => setMemberName(e.target.value)}
                  onBlur={() => { if (!memberName.trim()) setAdding(false); else void commitAdd(); }}
                  onKeyDown={e => {
                    if (e.key === "Enter") { void commitAdd(); }
                    else if (e.key === "Escape") { setAdding(false); setMemberName(""); }
                  }}
                  placeholder="Name"
                  maxLength={30}
                  className="flex-1 min-w-0 text-xs px-1.5 py-0.5 rounded outline-none bg-transparent"
                  style={{ color: "inherit" }}
                />
              </div>
            ) : (
              <button
                onClick={() => setAdding(true)}
                className="flex items-center justify-center gap-1 py-1.5 rounded-lg text-xs font-semibold transition-colors col-span-2 sm:col-span-1"
                style={{
                  border:     `1px dashed rgba(var(--team-${color}-rgb), 0.4)`,
                  color:      `rgba(var(--team-${color}-rgb), 0.85)`,
                  background: "transparent",
                }}
                title="Add a teammate's name for visual reference"
              >
                + Add member
              </button>
            )
          )}
        </div>
      )}
    </Panel>
  );
}

// ── Spectator panel: muted styling, smaller tiles ──────────────────────────

interface SpectatorPanelProps {
  players:     TlPlayer[];
  myPlayerId:  string | undefined;
  isHost:      boolean;
  onTileClick: (p: TlPlayer) => void;
}

function SpectatorPanel({ players, myPlayerId, isHost, onTileClick }: SpectatorPanelProps) {
  return (
    <Panel
      className="p-4"
      style={{
        borderTop:  "3px solid rgb(var(--team-spectator-rgb))",
        background: "rgb(var(--surface-raised-rgb))",
      }}
    >
      <div className="flex items-center gap-2 mb-3">
        <span className="text-base">👁️</span>
        <h3 className="font-bold text-sm flex-1">Spectators</h3>
        <span className="text-xs font-bold" style={{ color: "rgb(var(--text-muted-rgb))" }}>
          {players.length}
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {players.map(p => (
          <PlayerTile
            key={p.id}
            player={p}
            color="spectator"
            isMe={p.id === myPlayerId}
            clickable={isHost || p.id === myPlayerId}
            onClick={() => onTileClick(p)}
          />
        ))}
      </div>
    </Panel>
  );
}

// ── Single player tile: avatar + name + crown for captain + music indicator ─

interface PlayerTileProps {
  player:    TlPlayer;
  color:     TeamColor | "spectator";
  isMe:      boolean;
  clickable: boolean;
  onClick:   () => void;
}

function PlayerTile({ player, color, isMe, clickable, onClick }: PlayerTileProps) {
  const linked   = !!player.lastfm_username;
  const hasManual = (player.manual_artists?.length ?? 0) > 0;
  const hasMusic  = linked || hasManual;
  const colorVar  = `--team-${color}-rgb`;

  return (
    <button
      type="button"
      onClick={clickable ? onClick : undefined}
      disabled={!clickable}
      className="relative flex flex-col items-center gap-1.5 p-3 rounded-lg transition-all text-center disabled:cursor-default"
      style={{
        background: `rgba(var(${colorVar}), 0.12)`,
        border:     `1px solid rgba(var(${colorVar}), 0.35)`,
        cursor:     clickable ? "pointer" : "default",
      }}
      title={clickable ? `Tap to manage ${player.name}` : player.name}
    >
      {/* Captain crown */}
      {player.is_captain && !player.is_spectator && (
        <span
          className="absolute -top-1.5 -right-1.5 w-6 h-6 flex items-center justify-center rounded-full text-xs"
          style={{
            background: "linear-gradient(135deg, #facc15, #b45309)",
            boxShadow:  "0 0 10px rgba(250,204,21,0.55)",
          }}
          title="Captain"
        >
          👑
        </span>
      )}

      {/* Avatar = initial in colored chip */}
      <span
        className="w-10 h-10 rounded-full flex items-center justify-center text-base font-extrabold"
        style={{
          background: `rgba(var(${colorVar}), 0.55)`,
          color:      "#fff",
          textShadow: "0 1px 2px rgba(0,0,0,0.4)",
          border:     `2px solid rgba(var(${colorVar}), 0.85)`,
        }}
      >
        {getInitial(player.name)}
      </span>

      {/* Name */}
      <span className="text-xs font-semibold truncate max-w-full">
        {player.name}
        {isMe && <span className="ml-1 opacity-50 font-normal">(you)</span>}
      </span>

      {/* Footer line: host badge + music dot */}
      <div className="flex items-center gap-1.5">
        {player.is_host && (
          <span className="text-[9px] font-bold px-1.5 rounded-full uppercase tracking-wider"
            style={{
              background: "rgb(var(--color-primary-rgb))",
              color:      "rgb(var(--bg-rgb))",
            }}>
            Host
          </span>
        )}
        {!player.is_spectator && (
          <span
            className="text-[10px]"
            style={{ color: hasMusic ? "rgba(34,197,94,0.95)" : "rgb(220,160,0)" }}
            title={
              linked     ? `Last.fm: ${player.lastfm_username}` :
              hasManual  ? `Manual: ${player.manual_artists.join(", ")}` :
                           "No music linked"
            }
          >
            🎵 {linked ? "Last.fm" : hasManual ? "Manual" : "—"}
          </span>
        )}
      </div>
    </button>
  );
}

// ── Player action sheet: opens when host or self taps a tile ────────────────

interface PlayerActionSheetProps {
  player:            TlPlayer;
  teams:             TlTeam[];
  isHost:            boolean;
  isMe:              boolean;
  teamSwap:          boolean;
  hostId:            string;
  onClose:           () => void;
  onChangeTeam:      (teamId: number) => void;
  onToggleSpectator: () => void;
  onSetCaptain:      () => void;
  onKick:            () => void;
  onEditMusic:       () => void;
}

function PlayerActionSheet({
  player, teams, isHost, isMe, teamSwap, hostId,
  onClose, onChangeTeam, onToggleSpectator, onSetCaptain, onKick, onEditMusic,
}: PlayerActionSheetProps) {
  const canSwap        = isHost || (isMe && teamSwap);
  const canChangeTeam  = canSwap && !player.is_spectator;
  const canMakeSpec    = canSwap && !player.is_spectator;
  const canRejoinTeam  = canSwap && player.is_spectator;
  const canSetCaptain  = isHost && !player.is_spectator;
  const canKick        = isHost && !isMe && player.id !== hostId;
  const canEditMusic   = isMe && !player.is_spectator;

  const otherTeams = teams.filter(t => t.id !== player.team_id);

  return (
    <Modal open={true} onClose={onClose} maxWidth="380px">
      <div className="flex flex-col gap-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          <span
            className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-extrabold"
            style={{
              background: "rgba(var(--color-primary-rgb), 0.5)",
              color:      "#fff",
              border:     "2px solid rgba(var(--color-primary-rgb), 0.85)",
            }}
          >
            {getInitial(player.name)}
          </span>
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-base truncate">{player.name}{isMe && <span className="ml-1 opacity-50 font-normal text-sm">(you)</span>}</h3>
            <p className="text-xs" style={{ color: "rgb(var(--text-muted-rgb))" }}>
              {player.is_spectator
                ? "👁️ Spectator"
                : player.is_captain ? "👑 Captain" : "Player"}
            </p>
          </div>
        </div>

        {/* Move to team */}
        {canChangeTeam && otherTeams.length > 0 && (
          <div>
            <p className="text-xs font-medium mb-2" style={{ color: "rgb(var(--text-secondary-rgb))" }}>
              Move to team
            </p>
            <div className="flex flex-wrap gap-2">
              {otherTeams.map(t => {
                const c = getTeamColor(t);
                return (
                  <button
                    key={t.id}
                    onClick={() => onChangeTeam(t.id)}
                    className="text-sm font-semibold px-3 py-1.5 rounded-lg border transition-all"
                    style={{
                      borderColor: `rgba(var(--team-${c}-rgb), 0.7)`,
                      background:  `rgba(var(--team-${c}-rgb), 0.18)`,
                    }}
                  >
                    <span className="inline-block w-2 h-2 rounded-full mr-1.5"
                      style={{ background: `rgb(var(--team-${c}-rgb))` }} />
                    {t.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Rejoin a team (when currently spectator) */}
        {canRejoinTeam && (
          <div>
            <p className="text-xs font-medium mb-2" style={{ color: "rgb(var(--text-secondary-rgb))" }}>
              Join a team
            </p>
            <div className="flex flex-wrap gap-2">
              {teams.map(t => {
                const c = getTeamColor(t);
                return (
                  <button
                    key={t.id}
                    onClick={() => onChangeTeam(t.id)}
                    className="text-sm font-semibold px-3 py-1.5 rounded-lg border transition-all"
                    style={{
                      borderColor: `rgba(var(--team-${c}-rgb), 0.7)`,
                      background:  `rgba(var(--team-${c}-rgb), 0.18)`,
                    }}
                  >
                    {t.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Captain toggle */}
        {canSetCaptain && (
          <button
            onClick={onSetCaptain}
            className="text-sm font-semibold px-3 py-2 rounded-lg border transition-all"
            style={{
              borderColor: player.is_captain
                ? "rgba(250,204,21,0.6)"
                : "rgba(255,255,255,0.12)",
              background: player.is_captain
                ? "rgba(250,204,21,0.12)"
                : "transparent",
              color: player.is_captain ? "rgb(250,204,21)" : "inherit",
            }}
          >
            {player.is_captain ? "👑 Remove captain" : "👑 Make captain"}
          </button>
        )}

        {/* Make spectator */}
        {canMakeSpec && (
          <button
            onClick={onToggleSpectator}
            className="text-sm font-semibold px-3 py-2 rounded-lg border transition-all"
            style={{
              borderColor: "rgba(var(--team-spectator-rgb), 0.5)",
              background:  "rgba(var(--team-spectator-rgb), 0.12)",
              color:       "rgb(var(--text-secondary-rgb))",
            }}
          >
            👁️ Make spectator
          </button>
        )}

        {/* Edit music source (self only) */}
        {canEditMusic && (
          <button
            onClick={onEditMusic}
            className="text-sm font-semibold px-3 py-2 rounded-lg border transition-all"
            style={{
              borderColor: "rgba(var(--color-primary-rgb), 0.4)",
              background:  "rgba(var(--color-primary-rgb), 0.12)",
              color:       "rgb(var(--color-primary-rgb))",
            }}
          >
            🎵 Edit music source
          </button>
        )}

        {/* Kick */}
        {canKick && (
          <button
            onClick={onKick}
            className="text-sm font-semibold px-3 py-2 rounded-lg border transition-all"
            style={{
              borderColor: "rgba(220,38,38,0.4)",
              background:  "rgba(220,38,38,0.08)",
              color:       "rgb(248,113,113)",
            }}
          >
            Kick from room
          </button>
        )}

        <button
          onClick={onClose}
          className="text-xs mt-1"
          style={{ color: "rgb(var(--text-muted-rgb))" }}
        >
          Cancel
        </button>
      </div>
    </Modal>
  );
}

// ── Manual artists modal ───────────────────────────────────────────────────

interface ManualArtistsModalProps {
  player:  TlPlayer;
  onClose: () => void;
  onSave:  (list: string[]) => Promise<void>;
}

function ManualArtistsModal({ player, onClose, onSave }: ManualArtistsModalProps) {
  const [draft, setDraft] = useState((player.manual_artists ?? []).join(", "));
  const [saving, setSaving] = useState(false);
  const linked = !!player.lastfm_username;

  async function handleSave() {
    const list = draft.split(",").map(s => s.trim()).filter(Boolean).slice(0, 5);
    setSaving(true);
    try { await onSave(list); }
    finally { setSaving(false); }
  }

  return (
    <Modal open={true} onClose={onClose} maxWidth="420px">
      <div className="flex flex-col gap-4">
        <h3 className="font-bold text-lg">🎵 Your music source</h3>

        {linked ? (
          <div className="rounded-lg p-3 text-sm"
            style={{ background: "rgba(34,197,94,0.10)", border: "1px solid rgba(34,197,94,0.35)" }}>
            <p style={{ color: "rgba(34,197,94,0.95)" }}>
              Connected to Last.fm as <strong>{player.lastfm_username}</strong>
            </p>
            <p className="text-xs mt-1" style={{ color: "rgb(var(--text-muted-rgb))" }}>
              Songs will be picked from your scrobbled listening history.
            </p>
          </div>
        ) : (
          <div className="rounded-lg p-3 text-sm"
            style={{ background: "rgba(220,160,0,0.10)", border: "1px solid rgba(220,160,0,0.35)" }}>
            <p style={{ color: "rgb(220,160,0)" }}>
              No Last.fm linked.{" "}
              <a href="https://account.gokkehub.com/profile" target="_blank" rel="noreferrer" className="underline">
                Connect on your profile
              </a>{" "}
              for the best results, or list your favourite artists below.
            </p>
          </div>
        )}

        <div>
          <label className="text-sm font-medium mb-2 block"
            style={{ color: "rgb(var(--text-secondary-rgb))" }}>
            Favourite artists (3-5, comma-separated)
          </label>
          <input
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSave()}
            placeholder="e.g. Drake, Taylor Swift, The Weeknd"
            className="w-full rounded-lg px-3 py-2 text-sm outline-none"
            style={{
              background: "rgba(var(--surface-raised-rgb),0.5)",
              border:     "1px solid rgba(255,255,255,0.1)",
              color:      "inherit",
            }}
          />
          <p className="text-xs mt-1" style={{ color: "rgb(var(--text-muted-rgb))" }}>
            Each artist counts as ~100 scrobbles when picking songs.
          </p>
        </div>

        <div className="flex gap-2 mt-1">
          <Button onClick={handleSave} loading={saving} className="flex-1">Save</Button>
          <Button onClick={onClose} variant="ghost" className="flex-1">Cancel</Button>
        </div>
      </div>
    </Modal>
  );
}

