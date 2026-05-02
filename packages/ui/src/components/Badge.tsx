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
  blue:      { background: "transparent", color: "rgb(var(--team-blue-rgb))",      border: "1px solid rgba(var(--team-blue-rgb), 0.6)" },
  red:       { background: "transparent", color: "rgb(var(--team-red-rgb))",       border: "1px solid rgba(var(--team-red-rgb), 0.6)" },
  green:     { background: "transparent", color: "rgb(var(--team-green-rgb))",     border: "1px solid rgba(var(--team-green-rgb), 0.6)" },
  yellow:    { background: "transparent", color: "rgb(var(--team-yellow-rgb))",    border: "1px solid rgba(var(--team-yellow-rgb), 0.6)" },
  spectator: { background: "transparent", color: "rgb(var(--team-spectator-rgb))", border: "1px solid rgba(var(--team-spectator-rgb), 0.5)" },
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
      background: "transparent",
      color: "rgb(var(--color-primary-rgb))",
      border: "1px solid rgba(var(--color-primary-rgb), 0.55)",
    };
  } else if (variant === "team" && team) {
    style = TEAM_STYLES[team];
  } else if (variant === "host") {
    style = {
      background: "rgb(var(--color-primary-rgb))",
      color: "rgb(var(--bg-rgb))",
    };
  } else if (variant === "gm") {
    style = {
      background: "transparent",
      color: "rgb(var(--color-primary-rgb))",
      border: "1px solid rgba(var(--color-primary-rgb), 0.55)",
    };
  }

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${className}`}
      style={{ letterSpacing: "0.06em", ...style }}
    >
      {children}
    </span>
  );
}
