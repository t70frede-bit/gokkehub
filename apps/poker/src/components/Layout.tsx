import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { useStandalone } from "@/hooks/useStandalone";
import InstallBanner from "@/components/InstallBanner";

const ICONS: Record<string, JSX.Element> = {
  home: <path d="M3 11.5 12 4l9 7.5M5 10v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9" />,
  games: <><circle cx="12" cy="12" r="9" /><path d="M12 7v10M7 12h10" /></>,
  board: <path d="M4 20V10M10 20V4M16 20v-7M20 20H2" />,
  me: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  admin: <><path d="M12 2 4 6v6c0 5 3.5 8 8 10 4.5-2 8-5 8-10V6z" /></>,
};

function TabIcon({ name }: { name: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {ICONS[name]}
    </svg>
  );
}

const tabClass =
  "flex flex-col items-center justify-center gap-0.5 flex-1 py-2 text-[10px] font-bold uppercase tracking-wide transition-colors";

const tabStyle = (isActive: boolean) => ({
  color: isActive ? "rgb(var(--color-primary-rgb))" : "rgb(var(--text-muted-rgb))",
  letterSpacing: "0.04em",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  const { isAdmin, logout, activeGroup } = useAuth();
  const navigate = useNavigate();
  const standalone = useStandalone();

  const tabs = [
    { to: "/", icon: "home", label: "Home", end: true },
    { to: "/games", icon: "games", label: "Games", end: false },
    { to: "/leaderboard", icon: "board", label: "Board", end: false },
    { to: "/me", icon: "me", label: "Me", end: true },
    ...(isAdmin ? [{ to: "/admin", icon: "admin", label: "Admin", end: false }] : []),
  ];

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--bg-tint-1)" }}>
      {/* Top bar */}
      <header
        className="flex items-center justify-between px-4 flex-shrink-0 sticky top-0 z-40"
        style={{
          // Installed (standalone) on iPhone the web view extends under the
          // status bar/notch, cutting off the header — pad the top by the safe
          // area only when running as an app (it's 0 in a normal browser tab).
          minHeight: 56,
          paddingTop: standalone ? "env(safe-area-inset-top)" : undefined,
          background: "rgba(var(--surface-base-rgb), 0.85)",
          borderBottom: "1px solid rgb(var(--border-rgb))",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
        }}
      >
        <button
          onClick={() => navigate("/")}
          className="font-display font-bold text-lg leading-none tracking-tight"
          style={{ color: "rgb(var(--text-primary-rgb))" }}
        >
          Gokke<span style={{ color: "rgb(var(--color-primary-rgb))" }}>Poker</span>
        </button>
        <div className="flex items-center gap-2">
          {activeGroup && (
            <button
              onClick={() => navigate("/groups")}
              className="text-xs font-bold rounded-full px-3 py-1.5 max-w-[40vw] truncate"
              style={{
                color: "rgb(var(--color-primary-rgb))",
                background: "rgba(var(--color-primary-rgb), 0.14)",
                border: "1px solid rgba(var(--color-primary-rgb), 0.5)",
              }}
              title="Switch group"
            >
              {activeGroup.name} ▾
            </button>
          )}
          <button
            onClick={logout}
            className="text-xs font-semibold rounded-md px-2.5 py-1.5"
            style={{ color: "rgb(var(--text-muted-rgb))", border: "1px solid rgb(var(--border-rgb))" }}
          >
            Sign out
          </button>
        </div>
      </header>

      {/* Page body */}
      <main className="flex-1 w-full max-w-lg mx-auto px-4 py-5 pb-28">
        {!standalone && <InstallBanner />}
        {children}
      </main>

      {/* Bottom tab nav */}
      <nav
        className="fixed bottom-0 inset-x-0 z-40 flex"
        style={{
          background: "rgba(var(--surface-raised-rgb), 0.95)",
          borderTop: "1px solid rgb(var(--border-rgb))",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        {tabs.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} className={tabClass}
            style={({ isActive }) => tabStyle(isActive)}>
            <TabIcon name={t.icon} />
            {t.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
