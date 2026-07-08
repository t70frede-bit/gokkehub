import { useEffect, useRef, useState } from "react";
import type { JpPlayer, JpTeam } from "../../lib/types";
import { POWERUP_META } from "../../lib/types";

interface PodiumStripProps {
  teams:        JpTeam[];
  players:      JpPlayer[];
  buzzedTeamId: number | null;
}

interface Flash { delta: number; key: number }

export default function PodiumStrip({ teams, players, buzzedTeamId }: PodiumStripProps) {
  const prevScores  = useRef<Record<number, number>>({});
  const flashTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const [flashes,   setFlashes] = useState<Record<number, Flash>>({});

  useEffect(() => {
    const newFlashes: Record<number, Flash> = {};
    for (const team of teams) {
      const prev = prevScores.current[team.id];
      if (prev !== undefined && prev !== team.score) {
        newFlashes[team.id] = { delta: team.score - prev, key: Date.now() + team.id };
      }
      prevScores.current[team.id] = team.score;
    }
    if (Object.keys(newFlashes).length === 0) return;
    setFlashes(prev => ({ ...prev, ...newFlashes }));
    // Clear each team's flash independently so rapid multi-team scoring doesn't drop any.
    for (const teamId of Object.keys(newFlashes).map(Number)) {
      clearTimeout(flashTimers.current[teamId]);
      flashTimers.current[teamId] = setTimeout(
        () => setFlashes(prev => { const next = { ...prev }; delete next[teamId]; return next; }),
        2000,
      );
    }
  }, [teams]);

  return (
    <div className="flex gap-2 sm:gap-4 w-full justify-center flex-wrap">
      {teams.map(team => {
        const members = players.filter(p => p.team_id === team.id);
        const buzzed  = team.id === buzzedTeamId;
        const flash   = flashes[team.id];
        return (
          <div
            key={team.id}
            className={`flex flex-col items-center rounded-lg px-4 py-2 sm:px-6 sm:py-3 min-w-28 sm:min-w-40
              ${buzzed ? "jp-podium-buzzed" : ""}`}
            style={{
              background: "rgb(var(--surface-raised-rgb))",
              border: buzzed
                ? "1px solid rgb(var(--color-primary-rgb))"
                : "1px solid rgb(var(--border-rgb))",
            }}
          >
            <div className="font-bold text-sm sm:text-lg truncate max-w-40"
              title={team.name}
              style={{ color: "rgb(var(--text-primary-rgb))" }}
            >
              {team.powerup && (
                <span className="mr-1" title={POWERUP_META[team.powerup].name}>
                  {POWERUP_META[team.powerup].icon}
                </span>
              )}
              {team.name}
            </div>
            <div className="relative">
              <div className="font-black text-xl sm:text-3xl tabular-nums"
                style={{ color: team.score < 0 ? "rgb(var(--color-danger-rgb))" : "rgb(var(--color-primary-rgb))" }}
              >
                {team.score}
              </div>
              {flash && (
                <span key={flash.key} className="jp-score-delta"
                  style={{ color: flash.delta > 0 ? "rgb(var(--color-primary-rgb))" : "rgb(var(--color-danger-rgb))" }}>
                  {flash.delta > 0 ? "+" : ""}{flash.delta}
                </span>
              )}
            </div>
            {members.length > 1 && (
              <div className="text-[10px] sm:text-xs truncate max-w-40"
                style={{ color: "rgb(var(--text-secondary-rgb))" }}
              >
                {members.map(m => m.name).join(", ")}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
