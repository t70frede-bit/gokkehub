import { Avatar, Phone, Pill, T, TEAM, Tap, tint, useBeat } from "../motion";

/**
 * Joining from a phone: type the room code at gokkehub.com/join, land in the
 * lobby, and see yourself appear in the player list. Shared by every game
 * that uses room codes.
 */
export function JoinScene() {
  const beat = useBeat(8, 650);
  const code = "GOKK".slice(0, Math.max(0, Math.min(4, beat - 0)));
  const joined = beat >= 6;

  return (
    <div className="flex items-center gap-6">
      <Phone>
        <div className="w-full px-2 flex flex-col items-center">
          <div className="text-[8px] font-bold mt-2" style={{ color: "rgb(var(--text-muted-rgb))" }}>
            gokkehub.com/join
          </div>
          <div
            className="mt-3 w-full rounded-md py-2 text-center font-bold"
            style={{
              fontFamily: "var(--font-mono)",
              letterSpacing: "0.25em",
              fontSize: 15,
              background: "rgb(var(--surface-input-rgb))",
              border: `1px solid ${beat >= 4 ? "rgba(var(--accent), 0.7)" : "rgb(var(--border-rgb))"}`,
              color: "rgb(var(--accent))",
              ...T,
            }}
          >
            {code}
            {beat < 4 && <span className="gs-blink">|</span>}
          </div>
          <div
            className="mt-2 w-full rounded-md py-1.5 text-center text-[10px] font-bold"
            style={{
              background: "rgb(var(--accent))",
              color: "rgb(var(--bg-rgb))",
              opacity: beat >= 4 ? 1 : 0.4,
              transform: beat === 5 ? "scale(0.95)" : "scale(1)",
              ...T,
            }}
          >
            Continue →
          </div>
          <div className="mt-3" style={{ ...T, opacity: joined ? 1 : 0 }}>
            <Pill rgb={TEAM.green} show={joined}>✓ You're in</Pill>
          </div>
        </div>
        <Tap show={beat === 5} x="50%" y={92} />
      </Phone>

      <div className="flex flex-col gap-1.5">
        <div className="text-[10px] uppercase font-bold tracking-widest mb-1" style={{ color: "rgb(var(--text-muted-rgb))" }}>
          Lobby
        </div>
        {[
          { l: "H", rgb: TEAM.yellow, name: "Host", show: true },
          { l: "M", rgb: TEAM.blue, name: "Maja", show: true },
          { l: "S", rgb: TEAM.red, name: "Sofus", show: beat >= 2 },
          { l: "Y", rgb: TEAM.green, name: "You", show: joined },
        ].map((p) => (
          <div
            key={p.name}
            className="flex items-center gap-2 rounded-md px-2 py-1"
            style={{
              ...T,
              width: 110,
              opacity: p.show ? 1 : 0,
              transform: p.show ? "translateX(0)" : "translateX(10px)",
              background: "rgb(var(--surface-raised-rgb))",
              border: `1px solid ${p.name === "You" ? tint(TEAM.green, 0.6) : "rgb(var(--border-rgb))"}`,
            }}
          >
            <Avatar rgb={p.rgb} label={p.l} size={18} />
            <span className="text-[11px] font-semibold" style={{ color: "rgb(var(--text-primary-rgb))" }}>{p.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Two teams forming: avatars slide from a pool into two team columns. */
export function TeamsScene({ teams = 2, captain = false }: { teams?: 2 | 3 | 4; captain?: boolean }) {
  const beat = useBeat(6, 700);
  const colors = [TEAM.blue, TEAM.red, TEAM.green, TEAM.yellow].slice(0, teams);
  const players = ["A", "B", "C", "D", "E", "F", "G", "H"].slice(0, teams * 2);

  return (
    <div className="flex gap-3">
      {colors.map((rgb, ti) => (
        <div
          key={rgb}
          className="rounded-lg p-2 flex flex-col items-center gap-1.5"
          style={{
            width: 76,
            minHeight: 110,
            background: "rgb(var(--surface-raised-rgb))",
            border: "1px solid rgb(var(--border-rgb))",
            borderTop: `3px solid rgb(${rgb})`,
          }}
        >
          <div className="text-[10px] font-bold" style={{ color: `rgb(${rgb})` }}>
            Team {ti + 1}
          </div>
          {players
            .filter((_, pi) => pi % teams === ti)
            .map((l, k) => {
              const order = k * teams + ti;
              const show = beat > order * (5 / players.length);
              return (
                <div key={l} style={{ ...T, opacity: show ? 1 : 0, transform: show ? "scale(1)" : "scale(0.6)" }}>
                  <Avatar rgb={rgb} label={l} size={26} />
                </div>
              );
            })}
          {captain && beat >= 5 && <div className="gs-pop text-[9px]" style={{ color: "rgb(var(--text-muted-rgb))" }}>👑 captain</div>}
        </div>
      ))}
    </div>
  );
}

export function TwoTeamsWithCaptains() {
  return <TeamsScene teams={2} captain />;
}

export function TwoTeams() {
  return <TeamsScene teams={2} />;
}
