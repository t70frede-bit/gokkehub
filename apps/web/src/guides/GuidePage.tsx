import { useState, type CSSProperties, type ReactNode } from "react";
import { MotionProvider, Stage } from "./motion";
import type { GameGuide, GuideScene, GuideStep } from "./types";
import "./guides.css";

/** The catalogue fields a guide page needs about its game. */
export interface GuideGame {
  name:      string;
  tagline:   string;
  emoji:     string;
  url:       string;
  accentRgb: string;
  status:    "live" | "soon";
}

const H2: CSSProperties = {
  fontFamily: "var(--font-display)",
  fontSize:   "var(--text-2xl)",
  color:      "rgb(var(--text-primary-rgb))",
};

const CARD: CSSProperties = {
  background: "rgb(var(--surface-raised-rgb))",
  border:     "1px solid rgb(var(--border-rgb))",
};

function SceneBox({ scene }: { scene: GuideScene }) {
  const C = scene.Component;
  return (
    <Stage label={scene.label} height={scene.height}>
      <C />
    </Stage>
  );
}

function Section({ id, kicker, title, intro, children }: {
  id: string;
  kicker?: string;
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="mb-16 scroll-mt-20">
      {kicker && (
        <div className="text-xs font-bold uppercase mb-1" style={{ color: "rgb(var(--accent))", letterSpacing: "0.14em" }}>
          {kicker}
        </div>
      )}
      <h2 className="font-bold tracking-tight mb-2" style={H2}>{title}</h2>
      {intro && <p className="text-content-muted text-sm mb-6" style={{ maxWidth: 600 }}>{intro}</p>}
      {!intro && <div className="mb-6" />}
      {children}
    </section>
  );
}

function StepList({ steps, start = 1 }: { steps: GuideStep[]; start?: number }) {
  return (
    <ol className="flex flex-col gap-4">
      {steps.map((step, i) => (
        <li
          key={step.title}
          className={`rounded-xl p-5 grid gap-5 items-center ${step.scene ? "md:grid-cols-[1fr_minmax(0,340px)]" : ""}`}
          style={CARD}
        >
          <div className="flex gap-4 min-w-0">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0"
              style={{ background: "rgba(var(--accent), 0.18)", color: "rgb(var(--accent))" }}
            >
              {start + i}
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-bold text-content-primary mb-1 leading-tight">{step.title}</h3>
              <p className="text-content-muted text-sm leading-relaxed">{step.body}</p>
              {step.tip && (
                <p
                  className="text-sm leading-relaxed mt-3 rounded-md px-3 py-2"
                  style={{ background: "rgba(var(--accent), 0.08)", border: "1px solid rgba(var(--accent), 0.25)", color: "rgb(var(--text-secondary-rgb))" }}
                >
                  💡 {step.tip}
                </p>
              )}
            </div>
          </div>
          {step.scene && <SceneBox scene={step.scene} />}
        </li>
      ))}
    </ol>
  );
}

function Bullets({ points }: { points: string[] }) {
  return (
    <ul className="flex flex-col gap-2 mt-4">
      {points.map((p) => (
        <li key={p} className="flex gap-2.5 text-sm leading-relaxed text-content-secondary">
          <span className="mt-[7px] w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: "rgb(var(--accent))" }} />
          <span>{p}</span>
        </li>
      ))}
    </ul>
  );
}

