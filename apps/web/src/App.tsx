import { useEffect, useState } from "react";
import { GameHeader, useAccountSession } from "@gokkehub/ui";

// ── Game catalogue ────────────────────────────────────────────────────────────

interface GameGuide {
  /** One-line quick facts shown as chips at the top of the detail page. */
  players: string;
  time: string;
  needs: string;
  /** Lead paragraph under the hero. */
  intro: string;
  /** Numbered "how it works" steps. */
  steps: { title: string; body: string }[];
  /** Optional callout cards (e.g. song sources, modes). */
  highlights?: { icon: string; title: string; body: string }[];
  /** Optional power-up / feature chips. */
  features?: { icon: string; name: string; desc: string }[];
  faq: { q: string; a: string }[];
}

interface Game {
  name: string;
  /** URL slug for the /games/:slug detail page. */
  slug: string;
  tagline: string;
  description: string;
  emoji: string;
  url: string;
  /** CSS rgb() color for card accent — taken from each game's theme file */
  accentRgb: string;
  secondaryRgb: string;
  status: "live" | "soon";
  /** Optional long-form guide → renders a /games/:slug detail page. */
  guide?: GameGuide;
}

const GAMES: Game[] = [
  {
    name: "Grid Challenge",
    slug: "gridchallenge",
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
    slug: "trackguess",
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
    slug: "musix",
    tagline: "Sort the hits by year",
    description:
      "A song plays — place it on your team's timeline in the right year. Closer is better. Earn tokens by guessing the artist + name. Hitster, but with your group's actual taste.",
    emoji: "🎵",
    url: "https://musix.gokkehub.com",
    accentRgb: "212, 160, 74",
    secondaryRgb: "184, 133, 59",
    status: "live",
    guide: {
      players: "2 teams",
      time: "20–40 min",
      needs: "A host with Spotify",
      intro:
        "Musix is Hitster built around your group's actual taste. A song plays and your team slots it onto a timeline in the year you think it came out — the closer you are, the better. Nail the artist and title too and you'll earn power-up tokens to bend the rules in your favour.",
      steps: [
        {
          title: "Host a room, friends join with a code",
          body:
            "The host spins up a room and shares the 4-letter code. Players join from their phones at gokkehub.com/join — no install, no account required to play along.",
        },
        {
          title: "Pick where the songs come from",
          body:
            "Choose your group's taste (auto-built from what everyone actually listens to) or paste a Spotify playlist. Set the difficulty and how many cards it takes to win — 5, 7, 10, 12 or 15.",
        },
        {
          title: "Listen, then drop the song on your timeline",
          body:
            "Each round a mystery song plays. The team captain slides it into the gap on their timeline where they think it belongs by year. Confirm the placement — closer is correct, off is a miss.",
        },
        {
          title: "Guess the artist + title for bonus tokens",
          body:
            "Optionally call the artist and song name. Get both right and your team earns a random power-up token — banked for your next turn.",
        },
        {
          title: "First team to fill their timeline wins",
          body:
            "Build the longest correct run. The first team to reach the cards-to-win target takes the night. Tokens, steals and counters keep it from ever being a sure thing.",
        },
      ],
      highlights: [
        {
          icon: "🎧",
          title: "Your group's taste",
          body:
            "Songs are generated from what your players actually listen to, so the timeline is full of tracks you'll recognise — and argue about.",
        },
        {
          icon: "📃",
          title: "…or any Spotify playlist",
          body:
            "Prefer a theme night? Paste a playlist URL and Musix plays from that pool instead. Great for decades nights or a shared party mix.",
        },
        {
          icon: "⚖️",
          title: "You decide who judges",
          body:
            "Let the team's own captain, the next captain, the host, or a vote of everyone settle whether a tricky placement counts.",
        },
      ],
      features: [
        { icon: "🖼️", name: "Cover Reveal", desc: "Peek at the album art for a hint." },
        { icon: "±5", name: "±5 Years", desc: "Widen your placement window for one drop." },
        { icon: "⏭️", name: "Song Skipper", desc: "Bail on a song you have no clue about." },
        { icon: "🎯", name: "Steal by Year", desc: "Pounce on a rival's missed placement." },
        { icon: "↩️", name: "Token Counter", desc: "Cancel an opponent's power-up in real time." },
        { icon: "🛟", name: "Recovery", desc: "Save a card from a botched turn." },
      ],
      faq: [
        {
          q: "Do all players need Spotify?",
          a: "No — only the host needs a Spotify account so the room can play audio. Everyone else just joins with the room code from their phone.",
        },
        {
          q: "How do we all hear the song?",
          a: "Audio plays on the host's device. For remote groups, hop in a Discord call and share the audio there — the rest of the game syncs live for everyone.",
        },
        {
          q: "Can we play with our own music?",
          a: "Yes. Switch the song source to a Spotify playlist and paste the link, and Musix builds the round pool from that playlist.",
        },
        {
          q: "How many people can play?",
          a: "It runs as two teams, so it scales from a couple of friends to a packed room — gather everyone onto two sides and battle it out.",
        },
      ],
    },
  },
  {
    name: "Jeopardy",
    slug: "jeopardy",
    tagline: "Build a board, race the buzzer",
    description:
      "Make your own Jeopardy board with images, audio and custom categories, then host it live. Players buzz in from their phones and play power-ups to swing the scores.",
    emoji: "❓",
    url: "https://jeopardy.gokkehub.com",
    accentRgb: "74, 123, 156",
    secondaryRgb: "212, 160, 74",
    status: "live",
  },
  {
    name: "BeatRank",
    slug: "beatrank",
    tagline: "Music trivia showdown",
    description:
      "Fastest fingers, sharpest ears. Answer music trivia, rank artists, and climb the leaderboard. No Spotify required.",
    emoji: "🏆",
    url: "https://bezzerwizzer.gokkehub.com",
    accentRgb: "74, 123, 156",
    secondaryRgb: "212, 160, 74",
    status: "soon",
  },
  {
    name: "Poker",
    slug: "poker",
    tagline: "Run the home game",
    description:
      "Track buy-ins and cash-outs across your poker nights, see who's up and who's down in real time, and settle the night over MobilePay. Phone-first — add it to your home screen.",
    emoji: "🃏",
    url: "https://poker.gokkehub.com",
    accentRgb: "76, 134, 108",
    secondaryRgb: "212, 160, 74",
    status: "live",
  },
];

