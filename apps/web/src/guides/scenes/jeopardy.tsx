import { Avatar, Phone, Pill, Screen, T, TEAM, Tap, tint, useBeat } from "../motion";

const CATS = ["80s", "Food", "Space", "Films", "Sport"];
const VALUES = [100, 200, 300, 400, 500];

/** The big-screen board: a tile is picked and opens into its question. */
export function JeopardyBoardScene() {
  const beat = useBeat(7, 750);
  const spent = new Set(beat >= 1 ? ["0-0", "3-1", "1-2"] : ["0-0"]);
  const pickCol = 2, pickRow = 2;
  const open = beat >= 3;

  return (
    <Screen width={276} height={170}>
      <div className="relative w-full h-full">
        <div className="grid grid-cols-5 gap-[3px] h-full" style={{ gridTemplateRows: "auto repeat(5, 1fr)" }}>
          {CATS.map((c) => (
            <div key={c} className="text-center text-[8px] font-bold uppercase py-1 rounded-sm" style={{ background: "rgba(var(--accent), 0.25)", color: "rgb(var(--text-primary-rgb))" }}>
              {c}
            </div>
          ))}
          {VALUES.map((v, r) => CATS.map((_, c) => {
            const key = `${c}-${r}`;
            const picked = c === pickCol && r === pickRow && beat === 2;
            const gone = spent.has(key);
            return (
              <div
                key={key}
                className="flex items-center justify-center rounded-sm font-bold tabular-nums"
                style={{
                  ...T,
                  fontSize: 10,
                  background: picked ? "rgba(var(--accent), 0.6)" : "rgb(var(--surface-raised-rgb))",
                  border: "1px solid rgb(var(--border-rgb))",
                  color: gone ? "transparent" : "rgb(var(--accent))",
                }}
              >
                {v}
              </div>
            );
          }))}
        </div>

        {/* Open question */}
        <div
          className="absolute inset-0 rounded flex flex-col items-center justify-center text-center px-4"
          style={{
            ...T,
            background: "rgb(var(--surface-raised-rgb))",
            border: "1px solid rgba(var(--accent), 0.7)",
            opacity: open ? 1 : 0,
            transform: open ? "scale(1)" : "scale(0.2)",
            transformOrigin: "50% 62%",
          }}
        >
          <div className="text-[8px] uppercase font-bold tracking-widest" style={{ color: "rgb(var(--accent))" }}>Space · 300</div>
          <div className="text-[12px] font-bold leading-snug mt-1" style={{ color: "rgb(var(--text-primary-rgb))" }}>
            This planet has the most moons in our solar system.
          </div>
          <div className="mt-2"><Pill rgb={TEAM.blue} show={beat >= 5}>🔔 Team Blue buzzed</Pill></div>
        </div>
      </div>
    </Screen>
  );
}

/** Three screens: big screen for the room, host phone, a phone per player. */
export function JeopardySetupScene() {
  const beat = useBeat(4, 900, 3);
  const glow = (i: number) => (beat === i ? "rgba(var(--accent), 0.9)" : "rgb(var(--border-rgb))");
  return (
    <div className="flex items-end gap-4">
      <div className="flex flex-col items-center gap-1" style={{ ...T, opacity: beat >= 0 ? 1 : 0 }}>
        <div className="rounded-lg p-1.5" style={{ border: `1px solid ${glow(0)}`, ...T }}>
          <Screen width={120} height={74}>
            <div className="grid grid-cols-4 gap-[2px] h-full">
              {Array.from({ length: 16 }, (_, i) => (
                <div key={i} className="rounded-[2px]" style={{ background: i < 4 ? "rgba(var(--accent), 0.3)" : "rgb(var(--surface-raised-rgb))" }} />
              ))}
            </div>
          </Screen>
        </div>
        <span className="text-[10px] font-bold" style={{ color: "rgb(var(--text-secondary-rgb))" }}>📺 Big screen</span>
      </div>
      <div className="flex flex-col items-center gap-1" style={{ ...T, opacity: beat >= 1 ? 1 : 0.25 }}>
        <div className="rounded-[20px]" style={{ border: `1px solid ${glow(1)}`, ...T }}>
          <Phone width={62} height={100}>
            <div className="text-[7px] font-bold mt-1" style={{ color: "rgb(var(--accent))" }}>HOST</div>
            <div className="flex gap-1 mt-2">
              <div className="w-5 h-5 rounded flex items-center justify-center text-[9px]" style={{ background: tint(TEAM.green, 0.35) }}>✓</div>
              <div className="w-5 h-5 rounded flex items-center justify-center text-[9px]" style={{ background: tint(TEAM.red, 0.35) }}>✗</div>
            </div>
          </Phone>
        </div>
        <span className="text-[10px] font-bold" style={{ color: "rgb(var(--text-secondary-rgb))" }}>Host</span>
      </div>
      <div className="flex flex-col items-center gap-1" style={{ ...T, opacity: beat >= 2 ? 1 : 0.25 }}>
        <div className="flex gap-1">
          {[TEAM.blue, TEAM.red].map((rgb) => (
            <div key={rgb} className="rounded-[20px]" style={{ border: `1px solid ${glow(2)}`, ...T }}>
              <Phone width={50} height={84}>
                <div className="mt-3 w-8 h-8 rounded-full" style={{ background: tint(rgb, 0.6), border: `2px solid rgb(${rgb})` }} />
              </Phone>
            </div>
          ))}
        </div>
        <span className="text-[10px] font-bold" style={{ color: "rgb(var(--text-secondary-rgb))" }}>Players</span>
      </div>
    </div>
  );
}

