import { Phone, Pill, T, TEAM, Tap, tint, useBeat } from "../motion";

// ── Pieces ───────────────────────────────────────────────────────────────────

function YearCard({
  year, x, y = 0, w = 50, state = "locked", flip = false, style,
}: {
  year: string;
  x: number;
  y?: number;
  w?: number;
  state?: "locked" | "pending" | "mystery" | "wrong" | "right";
  flip?: boolean;
  style?: React.CSSProperties;
}) {
  const border =
    state === "pending" ? "1px dashed rgba(var(--accent), 0.9)"
    : state === "wrong" ? `1px solid ${tint(TEAM.red, 0.9)}`
    : state === "right" ? `1px solid ${tint(TEAM.green, 0.9)}`
    : state === "mystery" ? "1px solid rgba(var(--accent), 0.9)"
    : "1px solid rgb(var(--border-rgb))";
  return (
    <div
      className="absolute rounded-md flex flex-col items-center justify-center"
      style={{
        ...T,
        left: x, top: y, width: w, height: w * 1.3,
        background: state === "mystery" ? "rgba(var(--accent), 0.16)" : "rgb(var(--surface-raised-rgb))",
        border,
        transform: flip ? "rotateY(180deg)" : "none",
        ...style,
      }}
    >
      {state === "mystery" ? (
        <span style={{ fontSize: w * 0.42 }}>♪</span>
      ) : (
        <>
          <span className="font-bold" style={{ fontFamily: "var(--font-display)", fontSize: w * 0.28, color: "rgb(var(--text-primary-rgb))" }}>
            {year}
          </span>
          <span className="w-6 h-0.5 rounded mt-1" style={{ background: "rgb(var(--border-rgb))" }} />
          <span className="w-4 h-0.5 rounded mt-1" style={{ background: "rgb(var(--border-rgb))" }} />
        </>
      )}
    </div>
  );
}

function Equalizer({ on }: { on: boolean }) {
  return (
    <div className="flex items-end gap-[3px] h-4">
      {[0.5, 1, 0.7, 0.9, 0.4].map((h, i) => (
        <div
          key={i}
          className="w-[3px] rounded-sm"
          style={{
            height: `${(on ? h : 0.2) * 100}%`,
            background: "rgb(var(--accent))",
            transition: `height ${260 + i * 70}ms ease`,
          }}
        />
      ))}
    </div>
  );
}

// ── Scenes ───────────────────────────────────────────────────────────────────

/** A song plays, the captain slides the mystery card along the timeline and drops it. */
export function TimelineDropScene() {
  const beat = useBeat(7, 800);
  // Mystery card x by beat: hover over gaps right-to-left, then drop into the first gap.
  const xs = [230, 175, 175, 65, 65, 65, 65];
  const dropped = beat >= 4;
  const revealed = beat >= 5;

  return (
    <div className="relative" style={{ width: 290, height: 190 }}>
      <div className="absolute left-0 top-0 flex items-center gap-2">
        <Equalizer on={beat % 2 === 0 || beat < 4} />
        <span className="text-[11px] font-semibold" style={{ color: "rgb(var(--text-secondary-rgb))" }}>
          {revealed ? "Nirvana — Smells Like Teen Spirit" : "Now playing…"}
        </span>
      </div>

      {/* Timeline rail */}
      <div className="absolute left-0 right-0" style={{ top: 152, height: 2, background: "rgb(var(--border-rgb))" }} />

      {/* Gaps */}
      {[65, 175].map((gx) => (
        <div
          key={gx}
          className="absolute rounded-md"
          style={{
            ...T,
            left: gx, top: 85, width: 50, height: 65,
            border: `1px dashed ${xs[beat] === gx && !dropped ? "rgba(var(--accent), 0.9)" : "rgb(var(--border-rgb))"}`,
            opacity: dropped && gx === 65 ? 0 : 1,
          }}
        />
      ))}

      <YearCard year="1984" x={10} y={85} />
      <YearCard year="2003" x={120} y={85} />
      <YearCard year="2016" x={230} y={85} />

      <YearCard
        year="1991"
        x={xs[beat]}
        y={dropped ? 85 : 22}
        state={revealed ? "right" : "mystery"}
      />

      <div className="absolute left-0 right-0 flex justify-center" style={{ top: 162 }}>
        <Pill rgb={TEAM.green} show={beat >= 6}>✓ 1991 fits between 1984 and 2003</Pill>
      </div>
      <Tap show={beat === 3} x={90} y={60} />
    </div>
  );
}

