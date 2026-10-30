import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { SiteHeader } from "@gokkehub/ui";
import LoginPage from "./pages/LoginPage.tsx";
import ProfilePage from "./pages/ProfilePage.tsx";
import LibraryPage from "./pages/LibraryPage.tsx";
import { useSession } from "./hooks/useSession.ts";
import { safeReturnUrl } from "@gokkehub/auth/redirect";

const TABS = [
  { href: "/profile", label: "Profile" },
  { href: "/library", label: "Library" },
];

export default function App() {
  const { session, loading, refresh } = useSession();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div style={{ color: "rgb(var(--text-muted-rgb))" }} className="animate-pulse text-lg">
          Loading…
        </div>
      </div>
    );
  }

  // Already signed in and sent here by a game's "Sign in" link — go straight back.
  if (session && location.pathname === "/login") {
    const returnTo = safeReturnUrl(new URLSearchParams(location.search).get("redirect"));
    if (returnTo) {
      window.location.replace(returnTo);
      return null;
    }
  }

  const handleLogout = async () => {
    await fetch("/auth/logout", { method: "DELETE", credentials: "include" });
    window.location.replace("/login");
  };

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader
        displayName={session?.displayName}
        avatarUrl={session?.avatarUrl}
        onLogout={session ? handleLogout : undefined}
        tabs={session ? TABS : undefined}
      />
      <main className="flex-1 flex flex-col">
        <Routes>
          <Route
            path="/login"
            element={session ? <Navigate to="/profile" replace /> : <LoginPage />}
          />
          <Route
            path="/profile"
            element={
              session
                ? <ProfilePage session={session} onSessionRefresh={refresh} />
                : <Navigate to="/login" replace />
            }
          />
          <Route
            path="/library"
            element={
              session
                ? <LibraryPage session={session} />
                : <Navigate to="/login" replace />
            }
          />
          <Route path="*" element={<Navigate to={session ? "/profile" : "/login"} replace />} />
        </Routes>
      </main>
    </div>
  );
}
