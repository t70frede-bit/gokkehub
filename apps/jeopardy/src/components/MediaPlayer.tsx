import { useEffect, useRef, useState } from "react";
import type { JpMediaBlock } from "../lib/types";

interface MediaPlayerProps {
  block:  JpMediaBlock;
  /** Someone won the buzz — apply the block's on-buzz behaviour. */
  buzzed: boolean;
  /** Bumped by the host's replay action — restart the clip. */
  nonce:  number;
  /** The big screen's 🔊 unlock — playback waits for it. */
  soundOn: boolean;
}

const FADE_SECONDS = 1.5;

// Plays an audio/video block on the big screen. Trims are a playback window
// (seek to trimStart, pause at trimEnd), fades are volume ramps, and the
// on-buzz behaviour (stop / fadeOut / freeze / continue) fires when `buzzed`
// flips true. Nothing here touches the file itself.
export default function MediaPlayer({ block, buzzed, nonce, soundOn }: MediaPlayerProps) {
  const elRef      = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  const fadeTimer  = useRef<number | null>(null);
  const [playing, setPlaying] = useState(false);

  const isVideo = block.type === "video";
  const start   = block.trimStart ?? 0;
  const end     = block.trimEnd;

  const clearFade = () => {
    if (fadeTimer.current !== null) {
      window.clearInterval(fadeTimer.current);
      fadeTimer.current = null;
    }
  };

  const rampVolume = (el: HTMLMediaElement, to: number, seconds: number, then?: () => void) => {
    clearFade();
    const from  = el.volume;
    const steps = Math.max(1, Math.round(seconds * 20));
    let i = 0;
    fadeTimer.current = window.setInterval(() => {
      i += 1;
      el.volume = Math.min(1, Math.max(0, from + (to - from) * (i / steps)));
      if (i >= steps) {
        clearFade();
        then?.();
      }
    }, 50);
  };

  // Start (or restart on replay) once sound is unlocked.
  useEffect(() => {
    const el = elRef.current;
    if (!el || !soundOn) return;
    clearFade();
    el.currentTime = start;
    el.volume = block.fadeIn ? 0 : 1;
    void el.play().then(() => {
      setPlaying(true);
      if (block.fadeIn) rampVolume(el, 1, FADE_SECONDS);
    }).catch(() => setPlaying(false));
    return clearFade;
  }, [nonce, soundOn, block.url]);

  // Enforce the trim window + natural fade-out at its end.
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const onTime = () => {
      if (end === undefined) return;
      if (block.fadeOut && fadeTimer.current === null && el.currentTime >= end - FADE_SECONDS && !el.paused) {
        rampVolume(el, 0, Math.max(0.2, end - el.currentTime));
      }
      if (el.currentTime >= end) {
        el.pause();
        setPlaying(false);
      }
    };
    const onEnded = () => setPlaying(false);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("ended", onEnded);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("ended", onEnded);
    };
  }, [end, block.fadeOut]);

  // On-buzz behaviour.
  useEffect(() => {
    const el = elRef.current;
    if (!el || !buzzed || el.paused) return;
    const behaviour = block.onBuzz ?? (isVideo ? "freeze" : "stop");
    if (behaviour === "continue") return;
    if (behaviour === "fadeOut") {
      rampVolume(el, 0, 0.8, () => { el.pause(); setPlaying(false); });
    } else {
      // "stop" and "freeze" both pause; a paused video IS the freeze frame.
      el.pause();
      setPlaying(false);
    }
  }, [buzzed]);

  if (isVideo) {
    return (
      <video
        ref={elRef as React.RefObject<HTMLVideoElement>}
        src={block.url}
        muted={block.muted ?? false}
        playsInline
        className="max-h-[45vh] rounded-lg"
      />
    );
  }

  return (
    <div className="flex items-center gap-3 rounded-full px-6 py-3"
      style={{
        background: "rgb(var(--surface-raised-rgb))",
        border:     "1px solid rgb(var(--border-rgb))",
      }}
    >
      <audio ref={elRef as React.RefObject<HTMLAudioElement>} src={block.url} />
      <span className={`text-3xl ${playing ? "animate-pulse" : "opacity-40"}`}>🎵</span>
      <span className="font-bold text-lg" style={{ color: "rgb(var(--text-secondary-rgb))" }}>
        {!soundOn ? "Enable sound to play the clip" : playing ? "Listen…" : "Clip finished"}
      </span>
    </div>
  );
}
