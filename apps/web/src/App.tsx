import { useEffect, useState } from "react";

// ── Game catalogue ────────────────────────────────────────────────────────────

interface Game {
  name: string;
  tagline: string;
  description: string;
  emoji: string;
  url: string;
  /** CSS rgb() color for card accent — taken from each game's theme file */
  accentRgb: string;
  secondaryRgb: string;
  status: "live" | "soon";
}

const GAMES: Game[] = [
  {
    name: "Grid Challenge",
    tagline: "Team bingo with a twist",
    description:
      "Split into teams, claim squares by completing challenges, and race to bingo. Custom challenge sets, live lobby, and team chaos.",
    emoji: "🎯",
    url: "https://partybingo.gokkehub.com",
    accentRgb: "184, 100, 82",
    secondaryRgb: "212, 160, 74",
    status: "live",
  },
  {
    name: "Track Guess",
    tagline: "Name that tune",
    description:
      "A snippet plays — first team to buzz in and name the song scores. Pull from any Spotify playlist. Points, streaks, and chaos ensue.",
    emoji: "🎵",
    url: "https://musicquiz.gokkehub.com",
    accentRgb: "123, 156, 95",
    secondaryRgb: "212, 160, 74",
    status: "soon",
  },
  {
    name: "Musix",
    tagline: "Sort the hits by year",
    description:
      "A song plays — place it on your team's timeline in the right year. Closer is better. Earn tokens by guessing the artist + name. Hitster, but with your group's actual taste.",
    emoji: "🎵",
    url: "https://musix.gokkehub.com",
    accentRgb: "212, 160, 74",
    secondaryRgb: "184, 133, 59",
    status: "live",
  },
  {
    name: "BeatRank",
    tagline: "Music trivia showdown",
    description:
      "Fastest fingers, sharpest ears. Answer music trivia, rank artists, and climb the leaderboard. No Spotify required.",
    emoji: "🏆",
    url: "https://bezzerwizzer.gokkehub.com",
    accentRgb: "74, 123, 156",
    secondaryRgb: "212, 160, 74",
    status: "soon",
  },
];

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  // Lightweight client-side router. Any path other than the catalogue gets
  // routed below via the simple switch in <Catalogue /> wrapper.
  const path = typeof window !== "undefined" ? window.location.pathname : "/";
  if (path === "/join") return <JoinRedirect />;

  return <Catalogue />;
}

