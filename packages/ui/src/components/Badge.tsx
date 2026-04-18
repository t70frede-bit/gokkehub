import React from "react";
import type { TeamColor } from "@gokkehub/db/types";

export type BadgeVariant = "primary" | "team" | "host" | "gm";

export interface BadgeProps {
  variant?: BadgeVariant;
  team?: TeamColor | "spectator";
  children: React.ReactNode;
  className?: string;
}

const TEAM_STYLES: Record<TeamColor | "spectator", React.CSSProperties> = {
  blue:      { background: "rgba(var(--team-blue-rgb), 0.35)",      color: "#90b0ff", border: "1px solid rgba(var(--team-blue-rgb), 0.6)" },
  red:       { background: "rgba(var(--team-red-rgb), 0.35)",       color: "#ff9090", border: "1px solid rgba(var(--team-red-rgb), 0.6)" },
  green:     { background: "rgba(var(--team-green-rgb), 0.35)",     color: "#90e0a0", border: "1px solid rgba(var(--team-green-rgb), 0.6)" },
  yellow:    { background: "rgba(var(--team-yellow-rgb), 0.35)",    color: "#ffe070", border: "1px solid rgba(var(--team-yellow-rgb), 0.6)" },
  spectator: { background: "rgba(var(--team-spectator-rgb), 0.35)", color: "#c0c0c0", border: "1px solid rgba(var(--team-spectator-rgb), 0.5)" },
};

export default function Badge({
  variant = "primary",
  team,
  children,
  className = "",
}: BadgeProps) {
  let style: React.CSSProperties = {};

  if (variant === "primary") {
    style = {
      background: "linear-gradient(135deg, rgba(var(--color-primary-rgb), 0.35), rgba(var(--color-secondary-rgb), 0.35))",
      color: "rgb(var(--text-secondary-rgb))",
      border: "1px solid rgba(var(--color-primary-rgb), 0.7)",
    };
  } else if (variant === "team" && team) {
    style = TEAM_STYLES[team];
  } else if (variant === "host") {
    style = {
      background: "linear-gradient(135deg, rgb(var(--color-primary-rgb)), rgb(var(--color-secondary-rgb)))",
      color: "#fff",
    };
  } else if (variant === "gm") {
    style = {
      background: "linear-gradient(135deg, rgba(var(--color-primary-rgb), 0.4), rgba(var(--color-secondary-rgb), 0.4))",
      color: "rgb(var(--text-secondary-rgb))",
      border: "1px solid rgba(var(--color-primary-rgb), 0.7)",
    };
  }

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold tracking-wide ${className}`}
      style={style}
    >
      {children}
    </span>
  );
}
