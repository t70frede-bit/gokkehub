import { Routes, Route, Navigate, Link, useLocation } from "react-router-dom";
import { GameHeader } from "@gokkehub/ui";
import { useSession } from "./hooks/useSession";
import DashboardPage      from "./pages/DashboardPage";
import SetupWizardPage    from "./pages/SetupWizardPage";
import JoinPage           from "./pages/JoinPage";
import LobbyPage          from "./pages/LobbyPage";
import BigScreenPage      from "./pages/BigScreenPage";
import HostControllerPage from "./pages/HostControllerPage";
import PlayerPage         from "./pages/PlayerPage";
import PostGamePage       from "./pages/PostGamePage";

// Pull a room code from the path when we're inside a room-scoped view.
// Lets the shared header always show the code in the same spot.
function useRoomCodeFromPath(): string | undefined {
  const { pathname } = useLocation();
  const m = pathname.match(/^\/(?:lobby|host|screen|play|end)\/([^/]+)/);
  return m?.[1];
}

export default function App() {
  const { session } = useSession();
  const roomCode    = useRoomCodeFromPath();
  const isBigScreen = useLocation().pathname.startsWith("/screen/");
  return (
    <div className="min-h-dvh flex flex-col">
      {/* The big screen is a passive TV display — no header chrome. */}
      {!isBigScreen && (
        <GameHeader
          appName="jeopardy"
          session={session}
          LinkComponent={Link}
          roomCode={roomCode}
        />
      )}
      <main className="flex-1 flex flex-col">
        <Routes>
          <Route path="/"               element={<DashboardPage />} />
          <Route path="/setup/:gameId"  element={<SetupWizardPage />} />
          <Route path="/join"           element={<JoinPage />} />
          <Route path="/lobby/:roomId"  element={<LobbyPage />} />
          <Route path="/host/:roomId"   element={<HostControllerPage />} />
          <Route path="/screen/:roomId" element={<BigScreenPage />} />
          <Route path="/play/:roomId"   element={<PlayerPage />} />
          <Route path="/end/:roomId"    element={<PostGamePage />} />
          <Route path="*"               element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
