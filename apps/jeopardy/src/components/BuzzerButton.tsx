import type { BuzzerPhase } from "../hooks/useBuzzer";
import { readableTextOn } from "../lib/color";

interface BuzzerButtonProps {
  phase:    BuzzerPhase;
  inFlight: boolean;
  onBuzz:   () => void;
  /** Reading delay remaining, in ms — only meaningful in the "arming" phase. */
  armingMsLeft?: number;
  /** The team's colour. The buzzer is the one thing a captain stares at, so it
   *  wears the team's identity rather than the app's amber. */
  teamColor?: string;
}

const LABELS: Record<BuzzerPhase, string> = {
  "no-question":  "Waiting for a question…",
  "locked":       "Get ready…",
  "arming":       "READ IT…",
  "open":         "BUZZ",
  "you-buzzed":   "YOU'RE IN!",
  "locked-out":   "Locked out of this one",
  "other-buzzed": "Too late!",
};

export default function BuzzerButton({
  phase, inFlight, onBuzz, armingMsLeft = 0, teamColor,
}: BuzzerButtonProps) {
  const open   = phase === "open" && !inFlight;
  const you    = phase === "you-buzzed";
  const arming = phase === "arming";

  // Fall back to the app amber when the team has no colour resolved yet — that
  // path has to look exactly as it did before the team colour existed.
  const live    = teamColor ?? "rgb(var(--color-primary-rgb))";
  const onLive  = teamColor ? readableTextOn(teamColor) : "rgb(var(--bg-rgb))";
  // Dim the BACKGROUND, never the element: opacity would fade the label with it.
  const liveDim = teamColor ? `${teamColor}d9` : "rgba(var(--color-primary-rgb), 0.85)";
  const armTint = teamColor ? `${teamColor}80` : "rgba(var(--color-primary-rgb), 0.5)";

  return (
    <button
      type="button"
      disabled={!open}
      onClick={onBuzz}
      className="jp-buzzer w-full flex-1 min-h-64 rounded-2xl font-black text-3xl sm:text-5xl uppercase tracking-wide transition-transform flex flex-col items-center justify-center gap-2"
      style={{
        // Live but not yet pressed sits slightly back from the won state.
        background: you ? live : open ? liveDim : "rgb(var(--surface-input-rgb))",
        color: you || open ? onLive : "rgba(var(--text-secondary-rgb), 0.6)",
        border: `1px solid ${arming ? armTint : "rgb(var(--border-rgb))"}`,
      }}
    >
      {LABELS[phase]}
      {/* Counting down to live keeps the wait honest — nobody's tap is being eaten. */}
      {arming && (
        <span className="text-5xl sm:text-7xl tabular-nums" style={{ color: live }}>
          {Math.ceil(armingMsLeft / 1000)}
        </span>
      )}
    </button>
  );
}
