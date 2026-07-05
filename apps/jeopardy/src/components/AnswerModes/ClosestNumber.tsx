import { useState } from "react";
import { Button } from "@gokkehub/ui";
import type { JpClosestNumberConfig } from "../../lib/types";

interface ClosestNumberProps {
  cfg:       JpClosestNumberConfig;
  submitted: boolean;
  busy:      boolean;
  onSubmit:  (value: number) => void;
}

export default function ClosestNumber({ cfg, submitted, busy, onSubmit }: ClosestNumberProps) {
  const slider = cfg.input === "slider";
  const min = cfg.min ?? 0;
  const max = cfg.max ?? 100;
  const [value, setValue] = useState(slider ? String(Math.round((min + max) / 2)) : "");

  if (submitted) {
    return (
      <p className="text-center font-bold py-8" style={{ color: "rgb(var(--color-primary-rgb))" }}>
        Answer locked in ✓
      </p>
    );
  }

  const num = Number(value);

  return (
    <div className="flex flex-col gap-4">
      {slider ? (
        <>
          <input type="range" min={min} max={max} value={num}
            onChange={e => setValue(e.target.value)} className="w-full accent-current" />
          <p className="text-center font-black text-3xl tabular-nums"
            style={{ color: "rgb(var(--color-primary-rgb))" }}>
            {value} <span className="text-lg font-bold">{cfg.unit}</span>
          </p>
        </>
      ) : (
        <div className="flex items-center gap-2">
          <input type="number" inputMode="decimal" value={value} placeholder="0"
            onChange={e => setValue(e.target.value)}
            className="flex-1 px-4 py-3 rounded-md text-2xl font-bold text-center outline-none"
            style={{
              background: "rgb(var(--surface-input-rgb))",
              border:     "1px solid rgb(var(--border-rgb))",
              color:      "rgb(var(--text-primary-rgb))",
            }} />
          {cfg.unit && <span className="font-bold text-lg">{cfg.unit}</span>}
        </div>
      )}
      <Button fullWidth size="lg" disabled={!Number.isFinite(num) || value === ""} loading={busy}
        onClick={() => onSubmit(num)}>
        Lock in
      </Button>
      <p className="text-center text-xs" style={{ color: "rgb(var(--text-secondary-rgb))" }}>
        Closest answer wins — ties go to whoever locked in first.
      </p>
    </div>
  );
}