/** Push your luck: correct cards pile up as pending; lock in to keep them, or miss and lose the pile. */
export function PushLuckScene() {
  const beat = useBeat(12, 850, 0);
  const lockPath = beat < 6;
  const b = lockPath ? beat : beat - 6;

  const card1 = b >= 1;
  const card2 = b >= 2;
  const decide = b >= 3;
  const outcome = b >= 4;

  return (
    <div className="relative" style={{ width: 290, height: 190 }}>
      <div className="absolute left-0 top-0 text-[10px] uppercase font-bold tracking-widest" style={{ color: "rgb(var(--text-muted-rgb))" }}>
        Your turn · {lockPath ? "play it safe" : "one song too many"}
      </div>

      {/* Locked cards */}
      <YearCard year="1975" x={0} y={40} w={44} />
      <YearCard year="2008" x={50} y={40} w={44} />

      {/* Pending pile */}
      {[{ y: "1999", x: 110, show: card1 }, { y: "2012", x: 160, show: card2 }].map((c) => {
        const lost = !lockPath && outcome;
        return (
          <YearCard
            key={c.y}
            year={c.y}
            x={c.x}
            y={lost ? 140 : 40}
            w={44}
            state={lockPath && outcome ? "locked" : "pending"}
            style={{
              opacity: c.show ? (lost ? 0 : 1) : 0,
              borderColor: lockPath && outcome ? "rgba(var(--accent), 0.9)" : undefined,
            }}
          />
        );
      })}

      {/* The fatal third card */}
      {!lockPath && (
        <div className={b === 3 ? "gs-shake" : ""}>
          <YearCard year="1968" x={210} y={40} w={44} state="wrong" style={{ opacity: decide ? 1 : 0 }} />
        </div>
      )}

      {lockPath && (
        <div className="absolute flex gap-2" style={{ left: 60, top: 118, ...T, opacity: decide && !outcome ? 1 : 0 }}>
          <div className="rounded-md px-2.5 py-1.5 text-[10px] font-bold" style={{ background: "rgb(var(--accent))", color: "rgb(var(--bg-rgb))" }}>
            🔒 Lock in
          </div>
          <div className="rounded-md px-2.5 py-1.5 text-[10px] font-bold" style={{ border: "1px solid rgb(var(--border-rgb))", color: "rgb(var(--text-secondary-rgb))" }}>
            Next song →
          </div>
        </div>
      )}
      <Tap show={lockPath && b === 3} x={95} y={135} />

      <div className="absolute left-0 right-0 flex justify-center" style={{ top: 160 }}>
        {lockPath
          ? <Pill rgb={TEAM.green} show={outcome}>🔒 4 cards locked on the timeline</Pill>
          : <Pill rgb={TEAM.red} show={outcome}>✗ Miss — the 2 pending cards are lost</Pill>}
      </div>
    </div>
  );
}

