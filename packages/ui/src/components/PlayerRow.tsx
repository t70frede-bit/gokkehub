import React from "react";
import type { Player } from "@gokkehub/db/types";
import Badge from "./Badge.tsx";

export interface PlayerRowProps {
  player: Player;
  showKick?: boolean;
  onKick?: (playerId: string) => void;
}

export default function PlayerRow({ player, showKick = false, onKick }: PlayerRowProps) {
  const isGM = player.is_host && player.is_spectator;
  const teamLabel = isGM
    ? null
    : player.is_spectator
      ? "spectator" as const
      : player.team ?? undefined;

  return (
    <div
      className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl"
      style={{
        background: "rgba(var(--surface-overlay-rgb), 0.5)",
        border: "1px solid rgba(var(--color-primary-rgb), 0.2)",
      }}
    >
      {/* Name */}
      <span className="flex-1 font-semibold text-white truncate">
        {player.name}
      </span>

      {/* Team / role badge */}
      {isGM ? (
        <Badge variant="gm">🎙️ Game Master</Badge>
      ) : player.is_spectator ? (
        <Badge variant="team" team="spectator">👁️ Spectator</Badge>
      ) : teamLabel ? (
        <Badge variant="team" team={teamLabel}>
          {teamLabel.charAt(0).toUpperCase() + teamLabel.slice(1)} Team
        </Badge>
      ) : null}

      {/* Host badge */}
      {player.is_host && <Badge variant="host">HOST</Badge>}

      {/* Kick button — only shown to host, not on themselves */}
      {showKick && !player.is_host && (
        <button
          type="button"
          onClick={() => onKick?.(player.id)}
          className="text-xs font-semibold px-2 py-1 rounded-md transition-colors duration-150"
          style={{
            background: "rgba(var(--color-danger-rgb), 0.2)",
            border: "1px solid rgba(var(--color-danger-rgb), 0.5)",
            color: "rgba(var(--color-danger-rgb), 1)",
          }}
        >
          ✕ Kick
        </button>
      )}
    </div>
  );
}
