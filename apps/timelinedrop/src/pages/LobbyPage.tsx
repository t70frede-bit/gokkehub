import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Badge, Button, Input, Modal, Panel, Toggle } from "@gokkehub/ui";
import { useRoom } from "../hooks/useRoom";
import { supabase } from "../lib/supabase";
import type { TlPlayer, TlTeam, TlRoomSettings, LateJoinMode, JudgeMode, Difficulty, PlaylistMode } from "../lib/types";
import { DEFAULT_TL_SETTINGS } from "../lib/types";

// Map a team's sort_order (0-3) to a colour token from the design system.
type TeamColor = "red" | "blue" | "green" | "yellow";
const TEAM_PALETTE: TeamColor[] = ["red", "blue", "green", "yellow"];
function getTeamColor(sortOrder: number): TeamColor {
  return TEAM_PALETTE[sortOrder % TEAM_PALETTE.length];
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
  const [generating,     setGenerating]     = useState(false);
  const [starting,       setStarting]       = useState(false);
  const [startError,     setStartError]     = useState<string | null>(null);
  const [copied,         setCopied]         = useState(false);
  // Action sheet state — tap a player tile to open
  const [selectedPlayer, setSelectedPlayer] = useState<TlPlayer | null>(null);
  // Manual-artists editor state
  const [editingArtists, setEditingArtists] = useState<TlPlayer | null>(null);

  // ── Auto-redirect to game when host starts ───────────────────────────────────
  useEffect(() => {
    if (state?.room.status === "playing") navigate(`/game/${roomId}`);
  }, [state?.room.status, roomId, navigate]);

  if (error)  return <Centered>Error: {error}</Centered>;
  if (!state) return <Centered>Loading…</Centered>;

  const { room, teams, players } = state;
  const isHost     = state.myPlayer?.is_host ?? false;
  const settings   = { ...DEFAULT_TL_SETTINGS, ...(room.settings ?? {}) };
  const trackCount = room.track_pool?.length ?? 0;

  const teamSwap = settings.teamSwapEnabled || isHost;

  // Visible players (apply hideSpectators when configured)
  const visiblePlayers = players.filter(p => !(settings.hideSpectators && !isHost && p.is_spectator && p.id !== myPlayerId));

  // ── Handlers ────────────────────────────────────────────────────────────────

  async function copyInviteLink() {
    const baseUrl = `${window.location.origin}/join?room=${roomId}`;
    await navigator.clipboard.writeText(baseUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

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
      const data = await res.json() as { added: number; total: number; name: string; error?: string };
      if (!res.ok) { setPlaylistError(data.error ?? "Failed to add playlist"); return; }
      setPlaylistMsg(`Added ${data.added} songs from "${data.name}" (${data.total} total)`);
      setPlaylistUrl("");
    } catch {
      setPlaylistError("Network error — check your connection and try again");
    } finally {
      setAddingPlaylist(false);
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
    await fetch(`/room/${roomId}/team`, {
      method:      "POST",
      headers:     { "Content-Type": "application/json" },
      credentials: "include",
      body:        JSON.stringify({ player_id: targetId, team_id: teamId }),
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

  async function saveSettings(patch: TlRoomSettings) {
    if (!myPlayerId) return;
    await fetch(`/room/${roomId}/settings`, {
      method:      "POST",
      headers:     { "Content-Type": "application/json" },
      credentials: "include",
      body:        JSON.stringify({ player_id: myPlayerId, settings: patch }),
    });
  }

  async function generateBatch() {
    if (!myPlayerId) return;
    setGenerating(true); setPlaylistError(null); setPlaylistMsg(null);
    try {
      const res = await fetch(`/room/${roomId}/curate?action=generate-batch`, {
        method:      "POST",
        headers:     { "Content-Type": "application/json" },
        credentials: "include",
        body:        JSON.stringify({ player_id: myPlayerId }),
      });
      const data = await res.json() as { added: number; total: number; warning?: string; error?: string };
      if (!res.ok) { setPlaylistError(data.error ?? "Could not generate"); return; }
      setPlaylistMsg(
        `Generated ${data.added} songs (${data.total} total)${data.warning ? ` — ${data.warning}` : ""}`,
      );
    } catch {
      setPlaylistError("Network error");
    } finally {
      setGenerating(false);
    }
  }

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

  return (
    <div className="p-4 max-w-5xl mx-auto w-full flex flex-col gap-4">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-extrabold text-2xl tracking-tight">
              {settings.streamerMode ? "Lobby" : (
                <>
                  Lobby{" "}
                  <span style={{
                    background: "linear-gradient(135deg, rgb(var(--color-primary-rgb)), rgb(var(--color-secondary-rgb)))",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                    backgroundClip: "text",
                    fontFamily: "var(--font-mono)",
                  }}>
                    {roomId}
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
          <Button variant="ghost" size="sm" onClick={copyInviteLink}>
            {copied ? "✓ Copied" : (settings.streamerMode ? "🔗 Copy invite link" : "📋 Copy link")}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => navigate("/")}>Leave</Button>
        </div>
      </div>

      {/* ── Main 2-column grid ───────────────────────────────────────────── */}
      <div className="grid md:grid-cols-[1fr_340px] gap-4">

        {/* Left: Settings + Playlists */}
        <div className="flex flex-col gap-4">

          {/* Settings panel */}
          {isHost ? (
            <Panel className="p-5">
              <h2 className="font-bold text-lg mb-4">Game Settings</h2>
              <div className="flex flex-col gap-4">

                {/* Cards to win */}
                <div className="flex items-center gap-3">
                  <label className="text-sm font-medium" style={{ color: "rgb(var(--text-secondary-rgb))" }}>
                    Cards to win:
                  </label>
                  <select
                    value={room.win_target}
                    onChange={async (e) => {
                      const v = Number(e.target.value);
                      await supabase.from("tl_rooms").update({ win_target: v }).eq("id", roomId);
                    }}
                    className="rounded-lg px-3 py-1.5 text-sm"
                    style={{
                      background: "rgba(var(--surface-raised-rgb),0.5)",
                      border:     "1px solid rgba(255,255,255,0.1)",
                      color:      "inherit",
                    }}>
                    {[5, 7, 10, 12, 15].map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>

                {/* Late join */}
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

                {/* Judging mode */}
                <div>
                  <p className="text-sm font-medium mb-2">Who decides if the guess was right?</p>
                  <div className="grid grid-cols-2 gap-2">
                    {([
                      { value: "team-captain",      label: "👑 Own team",      hint: "Active team's captain self-judges" },
                      { value: "next-team-captain", label: "🎯 Next team",      hint: "Captain of the team after this one" },
                      { value: "host",              label: "⚖️ Host",          hint: "The host always decides" },
                      { value: "vote-all",          label: "🗳️ Everyone votes", hint: "Timer-bounded vote from all players" },
                    ] as const).map(({ value, label, hint }) => {
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

                {/* Difficulty (curation engine) */}
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
                          className="text-left rounded-lg p-2.5 transition-all border"
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

                {/* Playlist mode */}
                <div>
                  <p className="text-sm font-medium mb-2">Playlist source</p>
                  <Toggle
                    options={[
                      { value: "as-is",        label: "Use as-is" },
                      { value: "inspiration",  label: "Inspire" },
                      { value: "smart-filter", label: "Smart filter" },
                    ]}
                    value={settings.playlistMode}
                    onChange={v => saveSettings({ playlistMode: v as PlaylistMode })}
                  />
                  <p className="text-[11px] mt-1" style={{ color: "rgb(var(--text-muted-rgb))" }}>
                    {settings.playlistMode === "as-is" && "Play the host's playlist verbatim."}
                    {settings.playlistMode === "inspiration" && "Use the playlist's vibe; pick songs the group knows."}
                    {settings.playlistMode === "smart-filter" && "Filter the playlist by difficulty + group taste."}
                  </p>
                </div>

                {/* Pill toggles */}
                <div className="flex flex-wrap gap-2">
                  {([
                    { key: "streamerMode",      on: "📡 Streamer mode ON",      off: "📡 Streamer mode OFF" },
                    { key: "hideSpectators",    on: "👁️ Spectators hidden",     off: "👁️ Show spectators" },
                    { key: "teamSwapEnabled",   on: "🔄 Team swap ON",          off: "🔄 Team swap OFF" },
                    { key: "skipRecentlyHeard", on: "🆕 Skip recently heard ON", off: "🆕 Skip recently heard OFF" },
                  ] as const).map(({ key, on, off }) => {
                    const val = !!settings[key];
                    return (
                      <button
                        key={key}
                        onClick={() => saveSettings({ [key]: !val } as TlRoomSettings)}
                        className="text-sm font-semibold px-3 py-2 rounded-lg border transition-all"
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

          {/* Songs (curation engine + optional playlist) */}
          {isHost && (
            <Panel className="p-5">
              <h2 className="font-bold text-lg mb-1">Songs</h2>
              <p className="text-xs mb-3" style={{ color: "rgb(var(--text-muted-rgb))" }}>
                {trackCount > 0
                  ? `${trackCount} songs loaded. Generate more or add another playlist.`
                  : "Pick songs based on your group's listening data, or paste a Spotify playlist link."}
              </p>

              {/* Generate from group taste (Last.fm) */}
              <Button
                onClick={generateBatch}
                loading={generating}
                className="w-full mb-3"
              >
                🎵 Generate {trackCount > 0 ? "more" : "30 songs"} from group taste
              </Button>

              {/* Playlist URL fallback */}
              <div className="flex gap-2">
                <Input
                  value={playlistUrl}
                  onChange={e => setPlaylistUrl(e.target.value)}
                  placeholder="…or paste a Spotify playlist URL"
                  className="flex-1"
                  onKeyDown={e => e.key === "Enter" && addPlaylist()}
                />
                <Button onClick={addPlaylist} loading={addingPlaylist} size="sm" variant="ghost">Add</Button>
              </div>

              {playlistError && <p className="text-sm text-red-400 mt-2">{playlistError}</p>}
              {playlistMsg   && <p className="text-sm text-green-400 mt-2">{playlistMsg}</p>}
              <p className="text-xs mt-3" style={{ color: "rgb(var(--text-muted-rgb))" }}>
                Generation uses each player's Last.fm + the difficulty above. Spotify must be connected on your{" "}
                <a href="https://account.gokkehub.com/profile" target="_blank" rel="noreferrer" className="underline">
                  profile
                </a> for playback.
              </p>
            </Panel>
          )}
        </div>

        {/* Right: Players + Start */}
        <div className="flex flex-col gap-4">
          {/* Music coverage status */}
          {(() => {
            const activePlayers = visiblePlayers.filter(p => !p.is_spectator);
            const linked = activePlayers.filter(p => !!p.lastfm_username || (p.manual_artists?.length ?? 0) > 0);
            if (activePlayers.length === 0) return null;
            const allLinked = linked.length === activePlayers.length;
            return (
              <Panel className="p-3 flex items-center gap-2">
                <span className="text-base">🎵</span>
                <p className="text-xs flex-1" style={{ color: allLinked ? "rgba(34,197,94,0.85)" : "rgb(var(--text-muted-rgb))" }}>
                  <strong>{linked.length} of {activePlayers.length}</strong> players have music linked
                  {!allLinked && <span> · songs are picked from those who have</span>}
                </p>
              </Panel>
            );
          })()}

          {/* Team panels — one per team */}
          <div className="flex flex-col gap-3">
            {teams.map(team => {
              const teamPlayers = visiblePlayers.filter(p => p.team_id === team.id && !p.is_spectator);
              return (
                <TeamPanel
                  key={team.id}
                  team={team}
                  color={getTeamColor(team.sort_order)}
                  players={teamPlayers}
                  myPlayerId={myPlayerId}
                  isHost={isHost}
                  onTileClick={(p) => setSelectedPlayer(p)}
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

          {/* Start */}
          {isHost && (() => {
            const minTracks = Math.max(5, teams.length + 1);
            return (
              <Panel className="p-4">
                {startError && <p className="text-sm text-red-400 mb-3">⚠️ {startError}</p>}
                <Button
                  onClick={startGame}
                  loading={starting}
                  disabled={trackCount < minTracks}
                  className="w-full"
                  size="lg"
                >
                  {trackCount < minTracks
                    ? `Add songs first (${trackCount}/${minTracks})`
                    : "🎮 Start Game"}
                </Button>
                <p className="text-xs mt-2 text-center" style={{ color: "rgb(var(--text-muted-rgb))" }}>
                  Each team starts with one card; minimum is teams + 1
                </p>
              </Panel>
            );
          })()}
        </div>
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
}

function TeamPanel({ team, color, players, myPlayerId, isHost, onTileClick }: TeamPanelProps) {
  const isEmpty = players.length === 0;
  const captain = players.find(p => p.is_captain);
  return (
    <Panel
      className="p-4"
      style={{
        borderTop:    `3px solid rgba(var(--team-${color}-rgb), 0.85)`,
        background:   `linear-gradient(180deg, rgba(var(--team-${color}-rgb), 0.06) 0%, transparent 60%)`,
      }}
    >
      <div className="flex items-center gap-2 mb-3">
        <span
          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
          style={{ background: `rgb(var(--team-${color}-rgb))` }}
        />
        <h3 className="font-bold text-sm flex-1 truncate">{team.name}</h3>
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

      {isEmpty ? (
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
        borderTop:  "3px solid rgba(var(--team-spectator-rgb), 0.6)",
        background: "linear-gradient(180deg, rgba(var(--team-spectator-rgb), 0.06) 0%, transparent 60%)",
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
              background: "linear-gradient(135deg, rgb(var(--color-primary-rgb)), rgb(var(--color-secondary-rgb)))",
              color:      "#fff",
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
                const c = getTeamColor(t.sort_order);
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
                const c = getTeamColor(t.sort_order);
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

