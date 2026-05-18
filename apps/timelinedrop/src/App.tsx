import { createContext, useContext, useState, type ReactNode } from "react";
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

// Lets pages flip the room-code chip off in the global header (streamer mode,
// gamemaster mode). Pages call `useHeaderControls().setHideRoomCode(true)`
// in a useEffect that depends on the relevant settings; App reads the
// current value and passes it to GameHeader. Resets to false on unmount so
// the next page doesn't inherit a stale value.
interface HeaderControls {
  hideRoomCode: boolean;
  setHideRoomCode: (b: boolean) => void;
}
const HeaderControlsContext = createContext<HeaderControls>({
  hideRoomCode: false,
  setHideRoomCode: () => {},
});
export function useHeaderControls(): HeaderControls {
  return useContext(HeaderControlsContext);
}
function HeaderControlsProvider({ children }: { children: ReactNode }) {
  const [hideRoomCode, setHideRoomCode] = useState(false);
  return (
    <HeaderControlsContext.Provider value={{ hideRoomCode, setHideRoomCode }}>
      {children}
    </HeaderControlsContext.Provider>
  );
}

function AppShell() {
  const { session } = useSession();
  const roomCode    = useRoomCodeFromPath();
  const { hideRoomCode } = useHeaderControls();
  return (
    <div className="min-h-dvh flex flex-col">
      <GameHeader
        appName="musix"
        session={session}
        LinkComponent={Link}
        roomCode={roomCode}
        hideRoomCode={hideRoomCode}
      />
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

export default function App() {
  return (
    <HeaderControlsProvider>
      <AppShell />
    </HeaderControlsProvider>
  );
}
