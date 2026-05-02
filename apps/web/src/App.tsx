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
    name: "Timeline Drop",
    tagline: "Sort the hits by year",
    description:
      "Songs drop one by one — place each on your team's timeline in the right year. Closer is better. Based on Hitster.",
    emoji: "📅",
    url: "https://hitster.gokkehub.com",
    accentRgb: "212, 160, 74",
    secondaryRgb: "184, 133, 59",
    status: "soon",
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
      <section className="relative z-10 text-center px-6 pt-16 pb-20 max-w-3xl mx-auto">
        <div className="inline-flex items-center gap-2 text-sm text-content-muted border border-white/10 rounded-full px-4 py-1.5 mb-8">
          <span
            className="w-2 h-2 rounded-full animate-pulse"
            style={{ background: `rgb(var(--color-secondary-rgb))` }}
          />
          Party games for groups
        </div>

        <h1 className="text-5xl sm:text-7xl font-black tracking-tight leading-none mb-6">
          <span className="text-content-primary">Games for </span>
          <span className="text-gradient">the crew</span>
        </h1>

        <p className="text-content-secondary text-lg sm:text-xl max-w-xl mx-auto mb-10 leading-relaxed">
          Pick a game, share a code, split into teams. No app install. Works on
          any phone. Built for living rooms, not leaderboards.
        </p>

        <a
          href="https://partybingo.gokkehub.com"
          className="inline-flex items-center gap-2 px-8 py-4 rounded-md font-bold text-base transition-all active:scale-[0.98]"
          style={{
            background: "rgb(var(--color-primary-rgb))",
            color:      "rgb(var(--bg-rgb))",
          }}
        >
          Play Grid Challenge
          <span aria-hidden>→</span>
        </a>
      </section>

      {/* Game cards */}
      <section className="relative z-10 px-4 pb-24 max-w-6xl mx-auto">
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