function Catalogue() {
  return (
    <div
      className="min-h-screen relative overflow-x-hidden"
      style={{ background: "var(--bg-tint-1)" }}
    >
      {/* Ambient orbs removed for v0.2 — solid surfaces only. */}

      {/* Nav */}
      <header className="relative z-10 flex items-center justify-between px-6 py-5 max-w-6xl mx-auto">
        <span className="font-bold text-lg text-content-primary tracking-tight">
          Gokke<span className="text-gradient">Hub</span>
        </span>
        <a
          href="https://account.gokkehub.com"
          className="text-sm text-content-secondary hover:text-content-primary transition-colors border border-white/10 rounded-xl px-4 py-2 hover:border-white/25"
        >
          My Account
        </a>
      </header>

      {/* Hero */}
      <section className="relative z-10 text-center px-6 pt-16 pb-16 max-w-3xl mx-auto">
        <div className="inline-flex items-center gap-2 text-sm text-content-muted border border-white/10 rounded-full px-4 py-1.5 mb-8">
          <span
            className="w-2 h-2 rounded-full"
            style={{ background: "rgb(var(--color-primary-rgb))" }}
          />
          Party games for groups
        </div>

        <h1
          className="font-extrabold tracking-tight leading-[1.05] mb-4"
          style={{
            fontFamily: "var(--font-display)",
            fontSize:   "clamp(40px, 8vw, var(--text-display))",
            color:      "rgb(var(--text-primary-rgb))",
            letterSpacing: "-0.02em",
          }}
        >
          Join a game
        </h1>

        <p
          className="mx-auto mb-8"
          style={{
            color:    "rgb(var(--text-secondary-rgb))",
            fontSize: "var(--text-lg)",
            maxWidth: 560,
          }}
        >
          Got a code from your host? Drop it in. We'll send you to the right game.
        </p>

        <HeroJoinForm />

        <p
          className="mt-8"
          style={{ color: "rgb(var(--text-muted-rgb))", fontSize: "var(--text-sm)" }}
        >
          …or{" "}
          <a
            href="#games"
            className="font-semibold underline-offset-4 hover:underline"
            style={{ color: "rgb(var(--color-primary-rgb))" }}
          >
            host your own game
          </a>
          {" "}— pick one below.
        </p>
      </section>

      {/* Game cards — anchor target for "host your own game" */}
      <section id="games" className="relative z-10 px-4 pb-24 max-w-6xl mx-auto scroll-mt-12">
        <h2
          className="font-bold mb-6 tracking-tight"
          style={{ fontFamily: "var(--font-display)", fontSize: "var(--text-2xl)" }}
        >
          Host your own
        </h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-2 gap-4">
          {GAMES.map((game) => (
            <GameCard key={game.name} game={game} />
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/5 py-8 px-6 text-center">
        <p className="text-content-muted text-sm flex flex-wrap justify-center gap-x-4 gap-y-1">
          <span>© 2026 GokkeHub</span>
          <a href="https://account.gokkehub.com" className="hover:text-content-secondary transition-colors">Account</a>
          <a href="/privacy" className="hover:text-content-secondary transition-colors">Privacy Policy</a>
          <a href="/terms"   className="hover:text-content-secondary transition-colors">Terms of Service</a>
        </p>
      </footer>
    </div>
  );
}

// ── GameCard ──────────────────────────────────────────────────────────────────

function GameCard({ game }: { game: Game }) {
  const isLive = game.status === "live";

  return (
    <a
      href={isLive ? game.url : undefined}
      className={[
        "game-card block rounded-xl p-6 relative overflow-hidden transition-all",
        isLive ? "cursor-pointer" : "cursor-default opacity-60",
      ].join(" ")}
      style={{
        background: "rgb(var(--surface-raised-rgb))",
        border:     "1px solid rgb(var(--border-rgb))",
        borderTop:  `3px solid rgb(${game.accentRgb})`,
        boxShadow:  "var(--shadow-card)",
      }}
      aria-label={isLive ? `Play ${game.name}` : `${game.name} — coming soon`}
    >
      {/* Subtle corner accent (kept as a soft tint, not a glow) */}
      <div
        className="absolute -top-12 -right-12 w-40 h-40 rounded-full pointer-events-none"
        style={{
          background: `radial-gradient(circle, rgba(${game.accentRgb}, 0.10) 0%, transparent 70%)`,
        }}
        aria-hidden
      />

      <div className="relative flex items-start gap-4">
        {/* Emoji icon */}
        <div
          className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl flex-shrink-0"
          style={{ background: `rgb(${game.accentRgb} / 0.15)` }}
        >
          {game.emoji}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h2 className="text-content-primary font-bold text-lg leading-tight">
              {game.name}
            </h2>
            {isLive ? (
              <span
                className="text-xs font-semibold px-2 py-0.5 rounded-full"
                style={{
                  background: `rgb(${game.accentRgb} / 0.2)`,
                  color: `rgb(${game.accentRgb})`,
                }}
              >
                Live
              </span>
            ) : (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-white/5 text-content-muted">
                Coming soon
              </span>
            )}
          </div>

          <p
            className="text-sm font-medium mb-2"
            style={{ color: `rgb(${game.accentRgb})` }}
          >
            {game.tagline}
          </p>

          <p className="text-content-muted text-sm leading-relaxed">
            {game.description}
          </p>
        </div>
      </div>

      {isLive && (
        <div
          className="mt-4 flex items-center gap-1.5 text-sm font-medium"
          style={{ color: `rgb(${game.accentRgb})` }}
        >
          Play now
          <span aria-hidden>→</span>
        </div>
      )}
    </a>
  );
}

// ── Hero join form — inline code input on the front page ───────────────────
// Submitting just navigates to /join?room=CODE; the JoinRedirect view below
// handles the actual lookup + forward to the matching game.

function HeroJoinForm() {
  const [code, setCode] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;
    window.location.href = `/join?room=${encodeURIComponent(trimmed)}`;
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mx-auto flex flex-col sm:flex-row gap-2 sm:gap-2 items-stretch"
      style={{ maxWidth: 480 }}
    >
      <input
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        placeholder="ABC123"
        maxLength={12}
        aria-label="Room code"
        className="flex-1 rounded-md px-4 py-3 text-center font-bold outline-none transition-all"
        style={{
          background:    "rgb(var(--surface-input-rgb))",
          border:        "1px solid rgb(var(--border-rgb))",
          color:         "rgb(var(--color-primary-rgb))",
          fontFamily:    "var(--font-mono)",
          fontSize:      "var(--text-xl)",
          letterSpacing: "0.18em",
          caretColor:    "rgb(var(--color-primary-rgb))",
        }}
      />
      <button
        type="submit"
        disabled={!code.trim()}
        className="rounded-md px-6 py-3 font-bold transition-all active:scale-[0.98] disabled:opacity-45 disabled:cursor-not-allowed"
        style={{
          background: "rgb(var(--color-primary-rgb))",
          color:      "rgb(var(--bg-rgb))",
          fontSize:   "var(--text-base)",
        }}
      >
        Continue →
      </button>
    </form>
  );
}

// ── /join — looks up a room code and forwards to the right game ────────────

// Game subdomains used as the fallback picker when the lookup endpoint is
// unavailable. Keep in sync with apps/web/functions/api/find-room.ts.
const GAME_SUBDOMAINS = [
  { label: "musix",         subdomain: "musix.gokkehub.com"      },
  { label: "gridchallenge", subdomain: "partybingo.gokkehub.com" },
] as const;

function JoinRedirect() {
  const initialCode = typeof window !== "undefined"
    ? (new URLSearchParams(window.location.search).get("room") ?? "").toUpperCase().trim()
    : "";

  const [code,  setCode]  = useState(initialCode);
  const [state, setState] = useState<"idle" | "looking" | "notfound" | "error" | "fallback">(
    initialCode ? "looking" : "idle",
  );
  const [errMsg, setErrMsg] = useState<string | null>(null);

  async function lookup(target: string) {
    setState("looking");
    setErrMsg(null);
    try {
      const res = await fetch(`/api/find-room?code=${encodeURIComponent(target)}`);
      // Detect SPA fallback / HTML error pages. The Function should always
      // return JSON; anything else means the deploy hasn't routed correctly
      // and we should show a manual game picker instead of a parse error.
      const ct = res.headers.get("Content-Type") ?? "";
      if (!ct.includes("application/json")) {
        setState("fallback");
        setErrMsg("Lookup service is offline — pick your game below.");
        return;
      }
      if (res.status === 404) { setState("notfound"); return; }
      if (!res.ok) {
        setState("fallback");
        setErrMsg(`Lookup failed (${res.status}).`);
        return;
      }
      const data = await res.json() as { url?: string };
      if (data.url) { window.location.replace(data.url); return; }
      setState("notfound");
    } catch (err) {
      // Network error or JSON parse fail — fall back to manual picker.
      setState("fallback");
      setErrMsg(err instanceof Error ? err.message : "Network error");
    }
  }

  // Auto-lookup if a code came in via the URL.
  useEffect(() => {
    if (initialCode) lookup(initialCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    lookup(code.trim().toUpperCase());
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: "var(--bg-tint-1)" }}>
      <div
        className="w-full max-w-sm rounded-xl p-6 sm:p-8"
        style={{
          background: "rgb(var(--surface-raised-rgb))",
          border:     "1px solid rgb(var(--border-rgb))",
          boxShadow:  "var(--shadow-card)",
        }}
      >
        <p
          className="font-bold uppercase mb-2"
          style={{ color: "rgb(var(--color-primary-rgb))", fontSize: 11, letterSpacing: "0.18em" }}
        >
          GokkeHub
        </p>
        <h1
          className="text-3xl font-extrabold mb-1 tracking-tight"
          style={{ fontFamily: "var(--font-display)", color: "rgb(var(--text-primary-rgb))" }}
        >
          Join a room
        </h1>
        <p className="text-sm mb-6" style={{ color: "rgb(var(--text-muted-rgb))" }}>
          Enter the code your host shared. We'll send you to the right game.
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="ABC123"
            maxLength={12}
            autoFocus
            className="w-full rounded-md px-4 py-3 text-center text-2xl font-bold outline-none tracking-widest"
            style={{
              background: "rgb(var(--surface-input-rgb))",
              border:     "1px solid rgb(var(--border-rgb))",
              color:      "rgb(var(--color-primary-rgb))",
              fontFamily: "var(--font-mono)",
              caretColor: "rgb(var(--color-primary-rgb))",
            }}
          />
          <button
            type="submit"
            disabled={!code.trim() || state === "looking"}
            className="rounded-md py-3 font-bold transition-all active:scale-[0.98] disabled:opacity-45"
            style={{
              background: "rgb(var(--color-primary-rgb))",
              color:      "rgb(var(--bg-rgb))",
              fontSize:   15,
            }}
          >
            {state === "looking" ? "Finding game…" : "Continue"}
          </button>
        </form>

        {state === "notfound" && (
          <p
            className="text-sm mt-4 px-3 py-2 rounded-md"
            style={{
              background: "rgba(199,85,61,0.10)",
              border:     "1px solid rgba(199,85,61,0.4)",
              color:      "rgb(var(--color-danger-rgb))",
            }}
          >
            No room with that code. Check the spelling — codes are 4–12 letters/numbers.
          </p>
        )}
        {state === "error" && (
          <p
            className="text-sm mt-4 px-3 py-2 rounded-md"
            style={{
              background: "rgba(199,85,61,0.10)",
              border:     "1px solid rgba(199,85,61,0.4)",
              color:      "rgb(var(--color-danger-rgb))",
            }}
          >
            Couldn't reach the lookup service. {errMsg && `(${errMsg})`}
          </p>
        )}

        {/* Fallback: manual game picker. Shown when /api/find-room is offline
            so players can still get into the game by picking the right one. */}
        {state === "fallback" && code.trim() && (
          <div className="mt-4">
            <p
              className="text-sm mb-2 px-3 py-2 rounded-md"
              style={{
                background: "rgba(212,160,74,0.10)",
                border:     "1px solid rgba(212,160,74,0.35)",
                color:      "rgb(var(--color-primary-rgb))",
              }}
            >
              {errMsg ?? "Lookup unavailable."} Pick your game:
            </p>
            <div className="flex flex-col gap-2">
              {GAME_SUBDOMAINS.map(g => (
                <a
                  key={g.subdomain}
                  href={`https://${g.subdomain}/join?room=${encodeURIComponent(code.trim().toUpperCase())}`}
                  className="rounded-md px-4 py-2.5 font-bold transition-all active:scale-[0.98] flex items-center justify-between"
                  style={{
                    background: "rgb(var(--surface-overlay-rgb))",
                    border:     "1px solid rgb(var(--border-rgb))",
                    color:      "rgb(var(--text-primary-rgb))",
                    fontSize:   "var(--text-base)",
                  }}
                >
                  <span>{g.label}</span>
                  <span style={{ color: "rgb(var(--color-primary-rgb))" }}>→</span>
                </a>
              ))}
            </div>
          </div>
        )}

        <a
          href="/"
          className="block text-center text-sm mt-6"
          style={{ color: "rgb(var(--text-muted-rgb))" }}
        >
          ← Back to GokkeHub
        </a>
      </div>
    </div>
  );
}
