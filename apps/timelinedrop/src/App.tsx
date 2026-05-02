import { Routes, Route, Navigate, Link, useLocation } from "react-router-dom";
import { GameHeader } from "@gokkehub/ui";
import { useSession } from "./hooks/useSession";
import HomePage   from "./pages/HomePage";
import JoinPage   from "./pages/JoinPage";
import LobbyPage  from "./pages/LobbyPage";
import GamePage   from "./pages/GamePage";
import EndPage    from "./pages/EndPage";
import DebugPage  from "./pages/DebugPage";
import DesignPage from "./pages/DesignPage";

// Pull a room code from the path when we're inside /lobby /game or /end.
// Lets the shared header always show the code in the same spot.
function useRoomCodeFromPath(): string | undefined {
  const { pathname } = useLocation();
  const m = pathname.match(/^\/(?:lobby|game|end)\/([^/]+)/);
  return m?.[1];
}

export default function App() {
  const { session } = useSession();
  const roomCode    = useRoomCodeFromPath();
  return (
    <div className="min-h-dvh flex flex-col">
      <GameHeader appName="musix" session={session} LinkComponent={Link} roomCode={roomCode} />
      <main className="flex-1 flex flex-col">
        <Routes>
          <Route path="/"              element={<HomePage />} />
          <Route path="/join"          element={<JoinPage />} />
          <Route path="/lobby/:roomId" element={<LobbyPage />} />
          <Route path="/game/:roomId"  element={<GamePage />} />
          <Route path="/end/:roomId"   element={<EndPage />} />
          <Route path="/debug"         element={<DebugPage />} />
          <Route path="/design"        element={<DesignPage />} />
          <Route path="*"              element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
