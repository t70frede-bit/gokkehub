import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import Layout from "@/components/Layout";
import SiteGate from "@/components/SiteGate";
import LoginPage from "@/pages/LoginPage";
import HomePage from "@/pages/HomePage";
import TopUpPage from "@/pages/TopUpPage";
import GamesPage from "@/pages/GamesPage";
import SessionPage from "@/pages/SessionPage";
import LeaderboardPage from "@/pages/LeaderboardPage";
import ProfilePage from "@/pages/ProfilePage";
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
  const { session, profile, loading, isAdmin } = useAuth();

  if (loading) return <FullScreenSpinner />;
  if (!session || !profile) return <LoginPage />;

  // Discord login first, THEN the one-time site-code gate, then the app.
  return (
    <SiteGate>
      <Layout>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/topup" element={<TopUpPage />} />
          <Route path="/games" element={<GamesPage />} />
          <Route path="/games/:id" element={<SessionPage />} />
          <Route path="/leaderboard" element={<LeaderboardPage />} />
          <Route path="/me" element={<ProfilePage />} />
          <Route path="/players/:id" element={<ProfilePage />} />
          <Route path="/admin/*" element={isAdmin ? <AdminPage /> : <Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </SiteGate>
  );
}