/** Captain types artist + title; both right earns a token. */
export function GuessScene() {
  const beat = useBeat(8, 600);
  const artist = "Nirvana".slice(0, Math.max(0, Math.min(7, (beat) * 3)));
  const title = "Smells Like Teen Spirit".slice(0, Math.max(0, Math.min(23, (beat - 2) * 8)));
  const judged = beat >= 5;

  const Field = ({ label, value, ok }: { label: string; value: string; ok: boolean }) => (
    <div className="w-full mt-1.5">
      <div className="text-[7px] uppercase font-bold" style={{ color: "rgb(var(--text-muted-rgb))" }}>{label}</div>
      <div
        className="w-full rounded px-1.5 py-1 text-[9px] font-semibold flex justify-between items-center"
        style={{
          ...T,
          minHeight: 20,
          background: "rgb(var(--surface-input-rgb))",
          border: `1px solid ${ok ? tint(TEAM.green, 0.8) : "rgb(var(--border-rgb))"}`,
          color: "rgb(var(--text-primary-rgb))",
        }}
      >
        <span className="truncate">{value}</span>
        {ok && <span className="gs-pop" style={{ color: `rgb(${TEAM.green})` }}>✓</span>}
      </div>
    </div>
  );

  return (
    <div className="flex items-center gap-6">
      <Phone>
        <div className="w-full px-2">
          <div className="text-[9px] font-bold text-center mt-1" style={{ color: "rgb(var(--text-primary-rgb))" }}>Name it for a bonus</div>
          <Field label="Artist" value={artist} ok={judged} />
          <Field label="Song" value={title} ok={judged} />
        </div>
      </Phone>
      <div className="flex flex-col items-center gap-2" style={{ width: 110 }}>
        <div
          className={beat >= 6 ? "gs-pop" : ""}
          style={{
            ...T,
            opacity: beat >= 6 ? 1 : 0.15,
            width: 52, height: 52, borderRadius: 9999,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 24,
            background: "rgba(var(--accent), 0.18)",
            border: "2px solid rgba(var(--accent), 0.8)",
          }}
        >
          🪙
        </div>
        <Pill show={beat >= 6}>+1 power-up token</Pill>
      </div>
    </div>
  );
}

/** Two teams race to the cards-to-win target. */
export function MusixGoalScene() {
  const beat = useBeat(6, 750);
  const target = 10;
  const blue = Math.min(target, 6 + beat);
  const red = Math.min(8, 5 + Math.floor(beat * 0.7));

  const Row = ({ name, rgb, n }: { name: string; rgb: string; n: number }) => (
    <div className="flex items-center gap-2">
      <span className="text-[11px] font-bold w-14" style={{ color: `rgb(${rgb})` }}>{name}</span>
      <div className="flex gap-[3px]">
        {Array.from({ length: target }, (_, i) => (
          <div
            key={i}
            className="rounded-sm"
            style={{
              ...T,
              width: 16, height: 22,
              background: i < n ? tint(rgb, 0.55) : "transparent",
              border: `1px solid ${i < n ? tint(rgb, 0.9) : "rgb(var(--border-rgb))"}`,
              transform: i < n ? "scale(1)" : "scale(0.9)",
            }}
          />
        ))}
      </div>
      <span className="text-[11px] font-bold tabular-nums w-9" style={{ color: "rgb(var(--text-secondary-rgb))" }}>{n}/{target}</span>
    </div>
  );

  return (
    <div className="flex flex-col items-center gap-3">
      <Row name="Team 1" rgb={TEAM.blue} n={blue} />
      <Row name="Team 2" rgb={TEAM.red} n={red} />
      <Pill rgb={TEAM.blue} show={blue >= target}>🏆 Team 1 hits 10 cards and wins</Pill>
    </div>
  );
}

