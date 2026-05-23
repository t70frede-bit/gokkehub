import { useState } from "react";

// Proposed palette (Design Guide v0.1 — "vinyl liner notes")
// All inline so it doesn't depend on the design tokens being updated yet.
const C = {
  bg:           "#1A1614",
  bgElevated:   "#221E1B",
  bgOverlay:    "#2E2823",
  border:       "#3A332E",
  textPrimary:  "#F5EDE2",
  textSecondary:"#B8A99A",
  textMuted:    "#756A60",
  accent:       "#D4A04A",
  accentActive: "#B8853B",
  danger:       "#C7553D",
  success:      "#7B9C5F",
  team: {
    red:    "#B86452",
    blue:   "#4A7B9C",
    green:  "#7B9C5F",
    yellow: "#D4A04A",
  },
};

export default function DesignPage() {
  return (
    <div
      style={{
        background:  C.bg,
        color:       C.textPrimary,
        minHeight:   "100vh",
        padding:     "32px 24px",
        fontFamily:  "Inter, system-ui, sans-serif",
        fontSize:    15,
        lineHeight:  1.6,
      }}
    >
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <Header />
        <Section title="Colour palette" caption="Solid surfaces, no gradients. Album art carries the colour.">
          <Palette />
        </Section>

        <Section title="Typography" caption="Editorial. Mono only for codes & numbers.">
          <Typography />
        </Section>

        <Section title="Buttons">
          <Buttons />
        </Section>

        <Section title="Panels / cards" caption="Hairline border + soft outer shadow. No glassmorphism.">
          <Panels />
        </Section>

        <Section title="Badges & chips">
          <Badges />
        </Section>

        <Section title="Track card on the timeline">
          <TimelineRail />
        </Section>

        <Section title="Team tiles & player avatars" caption="Spotlight panel mockup with the active team highlighted.">
          <SpotlightMock />
        </Section>

        <Section title="Push-pin pings">
          <PingMock />
        </Section>

        <Section title="Modal">
          <ModalMock />
        </Section>

        <Footer />
      </div>
    </div>
  );
}

function Header() {
  return (
    <header style={{ marginBottom: 56 }}>
      <p
        style={{
          fontSize:    11,
          letterSpacing: "0.2em",
          textTransform: "uppercase",
          color:       C.accent,
          fontWeight:  700,
          marginBottom: 12,
          fontFamily:  "JetBrains Mono, ui-monospace, monospace",
        }}
      >
        Design preview · v0.1
      </p>
      <h1
        style={{
          fontFamily:  "'Space Grotesk', Inter, sans-serif",
          fontSize:    56,
          fontWeight:  700,
          letterSpacing: "-0.02em",
          lineHeight:  1.05,
          margin:      0,
        }}
      >
        Warm charcoal,<br />
        <span style={{ color: C.accent }}>amber accent.</span>
      </h1>
      <p
        style={{
          fontSize:    18,
          color:       C.textSecondary,
          marginTop:   16,
          maxWidth:    560,
        }}
      >
        Drop the AI gradient. Lean into vinyl liner notes — solid surfaces, hairline borders,
        single confident accent, album art carrying the colour.
      </p>
    </header>
  );
}

function Section({ title, caption, children }: { title: string; caption?: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 56 }}>
      <h2
        style={{
          fontFamily:  "'Space Grotesk', Inter, sans-serif",
          fontSize:    24,
          fontWeight:  700,
          letterSpacing: "-0.01em",
          marginBottom: caption ? 4 : 16,
        }}
      >
        {title}
      </h2>
      {caption && <p style={{ color: C.textMuted, marginBottom: 16, fontSize: 14 }}>{caption}</p>}
      {children}
    </section>
  );
}

function Footer() {
  return (
    <footer
      style={{
        marginTop:   72,
        paddingTop:  24,
        borderTop:   `1px solid ${C.border}`,
        color:       C.textMuted,
        fontSize:    13,
      }}
    >
      Inline preview. Once a direction is approved, these colours move into{" "}
      <code style={{ fontFamily: "JetBrains Mono, monospace", color: C.textSecondary }}>
        packages/config/src/themes/tokens.css
      </code>{" "}
      and the components stop carrying inline styles.
    </footer>
  );
}

