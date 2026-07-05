import { useMemo, useState } from "react";
import { Button } from "@gokkehub/ui";
import type { JpMultipleChoiceConfig } from "../../lib/types";
import { seededPermutation } from "../../lib/shuffle";

interface MultipleChoiceProps {
  cfg:       JpMultipleChoiceConfig;
  seed:      string;                       // playerId + tileKey → stable scramble
  submitted: boolean;
  busy:      boolean;
  onSubmit:  (originalIndex: number) => void;
}

export default function MultipleChoice({ cfg, seed, submitted, busy, onSubmit }: MultipleChoiceProps) {
  const perm = useMemo(() => seededPermutation(cfg.options.length, seed), [cfg.options.length, seed]);
  const [picked, setPicked] = useState<number | null>(null);   // original index

  if (submitted) {
    return (
      <p className="text-center font-bold py-8" style={{ color: "rgb(var(--color-primary-rgb))" }}>
        Answer locked in ✓
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {perm.map(orig => (
        <button key={orig} type="button" onClick={() => setPicked(orig)}
          className="rounded-lg px-4 py-3 font-bold text-left text-base"
          style={{
            background: picked === orig ? "rgba(var(--color-primary-rgb), 0.2)" : "rgb(var(--surface-input-rgb))",
            border: picked === orig
              ? "1px solid rgb(var(--color-primary-rgb))"
              : "1px solid rgb(var(--border-rgb))",
          }}>
          {cfg.options[orig]}
        </button>
      ))}
      <Button fullWidth size="lg" className="mt-2" disabled={picked === null} loading={busy}
        onClick={() => picked !== null && onSubmit(picked)}>
        Lock in
      </Button>
    </div>
  );
}