/** Where the songs come from — the host picks one source. */
export function SongSourceScene() {
  const beat = useBeat(3, 1300, 1);
  const options = [
    { icon: "🎧", t: "Group taste", d: "From what you all play" },
    { icon: "🟢", t: "Spotify taste", d: "From Spotify accounts" },
    { icon: "📃", t: "Playlist", d: "Paste any playlist" },
  ];
  return (
    <div className="flex flex-col gap-2" style={{ width: 230 }}>
      {options.map((o, i) => {
        const on = beat === i;
        return (
          <div
            key={o.t}
            className="flex items-center gap-3 rounded-lg px-3 py-2"
            style={{
              ...T,
              background: on ? "rgba(var(--accent), 0.14)" : "rgb(var(--surface-raised-rgb))",
              border: `1px solid ${on ? "rgba(var(--accent), 0.7)" : "rgb(var(--border-rgb))"}`,
              transform: on ? "scale(1.03)" : "scale(1)",
            }}
          >
            <span style={{ fontSize: 18 }}>{o.icon}</span>
            <div>
              <div className="text-[12px] font-bold" style={{ color: "rgb(var(--text-primary-rgb))" }}>{o.t}</div>
              <div className="text-[10px]" style={{ color: "rgb(var(--text-muted-rgb))" }}>{o.d}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Music Bingo: suggest a word, captain confirms, complete a line. */
export function MusicBingoScene() {
  const beat = useBeat(9, 750);
  const words = [
    "LOVE", "NIGHT", "DANCE", "HEART",
    "RAIN", "FIRE", "QUEEN", "GIRL",
    "BLUE", "TIME", "KISS", "DREAM",
    "ABBA", "HOME", "GOLD", "WILD",
  ];
  // [cell, beat suggested, beat confirmed]
  const marks: [number, number, number][] = [
    [6, 1, 2],   // QUEEN  (Dancing Queen)
    [2, 1, 2],   // DANCE
    [4, 3, 4],   // RAIN
    [5, 4, 5],   // FIRE
    [7, 5, 6],   // GIRL → completes row 2
  ];
  const songs = ["", "ABBA — Dancing Queen", "ABBA — Dancing Queen", "Purple Rain", "Set Fire to the Rain", "Girls Just Want to Have Fun", "", "", ""];
  const bingo = beat >= 7;

  return (
    <div className="flex items-center gap-5">
      <div className="grid grid-cols-4 gap-1">
        {words.map((w, i) => {
          const m = marks.find((mk) => mk[0] === i);
          const suggested = m && beat >= m[1] && beat < m[2];
          const confirmed = m && beat >= m[2];
          const inLine = bingo && i >= 4 && i <= 7;
          return (
            <div
              key={w}
              className="relative rounded flex items-center justify-center font-bold"
              style={{
                ...T,
                width: 44, height: 30, fontSize: 8.5,
                letterSpacing: "0.04em",
                background: confirmed ? (inLine ? tint(TEAM.green, 0.35) : "rgba(var(--accent), 0.22)") : "rgb(var(--surface-raised-rgb))",
                border: suggested ? "1px dashed rgba(var(--accent), 0.9)"
                  : `1px solid ${inLine ? tint(TEAM.green, 0.9) : confirmed ? "rgba(var(--accent), 0.7)" : "rgb(var(--border-rgb))"}`,
                color: "rgb(var(--text-primary-rgb))",
              }}
            >
              <span style={{ textDecoration: confirmed ? "line-through" : "none", textDecorationThickness: 2, textDecorationColor: inLine ? `rgb(${TEAM.green})` : "rgb(var(--accent))" }}>
                {w}
              </span>
              {confirmed && m && beat === m[2] && <span className="gs-pop absolute inset-0 rounded" style={{ border: "2px solid rgb(var(--accent))" }} />}
            </div>
          );
        })}
      </div>
      <div className="flex flex-col gap-2" style={{ width: 104 }}>
        <div className="text-[9px] uppercase font-bold tracking-widest" style={{ color: "rgb(var(--text-muted-rgb))" }}>Now playing</div>
        <div className="text-[11px] font-semibold leading-tight" style={{ color: "rgb(var(--text-primary-rgb))", minHeight: 28 }}>
          {songs[beat] || "…"}
        </div>
        <Pill show={marks.some((m) => beat >= m[1] && beat < m[2])}>💡 Teammate suggests</Pill>
        <Pill rgb={TEAM.green} show={bingo}>BINGO! 🎉</Pill>
      </div>
    </div>
  );
}

/** Hero: compact loop of the timeline drop with a phone controller. */
export function MusixHeroScene() {
  return <TimelineDropScene />;
}
