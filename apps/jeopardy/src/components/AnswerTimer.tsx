import { useEffect, useState } from "react";

// Visible stopwatch, no auto-cutoff — the host decides when time is up.
export default function AnswerTimer({ startMs }: { startMs: number | null }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (startMs === null) return;
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, [startMs]);

  if (startMs === null) return null;
  const elapsed = Math.max(0, now - startMs) / 1000;

  return (
    <span className="font-mono font-bold tabular-nums text-lg sm:text-2xl"
      style={{ color: "rgb(var(--color-primary-rgb))" }}
    >
      {elapsed.toFixed(1)}s
    </span>
  );
}
