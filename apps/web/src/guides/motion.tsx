// Motion plumbing for the animated how-to-play scenes.
//
// Every scene is a tiny state machine: a "beat" counter ticks forward on a
// timer and the scene styles its elements from the current beat, letting CSS
// transitions do the actual animating. That keeps each scene readable (beat 3
// = "the card lands") and gives us three things for free:
//
//  - scenes only tick while they're on screen (IntersectionObserver),
//  - a page-wide pause toggle,
//  - prefers-reduced-motion: the scene is pinned to its final, fully
//    explained beat instead of looping.

import {
  createContext, useContext, useEffect, useRef, useState,
  type CSSProperties, type ReactNode,
} from "react";

// ── Page-level motion settings ───────────────────────────────────────────────

interface MotionSettings {
  paused:  boolean;
  reduced: boolean;
}

const MotionContext = createContext<MotionSettings>({ paused: false, reduced: false });

export function MotionProvider({ paused, children }: { paused: boolean; children: ReactNode }) {
  const reduced = usePrefersReducedMotion();
  return <MotionContext.Provider value={{ paused, reduced }}>{children}</MotionContext.Provider>;
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  return reduced;
}

// ── Stage: the frame every scene renders in ─────────────────────────────────

const StageContext = createContext<{ visible: boolean }>({ visible: true });

export function Stage({
  label,
  children,
  height = 220,
}: {
  /** Plain-language description of what the animation shows (screen readers). */
  label:     string;
  children:  ReactNode;
  height?:   number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [scale, setScale] = useState(1);

  // Scenes are drawn at a fixed size; shrink them to fit narrow stages (phones).
  useEffect(() => {
    const el = ref.current, inner = innerRef.current;
    if (!el || !inner || typeof ResizeObserver === "undefined") return;
    const fit = () => {
      const w = inner.offsetWidth, h = inner.offsetHeight;
      if (!w || !h) return;
      setScale(Math.min(1, (el.clientWidth - 24) / w, (el.clientHeight - 16) / h));
    };
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    ro.observe(inner);
    fit();
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.2 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      role="img"
      aria-label={label}
      className="gs-stage relative w-full overflow-hidden rounded-xl flex items-center justify-center select-none"
      style={{
        height,
        background: "rgb(var(--surface-overlay-rgb))",
        border:     "1px solid rgb(var(--border-rgb))",
      }}
    >
      <StageContext.Provider value={{ visible }}>
        <div
          ref={innerRef}
          aria-hidden
          className="relative flex items-center justify-center flex-shrink-0"
          style={{ width: "max-content", transform: `scale(${scale})`, transformOrigin: "center" }}
        >
          {children}
        </div>
      </StageContext.Provider>
    </div>
  );
}

/**
 * Current beat of a looping scene, 0 … count-1. Holds on the last beat for
 * `holdLast` extra ticks so the payoff stays readable before the loop restarts.
 */
export function useBeat(count: number, ms = 900, holdLast = 2): number {
  const { paused, reduced } = useContext(MotionContext);
  const { visible } = useContext(StageContext);
  const [tick, setTick] = useState(0);
  const running = visible && !paused && !reduced;

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setTick((t) => (t + 1) % (count + holdLast)), ms);
    return () => window.clearInterval(id);
  }, [running, count, ms, holdLast]);

  if (reduced) return count - 1;
  return Math.min(tick, count - 1);
}

// ── Small shared building blocks ─────────────────────────────────────────────

/** rgba() from an "r, g, b" triplet or the page accent. */
export function tint(rgb: string, alpha: number): string {
  return `rgba(${rgb}, ${alpha})`;
}

export const TEAM = {
  blue:   "74, 123, 156",
  red:    "184, 100, 82",
  green:  "123, 156, 95",
  yellow: "212, 160, 74",
} as const;

export const T: CSSProperties = { transition: "all 320ms cubic-bezier(.2,.8,.2,1)" };

export function Phone({
  children,
  width = 112,
  height = 176,
  style,
}: {
  children: ReactNode;
  width?:   number;
  height?:  number;
  style?:   CSSProperties;
}) {
  return (
    <div
      className="relative flex-shrink-0 rounded-[18px] p-[6px]"
      style={{
        width, height,
        background: "rgb(var(--bg-rgb))",
        border:     "1px solid rgb(var(--border-rgb))",
        boxShadow:  "var(--shadow-card)",
        ...style,
      }}
    >
      <div
        className="relative w-full h-full overflow-hidden rounded-[13px] flex flex-col items-center"
        style={{ background: "rgb(var(--surface-raised-rgb))" }}
      >
        <div className="w-8 h-1 rounded-full mt-1.5 mb-1" style={{ background: "rgb(var(--border-rgb))" }} />
        {children}
      </div>
    </div>
  );
}

export function Screen({ children, width = 220, height = 132 }: { children: ReactNode; width?: number; height?: number }) {
  return (
    <div className="flex flex-col items-center flex-shrink-0">
      <div
        className="relative overflow-hidden rounded-lg p-2"
        style={{
          width, height,
          background: "rgb(var(--bg-rgb))",
          border:     "1px solid rgb(var(--border-rgb))",
          boxShadow:  "var(--shadow-card)",
        }}
      >
        {children}
      </div>
      <div className="w-10 h-2 rounded-b-md" style={{ background: "rgb(var(--border-rgb))" }} />
    </div>
  );
}

export function Avatar({ rgb, label, size = 22, style }: { rgb: string; label: string; size?: number; style?: CSSProperties }) {
  return (
    <div
      className="rounded-full flex items-center justify-center font-bold flex-shrink-0"
      style={{
        width: size, height: size,
        fontSize: size * 0.45,
        background: tint(rgb, 0.25),
        color: `rgb(${rgb})`,
        border: `1px solid ${tint(rgb, 0.6)}`,
        ...style,
      }}
    >
      {label}
    </div>
  );
}

/** A finger-tap ripple. Place it absolutely inside a positioned parent. */
export function Tap({ show, x, y }: { show: boolean; x: number | string; y: number | string }) {
  return (
    <div
      className="absolute pointer-events-none"
      style={{ left: x, top: y, transform: "translate(-50%, -50%)", ...T, opacity: show ? 1 : 0 }}
    >
      {show && <div className="gs-ripple" />}
      <div style={{ fontSize: 18, transform: "translate(6px, 8px)" }}>👆</div>
    </div>
  );
}

/** Small caption pill under/over a scene beat. */
export function Pill({ children, rgb, show = true, style }: { children: ReactNode; rgb?: string; show?: boolean; style?: CSSProperties }) {
  return (
    <div
      className="rounded-full px-2.5 py-1 text-[11px] font-bold leading-tight text-center"
      style={{
        ...T,
        opacity:    show ? 1 : 0,
        transform:  show ? "translateY(0) scale(1)" : "translateY(4px) scale(0.92)",
        background: rgb ? tint(rgb, 0.2) : "rgba(var(--accent), 0.18)",
        color:      rgb ? `rgb(${rgb})` : "rgb(var(--accent))",
        border:     `1px solid ${rgb ? tint(rgb, 0.45) : "rgba(var(--accent), 0.4)"}`,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
