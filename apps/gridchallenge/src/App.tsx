import { Routes, Route, Navigate, useLocation, Link } from "react-router-dom";
import { GameHeader } from "@gokkehub/ui";
import { useSession } from "./hooks/useSession";
import HomePage from "./pages/HomePage";
import JoinPage from "./pages/JoinPage";
import LobbyPage from "./pages/LobbyPage";
import BoardPage from "./pages/BoardPage";
import LibraryPage from "./pages/LibraryPage";

function Header() {
  const { session } = useSession();
  const location    = useLocation();

  // Don't show the header on the board — it uses its own toolbar to save space
  if (location.pathname.startsWith("/board")) return null;

  return (
    <GameHeader
      appName="GridChallenge"
      session={session}
      LinkComponent={Link}
      rightExtras={session ? (
        <Link
          to="/library"
          className="text-sm font-medium px-3 py-1.5 rounded-lg transition-all"
          style={{
            color:      "rgb(var(--text-muted-rgb))",
            background: "rgba(var(--surface-raised-rgb), 0.3)",
            border:     "1px solid rgba(255,255,255,0.06)",
          }}
        >
          🎮 Library
        </Link>
      ) : null}
    />
  );
}

export default function App() {
  return (
    <div className="min-h-dvh flex flex-col">
      <Header />
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
