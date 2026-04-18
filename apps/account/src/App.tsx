import { Routes, Route, Navigate } from "react-router-dom";
import LoginPage from "./pages/LoginPage.tsx";
import ProfilePage from "./pages/ProfilePage.tsx";
import { useSession } from "./hooks/useSession.ts";

export default function App() {
  const { session, loading, refresh } = useSession();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-content-muted animate-pulse text-lg">Loading…</div>
      </div>
    );
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={session ? <Navigate to="/profile" replace /> : <LoginPage />}
      />
      <Route
        path="/profile"
        element={session ? <ProfilePage session={session} onSessionRefresh={refresh} /> : <Navigate to="/login" replace />}
      />
      <Route path="*" element={<Navigate to={session ? "/profile" : "/login"} replace />} />
    </Routes>
  );
}