// ── Shared header (same one every game uses) ─────────────────────────────────

function HubHeader() {
  const { session } = useAccountSession();
  return <GameHeader session={session} hubHref="/" />;
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  // Lightweight client-side router. Any path other than the catalogue gets
  // routed below via the simple switch in <Catalogue /> wrapper.
  const path = typeof window !== "undefined" ? window.location.pathname : "/";
  if (path === "/join") return <JoinRedirect />;

  const gameMatch = path.match(/^\/games\/([\w-]+)\/?$/);
  if (gameMatch) {
    const game = GAMES.find((g) => g.slug === gameMatch[1]);
    if (game?.guide) return <GameDetail game={game} />;
  }

  return <Catalogue />;
}

function Catalogue() {
  return (
    <div
      className="min-h-screen relative overflow-x-hidden"
      style={{ background: "var(--bg-tint-1)" }}
    >
      {/* Ambient orbs removed for v0.2 — solid surfaces only. */}

      <HubHeader />

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
    <div
      className={[
        "game-card block rounded-xl p-6 relative overflow-hidden transition-all",
        isLive ? "" : "opacity-60",
      ].join(" ")}
      style={{
        background: "rgb(var(--surface-raised-rgb))",
        border:     "1px solid rgb(var(--border-rgb))",
        borderTop:  `3px solid rgb(${game.accentRgb})`,
        boxShadow:  "var(--shadow-card)",
      }}
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

      {/* Actions: Play now (live) + How to play (if a guide exists) */}
      <div className="relative mt-4 flex items-center gap-4 text-sm font-medium flex-wrap">
        {isLive && (
          <a
            href={game.url}
            className="flex items-center gap-1.5 hover:underline underline-offset-4"
            style={{ color: `rgb(${game.accentRgb})` }}
            aria-label={`Play ${game.name}`}
          >
            Play now
            <span aria-hidden>→</span>
          </a>
        )}
        {game.guide && (
          <a
            href={`/games/${game.slug}`}
            className="flex items-center gap-1.5 hover:underline underline-offset-4 text-content-secondary"
            aria-label={`How to play ${game.name}`}
          >
            How to play
            <span aria-hidden>→</span>
          </a>
        )}
      </div>
    </div>
  );
}

