import { useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import LoginPage from "./pages/LoginPage.tsx";
import ProfilePage from "./pages/ProfilePage.tsx";
import { useSession } from "./hooks/useSession.ts";

export default function App() {
  const { session, loading, refresh } = useSession();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div style={{ color: "rgb(var(--text-muted-rgb))" }} className="animate-pulse text-lg">
          Loading…
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader session={session} />
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
          <Route path="*" element={<Navigate to={session ? "/profile" : "/login"} replace />} />
        </Routes>
      </main>
    </div>
  );
}

/* ── Shared top header ── */

import type { PublicSessionData } from "@gokkehub/auth/types";

function AppHeader({ session }: { session: PublicSessionData | null }) {
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await fetch("/auth/logout", { method: "DELETE", credentials: "include" });
    } finally {
      // Hard reload clears React session state and forces a fresh /auth/me check
      window.location.replace("/login");
    }
  };

  return (
    <header
      className="flex items-center justify-between px-5 py-3 flex-shrink-0"
      style={{
        background: "rgba(var(--surface-base-rgb, 15 10 30), 0.7)",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
      }}
    >
      <a
        href="https://gokkehub.com"
        className="font-bold text-lg leading-none tracking-tight"
        style={{ color: "rgb(var(--text-primary-rgb))" }}
      >
        Gokke<span className="text-gradient">Hub</span>
      </a>

      {session && (
        <div className="flex items-center gap-3">
          <span className="text-sm hidden sm:block" style={{ color: "rgb(var(--text-muted-rgb))" }}>
            {session.displayName}
          </span>
          <button
            onClick={handleLogout}
            disabled={loggingOut}
            className="flex items-center gap-1.5 text-sm font-medium rounded-lg px-3 py-1.5 transition-all disabled:opacity-60"
            style={{
              color: "rgb(var(--text-secondary-rgb))",
              background: "rgba(var(--surface-raised-rgb), 0.5)",
              border: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            {loggingOut ? (
              <svg style={{ width: "14px", height: "14px", animation: "spin 0.75s linear infinite" }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            )}
            {loggingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      )}
    </header>
  );
}
