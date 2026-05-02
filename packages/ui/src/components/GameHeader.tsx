import type { CSSProperties, ReactNode } from "react";

export interface GameHeaderSession {
  displayName?: string | null;
  avatarUrl?:   string | null;
  email?:       string | null;
}

export interface GameHeaderLinkProps {
  to:         string;
  className?: string;
  style?:     CSSProperties;
  children?:  ReactNode;
}

export interface GameHeaderProps {
  /** Display name of the app, shown after the GokkeHub › breadcrumb. */
  appName: string;
  /** Optional logged-in session — renders the account chip when present. */
  session?: GameHeaderSession | null;
  /** SPA-aware link component (e.g. react-router-dom's `Link`). Falls back to <a> when omitted. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  LinkComponent?: any;
  /** URL of the app home — used by the gradient app name link. */
  homeTo?: string;
  /** Extra content rendered before the account chip (e.g. a Library link). */
  rightExtras?: ReactNode;
  /** URL the GokkeHub breadcrumb points at. */
  hubHref?: string;
  /** URL the account chip points at. */
  accountHref?: string;
  /** URL the Sign-in link points at when there is no session. */
  signInHref?: string;
}

const headerStyle: CSSProperties = {
  background:           "rgba(var(--surface-base-rgb, 15 10 30), 0.7)",
  borderBottom:         "1px solid rgba(255,255,255,0.06)",
  backdropFilter:       "blur(12px)",
  WebkitBackdropFilter: "blur(12px)",
  position:             "sticky",
  top:                  0,
  zIndex:               40,
};

const gradientStyle: CSSProperties = {
  background:           "linear-gradient(135deg, rgb(var(--color-primary-rgb)), rgb(var(--color-secondary-rgb, var(--color-accent-rgb))))",
  WebkitBackgroundClip: "text",
  WebkitTextFillColor:  "transparent",
  backgroundClip:       "text",
};

export function GameHeader({
  appName,
  session,
  LinkComponent,
  homeTo      = "/",
  rightExtras,
  hubHref     = "https://gokkehub.com",
  accountHref = "https://account.gokkehub.com/profile",
  signInHref  = "https://account.gokkehub.com",
}: GameHeaderProps) {
  const HomeLink = LinkComponent ?? DefaultLink;

  return (
    <header className="flex items-center justify-between px-5 py-3 flex-shrink-0" style={headerStyle}>
      <div className="flex items-center gap-3">
        <a
          href={hubHref}
          className="font-bold text-sm leading-none tracking-tight"
          style={{ color: "rgb(var(--text-muted-rgb))" }}
        >
          GokkeHub
        </a>
        <span style={{ color: "rgba(255,255,255,0.2)" }}>›</span>
        <HomeLink
          to={homeTo}
          className="font-extrabold text-base leading-none tracking-tight"
          style={gradientStyle}
        >
          {appName}
        </HomeLink>
      </div>

      <div className="flex items-center gap-3">
        {rightExtras}
        {session ? (
          <a
            href={accountHref}
            className="flex items-center gap-2 text-sm font-medium rounded-lg px-3 py-1.5 transition-all"
            style={{
              color:      "rgb(var(--text-secondary-rgb))",
              background: "rgba(var(--surface-raised-rgb), 0.5)",
              border:     "1px solid rgba(255,255,255,0.08)",
            }}
          >
            {session.avatarUrl && (
              <img src={session.avatarUrl} alt="" className="w-5 h-5 rounded-full object-cover" />
            )}
            <span className="hidden sm:block">
              {session.displayName ?? session.email ?? "Account"}
            </span>
          </a>
        ) : (
          <a href={signInHref} className="text-sm font-medium" style={{ color: "rgb(var(--text-muted-rgb))" }}>
            Sign in
          </a>
        )}
      </div>
    </header>
  );
}

function DefaultLink({ to, className, style, children }: GameHeaderLinkProps) {
  return (
    <a href={to} className={className} style={style}>
      {children}
    </a>
  );
}