/** Buzzers open after a reading delay; the server picks who was first. */
export function BuzzerScene() {
  const beat = useBeat(7, 700);
  const live = beat >= 2;
  const winner = beat >= 4;
  const players = [
    { rgb: TEAM.blue, name: "Blue", press: 3 },
    { rgb: TEAM.red, name: "Red", press: 4 },
    { rgb: TEAM.green, name: "Green", press: 99 },
  ];
  return (
    <div className="flex flex-col items-center gap-3">
      <Pill show rgb={live ? TEAM.green : undefined}>{live ? "🟢 Buzzers live!" : "📖 Reading time…"}</Pill>
      <div className="flex gap-3">
        {players.map((p, i) => {
          const pressed = beat >= p.press;
          const first = winner && i === 0;
          const locked = winner && i !== 0;
          return (
            <div key={p.name} className="relative">
              <Phone width={74} height={112}>
                <div className="flex-1 flex flex-col items-center justify-center w-full">
                  <div
                    className="rounded-full flex items-center justify-center text-[9px] font-black"
                    style={{
                      ...T,
                      width: 50, height: 50,
                      background: locked ? "rgb(var(--surface-input-rgb))" : first ? `rgb(${p.rgb})` : tint(p.rgb, live ? 0.55 : 0.18),
                      border: `2px solid ${live ? `rgb(${p.rgb})` : "rgb(var(--border-rgb))"}`,
                      color: "rgb(var(--text-primary-rgb))",
                      transform: pressed && beat === p.press ? "scale(0.88)" : "scale(1)",
                    }}
                  >
                    {first ? "FIRST!" : locked ? "—" : "BUZZ"}
                  </div>
                  <div className="text-[9px] font-bold mt-1.5" style={{ color: `rgb(${p.rgb})` }}>{p.name}</div>
                </div>
              </Phone>
              <Tap show={beat === p.press} x="50%" y="48%" />
            </div>
          );
        })}
      </div>
      <Pill rgb={TEAM.blue} show={winner}>Blue was 0.21 s faster — they answer</Pill>
    </div>
  );
}

/** Host judges out loud answers: right adds the tile's value, wrong takes it away. */
export function ScoringScene() {
  const beat = useBeat(6, 850);
  const blue = beat >= 2 ? 700 : 400;
  const red = beat >= 4 ? 100 : 400;
  return (
    <div className="flex items-center gap-6">
      <div className="flex flex-col gap-2">
        {[
          { n: "Blue", rgb: TEAM.blue, s: blue, d: beat === 2 || beat === 3 ? "+300" : "" },
          { n: "Red", rgb: TEAM.red, s: red, d: beat === 4 || beat === 5 ? "−300" : "" },
        ].map((t) => (
          <div key={t.n} className="relative flex items-center gap-2 rounded-md px-3 py-2" style={{ width: 140, background: "rgb(var(--surface-raised-rgb))", border: "1px solid rgb(var(--border-rgb))", borderTop: `3px solid rgb(${t.rgb})` }}>
            <span className="text-[12px] font-bold flex-1" style={{ color: `rgb(${t.rgb})` }}>{t.n}</span>
            <span className="text-[16px] font-bold tabular-nums" style={{ ...T, fontFamily: "var(--font-display)", color: "rgb(var(--text-primary-rgb))" }}>{t.s}</span>
            {t.d && (
              <span key={t.d + beat} className="gs-rise absolute right-2 -top-3 text-[12px] font-bold" style={{ color: t.d.startsWith("+") ? `rgb(${TEAM.green})` : `rgb(${TEAM.red})` }}>
                {t.d}
              </span>
            )}
          </div>
        ))}
      </div>
      <Phone width={86} height={130}>
        <div className="text-[7px] font-bold mt-1" style={{ color: "rgb(var(--accent))" }}>HOST · 300</div>
        <div className="text-[8px] mt-1 px-1 text-center" style={{ color: "rgb(var(--text-secondary-rgb))" }}>
          {beat < 3 ? "Blue says: Saturn" : "Red says: Jupiter"}
        </div>
        <div className="flex gap-1.5 mt-3">
          <div className="w-7 h-7 rounded flex items-center justify-center text-[12px]" style={{ ...T, background: tint(TEAM.green, beat === 1 ? 0.8 : 0.3) }}>✓</div>
          <div className="w-7 h-7 rounded flex items-center justify-center text-[12px]" style={{ ...T, background: tint(TEAM.red, beat === 3 ? 0.8 : 0.3) }}>✗</div>
        </div>
        <Tap show={beat === 1} x="33%" y={78} />
        <Tap show={beat === 3} x="67%" y={78} />
      </Phone>
    </div>
  );
}

