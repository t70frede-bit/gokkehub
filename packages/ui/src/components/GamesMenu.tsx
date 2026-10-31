import { useEffect, useRef, useState, type CSSProperties } from "react";
import { GOKKEHUB_GAMES, isCurrentGame, type GokkeHubGame } from "../lib/games.ts";

export interface GamesMenuProps {
  /** Games to list. Defaults to every GokkeHub game. */
  games?:   GokkeHubGame[];
  /** Link for "All games" at the bottom. */
  hubHref?: string;
  /** Which side of the button the panel lines up with. */
  align?:   "left" | "right";
}

/**
 * "Games" dropdown shared by every GokkeHub header: one tap to jump to any
 * other game. Live games are links; upcoming ones are listed as "Soon".
 */
export function GamesMenu({
  games   = GOKKEHUB_GAMES,
  hubHref = "https://gokkehub.com",
  align   = "left",
}: GamesMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const host = typeof window !== "undefined" ? window.location.hostname : null;

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown",   onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown",   onKey);
    };
  }, [open]);

  const live = games.filter((g) => g.status === "live");
  const soon = games.filter((g) => g.status === "soon");

  return (
    <div ref={wrapperRef} className="relative flex-shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-md px-2 py-1 font-semibold transition-all"
        style={{
          color:      open ? "rgb(var(--color-primary-rgb))" : "rgb(var(--text-secondary-rgb))",
          background: open ? "rgba(var(--color-primary-rgb),0.14)" : "transparent",
          border:     `1px solid ${open ? "rgba(var(--color-primary-rgb),0.5)" : "rgb(var(--border-rgb))"}`,
          fontSize:   "var(--text-sm)",
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="All games"
        title="All games"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <rect x="3"  y="3"  width="7.5" height="7.5" rx="2" />
          <rect x="13.5" y="3"  width="7.5" height="7.5" rx="2" />
          <rect x="3"  y="13.5" width="7.5" height="7.5" rx="2" />
          <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2" />
        </svg>
        <span className="hidden sm:inline">Games</span>
      </button>

      {open && (
        <div
          role="menu"
          className={`absolute ${align === "right" ? "right-0" : "left-0"} top-full mt-2 z-50 rounded-lg p-2 flex flex-col`}
          style={panelStyle}
        >
          {live.map((g) => {
            const current = isCurrentGame(g.url, host);
            return (
              <a
                key={g.url}
                role="menuitem"
                href={g.url}
                aria-current={current ? "page" : undefined}
                className="flex items-center gap-3 rounded-md px-3 py-2 transition-colors hover:bg-white/5"
                style={{
                  color:      current ? "rgb(var(--color-primary-rgb))" : "rgb(var(--text-primary-rgb))",
                  background: current ? "rgba(var(--color-primary-rgb),0.12)" : undefined,
                  fontSize:   "var(--text-sm)",
                  fontWeight: 600,
                }}
              >
                <span className="text-lg leading-none w-6 text-center" aria-hidden="true">{g.emoji}</span>
                <span className="flex-1">{g.name}</span>
                {current && <span style={tagStyle}>Here</span>}
              </a>
            );
          })}

          {soon.length > 0 && (
            <>
              <div className="my-1" style={{ borderTop: "1px solid rgb(var(--border-rgb))" }} />
              {soon.map((g) => (
                <div
                  key={g.url}
                  className="flex items-center gap-3 px-3 py-2"
                  style={{ color: "rgb(var(--text-muted-rgb))", fontSize: "var(--text-sm)" }}
                >
                  <span className="text-lg leading-none w-6 text-center opacity-60" aria-hidden="true">{g.emoji}</span>
                  <span className="flex-1">{g.name}</span>
                  <span style={tagStyle}>Soon</span>
                </div>
              ))}
            </>
          )}

          <div className="my-1" style={{ borderTop: "1px solid rgb(var(--border-rgb))" }} />
          <a
            role="menuitem"
            href={hubHref}
            className="rounded-md px-3 py-2 transition-colors hover:bg-white/5"
            style={{ color: "rgb(var(--text-secondary-rgb))", fontSize: "var(--text-sm)" }}
          >
            All games on GokkeHub →
          </a>
        </div>
      )}
    </div>
  );
}

const panelStyle: CSSProperties = {
  background: "rgb(var(--surface-overlay-rgb))",
  border:     "1px solid rgb(var(--border-rgb))",
  boxShadow:  "var(--shadow-elevated)",
  minWidth:   "240px",
};

const tagStyle: CSSProperties = {
  fontSize:      "10px",
  fontWeight:    700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  opacity:       0.8,
};