/* ── Palette ────────────────────────────────────────────────────────────── */

function Palette() {
  const swatch = (label: string, value: string, fg: string = C.textPrimary) => (
    <div
      key={label}
      style={{
        background:  value,
        color:       fg,
        padding:     "20px 16px",
        borderRadius: 8,
        border:       `1px solid ${C.border}`,
        minHeight:    96,
        display:      "flex",
        flexDirection:"column",
        justifyContent:"space-between",
      }}
    >
      <span style={{ fontWeight: 700, fontSize: 14 }}>{label}</span>
      <code style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 12, opacity: 0.8 }}>{value}</code>
    </div>
  );
  return (
    <div>
      <p style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.1em", color: C.textMuted, marginBottom: 8 }}>Surfaces</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12, marginBottom: 24 }}>
        {swatch("bg",          C.bg)}
        {swatch("bg-elevated", C.bgElevated)}
        {swatch("bg-overlay",  C.bgOverlay)}
        {swatch("border",      C.border)}
      </div>

      <p style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.1em", color: C.textMuted, marginBottom: 8 }}>Text</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12, marginBottom: 24 }}>
        {swatch("text-primary",   C.textPrimary,   C.bg)}
        {swatch("text-secondary", C.textSecondary, C.bg)}
        {swatch("text-muted",     C.textMuted,     C.bg)}
      </div>

      <p style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.1em", color: C.textMuted, marginBottom: 8 }}>Accent + status</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12, marginBottom: 24 }}>
        {swatch("accent",        C.accent,        C.bg)}
        {swatch("accent-active", C.accentActive,  C.bg)}
        {swatch("danger",        C.danger)}
        {swatch("success",       C.success,       C.bg)}
      </div>

      <p style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.1em", color: C.textMuted, marginBottom: 8 }}>Teams (muted)</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 }}>
        {swatch("team.red",    C.team.red)}
        {swatch("team.blue",   C.team.blue)}
        {swatch("team.green",  C.team.green)}
        {swatch("team.yellow", C.team.yellow, C.bg)}
      </div>
    </div>
  );
}

/* ── Typography ─────────────────────────────────────────────────────────── */

function Typography() {
  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div>
        <p style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.15em", color: C.textMuted, marginBottom: 6 }}>
          Display · Space Grotesk 700
        </p>
        <p style={{ fontFamily: "'Space Grotesk', Inter, sans-serif", fontSize: 40, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.1, margin: 0 }}>
          Place the song before the timer runs out.
        </p>
      </div>
      <div>
        <p style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.15em", color: C.textMuted, marginBottom: 6 }}>
          Body · Inter 400 / 15px
        </p>
        <p style={{ margin: 0, color: C.textSecondary, maxWidth: 640 }}>
          Each round, the captain hears a song they've never heard. They have to slot it on the timeline between
          songs they already know — pure vibes detective work. Get it right, win the card. Stop or risk it.
        </p>
      </div>
      <div>
        <p style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.15em", color: C.textMuted, marginBottom: 6 }}>
          Mono · JetBrains Mono 600 (codes, years)
        </p>
        <p style={{ fontFamily: "JetBrains Mono, ui-monospace, monospace", fontWeight: 600, fontSize: 28, letterSpacing: "0.05em", color: C.accent, margin: 0 }}>
          ABCD · 1991
        </p>
      </div>
    </div>
  );
}

/* ── Buttons ────────────────────────────────────────────────────────────── */