/** Phone question types: multiple choice, closest number, ranking. */
export function AnswerModesScene() {
  const beat = useBeat(9, 800, 0);
  const mode = Math.floor(beat / 3);
  const b = beat % 3;
  const titles = ["🔤 Multiple choice", "📏 Closest number", "🔢 Ranking"];
  const rank = b >= 1 ? ["Everest", "K2", "Mont Blanc"] : ["K2", "Mont Blanc", "Everest"];

  return (
    <div className="flex items-center gap-5">
      <Phone width={124} height={176}>
        <div className="w-full px-2">
          <div className="text-[9px] font-bold text-center mt-1" style={{ color: "rgb(var(--accent))" }}>{titles[mode]}</div>
          {mode === 0 && (
            <div className="grid grid-cols-2 gap-1 mt-2">
              {["Mars", "Saturn", "Venus", "Jupiter"].map((o, i) => (
                <div key={o} className="rounded py-2 text-center text-[9px] font-bold" style={{ ...T, background: b >= 1 && i === 1 ? "rgba(var(--accent), 0.35)" : "rgb(var(--surface-input-rgb))", border: `1px solid ${b >= 2 && i === 1 ? tint(TEAM.green, 0.9) : "rgb(var(--border-rgb))"}`, color: "rgb(var(--text-primary-rgb))" }}>
                  {o}
                </div>
              ))}
            </div>
          )}
          {mode === 1 && (
            <div className="mt-3">
              <div className="text-[8px] text-center" style={{ color: "rgb(var(--text-secondary-rgb))" }}>Height of Everest?</div>
              <div className="relative h-1.5 rounded-full mt-3" style={{ background: "rgb(var(--surface-input-rgb))" }}>
                <div className="absolute -top-1.5 w-4 h-4 rounded-full" style={{ ...T, left: `${[20, 62, 62][b]}%`, background: "rgb(var(--accent))" }} />
              </div>
              <div className="text-center font-bold tabular-nums mt-3 text-[13px]" style={{ color: "rgb(var(--text-primary-rgb))" }}>{[3000, 8700, 8700][b]} m</div>
            </div>
          )}
          {mode === 2 && (
            <div className="relative mt-2" style={{ height: 80 }}>
              {["Everest", "K2", "Mont Blanc"].map((m) => (
                <div key={m} className="absolute left-0 right-0 rounded px-2 py-1.5 text-[9px] font-bold" style={{ ...T, top: rank.indexOf(m) * 25, background: "rgb(var(--surface-input-rgb))", border: `1px solid ${b >= 2 ? tint(TEAM.green, 0.8) : "rgb(var(--border-rgb))"}`, color: "rgb(var(--text-primary-rgb))" }}>
                  ☰ {m}
                </div>
              ))}
            </div>
          )}
        </div>
      </Phone>
      <div className="flex flex-col gap-2" style={{ width: 130 }}>
        {titles.map((t, i) => (
          <div key={t} className="text-[11px] font-semibold rounded-md px-2 py-1.5" style={{ ...T, background: i === mode ? "rgba(var(--accent), 0.15)" : "transparent", border: `1px solid ${i === mode ? "rgba(var(--accent), 0.6)" : "transparent"}`, color: i === mode ? "rgb(var(--text-primary-rgb))" : "rgb(var(--text-muted-rgb))" }}>
            {t}
          </div>
        ))}
        <Pill rgb={TEAM.green} show={b >= 2}>{["Right answer scores", "Closest team scores", "Right order scores"][mode]}</Pill>
      </div>
    </div>
  );
}

