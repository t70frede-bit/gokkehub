import { useEffect, useState } from "react";

const PLAYLIST_URL = "https://open.spotify.com/playlist/0hZ9THXyLWxcjp3ZmEHesU?si=e6517f4e64ee4057";
const PLAYLIST_ID  = "0hZ9THXyLWxcjp3ZmEHesU";

type StepStatus = "pending" | "running" | "ok" | "error";

interface Step {
  id:       string;
  label:    string;
  status:   StepStatus;
  request?: { method: string; url: string; headers?: Record<string, string> };
  httpStatus?: number;
  body?:    unknown;
  error?:   string;
  durationMs?: number;
}

function StatusBadge({ s }: { s: StepStatus }) {
  const map: Record<StepStatus, [string, string]> = {
    pending: ["#555", "PENDING"],
    running: ["#f0a030", "RUNNING…"],
    ok:      ["#1db954", "OK"],
    error:   ["#e05050", "ERROR"],
  };
  const [color, label] = map[s];
  return (
    <span style={{
      display: "inline-block", padding: "2px 8px", borderRadius: 4,
      background: color + "33", color, border: `1px solid ${color}66`,
      fontWeight: 700, fontSize: 11, fontFamily: "monospace",
    }}>
      {label}
    </span>
  );
}

function Json({ value }: { value: unknown }) {
  return (
    <pre style={{
      margin: "8px 0 0", padding: "10px 12px", borderRadius: 6,
      background: "#0a0a0a", border: "1px solid #222",
      fontSize: 12, fontFamily: "monospace", whiteSpace: "pre-wrap",
      wordBreak: "break-all", color: "#c8f0c8", maxHeight: 400, overflowY: "auto",
    }}>
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function StepCard({ step }: { step: Step }) {
  const [open, setOpen] = useState(step.status === "error" || step.status === "ok");
  useEffect(() => {
    if (step.status === "error" || step.status === "ok") setOpen(true);
  }, [step.status]);

  return (
    <div style={{
      border: `1px solid ${step.status === "error" ? "#e0505066" : step.status === "ok" ? "#1db95433" : "#333"}`,
      borderRadius: 8, marginBottom: 12, overflow: "hidden",
    }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 10,
          padding: "10px 14px", background: "#111", border: "none",
          cursor: "pointer", textAlign: "left",
        }}
      >
        <StatusBadge s={step.status} />
        <span style={{ fontWeight: 600, color: "#e0e0e0", flex: 1 }}>{step.label}</span>
        {step.httpStatus != null && (
          <span style={{ fontFamily: "monospace", fontSize: 12, color: step.httpStatus < 300 ? "#1db954" : "#e05050" }}>
            HTTP {step.httpStatus}
          </span>
        )}
        {step.durationMs != null && (
          <span style={{ fontFamily: "monospace", fontSize: 11, color: "#666" }}>{step.durationMs}ms</span>
        )}
        <span style={{ color: "#555", fontSize: 12 }}>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div style={{ padding: "10px 14px", background: "#0d0d0d" }}>
          {step.request && (
            <div style={{ marginBottom: 8 }}>
              <p style={{ margin: "0 0 4px", fontSize: 11, color: "#888", fontFamily: "monospace" }}>REQUEST</p>
              <code style={{ fontSize: 12, color: "#aad4ff", fontFamily: "monospace" }}>
                {step.request.method} {step.request.url}
              </code>
              {step.request.headers && (
                <Json value={step.request.headers} />
              )}
            </div>
          )}
          {step.error && (
            <p style={{ color: "#e05050", fontFamily: "monospace", fontSize: 13, margin: "4px 0" }}>
              ⚠ {step.error}
            </p>
          )}
          {step.body !== undefined && (
            <div>
              <p style={{ margin: "8px 0 4px", fontSize: 11, color: "#888", fontFamily: "monospace" }}>RESPONSE BODY</p>
              <Json value={step.body} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

async function timed<T>(fn: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const t0 = Date.now();
  const result = await fn();
  return { result, ms: Date.now() - t0 };
}

export default function DebugPage() {
  const [steps, setSteps] = useState<Step[]>([
    { id: "session",    label: "1. Fetch session from account.gokkehub.com/auth/me", status: "pending" },
    { id: "token",      label: "2. Fetch Spotify token from /spotify/token",          status: "pending" },
    { id: "meta",       label: "3. Fetch playlist metadata from Spotify API",         status: "pending" },
    { id: "tracks_p1",  label: "4. Fetch tracks page 1 from Spotify API",            status: "pending" },
    { id: "tracks_all", label: "5. Fetch ALL tracks (paginated)",                    status: "pending" },
  ]);

  function update(id: string, patch: Partial<Step>) {
    setSteps(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));
  }

  useEffect(() => {
    run();
  }, []);

  async function run() {
    let accessToken = "";

    // ── Step 1: session ──────────────────────────────────────────────────────
    update("session", { status: "running", request: { method: "GET", url: "https://account.gokkehub.com/auth/me" } });
    try {
      const { result: r, ms } = await timed(() => fetch("https://account.gokkehub.com/auth/me", { credentials: "include" }));
      const body = await r.json().catch(() => null);
      update("session", { status: r.ok ? "ok" : "error", httpStatus: r.status, body, durationMs: ms,
        error: r.ok ? undefined : `Session fetch failed — are you logged in on account.gokkehub.com?` });
      if (!r.ok) return;
    } catch (e) {
      update("session", { status: "error", error: String(e) }); return;
    }

    // ── Step 2: Spotify token ────────────────────────────────────────────────
    update("token", { status: "running", request: { method: "GET", url: "/spotify/token" } });
    try {
      const { result: r, ms } = await timed(() => fetch("/spotify/token", { credentials: "include" }));
      const body = await r.json().catch(() => null) as { access_token?: string; error?: string } | null;
      update("token", { status: r.ok ? "ok" : "error", httpStatus: r.status, body, durationMs: ms,
        error: r.ok ? undefined : `Token fetch failed: ${body?.error ?? r.statusText}` });
      if (!r.ok || !body?.access_token) return;
      accessToken = body.access_token;
    } catch (e) {
      update("token", { status: "error", error: String(e) }); return;
    }

    const authHeader = { Authorization: `Bearer ${accessToken.slice(0, 20)}…[truncated]` };

    // ── Step 3: playlist metadata ────────────────────────────────────────────
    const metaUrl = `https://api.spotify.com/v1/playlists/${PLAYLIST_ID}`;
    update("meta", { status: "running", request: { method: "GET", url: metaUrl, headers: authHeader } });
    try {
      const { result: r, ms } = await timed(() =>
        fetch(metaUrl, { headers: { Authorization: `Bearer ${accessToken}` } })
      );
      const body = await r.json().catch(() => null);
      update("meta", { status: r.ok ? "ok" : "error", httpStatus: r.status, body, durationMs: ms,
        error: r.ok ? undefined : `Playlist metadata failed` });
      if (!r.ok) return;
    } catch (e) {
      update("meta", { status: "error", error: String(e) }); return;
    }

    // ── Step 4: tracks page 1 (raw, no fields filter) ─────────────────────
    const tracksUrl1 = `https://api.spotify.com/v1/playlists/${PLAYLIST_ID}/tracks?limit=5`;
    update("tracks_p1", { status: "running", request: { method: "GET", url: tracksUrl1, headers: authHeader } });
    try {
      const { result: r, ms } = await timed(() =>
        fetch(tracksUrl1, { headers: { Authorization: `Bearer ${accessToken}` } })
      );
      const body = await r.json().catch(() => null);
      update("tracks_p1", { status: r.ok ? "ok" : "error", httpStatus: r.status, body, durationMs: ms,
        error: r.ok ? undefined : `Tracks page 1 failed` });
      if (!r.ok) return;
    } catch (e) {
      update("tracks_p1", { status: "error", error: String(e) }); return;
    }

    // ── Step 5: all tracks with fields filter (exactly as LobbyPage does it) ─
    const tracksUrlAll =
      `https://api.spotify.com/v1/playlists/${PLAYLIST_ID}/tracks` +
      `?limit=100&fields=next,items(track(id,name,uri,artists(name),album(name,release_date,images)))`;
    update("tracks_all", { status: "running", request: { method: "GET", url: tracksUrlAll, headers: authHeader } });
    try {
      const { result: r, ms } = await timed(() =>
        fetch(tracksUrlAll, { headers: { Authorization: `Bearer ${accessToken}` } })
      );
      const body = await r.json().catch(() => null);
      update("tracks_all", { status: r.ok ? "ok" : "error", httpStatus: r.status, body, durationMs: ms,
        error: r.ok ? undefined : `Tracks with fields filter failed` });
    } catch (e) {
      update("tracks_all", { status: "error", error: String(e) });
    }
  }

  const allDone = steps.every(s => s.status === "ok" || s.status === "error");
  const anyError = steps.some(s => s.status === "error");

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", background: "#080808", minHeight: "100vh", padding: "24px 20px", color: "#e0e0e0" }}>
      <div style={{ maxWidth: 800, margin: "0 auto" }}>

        <div style={{ marginBottom: 24 }}>
          <h1 style={{ margin: "0 0 6px", fontSize: 20, fontWeight: 700 }}>Spotify Debug</h1>
          <p style={{ margin: 0, fontSize: 13, color: "#888", fontFamily: "monospace" }}>
            Playlist: <a href={PLAYLIST_URL} target="_blank" rel="noreferrer"
              style={{ color: "#1db954" }}>{PLAYLIST_URL}</a>
          </p>
        </div>

        {steps.map(s => <StepCard key={s.id} step={s} />)}

        {allDone && (
          <div style={{
            marginTop: 16, padding: "12px 16px", borderRadius: 8,
            background: anyError ? "#e0505011" : "#1db95411",
            border: `1px solid ${anyError ? "#e0505044" : "#1db95444"}`,
            fontSize: 14, color: anyError ? "#e07070" : "#80e8a0",
          }}>
            {anyError
              ? "One or more steps failed — expand the red steps above for details."
              : "All steps passed. The playlist and token are working correctly."}
          </div>
        )}

        <button onClick={() => { setSteps(s => s.map(x => ({ ...x, status: "pending", body: undefined, error: undefined, httpStatus: undefined }))); setTimeout(run, 50); }}
          style={{
            marginTop: 20, padding: "8px 20px", borderRadius: 6, border: "1px solid #333",
            background: "#1a1a1a", color: "#ccc", cursor: "pointer", fontSize: 13,
          }}>
          ↺ Re-run
        </button>
      </div>
    </div>
  );
}
