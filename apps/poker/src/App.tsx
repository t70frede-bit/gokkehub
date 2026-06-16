import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { useStandalone } from "@/hooks/useStandalone";
import Layout from "@/components/Layout";
import LoginPage from "@/pages/LoginPage";
import HomePage from "@/pages/HomePage";
import TopUpPage from "@/pages/TopUpPage";
import WithdrawPage from "@/pages/WithdrawPage";
import GamesPage from "@/pages/GamesPage";
import SessionPage from "@/pages/SessionPage";
import LeaderboardPage from "@/pages/LeaderboardPage";
import ProfilePage from "@/pages/ProfilePage";
import SettingsPage from "@/pages/SettingsPage";
import GroupsPage from "@/pages/GroupsPage";
import JoinInvitePage from "@/pages/JoinInvitePage";
import AdminPage from "@/pages/admin/AdminPage";

function FullScreenSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg-tint-1)" }}>
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none"
        stroke="rgb(var(--color-primary-rgb))" strokeWidth="2.5"
        style={{ animation: "spin 0.75s linear infinite" }}>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
      </svg>
    </div>
  );
}

export default function App() {
  const { session, profile, loading, isAdmin, activeGroup } = useAuth();
  const standalone = useStandalone();
  const location = useLocation();

  // Mark the document when installed (home-screen) so CSS can add the iPhone
  // safe-area top padding on EVERY screen (login, group gate, in-app), not just
  // the Layout header.
  useEffect(() => {
    document.documentElement.classList.toggle("pwa-standalone", standalone);
  }, [standalone]);

  // Capture an invite token from the URL as early as possible (even before
  // login) so it survives the Discord OAuth round-trip, which returns to "/".
  useEffect(() => {
    const m = window.location.pathname.match(/^\/join\/(.+)$/);
    if (m) localStorage.setItem("poker_pending_invite", m[1]);
  }, []);

  if (loading) return <FullScreenSpinner />;
  if (!session || !profile) return <LoginPage />;

  // Logged in: consume a pending invite (e.g. captured before login) by routing
  // to the join handler. JoinInvitePage clears the stash to avoid a loop.
  const pendingInvite = localStorage.getItem("poker_pending_invite");
  if (pendingInvite && location.pathname !== `/join/${pendingInvite}`) {
    return <Navigate to={`/join/${pendingInvite}`} replace />;
  }

  // No active group yet → the create/join gate (invite links still work).
  if (!activeGroup) {
    return (
      <Routes>
        <Route path="/join/:token" element={<JoinInvitePage />} />
        <Route path="*" element={<GroupsPage />} />
      </Routes>
    );
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/topup" element={<TopUpPage />} />
        <Route path="/withdraw" element={<WithdrawPage />} />
        <Route path="/games" element={<GamesPage />} />
        <Route path="/games/:id" element={<SessionPage />} />
        <Route path="/leaderboard" element={<LeaderboardPage />} />
        <Route path="/me" element={<ProfilePage />} />
        <Route path="/players/:id" element={<ProfilePage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/groups" element={<GroupsPage />} />
        <Route path="/join/:token" element={<JoinInvitePage />} />
        <Route path="/admin/*" element={isAdmin ? <AdminPage /> : <Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
