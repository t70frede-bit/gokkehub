/**
 * Buzzer sounds — shared by the account profile picker (preview) and the
 * jeopardy big screen (playback on buzz-in).
 *
 * A player's sound is a string: "preset:<id>" for a built-in synthesised
 * sound (no audio files anywhere), or a URL to their uploaded clip in the
 * avatars R2 bucket. Presets are generated with WebAudio at play time.
 */

export interface BuzzerPreset { id: string; name: string; emoji: string }

export const BUZZER_PRESETS: BuzzerPreset[] = [
  { id: "classic", name: "Classic buzzer", emoji: "🔴" },
  { id: "ding",    name: "Ding",           emoji: "🛎️" },
  { id: "chime",   name: "Chime",          emoji: "✨" },
  { id: "horn",    name: "Game show horn", emoji: "📯" },
  { id: "laser",   name: "Laser",          emoji: "🔫" },
  { id: "boing",   name: "Boing",          emoji: "🤪" },
];

export const DEFAULT_BUZZER = "preset:classic";

let _ctx: AudioContext | null = null;
function ctx(): AudioContext {
  if (!_ctx) _ctx = new AudioContext();
  if (_ctx.state === "suspended") void _ctx.resume();
  return _ctx;
}

/** Call from a user gesture (click) to satisfy browser autoplay policies. */
export function unlockAudio(): void {
  void ctx();
}

type Note = {
  type: OscillatorType;
  from: number;          // start frequency (Hz)
  to?: number;           // optional glide target
  at: number;            // offset seconds
  dur: number;           // seconds
  gain?: number;
};

const PRESET_NOTES: Record<string, Note[]> = {
  classic: [{ type: "square",   from: 165, at: 0,    dur: 0.55, gain: 0.22 }],
  ding:    [{ type: "sine",     from: 880, at: 0,    dur: 0.7,  gain: 0.3 }],
  chime:   [
    { type: "sine", from: 660,  at: 0,    dur: 0.35, gain: 0.25 },
    { type: "sine", from: 880,  at: 0.12, dur: 0.4,  gain: 0.25 },
    { type: "sine", from: 1320, at: 0.24, dur: 0.5,  gain: 0.2 },
  ],
  horn:    [
    { type: "sawtooth", from: 220, at: 0, dur: 0.6, gain: 0.16 },
    { type: "sawtooth", from: 277, at: 0, dur: 0.6, gain: 0.16 },
    { type: "sawtooth", from: 330, at: 0, dur: 0.6, gain: 0.16 },
  ],
  laser:   [{ type: "sawtooth", from: 1800, to: 120, at: 0, dur: 0.4, gain: 0.22 }],
  boing:   [{ type: "sine",     from: 140,  to: 420, at: 0, dur: 0.45, gain: 0.3 }],
};

function playPreset(id: string): void {
  const notes = PRESET_NOTES[id] ?? PRESET_NOTES.classic;
  const ac  = ctx();
  const now = ac.currentTime;
  for (const n of notes) {
    const osc  = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = n.type;
    osc.frequency.setValueAtTime(n.from, now + n.at);
    if (n.to !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, n.to), now + n.at + n.dur);
    }
    gain.gain.setValueAtTime(n.gain ?? 0.25, now + n.at);
    gain.gain.exponentialRampToValueAtTime(0.001, now + n.at + n.dur);
    osc.connect(gain).connect(ac.destination);
    osc.start(now + n.at);
    osc.stop(now + n.at + n.dur + 0.05);
  }
}

/**
 * Play a buzzer sound string: "preset:<id>" synthesises, anything else is
 * treated as an audio URL. Missing/empty falls back to the classic preset.
 */
export function playBuzzerSound(sound: string | null | undefined): void {
  const s = sound || DEFAULT_BUZZER;
  if (s.startsWith("preset:")) {
    playPreset(s.slice(7));
    return;
  }
  const el = new Audio(s);
  el.volume = 0.8;
  void el.play().catch(() => playPreset("classic"));
}
