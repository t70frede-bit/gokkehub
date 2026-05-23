import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Input, Modal, Panel } from "@gokkehub/ui";
import { useSession } from "../hooks/useSession";
import type { CreateRoomRequest, CreateRoomResponse, CreateRoomRole, TlRoomSettings } from "../lib/types";
import { DEFAULT_TL_SETTINGS } from "../lib/types";

// Coloured emoji per team slot, matching the design system's team palette
// (red, blue, green, yellow). Shown next to the team name input so the host
// can tell at a glance which colour each team is.
const TEAM_COLOR_EMOJI = ["🔴", "🔵", "🟢", "🟡"] as const;
function defaultTeamName(i: number): string {
  return ["Team Red", "Team Blue", "Team Green", "Team Yellow"][i] ?? `Team ${i + 1}`;
}

export default function HomePage() {
  const navigate    = useNavigate();
  const { session } = useSession();

  // Mode: pick (default) or join input
  const [mode, setMode] = useState<"pick" | "join">("pick");

  // Host modal state — slim by design. Everything else (cards to win, late
  // join, judge mode, timer, audio, etc.) is configured in the Lobby's
  // Settings tab AFTER the room is created. Defaults from DEFAULT_TL_SETTINGS
  // are baked in so 90% of rooms never need to touch Settings.
  const [showHost,     setShowHost]     = useState(false);
  const [name,         setName]         = useState(session?.displayName ?? "");
  const [role,         setRole]         = useState<CreateRoomRole>("player");
  const [teams,        setTeams]        = useState<string[]>([defaultTeamName(0), defaultTeamName(1)]);
  const [hostTeam,     setHostTeam]     = useState<number>(0);
  // Streamer mode lives on Create Room (not Lobby Settings) because it
  // affects what the host sees from the moment the room exists — once
  // the URL is in the address bar, hiding the code afterwards is too
  // late. Everything else stays in Lobby Settings.
  const [streamerMode, setStreamerMode] = useState(false);

  // Join input
  const [code, setCode] = useState("");

  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    if (session?.displayName && !name) setName(session.displayName);
  }, [session]);

  // ── Actions ─────────────────────────────────────────────────────────────────

  async function createRoom() {
    if (!name.trim()) { setError("Enter your name"); return; }
    setLoading(true); setError(null);
    try {
      // Audio mode default depends on whether the host has Spotify connected —
      // Browser/Local mode is the smoothest experience when Spotify is hooked
      // up; otherwise default to YouTube-via-bot so the room has audio at all.
      const settings: TlRoomSettings = {
        ...DEFAULT_TL_SETTINGS,
        audioMode: session?.spotify ? "browser" : "all-clients-stream",
        streamerMode,
      };
      const body: CreateRoomRequest = {
        name:         name.trim(),
        win_target:   10, // baked default; host can change in Lobby → Settings tab
        team_names:   teams.map((t, i) => (t.trim() || defaultTeamName(i))),
        // host_team only matters for the "player" role; server ignores it
        // for spectator/dj/gamemaster.
        host_team:    role === "player" ? hostTeam : null,
        role,
        settings,
      };
      const res = await fetch("/room/create", {
        method:      "POST",
        headers:     { "Content-Type": "application/json" },
        credentials: "include",
        body:        JSON.stringify(body),
      });
      const data = await res.json() as CreateRoomResponse | { error: string };
      if (!res.ok) { setError((data as { error: string }).error ?? "Failed to create room"); return; }
      const ok = data as CreateRoomResponse;
      localStorage.setItem(`tl_player_${ok.room_id}`, ok.player_id);
      navigate(`/lobby/${ok.room_id}`);
    } catch {
      setError("Could not create room");
    } finally {
      setLoading(false);
    }
  }

  function goToJoin() {
    const roomId = code.trim().toUpperCase();
    if (!roomId) { setError("Enter a room code"); return; }
    navigate(`/join?room=${roomId}`);
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-4 gap-6">

      {/* Hero */}
      <div className="text-center max-w-md">
        <h1 className="text-5xl font-extrabold tracking-tight mb-2"
          style={{
            color: "rgb(var(--color-primary-rgb))",
            fontFamily: "var(--font-display)",
            letterSpacing: "-0.02em",
          }}>
          musix
        </h1>
        <p className="text-sm" style={{ color: "rgb(var(--text-muted-rgb))" }}>
          Place songs on the timeline — are you sure about that year?
        </p>
        {session && (
          <p className="text-xs mt-1" style={{ color: "rgb(var(--text-muted-rgb))" }}>
            Signed in as <strong>{session.displayName ?? session.email}</strong>
          </p>
        )}
      </div>

      {/* Main mode: card menu */}
      {mode === "pick" && (
        <div className="flex flex-col sm:flex-row gap-4 w-full max-w-lg">
          <Panel className="flex-1 flex flex-col items-center gap-3 p-6 text-center">
            <span className="text-3xl">🎵</span>
            <h2 className="font-bold text-lg">Host Game</h2>
            <p className="text-sm" style={{ color: "rgb(var(--text-muted-rgb))" }}>
              Create a room and pick a Spotify playlist
            </p>
            <Button variant="primary" className="w-full mt-auto" onClick={() => setShowHost(true)}>
              Host
            </Button>
          </Panel>

          <Panel className="flex-1 flex flex-col items-center gap-3 p-6 text-center">
            <span className="text-3xl">🔗</span>
            <h2 className="font-bold text-lg">Join Game</h2>
            <p className="text-sm" style={{ color: "rgb(var(--text-muted-rgb))" }}>
              Enter a room code to join your friends
            </p>
            <Button variant="ghost" className="w-full mt-auto" onClick={() => setMode("join")}>
              Join
            </Button>
          </Panel>
        </div>
      )}

      {/* Join input */}
      {mode === "join" && (
        <Panel className="w-full max-w-sm p-5 space-y-4">
          <button
            onClick={() => { setMode("pick"); setError(null); }}
            className="text-sm flex items-center gap-1"
            style={{ color: "rgb(var(--text-muted-rgb))" }}
          >
            ← Back
          </button>
          <h2 className="font-bold text-xl">Join a room</h2>
          <div>
            <label className="text-sm font-medium mb-2 block"
              style={{ color: "rgb(var(--text-secondary-rgb))" }}>
              Room code
            </label>
            <input
              value={code}
              onChange={e => setCode(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === "Enter" && goToJoin()}
              placeholder="ABCD"
              // maxLength stays 6 so legacy rooms (pre-4-char codes) can still be joined
              maxLength={6}
              className="w-full rounded-xl px-4 py-3 text-center text-2xl font-bold tracking-widest outline-none"
              style={{
                background: "rgba(var(--surface-raised-rgb),0.5)",
                border:     "1px solid rgba(255,255,255,0.1)",
                color:      "rgb(var(--color-primary-rgb))",
                caretColor: "rgb(var(--color-primary-rgb))",
                fontFamily: "var(--font-mono)",
              }}
            />
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <Button onClick={goToJoin} className="w-full">Continue</Button>
        </Panel>
      )}

      {/* Host modal — slim: only name, role and teams. Everything else
          lives in Lobby → Settings tab after the room exists. */}
      <Modal open={showHost} onClose={() => { setShowHost(false); setError(null); }}>
        <div className="flex flex-col gap-4">
          <h2 className="font-bold text-xl">Create Room</h2>
          <p className="text-xs -mt-2" style={{ color: "rgb(var(--text-muted-rgb))" }}>
            Pick your role and teams. Tweak game settings, late-join, audio mode
            and more from the Lobby's Settings tab once the room exists.
          </p>

          {/* Name */}
          {session ? (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg"
              style={{ background: "rgba(var(--surface-raised-rgb),0.4)" }}>
              {session.avatarUrl && <img src={session.avatarUrl} alt="" className="w-6 h-6 rounded-full" />}
              <span className="text-sm font-semibold">{session.displayName ?? session.email}</span>
            </div>
          ) : (
            <Input
              label="Your name"
              placeholder="e.g. Frederik"
              value={name}
              onChange={e => setName(e.target.value)}
              maxLength={30}
            />
          )}

          {/* Role — Player / Spectator / DJ / Gamemaster. Custom grid so
              all four fit on mobile in a 2x2; descriptions explain the
              less-obvious ones. */}
          <div>
            <p className="text-sm font-medium mb-2">Your role</p>
            <div className="grid grid-cols-2 gap-2">
              {([
                { value: "player",      label: "👤 Player",      hint: "Join a team and play normally" },
                { value: "spectator",   label: "👁️ Spectator",   hint: "Watch without being on a team" },
                { value: "dj",          label: "🎧 DJ",          hint: "Run audio without playing" },
                { value: "gamemaster",  label: "🎲 Gamemaster",  hint: "Run everything solo — single device, no teammates" },
              ] as const).map(({ value, label, hint }) => {
                const active = role === value;
                return (
                  <button
                    key={value}
                    onClick={() => setRole(value)}
                    title={hint}
                    className="text-left rounded-lg p-3 transition-all border"
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

          {/* Teams editor — each row prefixed with the coloured emoji that
              matches the team's slot palette so the host knows which colour
              each team will be in the lobby/in-game UI. */}
          <div>
            <p className="text-sm font-medium mb-2">Teams</p>
            <div className="space-y-2">
              {teams.map((t, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <span className="text-lg flex-shrink-0 w-6 text-center" aria-hidden="true">
                    {TEAM_COLOR_EMOJI[i] ?? "⚪"}
                  </span>
                  <Input
                    value={t}
                    onChange={e => setTeams(ts => ts.map((x, j) => j === i ? e.target.value : x))}
                    placeholder={defaultTeamName(i)}
                    className="flex-1"
                  />
                  {teams.length > 2 && (
                    <button
                      onClick={() => {
                        setTeams(ts => ts.filter((_, j) => j !== i));
                        // If we removed the team the host was on, fall back to slot 0.
                        if (hostTeam >= teams.length - 1) setHostTeam(0);
                      }}
                      className="text-sm px-2 opacity-60 hover:opacity-100"
                      aria-label={`Remove team ${i + 1}`}
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
              {teams.length < 4 && (
                <button
                  onClick={() => setTeams(ts => [...ts, defaultTeamName(ts.length)])}
                  className="text-sm font-medium"
                  style={{ color: "rgb(var(--color-primary-rgb))" }}
                >
                  + Add team
                </button>
              )}
            </div>
          </div>

          {/* Host's starting team — only shown for Player. Spectator/DJ/
              Gamemaster don't sit on a team. */}
          {role === "player" && teams.length > 0 && (
            <div>
              <p className="text-sm font-medium mb-2">Your team</p>
              <div className="flex gap-2 flex-wrap">
                {teams.map((t, i) => {
                  const selected = hostTeam === i;
                  return (
                    <button
                      key={i}
                      onClick={() => setHostTeam(i)}
                      className="px-3 py-1.5 rounded-full text-sm font-semibold border transition-all flex items-center gap-1.5"
                      style={{
                        borderColor: selected ? "rgba(var(--color-primary-rgb),0.7)" : "rgba(255,255,255,0.12)",
                        background:  selected ? "rgba(var(--color-primary-rgb),0.18)" : "transparent",
                      }}
                    >
                      <span aria-hidden="true">{TEAM_COLOR_EMOJI[i] ?? "⚪"}</span>
                      <span>{t || defaultTeamName(i)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Streamer mode — hides the room code + invite button + QR
              everywhere it would otherwise appear (global header, lobby
              sub-header). Useful for streamers / videos where the join
              code leaking into frame would let randoms hop in. The URL
              itself can't be hidden from the address bar, so a streamer
              should also run fullscreen. Lives on Create Room because
              switching it on AFTER the room is visible is too late. */}
          <button
            onClick={() => setStreamerMode(v => !v)}
            className="text-sm font-semibold px-3 py-2 rounded-md border transition-all self-start"
            style={{
              borderColor: streamerMode ? "rgba(var(--color-primary-rgb),0.7)" : "rgba(255,255,255,0.12)",
              background:  streamerMode ? "rgba(var(--color-primary-rgb),0.15)" : "transparent",
            }}
            title="Hide the room code from the UI so it doesn't end up on stream. URL can't be stripped — go fullscreen too."
            type="button"
          >
            📡 Streamer mode {streamerMode ? "ON" : "OFF"}
          </button>

          {error && <p className="text-sm text-red-400">{error}</p>}
          <Button onClick={createRoom} loading={loading} className="w-full">Create Room</Button>
        </div>
      </Modal>
    </div>
  );
}