const PressButton = ({ children, variant = "primary", danger, disabled }: {
  children: React.ReactNode;
  variant?: "primary" | "ghost" | "secondary";
  danger?: boolean;
  disabled?: boolean;
}) => {
  const styles: Record<string, React.CSSProperties> = {
    primary: {
      background: danger ? C.danger : C.accent,
      color:      C.bg,
      border:     "1px solid transparent",
    },
    ghost: {
      background: "transparent",
      color:      danger ? C.danger : C.textPrimary,
      border:     `1px solid ${danger ? C.danger : C.border}`,
    },
    secondary: {
      background: C.bgElevated,
      color:      C.textPrimary,
      border:     `1px solid ${C.border}`,
    },
  };
  return (
    <button
      disabled={disabled}
      style={{
        ...styles[variant],
        padding:      "10px 18px",
        borderRadius: 8,
        fontWeight:   700,
        fontSize:     14,
        letterSpacing:"0.01em",
        cursor:       disabled ? "not-allowed" : "pointer",
        opacity:      disabled ? 0.45 : 1,
        transition:   "transform 80ms ease, background 120ms ease",
      }}
      onMouseDown={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = "scale(0.98)"; }}
      onMouseUp={(e) =>   { (e.currentTarget as HTMLButtonElement).style.transform = ""; }}
      onMouseLeave={(e) =>{ (e.currentTarget as HTMLButtonElement).style.transform = ""; }}
    >
      {children}
    </button>
  );
};

function Buttons() {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
      <PressButton>Start game</PressButton>
      <PressButton variant="ghost">Copy link</PressButton>
      <PressButton variant="secondary">Settings</PressButton>
      <PressButton danger variant="primary">Kick player</PressButton>
      <PressButton variant="ghost" danger>Leave room</PressButton>
      <PressButton disabled>Disabled</PressButton>
    </div>
  );
}

/* ── Panels ─────────────────────────────────────────────────────────────── */

