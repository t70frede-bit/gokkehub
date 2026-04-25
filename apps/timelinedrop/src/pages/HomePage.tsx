import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Input, Panel } from "@gokkehub/ui";
import { useSession } from "../hooks/useSession";

export default function HomePage() {
  const navigate = useNavigate();
  const { session } = useSession();

  const [mode,    setMode]    = useState<"pick" | "create" | "join">("pick");
  const [name,    setName]    = useState(session?.displayName ?? "");
  const [code,    setCode]    = useState("");
  const [teams,   setTeams]   = useState(["Team Red", "Team Blue"]);
  const [target,  setTarget]  = useState(10);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  async function createRoom() {
    if (!name.trim()) { setError("Enter your name"); return; }
    setLoading(true); setError(null);
    try {
      const res = await fetch("/room/create", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: name.trim(), win_target: target, team_names: teams }),
      });
      const data = await res.json() as { room_id: string; player_id: string };
      if (!res.ok) { setError((data as unknown as { error: string }).error); return; }
      localStorage.setItem(`tl_player_${data.room_id}`, data.player_id);
      navigate(`/lobby/${data.room_id}`);
    } catch {
      setError("Could not create room");
    } finally {
      setLoading(false);
    }
  }

  async function joinRoom() {
    if (!name.trim()) { setError("Enter your name"); return; }
    const roomId = code.trim().toUpperCase();
    if (!roomId) { setError("Enter a room code"); return; }
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/room/${roomId}/join`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = await res.json() as { player_id: string };
      if (!res.ok) { setError((data as unknown as { error: string }).error); return; }
      localStorage.setItem(`tl_player_${roomId}`, data.player_id);
      navigate(`/lobby/${roomId}`);
    } catch {
      setError("Could not join room");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex-1 flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-4">

        {/* Hero */}
        <div className="text-center mb-8">
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
        </div>

        {/* Mode picker */}
        {mode === "pick" && (
          <div className="grid grid-cols-2 gap-3">
            <Button onClick={() => setMode("create")} size="lg" className="h-20 flex-col gap-1">
              <span className="text-2xl">🎵</span>
              <span>Create Room</span>
            </Button>
            <Button onClick={() => setMode("join")} variant="ghost" size="lg" className="h-20 flex-col gap-1">
              <span className="text-2xl">🔗</span>
              <span>Join Room</span>
            </Button>
          </div>
        )}

        {/* Create form */}
        {mode === "create" && (
          <Panel className="space-y-4 p-5">
            <div className="flex items-center gap-2 mb-2">
              <button onClick={() => setMode("pick")} className="text-sm opacity-60 hover:opacity-100">← Back</button>
              <h2 className="font-bold text-lg">Create Room</h2>
            </div>

            <Input label="Your name" value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. Frederik" maxLength={30} />

            <div>
              <label className="text-sm font-medium mb-2 block"
                style={{ color: "rgb(var(--text-secondary-rgb))" }}>
                Teams
              </label>
              <div className="space-y-2">
                {teams.map((t, i) => (
                  <div key={i} className="flex gap-2">
                    <Input value={t}
                      onChange={e => setTeams(ts => ts.map((x, j) => j === i ? e.target.value : x))}
                      placeholder={`Team ${i + 1}`} />
                    {teams.length > 2 && (
                      <button onClick={() => setTeams(ts => ts.filter((_, j) => j !== i))}
                        className="text-sm px-2 opacity-60 hover:opacity-100">✕</button>
                    )}
                  </div>
                ))}
                {teams.length < 4 && (
                  <button onClick={() => setTeams(ts => [...ts, `Team ${ts.length + 1}`])}
                    className="text-sm opacity-60 hover:opacity-100"
                    style={{ color: "rgb(var(--color-primary-rgb))" }}>
                    + Add team
                  </button>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <label className="text-sm font-medium" style={{ color: "rgb(var(--text-secondary-rgb))" }}>
                Cards to win:
              </label>
              <select value={target} onChange={e => setTarget(Number(e.target.value))}
                className="rounded-lg px-3 py-1.5 text-sm"
                style={{
                  background: "rgba(var(--surface-raised-rgb),0.5)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  color: "inherit",
                }}>
                {[5,7,10,12,15].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>

            {error && <p className="text-sm text-red-400">{error}</p>}
            <Button onClick={createRoom} loading={loading} className="w-full">Create Room</Button>
          </Panel>
        )}

        {/* Join form */}
        {mode === "join" && (
          <Panel className="space-y-4 p-5">
            <div className="flex items-center gap-2 mb-2">
              <button onClick={() => setMode("pick")} className="text-sm opacity-60 hover:opacity-100">← Back</button>
              <h2 className="font-bold text-lg">Join Room</h2>
            </div>

            <Input label="Your name" value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. Frederik" maxLength={30} />

            <div>
              <label className="text-sm font-medium mb-2 block"
                style={{ color: "rgb(var(--text-secondary-rgb))" }}>
                Room code
              </label>
              <input
                value={code}
                onChange={e => setCode(e.target.value.toUpperCase())}
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
            <Button onClick={joinRoom} loading={loading} className="w-full">Join Room</Button>
          </Panel>
        )}
      </div>
    </div>
  );
}
