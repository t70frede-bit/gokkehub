import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Badge, Button, Input, Panel, Toggle } from "@gokkehub/ui";
import { useRoom } from "../hooks/useRoom";
import { supabase } from "../lib/supabase";
import type { TlPlayer, TlRoomSettings, LateJoinMode, JudgeMode, Difficulty, PlaylistMode } from "../lib/types";
import { DEFAULT_TL_SETTINGS } from "../lib/types";

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

  async function cycleTeam(player: TlPlayer) {
    if (player.is_spectator) return;
    if (teams.length === 0) return;
    const idx     = teams.findIndex(t => t.id === player.team_id);
    const nextIdx = idx === -1 ? 0 : (idx + 1) % teams.length;
    await changeTeam(player.id, teams[nextIdx].id);
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
          <Panel className="p-4">
            <h2 className="font-bold text-base mb-3">
              Players <span style={{ color: "rgb(var(--text-muted-rgb))" }}>({visiblePlayers.length})</span>
            </h2>
            {visiblePlayers.length === 0 ? (
              <p className="text-sm" style={{ color: "rgb(var(--text-muted-rgb))" }}>Waiting for players…</p>
            ) : (
              <div className="flex flex-col gap-3">
                {[...visiblePlayers]
                  .sort((a, b) => Number(a.is_spectator) - Number(b.is_spectator))
                  .map(p => {
                    const team    = teams.find(t => t.id === p.team_id);
                    const isMe    = p.id === myPlayerId;
                    const canSwap = !p.is_spectator && (isHost || (isMe && teamSwap));
                    // Host can act on anyone (including themselves for captain toggling).
                    // Kick is gated separately to prevent host self-kick.
                    const showHostActions = isHost;
                    const canCaptain      = isHost && !p.is_spectator;
                    return (
                      <div key={p.id} className="flex flex-col gap-1.5 py-1">
                        {/* Row 1: name + badges + team chip */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm truncate min-w-0">
                            {p.name}{isMe && <span className="ml-1 text-xs opacity-40 font-normal">(you)</span>}
                          </span>
                          {p.is_host && <Badge variant="host">HOST</Badge>}
                          {p.is_captain && !p.is_spectator && <Badge variant="primary">👑 Captain</Badge>}
                          {p.is_spectator ? (
                            <Badge variant="team" team="spectator">👁️ Spectator</Badge>
                          ) : (
                            <button
                              onClick={() => canSwap && cycleTeam(p)}
                              disabled={!canSwap}
                              title={canSwap ? "Click to change team" : team?.name}
                              className="text-xs font-bold px-2.5 py-0.5 rounded-full transition-opacity disabled:cursor-default"
                              style={{
                                background:  "rgba(var(--color-primary-rgb),0.18)",
                                border:      "1px solid rgba(var(--color-primary-rgb),0.4)",
                                color:       "rgb(var(--color-primary-rgb))",
                                opacity:     canSwap ? 1 : 0.85,
                              }}
                            >
                              {team?.name ?? "No team"}
                            </button>
                          )}
                        </div>
                        {/* Row 2: host-only actions */}
                        {showHostActions && (
                          <div className="flex items-center gap-2 pl-1">
                            {canCaptain && (
                              <button
                                onClick={() => setCaptain(p)}
                                className="text-xs px-2 py-0.5 rounded transition-colors"
                                style={{
                                  border: p.is_captain
                                    ? "1px solid rgba(var(--color-primary-rgb),0.6)"
                                    : "1px solid rgba(255,255,255,0.12)",
                                  background: p.is_captain ? "rgba(var(--color-primary-rgb),0.15)" : "transparent",
                                  color: p.is_captain ? "rgb(var(--color-primary-rgb))" : "rgb(var(--text-muted-rgb))",
                                }}
                              >
                                {p.is_captain ? "👑 Un-captain" : "👑 Make captain"}
                              </button>
                            )}
                            {!p.is_host && (
                              <button
                                onClick={() => kickPlayer(p.id)}
                                className="text-xs px-2 py-0.5 rounded hover:bg-red-500/20"
                                style={{ color: "rgb(var(--text-muted-rgb))" }}
                              >
                                Kick
                              </button>
                            )}
                          </div>
                        )}
                        {/* Row 3: music source — Last.fm or manual artists */}
                        {!p.is_spectator && (
                          <PlayerMusicRow
                            player={p}
                            roomId={roomId!}
                            isMe={isMe}
                          />
                        )}
                      </div>
                    );
                  })}
              </div>
            )}
          </Panel>

          {/* Empty teams hint (host only) */}
          {isHost && teams.some(t => !players.some(p => p.team_id === t.id && !p.is_spectator)) && (
            <Panel className="p-3">
              <p className="text-xs" style={{ color: "rgb(var(--text-muted-rgb))" }}>
                <span style={{ color: "rgb(220,160,0)" }}>⚠️</span>{" "}
                {teams
                  .filter(t => !players.some(p => p.team_id === t.id && !p.is_spectator))
                  .map(t => t.name)
                  .join(", ")} {teams.filter(t => !players.some(p => p.team_id === t.id && !p.is_spectator)).length === 1 ? "has" : "have"} no players yet.
              </p>
            </Panel>
          )}

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
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex-1 flex items-center justify-center opacity-50">{children}</div>;
}

// ── Per-player music source row ─────────────────────────────────────────────
// Shows the player's Last.fm linkage (read-only) or, if missing, lets them type
// 3-5 favourite artists as a manual fallback. Only the player themselves can
// edit their own row.

function PlayerMusicRow({ player, isMe }: { player: TlPlayer; roomId: string; isMe: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState((player.manual_artists ?? []).join(", "));
  const [saving, setSaving]   = useState(false);

  const linked         = !!player.lastfm_username;
  const hasManual      = (player.manual_artists?.length ?? 0) > 0;
  const needsFallback  = !linked && !hasManual;

  async function saveManual() {
    const list = draft.split(",").map(s => s.trim()).filter(Boolean).slice(0, 5);
    setSaving(true);
    try {
      await supabase.from("tl_players").update({ manual_artists: list }).eq("id", player.id);
      setEditing(false);
    } finally { setSaving(false); }
  }

  if (linked) {
    return (
      <p className="text-[11px] pl-1 truncate" style={{ color: "rgba(34,197,94,0.85)" }}>
        🎵 Last.fm: <strong>{player.lastfm_username}</strong>
      </p>
    );
  }

  if (!isMe) {
    return (
      <p className="text-[11px] pl-1" style={{ color: needsFallback ? "rgb(220,160,0)" : "rgb(var(--text-muted-rgb))" }}>
        {hasManual
          ? `🎵 Manual: ${player.manual_artists.slice(0, 3).join(", ")}${player.manual_artists.length > 3 ? "…" : ""}`
          : "🎵 No music linked — songs will be picked from group taste"}
      </p>
    );
  }

  // Editable for self
  if (editing) {
    return (
      <div className="flex items-center gap-2 pl-1">
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => e.key === "Enter" && saveManual()}
          placeholder="3-5 favourite artists, comma-separated"
          className="flex-1 min-w-0 rounded px-2 py-0.5 text-[11px] outline-none"
          style={{
            background: "rgba(var(--surface-raised-rgb),0.5)",
            border:     "1px solid rgba(255,255,255,0.1)",
            color:      "inherit",
          }}
        />
        <button onClick={saveManual} disabled={saving}
          className="text-[10px] px-2 py-0.5 rounded font-bold"
          style={{
            background: "rgba(var(--color-primary-rgb),0.18)",
            color:      "rgb(var(--color-primary-rgb))",
            border:     "1px solid rgba(var(--color-primary-rgb),0.4)",
          }}>
          {saving ? "…" : "Save"}
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 pl-1">
      {hasManual ? (
        <p className="text-[11px] truncate flex-1" style={{ color: "rgb(var(--text-muted-rgb))" }}>
          🎵 Manual: {player.manual_artists.join(", ")}
        </p>
      ) : (
        <p className="text-[11px] flex-1" style={{ color: "rgb(220,160,0)" }}>
          🎵 No Last.fm linked. <a href="https://account.gokkehub.com/profile" target="_blank" rel="noreferrer" className="underline">Connect</a>
          {" "}or list 3-5 favourite artists →
        </p>
      )}
      <button
        onClick={() => setEditing(true)}
        className="text-[10px] px-2 py-0.5 rounded font-bold"
        style={{
          background: "transparent",
          color:      "rgb(var(--text-muted-rgb))",
          border:     "1px solid rgba(255,255,255,0.12)",
        }}>
        {hasManual ? "Edit" : "Add artists"}
      </button>
    </div>
  );
}
