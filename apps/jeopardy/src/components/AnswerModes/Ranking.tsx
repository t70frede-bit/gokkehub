import { useMemo, useState } from "react";
import { Button } from "@gokkehub/ui";
import type { JpRankingConfig } from "../../lib/types";
import { seededPermutation } from "../../lib/shuffle";

interface RankingProps {
  cfg:       JpRankingConfig;
  seed:      string;
  submitted: boolean;
  busy:      boolean;
  /** Item indices (original order) in the player's chosen top-to-bottom order. */
  onSubmit:  (order: number[]) => void;
}

export default function Ranking({ cfg, seed, submitted, busy, onSubmit }: RankingProps) {
  const initial = useMemo(
    () => seededPermutation(cfg.items.length, seed),
    [cfg.items.length, seed]
  );
  const [order, setOrder] = useState<number[]>(initial);

  if (submitted) {
    return (
      <p className="text-center font-bold py-8" style={{ color: "rgb(var(--color-primary-rgb))" }}>
        Answer locked in ✓
      </p>
    );
  }

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next);
  };

  return (
    <div className="flex flex-col gap-2">
      {(cfg.topLabel || cfg.bottomLabel) ? (
        <div className="flex justify-between text-xs font-bold px-1" style={{ color: "rgb(var(--color-primary-rgb))" }}>
          <span>▲ {cfg.topLabel ?? "Top"}</span>
          <span>{cfg.bottomLabel ?? "Bottom"} ▼</span>
        </div>
      ) : (
        <p className="text-xs text-center" style={{ color: "rgb(var(--text-secondary-rgb))" }}>
          Arrange top → bottom
        </p>
      )}
      {order.map((orig, i) => (
        <div key={orig} className="flex items-center gap-2 rounded-lg px-3 py-2"
          style={{
            background: "rgb(var(--surface-input-rgb))",
            border:     "1px solid rgb(var(--border-rgb))",
          }}>
          <span className="font-bold w-6 text-center" style={{ color: "rgb(var(--text-secondary-rgb))" }}>
            {i + 1}.
          </span>
          <span className="flex-1 font-semibold truncate">{cfg.items[orig]}</span>
          <Button variant="ghost" size="sm" disabled={i === 0} onClick={() => move(i, -1)}>↑</Button>
          <Button variant="ghost" size="sm" disabled={i === order.length - 1} onClick={() => move(i, 1)}>↓</Button>
        </div>
      ))}
      <Button fullWidth size="lg" className="mt-2" loading={busy} onClick={() => onSubmit(order)}>
        Lock in
      </Button>
    </div>
  );
}