// ── GameDetail — /games/:slug long-form guide page ─────────────────────────

function GameDetail({ game }: { game: Game }) {
  const guide = game.guide!;
  const isLive = game.status === "live";
  const accent = `rgb(${game.accentRgb})`;

  return (
    <div className="min-h-screen relative overflow-x-hidden" style={{ background: "var(--bg-tint-1)" }}>
      <HubHeader />

      <main className="relative z-10 px-6 max-w-4xl mx-auto pb-24">
        {/* Breadcrumb */}
        <a
          href="/#games"
          className="inline-flex items-center gap-1.5 text-sm mt-2 mb-8"
          style={{ color: "rgb(var(--text-muted-rgb))" }}
        >
          <span aria-hidden>←</span> All games
        </a>

        {/* Hero */}
        <section className="flex flex-col sm:flex-row sm:items-start gap-5 mb-4">
          <div
            className="w-16 h-16 rounded-3xl flex items-center justify-center text-3xl flex-shrink-0"
            style={{ background: `rgb(${game.accentRgb} / 0.15)` }}
          >
            {game.emoji}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <h1
                className="font-extrabold tracking-tight leading-none"
                style={{ fontFamily: "var(--font-display)", fontSize: "clamp(32px, 6vw, var(--text-4xl))", color: "rgb(var(--text-primary-rgb))" }}
              >
                {game.name}
              </h1>
              {isLive ? (
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: `rgb(${game.accentRgb} / 0.2)`, color: accent }}>
                  Live
                </span>
              ) : (
                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-white/5 text-content-muted">
                  Coming soon
                </span>
              )}
            </div>
            <p className="text-base font-medium" style={{ color: accent }}>{game.tagline}</p>
          </div>
        </section>

        <p className="text-content-secondary leading-relaxed mb-6" style={{ fontSize: "var(--text-lg)", maxWidth: 640 }}>
          {guide.intro}
        </p>

        {/* CTAs */}
        <div className="flex flex-wrap gap-3 mb-8">
          {isLive && (
            <a
              href={game.url}
              className="rounded-md px-6 py-3 font-bold transition-all active:scale-[0.98]"
              style={{ background: accent, color: "rgb(var(--bg-rgb))", fontSize: "var(--text-base)" }}
            >
              Host a game →
            </a>
          )}
          <a
            href="/join"
            className="rounded-md px-6 py-3 font-bold transition-all active:scale-[0.98] border"
            style={{ borderColor: "rgb(var(--border-rgb))", color: "rgb(var(--text-primary-rgb))", fontSize: "var(--text-base)" }}
          >
            Join with a code
          </a>
        </div>

        {/* Quick facts */}
        <div className="flex flex-wrap gap-2 mb-12">
          {[
            { label: "Players", value: guide.players },
            { label: "Length", value: guide.time },
            { label: "You need", value: guide.needs },
          ].map((f) => (
            <div
              key={f.label}
              className="rounded-xl px-4 py-2.5"
              style={{ background: "rgb(var(--surface-raised-rgb))", border: "1px solid rgb(var(--border-rgb))" }}
            >
              <div className="text-xs uppercase tracking-wide" style={{ color: "rgb(var(--text-muted-rgb))", letterSpacing: "0.1em" }}>{f.label}</div>
              <div className="font-bold text-content-primary text-sm">{f.value}</div>
            </div>
          ))}
        </div>

        {/* How it works */}
        <h2 className="font-bold mb-6 tracking-tight" style={{ fontFamily: "var(--font-display)", fontSize: "var(--text-2xl)", color: "rgb(var(--text-primary-rgb))" }}>
          How it works
        </h2>
        <ol className="flex flex-col gap-4 mb-14">
          {guide.steps.map((step, i) => (
            <li
              key={i}
              className="flex gap-4 rounded-xl p-5"
              style={{ background: "rgb(var(--surface-raised-rgb))", border: "1px solid rgb(var(--border-rgb))" }}
            >
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0"
                style={{ background: `rgb(${game.accentRgb} / 0.18)`, color: accent }}
              >
                {i + 1}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-content-primary mb-1 leading-tight">{step.title}</h3>
                <p className="text-content-muted text-sm leading-relaxed">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>

        {/* Highlights */}
        {guide.highlights && (
          <>
            <h2 className="font-bold mb-6 tracking-tight" style={{ fontFamily: "var(--font-display)", fontSize: "var(--text-2xl)", color: "rgb(var(--text-primary-rgb))" }}>
              What makes it different
            </h2>
            <div className="grid sm:grid-cols-3 gap-4 mb-14">
              {guide.highlights.map((h) => (
                <div
                  key={h.title}
                  className="rounded-xl p-5"
                  style={{ background: "rgb(var(--surface-raised-rgb))", border: "1px solid rgb(var(--border-rgb))" }}
                >
                  <div className="text-2xl mb-2">{h.icon}</div>
                  <h3 className="font-bold text-content-primary mb-1 text-sm leading-tight">{h.title}</h3>
                  <p className="text-content-muted text-sm leading-relaxed">{h.body}</p>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Features / power-ups */}
        {guide.features && (
          <>
            <h2 className="font-bold mb-2 tracking-tight" style={{ fontFamily: "var(--font-display)", fontSize: "var(--text-2xl)", color: "rgb(var(--text-primary-rgb))" }}>
              Power-up tokens
            </h2>
            <p className="text-content-muted text-sm mb-6" style={{ maxWidth: 560 }}>
              Earn these by nailing the artist and title — then spend them to bend a round in your favour.
            </p>
            <div className="grid sm:grid-cols-2 gap-3 mb-14">
              {guide.features.map((f) => (
                <div
                  key={f.name}
                  className="flex items-center gap-3 rounded-xl px-4 py-3"
                  style={{ background: "rgb(var(--surface-raised-rgb))", border: "1px solid rgb(var(--border-rgb))" }}
                >
                  <div
                    className="w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold flex-shrink-0"
                    style={{ background: `rgb(${game.accentRgb} / 0.15)`, color: accent }}
                  >
                    {f.icon}
                  </div>
                  <div className="min-w-0">
                    <div className="font-bold text-content-primary text-sm leading-tight">{f.name}</div>
                    <div className="text-content-muted text-sm leading-tight">{f.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* FAQ */}
        <h2 className="font-bold mb-6 tracking-tight" style={{ fontFamily: "var(--font-display)", fontSize: "var(--text-2xl)", color: "rgb(var(--text-primary-rgb))" }}>
          Good to know
        </h2>
        <div className="flex flex-col gap-3 mb-14">
          {guide.faq.map((item) => (
            <div
              key={item.q}
              className="rounded-xl p-5"
              style={{ background: "rgb(var(--surface-raised-rgb))", border: "1px solid rgb(var(--border-rgb))" }}
            >
              <h3 className="font-bold text-content-primary mb-1 leading-tight">{item.q}</h3>
              <p className="text-content-muted text-sm leading-relaxed">{item.a}</p>
            </div>
          ))}
        </div>

        {/* Closing CTA */}
        <div
          className="rounded-xl p-8 text-center"
          style={{ background: `rgb(${game.accentRgb} / 0.10)`, border: `1px solid rgb(${game.accentRgb} / 0.3)` }}
        >
          <h2 className="font-extrabold mb-2 tracking-tight" style={{ fontFamily: "var(--font-display)", fontSize: "var(--text-2xl)", color: "rgb(var(--text-primary-rgb))" }}>
            {isLive ? `Ready to play ${game.name}?` : `${game.name} is coming soon`}
          </h2>
          <p className="text-content-secondary text-sm mb-5" style={{ maxWidth: 440, marginInline: "auto" }}>
            {isLive ? "Gather your group, grab the room code, and get going." : "Check back soon — it's on the way."}
          </p>
          {isLive && (
            <a
              href={game.url}
              className="inline-block rounded-md px-6 py-3 font-bold transition-all active:scale-[0.98]"
              style={{ background: accent, color: "rgb(var(--bg-rgb))", fontSize: "var(--text-base)" }}
            >
              Host a game →
            </a>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/5 py-8 px-6 text-center">
        <p className="text-content-muted text-sm flex flex-wrap justify-center gap-x-4 gap-y-1">
          <span>© 2026 GokkeHub</span>
          <a href="/" className="hover:text-content-secondary transition-colors">All games</a>
          <a href="https://account.gokkehub.com" className="hover:text-content-secondary transition-colors">Account</a>
        </p>
      </footer>
    </div>
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
        placeholder="ABCD"
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
  { label: "jeopardy",      subdomain: "jeopardy.gokkehub.com"   },
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
