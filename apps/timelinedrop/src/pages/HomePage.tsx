import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Input, Modal, Panel, Toggle } from "@gokkehub/ui";
import { useSession } from "../hooks/useSession";
import type { CreateRoomRequest, CreateRoomResponse, TlRoomSettings } from "../lib/types";
import { DEFAULT_TL_SETTINGS } from "../lib/types";

export default function HomePage() {
  const navigate    = useNavigate();
  const { session } = useSession();

  // Mode: pick (default) or join input
  const [mode, setMode] = useState<"pick" | "join">("pick");

  // Host modal state
  const [showHost, setShowHost] = useState(false);
  const [name,     setName]     = useState(session?.displayName ?? "");
  const [role,     setRole]     = useState<"player" | "dj">("player");
  const [teams,    setTeams]    = useState<string[]>(["Team Red", "Team Blue"]);
  const [hostTeam, setHostTeam] = useState<number>(0);
  const [target,   setTarget]   = useState(10);
  const [settings, setSettings] = useState<TlRoomSettings>({ ...DEFAULT_TL_SETTINGS });

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
      const body: CreateRoomRequest = {
        name:         name.trim(),
        win_target:   target,
        team_names:   teams.map(t => t.trim()).filter(Boolean),
        host_team:    role === "dj" ? null : hostTeam,
        is_spectator: role === "dj",
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
            background: "linear-gradient(135deg, rgb(var(--color-primary-rgb)), rgb(var(--color-secondary-rgb)))",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
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
              placeholder="ABC123"
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

      {/* Host modal */}
      <Modal open={showHost} onClose={() => { setShowHost(false); setError(null); }}>
        <div className="flex flex-col gap-4">
          <h2 className="font-bold text-xl">Create Room</h2>

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

          {/* Role */}
          <div>
            <p className="text-sm font-medium mb-2">Your role</p>
            <Toggle
              options={[
                { value: "player", label: "Player" },
                { value: "dj",     label: "DJ only (no team)" },
              ]}
              value={role}
              onChange={v => setRole(v as "player" | "dj")}
            />
          </div>

          {/* Teams editor */}
          <div>
            <p className="text-sm font-medium mb-2">Teams</p>
            <div className="space-y-2">
              {teams.map((t, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    value={t}
                    onChange={e => setTeams(ts => ts.map((x, j) => j === i ? e.target.value : x))}
                    placeholder={`Team ${i + 1}`}
                  />
                  {teams.length > 2 && (
                    <button
                      onClick={() => setTeams(ts => ts.filter((_, j) => j !== i))}
                      className="text-sm px-2 opacity-60 hover:opacity-100"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
              {teams.length < 4 && (
                <button
                  onClick={() => setTeams(ts => [...ts, `Team ${ts.length + 1}`])}
                  className="text-sm font-medium"
                  style={{ color: "rgb(var(--color-primary-rgb))" }}
                >
                  + Add team
                </button>
              )}
            </div>
          </div>

          {/* Host's starting team — only shown when Player */}
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
                      className="px-3 py-1.5 rounded-full text-sm font-semibold border transition-all"
                      style={{
                        borderColor: selected ? "rgba(var(--color-primary-rgb),0.7)" : "rgba(255,255,255,0.12)",
                        background:  selected ? "rgba(var(--color-primary-rgb),0.18)" : "transparent",
                      }}
                    >
                      {t || `Team ${i + 1}`}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Cards to win */}
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium" style={{ color: "rgb(var(--text-secondary-rgb))" }}>
              Cards to win:
            </label>
            <select
              value={target}
              onChange={e => setTarget(Number(e.target.value))}
              className="rounded-lg px-3 py-1.5 text-sm"
              style={{
                background: "rgba(var(--surface-raised-rgb),0.5)",
                border:     "1px solid rgba(255,255,255,0.1)",
                color:      "inherit",
              }}
            >
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
              value={settings.lateJoinMode ?? "open"}
              onChange={v => setSettings(s => ({ ...s, lateJoinMode: v as TlRoomSettings["lateJoinMode"] }))}
            />
          </div>

          {/* Toggle pills */}
          <div className="flex flex-wrap gap-2">
            {([
              { key: "streamerMode",    on: "📡 Streamer mode ON",   off: "📡 Streamer mode OFF" },
              { key: "hideSpectators",  on: "👁️ Spectators hidden",  off: "👁️ Show spectators" },
              { key: "teamSwapEnabled", on: "🔄 Team swap ON",       off: "🔄 Team swap OFF" },
            ] as const).map(({ key, on, off }) => {
              const val = !!settings[key];
              return (
                <button
                  key={key}
                  onClick={() => setSettings(s => ({ ...s, [key]: !val }))}
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

          {error && <p className="text-sm text-red-400">{error}</p>}
          <Button onClick={createRoom} loading={loading} className="w-full">Create Room</Button>
        </div>
      </Modal>
    </div>
  );
}
