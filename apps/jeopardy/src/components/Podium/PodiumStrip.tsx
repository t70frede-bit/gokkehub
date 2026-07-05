import type { JpPlayer, JpTeam } from "../../lib/types";

interface PodiumStripProps {
  teams:        JpTeam[];
  players:      JpPlayer[];
  buzzedTeamId: number | null;
}

export default function PodiumStrip({ teams, players, buzzedTeamId }: PodiumStripProps) {
  return (
    <div className="flex gap-2 sm:gap-4 w-full justify-center flex-wrap">
      {teams.map(team => {
        const members = players.filter(p => p.team_id === team.id);
        const buzzed  = team.id === buzzedTeamId;
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
              style={{ color: "rgb(var(--text-primary-rgb))" }}
            >
              {team.name}
            </div>
            <div className="font-black text-xl sm:text-3xl tabular-nums"
              style={{ color: team.score < 0 ? "rgb(var(--color-danger-rgb))" : "rgb(var(--color-primary-rgb))" }}
            >
              {team.score}
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
