import { Avatar, Phone, Pill, T, TEAM, Tap, tint, useBeat } from "../motion";

const kr = (n: number) => `${n.toLocaleString("da-DK")} kr`;
const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toLocaleString("da-DK")} kr`;

function Chip({ rgb, style }: { rgb: string; style?: React.CSSProperties }) {
  return (
    <div
      className="rounded-full"
      style={{
        width: 18, height: 18,
        background: `rgb(${rgb})`,
        border: "3px dashed rgba(255,255,255,0.55)",
        boxShadow: "0 1px 0 rgba(0,0,0,0.4)",
        ...style,
      }}
    />
  );
}

/** Hero: a night at the table — buy-ins go in, the night's results come out. */
export function PokerTableScene() {
  const beat = useBeat(7, 800);
  const seats = [
    { l: "A", rgb: TEAM.blue,   x: 50,  y: 6,   buy: 100, out: 260 },
    { l: "M", rgb: TEAM.red,    x: 214, y: 6,   buy: 150, out: 40 },
    { l: "S", rgb: TEAM.green,  x: 214, y: 132, buy: 100, out: 150 },
    { l: "J", rgb: TEAM.yellow, x: 50,  y: 132, buy: 100, out: 0 },
  ];
  const settled = beat >= 4;

  return (
    <div className="relative" style={{ width: 290, height: 180 }}>
      {/* felt */}
      <div
        className="absolute rounded-[60px] flex flex-col items-center justify-center"
        style={{ left: 55, top: 40, width: 180, height: 96, background: "rgba(var(--accent), 0.16)", border: "1px solid rgba(var(--accent), 0.5)" }}
      >
        <div className="text-[9px] uppercase font-bold tracking-widest" style={{ color: "rgb(var(--text-muted-rgb))" }}>On the table</div>
        <div className="font-bold tabular-nums" style={{ fontFamily: "var(--font-display)", fontSize: 20, color: "rgb(var(--text-primary-rgb))" }}>
          {kr(seats.slice(0, Math.min(4, beat)).reduce((s, p) => s + p.buy, 0))}
        </div>
      </div>
      {seats.map((p, i) => {
        const bought = beat > i;
        const net = p.out - p.buy;
        return (
          <div key={p.l} className="absolute flex items-center gap-1.5" style={{ left: p.x - (i === 0 || i === 3 ? 40 : 0), top: p.y }}>
            <Avatar rgb={p.rgb} label={p.l} size={26} />
            <div className="text-[10px] font-bold tabular-nums leading-tight" style={{ minWidth: 52 }}>
              <div style={{ ...T, color: "rgb(var(--text-secondary-rgb))", opacity: bought ? 1 : 0.3 }}>in {kr(p.buy)}</div>
              <div style={{ ...T, opacity: settled ? 1 : 0, color: net > 0 ? `rgb(${TEAM.green})` : net < 0 ? `rgb(${TEAM.red})` : "rgb(var(--text-muted-rgb))" }}>
                {signed(net)}
              </div>
            </div>
            {bought && !settled && beat === i + 1 && <Chip rgb={p.rgb} style={{ position: "absolute", left: 30, top: -4 }} />}
          </div>
        );
      })}
    </div>
  );
}

/** Create a group, share the invite link, friends join. */
export function GroupScene() {
  const beat = useBeat(6, 750);
  const members = [
    { l: "Y", rgb: TEAM.yellow, n: "You · admin" },
    { l: "A", rgb: TEAM.blue, n: "Anders" },
    { l: "M", rgb: TEAM.red, n: "Mette" },
    { l: "S", rgb: TEAM.green, n: "Søren" },
  ];
  return (
    <div className="flex items-center gap-5">
      <Phone>
        <div className="w-full px-2 flex flex-col items-center">
          <div className="text-[10px] font-bold mt-2" style={{ color: "rgb(var(--text-primary-rgb))" }}>Friday Poker</div>
          <div className="text-[8px]" style={{ color: "rgb(var(--text-muted-rgb))" }}>Pays via MobilePay Box</div>
          <div
            className="mt-3 w-full rounded-md px-1.5 py-1.5 text-[8px] truncate"
            style={{ fontFamily: "var(--font-mono)", background: "rgb(var(--surface-input-rgb))", border: "1px solid rgb(var(--border-rgb))", color: "rgb(var(--text-secondary-rgb))" }}
          >
            poker.gokkehub.com/join/…
          </div>
          <div
            className="mt-1.5 w-full rounded-md py-1.5 text-center text-[9px] font-bold"
            style={{ ...T, background: "rgb(var(--accent))", color: "rgb(var(--bg-rgb))", transform: beat === 1 ? "scale(0.95)" : "scale(1)" }}
          >
            {beat >= 1 ? "✓ Link copied" : "Copy invite link"}
          </div>
        </div>
        <Tap show={beat === 1} x="50%" y={100} />
      </Phone>
      <div className="flex flex-col gap-1.5">
        {members.map((m, i) => {
          const show = i === 0 || beat >= i + 1;
          return (
            <div key={m.l} className="flex items-center gap-2 rounded-md px-2 py-1" style={{ ...T, width: 120, opacity: show ? 1 : 0, transform: show ? "none" : "translateX(10px)", background: "rgb(var(--surface-raised-rgb))", border: "1px solid rgb(var(--border-rgb))" }}>
              <Avatar rgb={m.rgb} label={m.l} size={18} />
              <span className="text-[11px] font-semibold" style={{ color: "rgb(var(--text-primary-rgb))" }}>{m.n}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Top up: request an amount, pay with the group's payment app, the house confirms. */
export function TopUpScene() {
  const beat = useBeat(6, 850);
  const steps = ["Request 200 kr", "Pay with code K7Q2", "Waiting for the house", "Confirmed"];
  const balance = beat >= 4 ? 200 : 0;
  return (
    <div className="flex items-center gap-5">
      <Phone>
        <div className="w-full px-2 flex flex-col items-center">
          <div className="text-[8px] uppercase font-bold tracking-widest mt-2" style={{ color: "rgb(var(--text-muted-rgb))" }}>Balance</div>
          <div key={balance} className={balance ? "gs-pop" : ""} style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 22, color: "rgb(var(--accent))" }}>
            {kr(balance)}
          </div>
          <div className="mt-2 w-full grid grid-cols-2 gap-1">
            {[100, 200, 300, 500].map((q) => (
              <div key={q} className="rounded py-1 text-center text-[9px] font-bold tabular-nums" style={{ ...T, background: q === 200 && beat >= 1 ? "rgba(var(--accent), 0.25)" : "rgb(var(--surface-input-rgb))", border: `1px solid ${q === 200 && beat >= 1 ? "rgba(var(--accent), 0.8)" : "rgb(var(--border-rgb))"}`, color: "rgb(var(--text-primary-rgb))" }}>
                {q}
              </div>
            ))}
          </div>
        </div>
        <Tap show={beat === 1} x="72%" y={102} />
      </Phone>
      <div className="flex flex-col gap-1.5" style={{ width: 140 }}>
        {steps.map((s, i) => {
          const on = beat >= i + 1;
          const done = beat > i + 1 || (i === 3 && on);
          return (
            <div key={s} className="flex items-center gap-2" style={{ ...T, opacity: on ? 1 : 0.25 }}>
              <div className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold" style={{ ...T, background: done ? tint(TEAM.green, 0.3) : "rgba(var(--accent), 0.2)", color: done ? `rgb(${TEAM.green})` : "rgb(var(--accent))" }}>
                {done ? "✓" : i + 1}
              </div>
              <span className="text-[11px] font-semibold" style={{ color: "rgb(var(--text-primary-rgb))" }}>{s}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Buy in from your balance, rebuy if you bust, cash out what's in front of you. */
export function BuyInCashOutScene() {
  const beat = useBeat(8, 800);
  const balance = [200, 100, 100, 50, 50, 50, 250, 250][beat];
  const inGame = [0, 100, 100, 150, 150, 150, 150, 150][beat];
  const label = ["", "Buy in 100 kr", "Playing…", "Rebuy 50 kr", "Playing…", "Cash out: 200 kr in chips", "", ""][beat];

  return (
    <div className="flex items-center gap-5">
      <Phone width={132}>
        <div className="w-full px-2 flex flex-col items-center">
          <div className="text-[8px] uppercase font-bold tracking-widest mt-2" style={{ color: "rgb(var(--text-muted-rgb))" }}>Balance</div>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 20, color: "rgb(var(--accent))", ...T }}>{kr(balance)}</div>
          <div className="mt-2 w-full rounded-md px-2 py-1.5" style={{ background: "rgb(var(--surface-input-rgb))", border: "1px solid rgb(var(--border-rgb))" }}>
            <div className="flex justify-between text-[9px]"><span style={{ color: "rgb(var(--text-muted-rgb))" }}>Bought in</span><span className="font-bold tabular-nums" style={{ color: "rgb(var(--text-primary-rgb))" }}>{kr(inGame)}</span></div>
            <div className="flex justify-between text-[9px] mt-0.5"><span style={{ color: "rgb(var(--text-muted-rgb))" }}>Net</span>
              <span className="font-bold tabular-nums" style={{ ...T, color: beat >= 6 ? `rgb(${TEAM.green})` : "rgb(var(--text-muted-rgb))" }}>{beat >= 6 ? signed(50) : "—"}</span>
            </div>
          </div>
          <div className="mt-2 text-[9px] font-semibold text-center" style={{ color: "rgb(var(--text-secondary-rgb))", minHeight: 24 }}>{label}</div>
        </div>
      </Phone>
      <div className="relative flex flex-col items-center gap-1" style={{ width: 110 }}>
        <div className="flex flex-col-reverse items-center" style={{ height: 80 }}>
          {Array.from({ length: beat >= 5 ? 8 : beat >= 3 ? 6 : beat >= 1 ? 4 : 0 }, (_, i) => (
            <Chip key={i} rgb={i % 2 ? TEAM.red : TEAM.blue} style={{ marginTop: -10, width: 30, height: 14, borderRadius: 9999 }} />
          ))}
        </div>
        <Pill rgb={TEAM.green} show={beat >= 6}>Cashed out {signed(50)}</Pill>
      </div>
    </div>
  );
}

/** Leaderboard: who's up across the group's nights. */
export function LeaderboardScene() {
  const beat = useBeat(4, 900);
  const rows = [
    { n: "Anders", v: [120, 180, 240, 310] },
    { n: "Mette",  v: [200, 150, 160, 120] },
    { n: "Søren",  v: [-40, 30, 90, 60] },
    { n: "Jonas",  v: [-80, -150, -190, -260] },
  ];
  const sorted = [...rows].sort((a, b) => b.v[beat] - a.v[beat]);
  const max = 320;
  return (
    <div className="relative" style={{ width: 260, height: 4 * 30 }}>
      {rows.map((r) => {
        const rank = sorted.indexOf(r);
        const v = r.v[beat];
        const w = Math.abs(v) / max * 90;
        const rgb = v >= 0 ? TEAM.green : TEAM.red;
        return (
          <div key={r.n} className="absolute left-0 right-0 flex items-center gap-2" style={{ ...T, top: rank * 30, height: 26 }}>
            <span className="text-[10px] font-bold w-3 tabular-nums" style={{ color: "rgb(var(--text-muted-rgb))" }}>{rank + 1}</span>
            <span className="text-[11px] font-semibold w-12" style={{ color: "rgb(var(--text-primary-rgb))" }}>{r.n}</span>
            <div className="relative flex-1 h-3">
              <div className="absolute top-0 bottom-0" style={{ left: "50%", width: 1, background: "rgb(var(--border-rgb))" }} />
              <div
                className="absolute top-0 bottom-0 rounded-sm"
                style={{ ...T, background: tint(rgb, 0.6), width: `${w / 2}%`, left: v >= 0 ? "50%" : `${50 - w / 2}%` }}
              />
            </div>
            <span className="text-[10px] font-bold tabular-nums w-14 text-right" style={{ color: `rgb(${rgb})` }}>{signed(v)}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Tournament mystery bounty: record a knockout, they confirm, you draw from the pool. */
export function BountyScene() {
  const beat = useBeat(6, 850);
  return (
    <div className="flex items-center gap-4">
      <div className="flex flex-col items-center gap-1.5" style={{ width: 120 }}>
        <div className="flex items-center gap-2">
          <Avatar rgb={TEAM.blue} label="A" size={30} />
          <span style={{ fontSize: 16 }}>🥊</span>
          <Avatar rgb={TEAM.red} label="M" size={30} style={{ ...T, opacity: beat >= 2 ? 0.35 : 1, filter: beat >= 2 ? "grayscale(1)" : "none" }} />
        </div>
        <Pill show={beat >= 1 && beat < 2}>Anders: "I knocked out Mette"</Pill>
        <Pill rgb={TEAM.green} show={beat >= 2}>✓ Mette confirms</Pill>
      </div>
      <div className="flex flex-col items-center gap-2" style={{ width: 120 }}>
        <div
          className={beat === 3 ? "gs-shake" : ""}
          style={{
            ...T,
            width: 76, height: 52,
            borderRadius: 8,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: beat >= 4 ? "rgba(var(--accent), 0.22)" : "rgb(var(--surface-raised-rgb))",
            border: "1px solid rgba(var(--accent), 0.7)",
            fontSize: beat >= 4 ? 16 : 24,
            fontWeight: 800,
            color: "rgb(var(--accent))",
          }}
        >
          {beat >= 4 ? <span className="gs-pop">+75 kr</span> : "🎁"}
        </div>
        <div className="text-[9px] uppercase font-bold tracking-widest" style={{ color: "rgb(var(--text-muted-rgb))" }}>Mystery bounty</div>
      </div>
    </div>
  );
}
