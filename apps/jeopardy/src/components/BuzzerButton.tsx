import type { BuzzerPhase } from "../hooks/useBuzzer";

interface BuzzerButtonProps {
  phase:    BuzzerPhase;
  inFlight: boolean;
  onBuzz:   () => void;
  /** Reading delay remaining, in ms — only meaningful in the "arming" phase. */
  armingMsLeft?: number;
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

export default function BuzzerButton({ phase, inFlight, onBuzz, armingMsLeft = 0 }: BuzzerButtonProps) {
  const open   = phase === "open" && !inFlight;
  const you    = phase === "you-buzzed";
  const arming = phase === "arming";
  return (
    <button
      type="button"
      disabled={!open}
      onClick={onBuzz}
      className="jp-buzzer w-full flex-1 min-h-64 rounded-2xl font-black text-3xl sm:text-5xl uppercase tracking-wide transition-transform flex flex-col items-center justify-center gap-2"
      style={{
        background: you
          ? "rgb(var(--color-primary-rgb))"
          : open
            ? "rgba(var(--color-primary-rgb), 0.85)"
            : "rgb(var(--surface-input-rgb))",
        color: you || open ? "rgb(var(--bg-rgb))" : "rgba(var(--text-secondary-rgb), 0.6)",
        border: arming
          ? "1px solid rgba(var(--color-primary-rgb), 0.5)"
          : "1px solid rgb(var(--border-rgb))",
      }}
    >
      {LABELS[phase]}
      {/* Counting down to live keeps the wait honest — nobody's tap is being eaten. */}
      {arming && (
        <span className="text-5xl sm:text-7xl tabular-nums"
          style={{ color: "rgb(var(--color-primary-rgb))" }}>
          {Math.ceil(armingMsLeft / 1000)}
        </span>
      )}
    </button>
  );
}
