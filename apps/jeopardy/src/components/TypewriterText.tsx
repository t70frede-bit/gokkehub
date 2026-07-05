import { useEffect, useRef, useState } from "react";

interface TypewriterTextProps {
  text:      string;
  /** Buzz happened: stop typing and stay stopped mid-sentence. */
  frozen:    boolean;
  className?: string;
  style?:    React.CSSProperties;
}

const CHAR_MS = 45;

export default function TypewriterText({ text, frozen, className, style }: TypewriterTextProps) {
  // Frozen from the very start (late join / reconnect) → the question was
  // already on screen, show it all rather than an eternally blank line.
  const frozenAtMount = useRef(frozen);
  const [count, setCount] = useState(frozenAtMount.current ? text.length : 0);

  useEffect(() => {
    if (frozen || count >= text.length) return;
    const t = setInterval(() => {
      setCount(c => Math.min(c + 1, text.length));
    }, CHAR_MS);
    return () => clearInterval(t);
  }, [frozen, count >= text.length, text]);

  return (
    <p className={className} style={style}>
      {text.slice(0, count)}
      {count < text.length && <span className="animate-pulse">▌</span>}
    </p>
  );
}
