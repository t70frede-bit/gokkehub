import { Routes, Route, Navigate, Link } from "react-router-dom";
import { useSession } from "./hooks/useSession";
import HomePage  from "./pages/HomePage";
import LobbyPage from "./pages/LobbyPage";
import GamePage  from "./pages/GamePage";
import EndPage   from "./pages/EndPage";
import DebugPage from "./pages/DebugPage";

function Header() {
  const { session } = useSession();
  return (
    <header
      className="flex items-center justify-between px-5 py-3 flex-shrink-0"
      style={{
        background:     "rgba(var(--surface-base-rgb, 20 10 30), 0.8)",
        borderBottom:   "1px solid rgba(255,255,255,0.06)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        position:       "sticky",
        top: 0,
        zIndex: 40,
      }}
    >
      <div className="flex items-center gap-3">
        <a href="https://gokkehub.com" className="font-bold text-sm"
          style={{ color: "rgb(var(--text-muted-rgb))" }}>
          GokkeHub
        </a>
        <span style={{ color: "rgba(255,255,255,0.2)" }}>›</span>
        <Link to="/" className="font-extrabold text-base"
          style={{
            background: "linear-gradient(135deg, rgb(var(--color-primary-rgb)), rgb(var(--color-secondary-rgb)))",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
          }}>
          musix
        </Link>
      </div>
      <div>
        {session ? (
          <a href="https://account.gokkehub.com/profile"
            className="flex items-center gap-2 text-sm font-medium rounded-lg px-3 py-1.5"
            style={{
              color:      "rgb(var(--text-secondary-rgb))",
              background: "rgba(var(--surface-raised-rgb), 0.5)",
              border:     "1px solid rgba(255,255,255,0.08)",
            }}>
            {session.avatarUrl && (
              <img src={session.avatarUrl} alt="" className="w-5 h-5 rounded-full object-cover" />
            )}
            <span className="hidden sm:block">{session.displayName ?? session.email}</span>
          </a>
        ) : (
          <a href="https://account.gokkehub.com" className="text-sm font-medium"
            style={{ color: "rgb(var(--text-muted-rgb))" }}>
            Sign in
          </a>
        )}
      </div>
    </header>
  );
}

export default function App() {
  return (
    <div className="min-h-dvh flex flex-col">
      <Header />
      <main className="flex-1 flex flex-col">
        <Routes>
          <Route path="/"              element={<HomePage />} />
          <Route path="/lobby/:roomId" element={<LobbyPage />} />
          <Route path="/game/:roomId"  element={<GamePage />} />
          <Route path="/end/:roomId"   element={<EndPage />} />
          <Route path="/debug"         element={<DebugPage />} />
          <Route path="*"              element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
