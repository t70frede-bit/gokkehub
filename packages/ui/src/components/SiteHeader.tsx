import { useState } from "react";

export interface SiteHeaderTab {
  href:  string;
  label: string;
}

export interface SiteHeaderProps {
  /** Current user's display name — shown in header when provided */
  displayName?: string | null;
  /** Avatar URL — shown as small circle when provided */
  avatarUrl?: string | null;
  /** Called when Sign out is clicked. Omit to hide the button. */
  onLogout?: () => void;
  /** Tabs shown below the header bar — active tab detected from current path */
  tabs?: SiteHeaderTab[];
}

export function SiteHeader({ displayName, avatarUrl, onLogout, tabs }: SiteHeaderProps) {
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = async () => {
    if (!onLogout) return;
    setLoggingOut(true);
    await onLogout();
    setLoggingOut(false);
  };

  const currentPath =
    typeof window !== "undefined" ? window.location.pathname : "";

  return (
    <div className="flex-shrink-0">
      {/* ── Main bar ── */}
      <header
        className="flex items-center justify-between px-5 py-3"
        style={{
          background: "rgba(var(--surface-base-rgb, 15 10 30), 0.7)",
          borderBottom: tabs?.length ? "none" : "1px solid rgba(255,255,255,0.06)",
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

        {(displayName || onLogout) && (
          <div className="flex items-center gap-3">
            {displayName && (
              <div className="flex items-center gap-2">
                {avatarUrl && (
                  <img
                    src={avatarUrl}
                    alt=""
                    className="w-7 h-7 rounded-full object-cover"
                    style={{ border: "1.5px solid rgba(255,255,255,0.12)" }}
                  />
                )}
                <span
                  className="text-sm hidden sm:block"
                  style={{ color: "rgb(var(--text-muted-rgb))" }}
                >
                  {displayName}
                </span>
              </div>
            )}

            {onLogout && (
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
                  <svg
                    style={{ width: 14, height: 14, animation: "spin 0.75s linear infinite" }}
                    viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                  >
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
            )}
          </div>
        )}
      </header>

      {/* ── Tab bar ── */}
      {tabs && tabs.length > 0 && (
        <nav
          className="flex gap-1 px-5"
          style={{
            background: "rgba(var(--surface-base-rgb, 15 10 30), 0.7)",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          {tabs.map(({ href, label }) => {
            const isActive = currentPath === href || currentPath.startsWith(href + "/");
            return (
              <a
                key={href}
                href={href}
                className="px-4 py-3 text-sm font-semibold transition-colors"
                style={{
                  color: isActive
                    ? "rgb(var(--color-primary-rgb))"
                    : "rgb(var(--text-muted-rgb))",
                  borderBottom: isActive
                    ? "2px solid rgb(var(--color-primary-rgb))"
                    : "2px solid transparent",
                  textDecoration: "none",
                }}
              >
                {label}
              </a>
            );
          })}
        </nav>
      )}
    </div>
  );
}
