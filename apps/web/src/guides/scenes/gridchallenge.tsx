import { Avatar, Pill, T, TEAM, Tap, tint, useBeat } from "../motion";

type Team = "blue" | "red";

function Cell({
  team, size, children, glow, locked, style,
}: {
  team?: Team | null;
  size: number;
  children?: React.ReactNode;
  glow?: boolean;
  locked?: boolean;
  style?: React.CSSProperties;
}) {
  const rgb = team ? TEAM[team] : null;
  return (
    <div
      className="relative rounded flex items-center justify-center text-center"
      style={{
        ...T,
        width: size, height: size,
        background: rgb ? tint(rgb, glow ? 0.65 : 0.4) : "rgb(var(--surface-raised-rgb))",
        border: `1px solid ${glow ? "rgb(var(--text-primary-rgb))" : rgb ? tint(rgb, 0.9) : "rgb(var(--border-rgb))"}`,
        opacity: locked ? 0.6 : 1,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** 5×5 board filling up with claims until Blue completes a diagonal. */
export function GridBoardScene() {
  const beat = useBeat(9, 600);
  // [cell index, team, beat it gets claimed]
  const claims: [number, Team, number][] = [
    [0, "blue", 1], [7, "red", 1], [6, "blue", 2], [13, "red", 3],
    [12, "blue", 3], [2, "red", 4], [18, "blue", 5], [21, "red", 5],
    [24, "blue", 6],
  ];
  const diagonal = [0, 6, 12, 18, 24];
  const bingo = beat >= 7;

  return (
    <div className="flex items-center gap-5">
      <div className="grid grid-cols-5 gap-1">
        {Array.from({ length: 25 }, (_, i) => {
          const c = claims.find((cl) => cl[0] === i && beat >= cl[2]);
          const glow = bingo && diagonal.includes(i);
          return (
            <Cell key={i} size={28} team={c?.[1]} glow={glow}>
              {i === 16 && <span style={{ fontSize: 11 }}>⚔️</span>}
              {c && beat === c[2] && <span className="gs-pop absolute inset-0 rounded" style={{ border: "2px solid rgb(var(--text-primary-rgb))" }} />}
            </Cell>
          );
        })}
      </div>
      <div className="flex flex-col gap-2 items-start" style={{ width: 100 }}>
        <div className="flex items-center gap-1.5"><Avatar rgb={TEAM.blue} label="B" size={18} /><span className="text-[11px] font-bold" style={{ color: `rgb(${TEAM.blue})` }}>Blue</span></div>
        <div className="flex items-center gap-1.5"><Avatar rgb={TEAM.red} label="R" size={18} /><span className="text-[11px] font-bold" style={{ color: `rgb(${TEAM.red})` }}>Red</span></div>
        <Pill rgb={TEAM.blue} show={bingo}>BINGO — 5 in a row!</Pill>
      </div>
    </div>
  );
}

/** Do the challenge in-game, then tap the square to claim it for your team. */
export function ClaimScene() {
  const beat = useBeat(6, 800);
  const claimed = beat >= 3;
  return (
    <div className="relative flex items-center gap-5">
      <div className="relative">
        <Cell size={120} team={claimed ? "blue" : null}>
          <div className="px-2">
            <div className="text-[9px] font-bold uppercase tracking-wider" style={{ color: "rgb(var(--text-muted-rgb))" }}>League of Legends</div>
            <div className="text-[13px] font-bold leading-tight mt-1" style={{ color: "rgb(var(--text-primary-rgb))" }}>Win a game without dying</div>
            <div className="text-[10px] mt-1.5" style={{ color: "rgb(var(--text-secondary-rgb))" }}>👤 Single</div>
            {claimed && <div className="gs-pop text-[10px] font-bold mt-1" style={{ color: "rgb(var(--text-primary-rgb))" }}>🔵 Maja</div>}
          </div>
        </Cell>
        <Tap show={beat === 2} x="60%" y="60%" />
      </div>
      <div className="flex flex-col gap-2" style={{ width: 130 }}>
        <Pill rgb={TEAM.yellow} show={beat >= 1 && beat < 3}>🎮 Maja pulls it off…</Pill>
        <Pill rgb={TEAM.blue} show={beat >= 3}>🔵 Maja claimed it</Pill>
        <div className="text-[10px] leading-snug" style={{ ...T, opacity: beat >= 4 ? 1 : 0, color: "rgb(var(--text-muted-rgb))" }}>
          Everyone sees it instantly. Misclick? Tap again to undo.
        </div>
      </div>
    </div>
  );
}

/** A locked versus tile unlocks on a timer and both teams race for it. */
export function VersusScene() {
  const beat = useBeat(8, 750);
  const countdown = ["0:03", "0:02", "0:01"];
  const unlocked = beat >= 3;
  const won = beat >= 6;
  return (
    <div className="flex items-center gap-5">
      <Cell size={120} team={won ? "red" : null} locked={!unlocked} style={unlocked && !won ? { borderColor: "rgba(var(--accent), 0.9)" } : undefined}>
        {!unlocked ? (
          <div>
            <div style={{ fontSize: 26 }}>🔒</div>
            <div className="font-bold text-[16px] tabular-nums mt-1" style={{ fontFamily: "var(--font-mono)", color: "rgb(var(--accent))" }}>
              {countdown[beat] ?? "0:00"}
            </div>
            <div className="text-[9px] mt-0.5" style={{ color: "rgb(var(--text-muted-rgb))" }}>next versus</div>
          </div>
        ) : (
          <div className={beat === 3 ? "gs-pop px-2" : "px-2"}>
            <div className="text-[10px] font-bold" style={{ color: "rgb(var(--accent))" }}>⚔️ VERSUS</div>
            <div className="text-[12px] font-bold leading-tight mt-1" style={{ color: "rgb(var(--text-primary-rgb))" }}>Win a 1v1 against the other team</div>
            {won && <div className="gs-pop text-[10px] font-bold mt-1" style={{ color: "rgb(var(--text-primary-rgb))" }}>🔴 Red wins it</div>}
          </div>
        )}
      </Cell>
      <div className="flex flex-col gap-2" style={{ width: 130 }}>
        <Pill show={unlocked && !won}>Unlocked — first team to win it</Pill>
        <div className="flex gap-2" style={{ ...T, opacity: unlocked && !won ? 1 : 0 }}>
          <Avatar rgb={TEAM.blue} label="B" size={26} style={{ transform: beat === 5 ? "translateX(4px)" : "none", ...T }} />
          <span className="text-[14px] self-center">⚔️</span>
          <Avatar rgb={TEAM.red} label="R" size={26} style={{ transform: beat === 5 ? "translateX(-4px)" : "none", ...T }} />
        </div>
        <Pill rgb={TEAM.red} show={won}>🔴 Red claims the square</Pill>
      </div>
    </div>
  );
}

/** Lobby game library: players' games (Steam or added by hand), host ticks what to play. */
export function LibraryScene() {
  const beat = useBeat(6, 750);
  const games = [
    { name: "League of Legends", owners: [TEAM.blue, TEAM.red, TEAM.blue], n: 41, pick: 2 },
    { name: "Counter-Strike 2", owners: [TEAM.red, TEAM.blue], n: 38, pick: 3 },
    { name: "Dark Souls 3", owners: [TEAM.blue], n: 12, pick: 99 },
  ];
  return (
    <div className="flex flex-col gap-1.5" style={{ width: 260 }}>
      <div className="flex justify-between items-center mb-1">
        <span className="text-[10px] uppercase font-bold tracking-widest" style={{ color: "rgb(var(--text-muted-rgb))" }}>Games in this lobby</span>
        <Pill rgb={TEAM.green} show={beat >= 1}>⟳ Steam synced</Pill>
      </div>
      {games.map((g, i) => {
        const on = beat >= g.pick;
        const show = beat >= 1 || i === 0;
        return (
          <div
            key={g.name}
            className="flex items-center gap-2 rounded-md px-2 py-1.5"
            style={{
              ...T,
              opacity: show ? 1 : 0,
              background: on ? "rgba(var(--accent), 0.12)" : "rgb(var(--surface-raised-rgb))",
              border: `1px solid ${on ? "rgba(var(--accent), 0.6)" : "rgb(var(--border-rgb))"}`,
            }}
          >
            <div
              className="w-4 h-4 rounded flex items-center justify-center text-[10px] font-bold"
              style={{ ...T, background: on ? "rgb(var(--accent))" : "transparent", border: "1px solid rgb(var(--border-rgb))", color: "rgb(var(--bg-rgb))" }}
            >
              {on ? "✓" : ""}
            </div>
            <span className="text-[11px] font-semibold flex-1 truncate" style={{ color: "rgb(var(--text-primary-rgb))" }}>{g.name}</span>
            <div className="flex -space-x-1.5">
              {g.owners.map((o, k) => <Avatar key={k} rgb={o} label="" size={14} />)}
            </div>
            <span className="text-[9px] tabular-nums w-14 text-right" style={{ color: "rgb(var(--text-muted-rgb))" }}>{g.n} challenges</span>
          </div>
        );
      })}
      <div className="flex justify-center mt-1">
        <Pill show={beat >= 4}>🎲 Board shuffled from 79 challenges</Pill>
      </div>
    </div>
  );
}
