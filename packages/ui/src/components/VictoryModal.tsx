import React from "react";
import type { TeamColor } from "@gokkehub/db/types";
import Button from "./Button.tsx";

export interface VictoryModalProps {
  open: boolean;
  team: TeamColor;
  onDismiss: () => void;
}

const TEAM_META: Record<TeamColor, { emoji: string; label: string; glowVar: string }> = {
  blue:   { emoji: "🔵", label: "Blue",   glowVar: "--team-blue-rgb" },
  red:    { emoji: "🔴", label: "Red",    glowVar: "--team-red-rgb" },
  green:  { emoji: "🟢", label: "Green",  glowVar: "--team-green-rgb" },
  yellow: { emoji: "🟡", label: "Yellow", glowVar: "--team-yellow-rgb" },
};

export default function VictoryModal({ open, team, onDismiss }: VictoryModalProps) {
  if (!open) return null;

  const meta = TEAM_META[team];

  return (
    <div
      className="fixed inset-0 z-[9998] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.85)", backdropFilter: "blur(8px)" }}
    >
      {/* Animated glow ring behind the card */}
      <div
        className="absolute rounded-full opacity-30"
        style={{
          width: 480,
          height: 480,
          background: `radial-gradient(circle, rgba(var(--color-warning-rgb), 0.6) 0%, transparent 70%)`,
          animation: "bingo-pulse 1.2s ease-in-out infinite",
        }}
      />

      <div
        className="relative text-center px-16 py-14 rounded-3xl"
        style={{
          background: "linear-gradient(135deg, rgba(var(--surface-overlay-rgb), 0.98), rgba(var(--surface-base-rgb), 0.98))",
          border: "2px solid rgba(var(--color-warning-rgb), 0.85)",
          boxShadow: `0 0 60px rgba(var(--color-warning-rgb), 0.4), 0 0 0 1px rgba(var(--color-warning-rgb), 0.2)`,
          animation: "victory-pop 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards",
        }}
      >
        <style>{`
          @keyframes victory-pop {
            0%   { transform: scale(0.5); opacity: 0; }
            100% { transform: scale(1);   opacity: 1; }
          }
          @keyframes bingo-pulse {
            0%, 100% { transform: scale(1);    opacity: 0.3; }
            50%       { transform: scale(1.15); opacity: 0.5; }
          }
          @keyframes float-emoji {
            0%, 100% { transform: translateY(0); }
            50%       { transform: translateY(-10px); }
          }
        `}</style>

        {/* Team emoji */}
        <div
          className="text-7xl mb-4 leading-none"
          style={{ animation: "float-emoji 2s ease-in-out infinite" }}
        >
          {meta.emoji}
        </div>

        {/* BINGO! */}
        <h2
          className="text-5xl font-black tracking-widest mb-3"
          style={{
            background: "linear-gradient(135deg, rgb(var(--color-warning-rgb)), #ff8c00)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
            textShadow: "none",
          }}
        >
          BINGO!
        </h2>

        {/* Team name */}
        <p
          className="text-xl font-semibold mb-10"
          style={{ color: "rgb(var(--text-secondary-rgb))" }}
        >
          {meta.label} Team wins!
        </p>

        <Button variant="ghost" size="lg" onClick={onDismiss}>
          Continue
        </Button>
      </div>
    </div>
  );
}
