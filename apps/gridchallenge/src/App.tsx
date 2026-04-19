import { Routes, Route, Navigate, useLocation, Link } from "react-router-dom";
import { useSession } from "./hooks/useSession";
import HomePage from "./pages/HomePage";
import JoinPage from "./pages/JoinPage";
import LobbyPage from "./pages/LobbyPage";
import BoardPage from "./pages/BoardPage";
import LibraryPage from "./pages/LibraryPage";

// ── Header ────────────────────────────────────────────────────────────────────

function GameHeader() {
  const { session } = useSession();
  const location = useLocation();

  // Don't show the header on the board — it uses its own toolbar to save space
  const isBoardPage = location.pathname.startsWith("/board");
  if (isBoardPage) return null;

  return (
    <header
      className="flex items-center justify-between px-5 py-3 flex-shrink-0"
      style={{
        background: "rgba(var(--surface-base-rgb, 15 10 30), 0.7)",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        position: "sticky",
        top: 0,
        zIndex: 40,
      }}
    >
      {/* Left: branding */}
      <div className="flex items-center gap-3">
        <a
          href="https://gokkehub.com"
          className="font-bold text-sm leading-none tracking-tight"
          style={{ color: "rgb(var(--text-muted-rgb))" }}
        >
          GokkeHub
        </a>
        <span style={{ color: "rgba(255,255,255,0.2)" }}>›</span>
        <Link
          to="/"
          className="font-bold text-base leading-none tracking-tight"
          style={{
            background: "linear-gradient(135deg, rgb(var(--color-primary-rgb)), rgb(var(--color-accent-rgb)))",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
          }}
        >
          GridChallenge
        </Link>
      </div>

      {/* Right: account */}
      <div className="flex items-center gap-3">
        {session ? (
          <>
            <Link
              to="/library"
              className="text-sm font-medium px-3 py-1.5 rounded-lg transition-all"
              style={{
                color: "rgb(var(--text-muted-rgb))",
                background: "rgba(var(--surface-raised-rgb), 0.3)",
                border: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              🎮 Library
            </Link>
            <a
              href="https://account.gokkehub.com/profile"
              className="flex items-center gap-2 text-sm font-medium rounded-lg px-3 py-1.5 transition-all"
              style={{
                color: "rgb(var(--text-secondary-rgb))",
                background: "rgba(var(--surface-raised-rgb), 0.5)",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              {session.avatarUrl && (
                <img
                  src={session.avatarUrl}
                  alt=""
                  className="w-5 h-5 rounded-full object-cover"
                />
              )}
              <span className="hidden sm:block">{session.displayName ?? session.email}</span>
            </a>
          </>
        ) : (
          <a
            href="https://account.gokkehub.com"
            className="text-sm font-medium"
            style={{ color: "rgb(var(--text-muted-rgb))" }}
          >
            Sign in
          </a>
        )}
      </div>
    </header>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <div className="min-h-dvh flex flex-col">
      <GameHeader />
      <main className="flex-1 flex flex-col">
        <Routes>
          <Route path="/"               element={<HomePage />} />
          <Route path="/join"           element={<JoinPage />} />
          <Route path="/lobby/:lobbyId" element={<LobbyPage />} />
          <Route path="/board/:lobbyId" element={<BoardPage />} />
          {/* solo board: no lobbyId */}
          <Route path="/board"          element={<BoardPage />} />
          <Route path="/library"        element={<LibraryPage />} />
          <Route path="*"               element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
