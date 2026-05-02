import { useState, type CSSProperties, type ReactNode } from "react";

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
  /** Display name of the app (e.g. "musix", "gridchallenge") */
  appName: string;
  /** Optional logged-in session — renders the account chip when present. */
  session?: GameHeaderSession | null;
  /** SPA-aware link component (e.g. react-router-dom's `Link`). Falls back to <a>. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  LinkComponent?: any;
  homeTo?:        string;
  hubHref?:       string;
  accountHref?:   string;
  signInHref?:    string;
  rightExtras?:   ReactNode;

  /** Optional active room — when set, the header shows the code centred and a copy-link button. */
  roomCode?:      string;
  /** Hide the room code (streamer mode). */
  hideRoomCode?:  boolean;
  /** Override the invite URL — defaults to https://gokkehub.com/join?room=CODE so players land on the hub. */
  inviteUrl?:     string;
  /** Override the small label rendered before the code (default: "Lobby"). */
  roomLabel?:     string;
}

const headerStyle: CSSProperties = {
  background:    "rgb(var(--surface-raised-rgb))",
  borderBottom:  "1px solid rgb(var(--border-rgb))",
  position:      "sticky",
  top:           0,
  zIndex:        40,
  height:        "var(--header-height, 56px)",
};

const accentStyle: CSSProperties = {
  color:      "rgb(var(--color-primary-rgb))",
  fontFamily: "var(--font-display)",
};

export function GameHeader({
  appName,
  session,
  LinkComponent,
  homeTo      = "/",
  hubHref     = "https://gokkehub.com",
  accountHref = "https://account.gokkehub.com/profile",
  signInHref  = "https://account.gokkehub.com",
  rightExtras,
  roomCode,
  hideRoomCode = false,
  inviteUrl,
  roomLabel    = "Room",
}: GameHeaderProps) {
  const HomeLink = LinkComponent ?? DefaultLink;

  return (
    <header className="flex items-center px-4 sm:px-5 flex-shrink-0 gap-3" style={headerStyle}>

      {/* Left: breadcrumb */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <a
          href={hubHref}
          className="font-bold leading-none tracking-tight hidden sm:inline"
          style={{ color: "rgb(var(--text-muted-rgb))", fontSize: "var(--text-sm)" }}
        >
          GokkeHub
        </a>
        <span className="hidden sm:inline" style={{ color: "rgb(var(--text-muted-rgb))", opacity: 0.4 }}>›</span>
        <HomeLink
          to={homeTo}
          className="font-extrabold leading-none tracking-tight"
          style={{ ...accentStyle, fontSize: "var(--text-base)" }}
        >
          {appName}
        </HomeLink>
      </div>

      {/* Centre: room code */}
      <div className="flex-1 flex justify-center min-w-0">
        {roomCode && !hideRoomCode && (
          <div className="flex items-center gap-2 truncate">
            <span
              className="uppercase hidden md:inline"
              style={{
                color:        "rgb(var(--text-muted-rgb))",
                fontSize:     "var(--text-xs)",
                letterSpacing:"0.18em",
                fontWeight:   700,
              }}
            >
              {roomLabel}
            </span>
            <span
              className="leading-none truncate"
              style={{
                color:         "rgb(var(--color-primary-rgb))",
                fontFamily:    "var(--font-mono)",
                fontWeight:    700,
                fontSize:      "var(--text-lg)",
                letterSpacing: "0.15em",
              }}
            >
              {roomCode}
            </span>
          </div>
        )}
      </div>

      {/* Right: copy invite + extras + account */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {roomCode && !hideRoomCode && (
          <CopyInviteButton
            url={inviteUrl ?? `https://gokkehub.com/join?room=${encodeURIComponent(roomCode)}`}
          />
        )}
        {rightExtras}
        {session ? (
          <a
            href={accountHref}
            className="flex items-center gap-2 font-medium rounded-md px-2.5 py-1 transition-all"
            style={{
              color:      "rgb(var(--text-secondary-rgb))",
              background: "transparent",
              border:     "1px solid rgb(var(--border-rgb))",
              fontSize:   "var(--text-sm)",
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
          <a
            href={signInHref}
            className="font-medium"
            style={{ color: "rgb(var(--text-muted-rgb))", fontSize: "var(--text-sm)" }}
          >
            Sign in
          </a>
        )}
      </div>
    </header>
  );
}

function CopyInviteButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch { /* noop — clipboard may be blocked */ }
      }}
      className="font-bold rounded-md px-2.5 py-1 transition-all whitespace-nowrap active:scale-[0.98]"
      style={{
        background: copied ? "rgba(123,156,95,0.18)" : "transparent",
        color:      copied ? "rgb(var(--color-success-rgb))" : "rgb(var(--text-muted-rgb))",
        border:     `1px solid ${copied ? "rgba(123,156,95,0.5)" : "rgb(var(--border-rgb))"}`,
        fontSize:   "var(--text-xs)",
        letterSpacing: "0.04em",
      }}
      title="Copy invite link"
    >
      {copied ? "✓ Copied" : (
        <>
          <span className="hidden sm:inline">📋 Copy link</span>
          <span className="sm:hidden">📋</span>
        </>
      )}
    </button>
  );
}

function DefaultLink({ to, className, style, children }: GameHeaderLinkProps) {
  return (
    <a href={to} className={className} style={style}>
      {children}
    </a>
  );
}
