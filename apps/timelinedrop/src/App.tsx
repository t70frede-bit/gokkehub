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

// Lets pages control the global header's room-code chip + invite button.
//
// Two independent flags:
//  - hideRoomCode: hides the always-visible room-code chip. ON for both
//    streamer mode (don't leak the code on stream) and gamemaster mode.
//  - hideInvite:   hides the copy-link / QR button. ON only for gamemaster
//    mode (solo play, nobody to invite). Streamer mode KEEPS the invite
//    button so the host can still share the link with friends — the code
//    just isn't pinned to the top of the screen the whole time.
//
// hideRoomCode DEFAULTS TO TRUE: the header reads roomCode from the URL
// instantly, but whether to show it depends on room settings that load
// async. Defaulting hidden means a streamer room never flashes its code
// for the frame before the settings arrive. Pages flip it to the real
// value once room data is loaded (and reset to the safe default on
// unmount). Normal rooms briefly hide the code on load then reveal it —
// an acceptable trade for never leaking a streamer's code.
interface HeaderState { hideRoomCode: boolean; hideInvite: boolean }
interface HeaderControls extends HeaderState {
  setHeaderControls: (next: HeaderState) => void;
}
const DEFAULT_HEADER: HeaderState = { hideRoomCode: true, hideInvite: false };
const HeaderControlsContext = createContext<HeaderControls>({
  ...DEFAULT_HEADER,
  setHeaderControls: () => {},
});
export function useHeaderControls(): HeaderControls {
  return useContext(HeaderControlsContext);
}
export const DEFAULT_HEADER_CONTROLS = DEFAULT_HEADER;
function HeaderControlsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<HeaderState>(DEFAULT_HEADER);
  return (
    <HeaderControlsContext.Provider value={{ ...state, setHeaderControls: setState }}>
      {children}
    </HeaderControlsContext.Provider>
  );
}

function AppShell() {
  const { session } = useSession();
  const roomCode    = useRoomCodeFromPath();
  const { hideRoomCode, hideInvite } = useHeaderControls();
  return (
    <div className="min-h-dvh flex flex-col">
      <GameHeader
        appName="musix"
        session={session}
        LinkComponent={Link}
        roomCode={roomCode}
        hideRoomCode={hideRoomCode}
        hideInvite={hideInvite}
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