export function GuidePage({ game, guide, header }: { game: GuideGame; guide: GameGuide; header: ReactNode }) {
  const [paused, setPaused] = useState(false);
  const isLive = game.status === "live";
  const accent = `rgb(${game.accentRgb})`;

  const nav = [
    { id: "goal",        label: "Goal" },
    { id: "setup",       label: "Setup" },
    { id: "how-to-play", label: "How to play" },
    { id: "winning",     label: "Winning" },
    guide.modes  && { id: "modes",  label: guide.modes.heading },
    guide.extras && { id: "extras", label: guide.extras.heading },
    { id: "faq",         label: "FAQ" },
  ].filter(Boolean) as { id: string; label: string }[];

  return (
    <div
      className={`min-h-screen relative overflow-x-hidden ${paused ? "gs-paused" : ""}`}
      style={{ background: "var(--bg-tint-1)", ["--accent" as string]: game.accentRgb }}
    >
      {header}

      <MotionProvider paused={paused}>
        <main className="relative z-10 px-4 sm:px-6 max-w-5xl mx-auto pb-24">
          <a
            href="/#games"
            className="inline-flex items-center gap-1.5 text-sm mt-2 mb-8"
            style={{ color: "rgb(var(--text-muted-rgb))" }}
          >
            <span aria-hidden>←</span> All games
          </a>

          {/* ── Hero ── */}
          <section className="grid lg:grid-cols-[1fr_minmax(0,420px)] gap-8 items-center mb-10">
            <div className="min-w-0">
              <div className="flex items-center gap-4 mb-4">
                <div
                  className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl flex-shrink-0"
                  style={{ background: `rgba(${game.accentRgb}, 0.15)` }}
                >
                  {game.emoji}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold uppercase" style={{ color: accent, letterSpacing: "0.14em" }}>How to play</p>
                  <h1
                    className="font-extrabold tracking-tight leading-none"
                    style={{ fontFamily: "var(--font-display)", fontSize: "clamp(32px, 6vw, var(--text-4xl))", color: "rgb(var(--text-primary-rgb))" }}
                  >
                    {game.name}
                  </h1>
                </div>
              </div>
              <p className="text-base font-medium mb-3" style={{ color: accent }}>{game.tagline}</p>
              <p className="text-content-secondary leading-relaxed mb-6" style={{ fontSize: "var(--text-lg)", maxWidth: 600 }}>
                {guide.intro}
              </p>

              <div className="flex flex-wrap gap-3 mb-6">
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

              <div className="flex flex-wrap gap-2">
                {[
                  { label: "Players",  value: guide.players },
                  { label: "Length",   value: guide.time },
                  { label: "You need", value: guide.needs },
                ].map((f) => (
                  <div key={f.label} className="rounded-xl px-4 py-2.5" style={CARD}>
                    <div className="text-xs uppercase" style={{ color: "rgb(var(--text-muted-rgb))", letterSpacing: "0.1em" }}>{f.label}</div>
                    <div className="font-bold text-content-primary text-sm">{f.value}</div>
                  </div>
                ))}
              </div>
            </div>
            <SceneBox scene={{ ...guide.hero, height: guide.hero.height ?? 240 }} />
          </section>

          {/* ── In-page nav ── */}
          <nav
            aria-label="Guide sections"
            className="sticky top-0 z-20 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 mb-10 flex items-center gap-2"
            style={{ background: "var(--bg-tint-1)", borderBottom: "1px solid rgb(var(--border-rgb))" }}
          >
            <div className="flex gap-2 overflow-x-auto flex-1 min-w-0" style={{ scrollbarWidth: "none" }}>
              {nav.map((n) => (
                <a
                  key={n.id}
                  href={`#${n.id}`}
                  className="rounded-full px-3 py-1 text-sm font-semibold whitespace-nowrap transition-colors"
                  style={{ ...CARD, color: "rgb(var(--text-secondary-rgb))" }}
                >
                  {n.label}
                </a>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setPaused((p) => !p)}
              aria-pressed={paused}
              className="rounded-full px-3 py-1 text-sm font-semibold whitespace-nowrap flex-shrink-0 transition-all active:scale-[0.98]"
              style={{ ...CARD, color: "rgb(var(--text-muted-rgb))" }}
            >
              {paused ? "▶ Play animations" : "⏸ Pause animations"}
            </button>
          </nav>

          {/* ── Goal ── */}
          <Section id="goal" kicker="01" title="Goal of the game">
            <div className="rounded-xl p-5 grid md:grid-cols-[1fr_minmax(0,380px)] gap-6 items-center" style={CARD}>
              <div>
                <p className="text-content-primary font-semibold leading-relaxed" style={{ fontSize: "var(--text-lg)" }}>
                  {guide.goal.summary}
                </p>
                <Bullets points={guide.goal.points} />
              </div>
              <SceneBox scene={guide.goal.scene} />
            </div>
          </Section>

          {/* ── Setup ── */}
          <Section id="setup" kicker="02" title="Setup">
            <StepList steps={guide.setup} />
          </Section>

          {/* ── How to play ── */}
          <Section id="how-to-play" kicker="03" title="How to play">
            <StepList steps={guide.play} />
          </Section>

          {/* ── Winning ── */}
          <Section id="winning" kicker="04" title="How to win">
            <div
              className={`rounded-xl p-5 grid gap-6 items-center ${guide.winning.scene ? "md:grid-cols-[1fr_minmax(0,380px)]" : ""}`}
              style={{ background: "rgba(var(--accent), 0.08)", border: "1px solid rgba(var(--accent), 0.3)" }}
            >
              <div>
                <p className="text-content-primary font-semibold leading-relaxed" style={{ fontSize: "var(--text-lg)" }}>
                  🏆 {guide.winning.summary}
                </p>
                {guide.winning.points && <Bullets points={guide.winning.points} />}
              </div>
              {guide.winning.scene && <SceneBox scene={guide.winning.scene} />}
            </div>
          </Section>

          {/* ── Modes ── */}
          {guide.modes && (
            <Section id="modes" title={guide.modes.heading} intro={guide.modes.intro}>
              <div className="grid sm:grid-cols-2 gap-4">
                {guide.modes.items.map((m) => (
                  <div
                    key={m.title}
                    className={`rounded-xl p-5 ${m.scene ? "sm:col-span-2 grid md:grid-cols-[1fr_minmax(0,340px)] gap-5 items-center" : ""}`}
                    style={CARD}
                  >
                    <div>
                      <div className="text-2xl mb-2">{m.icon}</div>
                      <h3 className="font-bold text-content-primary mb-1 leading-tight">{m.title}</h3>
                      <p className="text-content-muted text-sm leading-relaxed">{m.body}</p>
                    </div>
                    {m.scene && <SceneBox scene={m.scene} />}
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* ── Power-ups / extras ── */}
          {guide.extras && (
            <Section id="extras" title={guide.extras.heading} intro={guide.extras.intro}>
              <div className="grid sm:grid-cols-2 gap-3">
                {guide.extras.items.map((f) => (
                  <div key={f.name} className="flex items-center gap-3 rounded-xl px-4 py-3" style={CARD}>
                    <div
                      className="w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold flex-shrink-0"
                      style={{ background: "rgba(var(--accent), 0.15)", color: accent }}
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
            </Section>
          )}

          {/* ── FAQ ── */}
          <Section id="faq" title="Good to know">
            <div className="flex flex-col gap-3">
              {guide.faq.map((item) => (
                <div key={item.q} className="rounded-xl p-5" style={CARD}>
                  <h3 className="font-bold text-content-primary mb-1 leading-tight">{item.q}</h3>
                  <p className="text-content-muted text-sm leading-relaxed">{item.a}</p>
                </div>
              ))}
            </div>
          </Section>

          {/* ── Closing CTA ── */}
          <div
            className="rounded-xl p-8 text-center"
            style={{ background: "rgba(var(--accent), 0.10)", border: "1px solid rgba(var(--accent), 0.3)" }}
          >
            <h2 className="font-extrabold mb-2 tracking-tight" style={H2}>
              {isLive ? `Ready to play ${game.name}?` : `${game.name} is coming soon`}
            </h2>
            <p className="text-content-secondary text-sm mb-5" style={{ maxWidth: 440, marginInline: "auto" }}>
              {isLive ? "Gather your group, grab the room code, and get going." : "Check back soon. It's on the way."}
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
      </MotionProvider>

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
