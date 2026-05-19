import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import QRCode from "qrcode";

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

export interface CopyInviteButtonProps {
  url:    string;
  /** Visual size. "sm" (default) matches the header chip; "md" is roomier
   *  for prominent in-page calls-to-action like the Lobby sub-header. */
  size?:  "sm" | "md";
}

export function CopyInviteButton({ url, size = "sm" }: CopyInviteButtonProps) {
  const [copied, setCopied] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Generate the QR once per URL. Level H error correction (~30%
  // recoverable) is high enough that the centred GokkeHub favicon
  // can cover the middle ~17% of the code without breaking scans.
  // Dark + light colours come straight off the v0.2 "vinyl liner
  // notes" palette so the QR sits visually inside the rest of the UI.
  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(url, {
      margin:                1,
      width:                 300,
      errorCorrectionLevel:  "H",
      color: { dark: "#221E1B", light: "#FFF8EF" },
    })
      .then(data => { if (!cancelled) setQrDataUrl(data); })
      .catch(() => { if (!cancelled) setQrDataUrl(null); });
    return () => { cancelled = true; };
  }, [url]);

  // Close the QR popover on outside-click or Escape so it behaves like
  // a normal dropdown menu.
  useEffect(() => {
    if (!qrOpen) return;
    function onDocClick(e: MouseEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) setQrOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setQrOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown",   onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown",   onKey);
    };
  }, [qrOpen]);

  // Two size presets keep visual continuity with whichever surface the
  // button lives on. "sm" matches the global header chip; "md" gives the
  // Lobby sub-header version enough weight to read as a primary CTA.
  const copyPad   = size === "md" ? "px-3 py-1.5"  : "px-2.5 py-1";
  const qrPad     = size === "md" ? "px-2.5 py-1.5" : "px-2 py-1";
  const fontSize  = size === "md" ? "var(--text-sm)" : "var(--text-xs)";

  return (
    <div ref={wrapperRef} className="relative flex items-stretch">
      {/* Main copy button — left half. Keeps the original click-to-copy UX. */}
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch { /* noop — clipboard may be blocked */ }
        }}
        className={`font-bold rounded-l-md ${copyPad} transition-all whitespace-nowrap active:scale-[0.98]`}
        style={{
          background: copied ? "rgba(123,156,95,0.18)" : "transparent",
          color:      copied ? "rgb(var(--color-success-rgb))" : "rgb(var(--text-muted-rgb))",
          border:     `1px solid ${copied ? "rgba(123,156,95,0.5)" : "rgb(var(--border-rgb))"}`,
          fontSize,
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

      {/* QR dropdown trigger — right half. Visually attached (rounded-r,
          negative left border so the two buttons share a seam). */}
      <button
        type="button"
        onClick={() => setQrOpen(o => !o)}
        className={`font-bold rounded-r-md ${qrPad} transition-all active:scale-[0.98] -ml-px`}
        style={{
          background: qrOpen ? "rgba(var(--color-primary-rgb),0.18)" : "transparent",
          color:      qrOpen ? "rgb(var(--color-primary-rgb))" : "rgb(var(--text-muted-rgb))",
          border:     `1px solid ${qrOpen ? "rgba(var(--color-primary-rgb),0.5)" : "rgb(var(--border-rgb))"}`,
          fontSize,
        }}
        aria-label="Show QR code"
        aria-expanded={qrOpen}
        title="Show QR code (scan with phone)"
      >
        📱
      </button>

      {qrOpen && (
        <div
          className="absolute right-0 top-full mt-2 z-50 rounded-lg p-3 flex flex-col items-center gap-2"
          style={{
            background: "rgb(var(--surface-overlay-rgb))",
            border:     "1px solid rgb(var(--border-rgb))",
            boxShadow:  "var(--shadow-elevated)",
            minWidth:   "260px",
          }}
        >
          {qrDataUrl ? (
            // Relative-positioned wrapper so the GokkeHub favicon can be
            // absolute-centred over the QR's middle. Level H error
            // correction (set in toDataURL above) keeps the QR scannable
            // even with the logo covering the centre ~17%.
            <div className="relative">
              <img
                src={qrDataUrl}
                alt="Scan to join this room"
                width={240}
                height={240}
                className="rounded-md block"
                draggable={false}
              />
              <div
                className="absolute inset-0 flex items-center justify-center pointer-events-none"
                aria-hidden="true"
              >
                {/* GokkeHub favicon — amber G on warm-charcoal, framed by
                    the QR's cream so the logo reads as a single object
                    instead of blending with QR cells. Inlined SVG so it
                    works cross-app without a network fetch. */}
                <div
                  className="rounded-md flex items-center justify-center"
                  style={{
                    width:      "52px",
                    height:     "52px",
                    background: "#FFF8EF",
                    border:     "3px solid #FFF8EF",
                    boxShadow:  "0 1px 3px rgba(0,0,0,0.25)",
                  }}
                >
                  <svg viewBox="0 0 64 64" width="40" height="40">
                    <rect width="64" height="64" rx="12" fill="#221E1B"/>
                    <path
                      d="M 47 22 A 18 18 0 1 0 47 42 L 36 42 L 36 34"
                      fill="none"
                      stroke="#D4A04A"
                      strokeWidth="8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
              </div>
            </div>
          ) : (
            <div className="w-[240px] h-[240px] flex items-center justify-center text-xs opacity-50">
              Generating…
            </div>
          )}
          <p className="text-xs text-center" style={{ color: "rgb(var(--text-muted-rgb))" }}>
            Scan with a phone camera to join the room
          </p>
          <code
            className="text-[10px] px-2 py-1 rounded w-full text-center truncate"
            style={{
              background: "rgba(255,255,255,0.04)",
              fontFamily: "var(--font-mono)",
              color:      "rgb(var(--text-muted-rgb))",
            }}
            title={url}
          >
            {url}
          </code>
        </div>
      )}
    </div>
  );
}

function DefaultLink({ to, className, style, children }: GameHeaderLinkProps) {
  return (
    <a href={to} className={className} style={style}>
      {children}
    </a>
  );
}