function Panels() {
  const card: React.CSSProperties = {
    background:  C.bgElevated,
    border:      `1px solid ${C.border}`,
    borderRadius: 12,
    padding:     20,
    boxShadow:   "0 8px 16px rgba(0,0,0,0.25)",
  };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
      <div style={card}>
        <p style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.15em", color: C.textMuted, margin: 0 }}>Cards to win</p>
        <p style={{ fontSize: 36, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif", margin: "4px 0 0" }}>10</p>
        <p style={{ fontSize: 13, color: C.textMuted, margin: "8px 0 0" }}>Lock cards on the timeline before the others.</p>
      </div>
      <div style={{ ...card, borderTop: `2px solid ${C.team.red}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: C.team.red }} />
          <p style={{ fontWeight: 700, margin: 0 }}>Team Red</p>
          <span style={{ marginLeft: "auto", fontSize: 12, color: C.textMuted, fontFamily: "JetBrains Mono, monospace" }}>3 cards</span>
        </div>
        <p style={{ color: C.textSecondary, fontSize: 13, margin: 0 }}>Captain: Anna · 2 teammates</p>
      </div>
      <div style={{ ...card, background: C.bgOverlay }}>
        <p style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.15em", color: C.accent, margin: 0 }}>Overlay surface</p>
        <p style={{ fontSize: 14, color: C.textSecondary, margin: "8px 0 0" }}>
          Used for modals & popovers. Slightly lighter than the elevated panel so it stands out
          when layered.
        </p>
      </div>
    </div>
  );
}

/* ── Badges ─────────────────────────────────────────────────────────────── */

function Badges() {
  const chip = (color: string, opts?: { fill?: boolean }): React.CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.04em",
    border: `1px solid ${color}`,
    color: opts?.fill ? C.bg : color,
    background: opts?.fill ? color : "transparent",
  });
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
      <span style={chip(C.accent, { fill: true })}>HOST</span>
      <span style={chip(C.accent)}>🎯 On the spot</span>
      <span style={chip(C.accent)}>👑 Captain</span>
      <span style={chip(C.textMuted)}>👁️ Spectator</span>
      <span style={chip(C.success)}>● Last.fm linked</span>
      <span style={chip(C.danger)}>✗ Not quite</span>
      <span style={chip("rgb(220,160,0)")}>⚠ No captain</span>
    </div>
  );
}

/* ── Timeline rail with track cards ─────────────────────────────────────── */

function TrackCardMock({ year, name, artist, accent }: { year: number; name: string; artist: string; accent: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 96 }}>
      <span
        style={{
          fontFamily:    "JetBrains Mono, monospace",
          fontWeight:    700,
          fontSize:      13,
          color:         C.bg,
          background:    accent,
          padding:       "2px 8px",
          borderRadius:  4,
          letterSpacing: "0.05em",
          marginBottom:  8,
        }}
      >
        {year}
      </span>
      <div
        style={{
          width:         88,
          height:        88,
          borderRadius:  6,
          border:        `1px solid ${C.border}`,
          background:    `linear-gradient(135deg, ${accent}33, ${C.bgOverlay})`,
        }}
      />
      <p style={{ fontSize: 12, fontWeight: 700, marginTop: 6, marginBottom: 0, textAlign: "center", lineHeight: 1.2 }}>{name}</p>
      <p style={{ fontSize: 11, color: C.textMuted, margin: 0, textAlign: "center" }}>{artist}</p>
    </div>
  );
}

function TimelineRail() {
  return (
    <div
      style={{
        background:    C.bgElevated,
        border:        `1px solid ${C.border}`,
        borderRadius:  12,
        padding:       24,
        boxShadow:     "0 8px 16px rgba(0,0,0,0.25)",
        overflow:      "auto",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 18 }}>
        <TrackCardMock year={1976} name="Bohemian Rhapsody" artist="Queen" accent={C.accent} />
        <Gap />
        <TrackCardMock year={1991} name="Smells Like Teen Spirit" artist="Nirvana" accent={C.accent} />
        <Gap pinged />
        <TrackCardMock year={2003} name="Hey Ya!" artist="OutKast" accent={C.accent} />
        <Gap />
        <TrackCardMock year={2014} name="Take Me to Church" artist="Hozier" accent={C.accent} />
      </div>
    </div>
  );
}

function Gap({ pinged }: { pinged?: boolean }) {
  return (
    <div style={{ position: "relative", flex: "0 1 80px", minWidth: 60, alignSelf: "stretch", display: "flex", alignItems: "center", justifyContent: "center", marginTop: 28 }}>
      <span
        style={{
          width:        4,
          height:       4,
          borderRadius: 999,
          background:   C.border,
        }}
      />
      {pinged && (
        <Pin name="Anna" />
      )}
    </div>
  );
}

/* ── Push-pin ping component (preview) ──────────────────────────────────── */

function Pin({ name, mine }: { name: string; mine?: boolean }) {
  const c = mine ? C.accent : C.team.blue;
  return (
    <div
      style={{
        position:  "absolute",
        bottom:    "100%",
        left:      "50%",
        transform: "translateX(-50%)",
        marginBottom: 6,
      }}
    >
      <div
        style={{
          background:    `linear-gradient(180deg, ${c} 0%, ${shade(c, -18)} 100%)`,
          color:         "#fff",
          fontSize:      12,
          fontWeight:    700,
          padding:       "5px 10px",
          borderRadius:  999,
          border:        `1px solid ${shade(c, -25)}`,
          boxShadow: [
            "inset 0 1px 0 rgba(255,255,255,0.22)",
            "0 1px 1px rgba(0,0,0,0.4)",
            "0 6px 14px rgba(0,0,0,0.45)",
          ].join(", "),
          textShadow: "0 1px 1px rgba(0,0,0,0.35)",
          whiteSpace: "nowrap",
        }}
      >
        📍 {name}
      </div>
      <div
        style={{
          position:    "absolute",
          left:        "50%",
          top:         "100%",
          transform:   "translateX(-50%)",
          width:       0,
          height:      0,
          borderLeft:  "5px solid transparent",
          borderRight: "5px solid transparent",
          borderTop:   `5px solid ${shade(c, -10)}`,
          filter:      "drop-shadow(0 1px 1px rgba(0,0,0,0.45))",
        }}
      />
    </div>
  );
}

function shade(hex: string, percent: number): string {
  const h = hex.replace("#", "");
  const num = parseInt(h, 16);
  const r = Math.max(0, Math.min(255, ((num >> 16) & 0xff) + Math.round(255 * (percent / 100))));
  const g = Math.max(0, Math.min(255, ((num >> 8)  & 0xff) + Math.round(255 * (percent / 100))));
  const b = Math.max(0, Math.min(255,  (num        & 0xff) + Math.round(255 * (percent / 100))));
  return `rgb(${r},${g},${b})`;
}

/* ── Spotlight team mockup ──────────────────────────────────────────────── */

function SpotlightMock() {
  return (
    <div
      style={{
        background:   C.bgElevated,
        borderTop:    `3px solid ${C.team.red}`,
        border:       `1px solid ${C.border}`,
        borderRadius: 12,
        padding:      24,
        boxShadow:    "0 8px 16px rgba(0,0,0,0.25)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
        <span style={{ width: 12, height: 12, borderRadius: "50%", background: C.team.red }} />
        <h3 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 22, margin: 0 }}>Team Red</h3>
        <span style={{
          marginLeft: 4,
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.15em",
          padding: "2px 8px",
          borderRadius: 999,
          color: C.team.red,
          border: `1px solid ${C.team.red}`,
          textTransform: "uppercase",
        }}>
          🎯 On the spot
        </span>
        <span style={{ marginLeft: "auto", fontSize: 13, color: C.textMuted, fontFamily: "JetBrains Mono, monospace" }}>4 cards</span>
      </div>

      {/* Avatar row */}
      <div style={{ display: "flex", gap: 24, paddingTop: 8, borderTop: `1px dashed ${C.border}` }}>
        <PlayerAvatar name="Anna"     captain color={C.team.red} />
        <PlayerAvatar name="Lukas"    color={C.team.red} />
        <PlayerAvatar name="Frederik" you color={C.team.red} bubble="that's late 90s" />
        <PlayerAvatar name="Daniel"   color={C.team.red} />
      </div>
    </div>
  );
}

function PlayerAvatar({ name, captain, you, color, bubble }: {
  name: string;
  captain?: boolean;
  you?: boolean;
  color: string;
  bubble?: string;
}) {
  return (
    <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", width: 60 }}>
      {bubble && (
        <div
          style={{
            position:     "absolute",
            bottom:       "100%",
            left:         "50%",
            transform:    "translateX(-50%)",
            marginBottom: 8,
            background:   shade(color, -20),
            color:        "#fff",
            fontSize:     13,
            fontWeight:   600,
            padding:      "8px 12px",
            borderRadius: 16,
            whiteSpace:   "nowrap",
            boxShadow:    "0 4px 14px rgba(0,0,0,0.45)",
          }}
        >
          {bubble}
        </div>
      )}
      <div
        style={{
          position:     "relative",
          width:        44,
          height:       44,
          borderRadius: "50%",
          background:   color,
          border:       `2px solid ${shade(color, -25)}`,
          color:        "#fff",
          display:      "flex",
          alignItems:   "center",
          justifyContent:"center",
          fontWeight:   800,
          fontSize:     17,
          boxShadow:    "inset 0 1px 0 rgba(255,255,255,0.22), 0 4px 8px rgba(0,0,0,0.3)",
        }}
      >
        {name[0]}
        {captain && (
          <span
            style={{
              position:   "absolute",
              top:        -6,
              right:      -6,
              width:      20,
              height:     20,
              borderRadius:"50%",
              background: "linear-gradient(135deg,#facc15,#b45309)",
              fontSize:   11,
              display:    "flex",
              alignItems: "center",
              justifyContent:"center",
              boxShadow:  "0 2px 6px rgba(250,204,21,0.5)",
            }}
          >
            👑
          </span>
        )}
      </div>
      <span style={{ fontSize: 11, color: you ? C.textPrimary : C.textMuted, marginTop: 4 }}>
        {name.split(" ")[0]}{you && " (you)"}
      </span>
    </div>
  );
}

/* ── Ping mockup ────────────────────────────────────────────────────────── */

function PingMock() {
  return (
    <div
      style={{
        background: C.bgElevated,
        border:     `1px solid ${C.border}`,
        borderRadius:12,
        padding:    "60px 40px 32px",
        boxShadow:  "0 8px 16px rgba(0,0,0,0.25)",
        position:   "relative",
        display:    "flex",
        gap:        80,
        justifyContent:"center",
      }}
    >
      <div style={{ position: "relative", paddingTop: 40 }}>
        <Pin name="Anna" />
        <span style={{ width: 6, height: 6, borderRadius: 999, background: C.border, display: "block", margin: "0 auto" }} />
        <p style={{ fontSize: 11, color: C.textMuted, marginTop: 16, textAlign: "center" }}>Teammate's pin</p>
      </div>
      <div style={{ position: "relative", paddingTop: 40 }}>
        <Pin name="Frederik" mine />
        <span style={{ width: 6, height: 6, borderRadius: 999, background: C.border, display: "block", margin: "0 auto" }} />
        <p style={{ fontSize: 11, color: C.textMuted, marginTop: 16, textAlign: "center" }}>Your pin (amber)</p>
      </div>
      <div style={{ position: "relative", paddingTop: 40 }}>
        <Pin name="Lukas" />
        <Pin name="Anna" />
        <span style={{ width: 6, height: 6, borderRadius: 999, background: C.border, display: "block", margin: "0 auto" }} />
        <p style={{ fontSize: 11, color: C.textMuted, marginTop: 16, textAlign: "center" }}>Stacked</p>
      </div>
    </div>
  );
}

/* ── Modal mockup ───────────────────────────────────────────────────────── */

function ModalMock() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <PressButton variant="primary" {...(open ? {} : {})}>
        <span onClick={() => setOpen(true)}>Open modal preview</span>
      </PressButton>

      {/* Inline mock — always visible at low opacity for the design page */}
      <div
        style={{
          marginTop:    16,
          background:   C.bgOverlay,
          border:       `1px solid ${C.border}`,
          borderRadius: 12,
          padding:      24,
          maxWidth:     420,
          boxShadow:    "0 24px 48px rgba(0,0,0,0.5)",
        }}
      >
        <h3 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 20, margin: "0 0 4px" }}>Move Frederik</h3>
        <p style={{ fontSize: 13, color: C.textMuted, margin: "0 0 16px" }}>Pick a team to move them to.</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
          {(["Red", "Blue", "Green"] as const).map(t => (
            <button
              key={t}
              style={{
                background:    "transparent",
                border:        `1px solid ${C.team[t.toLowerCase() as keyof typeof C.team]}`,
                color:         C.team[t.toLowerCase() as keyof typeof C.team],
                fontSize:      13,
                fontWeight:    700,
                padding:       "6px 12px",
                borderRadius:  8,
                cursor:        "pointer",
              }}
            >
              <span style={{
                display:      "inline-block",
                width:        8,
                height:       8,
                borderRadius: "50%",
                marginRight:  6,
                background:   C.team[t.toLowerCase() as keyof typeof C.team],
              }} />
              Team {t}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <PressButton>Confirm</PressButton>
          <PressButton variant="ghost">Cancel</PressButton>
        </div>
      </div>

      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: "fixed", inset: 0,
            background: "rgba(0,0,0,0.7)",
            backdropFilter: "blur(4px)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 100,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: C.bgOverlay,
              border:     `1px solid ${C.border}`,
              borderRadius: 12,
              padding:    32,
              minWidth:   320,
              boxShadow:  "0 24px 48px rgba(0,0,0,0.6)",
            }}
          >
            <p style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: "0.15em", color: C.accent, margin: 0 }}>Live preview</p>
            <h3 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 22, margin: "8px 0 16px" }}>It looks like this in context.</h3>
            <PressButton variant="ghost"><span onClick={() => setOpen(false)}>Close</span></PressButton>
          </div>
        </div>
      )}
    </>
  );
}
