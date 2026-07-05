import type { BuzzerPhase } from "../hooks/useBuzzer";

interface BuzzerButtonProps {
  phase:    BuzzerPhase;
  inFlight: boolean;
  onBuzz:   () => void;
}

const LABELS: Record<BuzzerPhase, string> = {
  "no-question":  "Waiting for a question…",
  "locked":       "Get ready…",
  "open":         "BUZZ",
  "you-buzzed":   "YOU'RE IN!",
  "other-buzzed": "Too late!",
};

export default function BuzzerButton({ phase, inFlight, onBuzz }: BuzzerButtonProps) {
  const open = phase === "open" && !inFlight;
  const you  = phase === "you-buzzed";
  return (
    <button
      type="button"
      disabled={!open}
      onClick={onBuzz}
      className="jp-buzzer w-full flex-1 min-h-64 rounded-2xl font-black text-3xl sm:text-5xl uppercase tracking-wide transition-transform"
      style={{
        background: you
          ? "rgb(var(--color-primary-rgb))"
          : open
            ? "rgba(var(--color-primary-rgb), 0.85)"
            : "rgb(var(--surface-input-rgb))",
        color: you || open ? "rgb(var(--bg-rgb))" : "rgba(var(--text-secondary-rgb), 0.6)",
        border: "1px solid rgb(var(--border-rgb))",
      }}
    >
      {LABELS[phase]}
    </button>
  );
}
