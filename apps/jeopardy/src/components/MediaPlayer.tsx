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
  /** Show native playback controls and attempt autoplay even before the 🔊
   *  unlock (used in the answer reveal, where the host may just want to hit play). */
  controls?: boolean;
}

const FADE_SECONDS = 1.5;

// Plays an audio/video block on the big screen. Trims are a playback window
// (seek to trimStart, pause at trimEnd), fades are volume ramps, and the
// on-buzz behaviour (stop / fadeOut / freeze / continue) fires when `buzzed`
// flips true. Nothing here touches the file itself.
export default function MediaPlayer({ block, buzzed, nonce, soundOn, controls = false }: MediaPlayerProps) {
  const elRef      = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  const fadeTimer  = useRef<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded]     = useState(false);

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

  const startPlayback = (el: HTMLMediaElement) => {
    clearFade();
    el.currentTime = start;
    el.volume = block.fadeIn ? 0 : 1;
    setEnded(false);
    void el.play().then(() => {
      setPlaying(true);
      if (block.fadeIn) rampVolume(el, 1, FADE_SECONDS);
    }).catch(() => setPlaying(false));
  };

  // Start (or restart on replay) once sound is unlocked. In `controls` mode we
  // attempt autoplay even before the unlock — if the browser blocks it, the
  // native controls let the host press play manually.
  useEffect(() => {
    const el = elRef.current;
    if (!el || (!soundOn && !controls)) return;
    startPlayback(el);
    return clearFade;
  }, [nonce, soundOn, controls, block.url]);

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
        setEnded(true);
      }
    };
    const onEnded = () => { setPlaying(false); setEnded(true); };
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
      <div className="relative inline-block">
        <video
          ref={elRef as React.RefObject<HTMLVideoElement>}
          src={block.url}
          muted={block.muted ?? false}
          playsInline
          className={controls ? "max-h-[55vh] max-w-[80vw] rounded-lg" : "max-h-[45vh] rounded-lg"}
        />
        {/* Replay button, centred over the video once it finishes. */}
        {ended && (
          <button
            type="button"
            onClick={() => { const el = elRef.current; if (el) startPlayback(el); }}
            aria-label="Replay video"
            className="absolute inset-0 flex items-center justify-center rounded-lg"
            style={{ background: "rgba(0,0,0,0.4)" }}
          >
            <span className="flex items-center justify-center rounded-full"
              style={{
                width: "clamp(3.5rem, 9vw, 6rem)", height: "clamp(3.5rem, 9vw, 6rem)",
                background: "rgba(0,0,0,0.6)", border: "3px solid rgba(255,255,255,0.9)",
              }}>
              <svg viewBox="0 0 24 24" width="55%" height="55%" fill="none"
                stroke="rgba(255,255,255,0.95)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="1 4 1 10 7 10" />
                <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
              </svg>
            </span>
          </button>
        )}
      </div>
    );
  }

  // In `controls` mode (answer reveal) show a real audio player the host can scrub.
  if (controls) {
    return (
      <audio
        ref={elRef as React.RefObject<HTMLAudioElement>}
        src={block.url}
        controls
        className="w-full max-w-md"
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