/** A hidden power-up tile: answer right, then take the points or the power-up. */
export function PowerupScene() {
  const beat = useBeat(6, 850);
  return (
    <div className="flex items-center gap-5">
      <div
        className={beat === 1 ? "gs-shake" : ""}
        style={{
          ...T,
          width: 92, height: 92, borderRadius: 10,
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          background: beat >= 1 ? "rgba(var(--accent), 0.22)" : "rgb(var(--surface-raised-rgb))",
          border: `1px solid ${beat >= 1 ? "rgba(var(--accent), 0.9)" : "rgb(var(--border-rgb))"}`,
        }}
      >
        {beat >= 1 ? (
          <>
            <span className="gs-pop" style={{ fontSize: 28 }}>⚡</span>
            <span className="text-[10px] font-bold mt-1" style={{ color: "rgb(var(--accent))" }}>Power-up!</span>
          </>
        ) : (
          <span className="font-bold text-[18px]" style={{ color: "rgb(var(--accent))" }}>400</span>
        )}
      </div>
      <div className="flex flex-col gap-2" style={{ width: 150 }}>
        <div className="text-[10px] font-semibold" style={{ ...T, opacity: beat >= 2 ? 1 : 0, color: "rgb(var(--text-secondary-rgb))" }}>Blue answered right. Pick one:</div>
        {[
          { t: "Take the 400 points", on: false },
          { t: "⚡ Take Sniper instead", on: beat >= 4 },
        ].map((o, i) => (
          <div key={o.t} className="relative rounded-md px-2.5 py-1.5 text-[11px] font-bold" style={{ ...T, opacity: beat >= 2 ? 1 : 0, background: o.on ? "rgba(var(--accent), 0.25)" : "rgb(var(--surface-raised-rgb))", border: `1px solid ${o.on ? "rgba(var(--accent), 0.8)" : "rgb(var(--border-rgb))"}`, color: "rgb(var(--text-primary-rgb))" }}>
            {o.t}
            {i === 1 && <Tap show={beat === 3} x="80%" y="50%" />}
          </div>
        ))}
        <div className="flex items-center gap-1.5" style={{ ...T, opacity: beat >= 5 ? 1 : 0 }}>
          <Avatar rgb={TEAM.blue} label="B" size={18} />
          <span className="text-[10px]" style={{ color: "rgb(var(--text-muted-rgb))" }}>Blue now buzzes with a head start</span>
        </div>
      </div>
    </div>
  );
}

/** Final Jeopardy: every team wagers, answers in secret, the host reveals. */
export function FinalScene() {
  const beat = useBeat(7, 850);
  const teams = [
    { n: "Blue", rgb: TEAM.blue, score: 1800, wager: 1000, right: true },
    { n: "Red", rgb: TEAM.red, score: 1500, wager: 1500, right: false },
  ];
  return (
    <div className="flex flex-col items-center gap-3">
      <Pill show>{beat < 3 ? "1 · Place your wager" : beat < 5 ? "2 · Answer in secret" : "3 · Reveal"}</Pill>
      <div className="flex gap-3">
        {teams.map((t, i) => {
          const revealed = beat >= 5 + i;
          const final = revealed ? (t.right ? t.score + t.wager : t.score - t.wager) : t.score;
          return (
            <div key={t.n} className="rounded-lg px-3 py-2 flex flex-col items-center gap-1" style={{ width: 120, background: "rgb(var(--surface-raised-rgb))", border: "1px solid rgb(var(--border-rgb))", borderTop: `3px solid rgb(${t.rgb})` }}>
              <span className="text-[11px] font-bold" style={{ color: `rgb(${t.rgb})` }}>{t.n}</span>
              <span className="text-[18px] font-bold tabular-nums" style={{ ...T, fontFamily: "var(--font-display)", color: "rgb(var(--text-primary-rgb))" }}>{final}</span>
              <span className="text-[10px] tabular-nums" style={{ ...T, opacity: beat >= 1 + i ? 1 : 0, color: "rgb(var(--text-secondary-rgb))" }}>
                wager {t.wager}
              </span>
              <span className="text-[10px] font-bold" style={{ ...T, opacity: beat >= 3 ? 1 : 0, color: revealed ? (t.right ? `rgb(${TEAM.green})` : `rgb(${TEAM.red})`) : "rgb(var(--text-muted-rgb))" }}>
                {revealed ? (t.right ? "✓ Right" : "✗ Wrong") : "🔒 answer locked"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
