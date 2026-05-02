import { Routes, Route, Navigate, Link } from "react-router-dom";
import { GameHeader } from "@gokkehub/ui";
import { useSession } from "./hooks/useSession";
import HomePage  from "./pages/HomePage";
import JoinPage  from "./pages/JoinPage";
import LobbyPage from "./pages/LobbyPage";
import GamePage  from "./pages/GamePage";
import EndPage   from "./pages/EndPage";
import DebugPage from "./pages/DebugPage";

export default function App() {
  const { session } = useSession();
  return (
    <div className="min-h-dvh flex flex-col">
      <GameHeader appName="musix" session={session} LinkComponent={Link} />
      <main className="flex-1 flex flex-col">
        <Routes>
          <Route path="/"              element={<HomePage />} />
          <Route path="/join"          element={<JoinPage />} />
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
