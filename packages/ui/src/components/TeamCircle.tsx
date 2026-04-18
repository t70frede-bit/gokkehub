import React from "react";
import type { TeamColor } from "@gokkehub/db/types";

export type TeamOption = TeamColor | "spectator";

export interface TeamCircleProps {
  team: TeamOption;
  selected?: boolean;
  onClick?: () => void;
  disabled?: boolean;
}

const TEAM_META: Record<TeamOption, { emoji: string; label: string; glowVar: string }> = {
  blue:      { emoji: "🔵", label: "Blue",     glowVar: "--team-blue-rgb" },
  red:       { emoji: "🔴", label: "Red",      glowVar: "--team-red-rgb" },
  green:     { emoji: "🟢", label: "Green",    glowVar: "--team-green-rgb" },
  yellow:    { emoji: "🟡", label: "Yellow",   glowVar: "--team-yellow-rgb" },
  spectator: { emoji: "👁️", label: "Spectate", glowVar: "--team-spectator-rgb" },
};

export default function TeamCircle({
  team,
  selected = false,
  onClick,
  disabled = false,
}: TeamCircleProps) {
  const meta = TEAM_META[team];

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex flex-col items-center gap-1.5 min-w-[80px] px-4 py-3
        rounded-xl cursor-pointer transition-all duration-200
        hover:-translate-y-1 disabled:opacity-40 disabled:cursor-not-allowed"
      style={{
        background: selected
          ? `rgba(var(${meta.glowVar}), 0.25)`
          : "rgba(var(--surface-overlay-rgb), 0.5)",
        border: selected
          ? `3px solid rgba(var(${meta.glowVar}), 0.9)`
          : "2px solid rgba(var(--color-primary-rgb), 0.4)",
        boxShadow: selected
          ? `0 0 18px rgba(var(${meta.glowVar}), 0.7), inset 0 0 8px rgba(var(${meta.glowVar}), 0.15)`
          : "none",
        transform: selected ? "scale(1.08)" : undefined,
        color: "#fff",
      }}
    >
      <span className="text-2xl leading-none">{meta.emoji}</span>
      <span className="text-xs font-bold tracking-wide">{meta.label}</span>
    </button>
  );
}
