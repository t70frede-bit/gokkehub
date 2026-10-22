import { useEffect, useState } from "react";
import type { BingoCheckMode, BingoWinMode, BingoWordMatch, TlRoomSettings } from "../lib/types";

// Host-only Music Bingo settings, shown in the Lobby's Game Settings panel
// in place of the timeline game's cards-to-win / guessing / tokens blocks.
// Same pill-card look as the rest of the Lobby.

function OptionCard({ active, label, hint, onClick }: { active: boolean; label: string; hint: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={hint}
      className="text-left rounded-lg p-3 transition-all border"
      style={{
        borderColor: active ? "rgba(var(--color-primary-rgb),0.7)" : "rgba(255,255,255,0.12)",
        background:  active ? "rgba(var(--color-primary-rgb),0.15)" : "transparent",
      }}
    >
      <p className="text-sm font-semibold">{label}</p>
      <p className="text-xs mt-0.5" style={{ color: "rgb(var(--text-muted-rgb))" }}>{hint}</p>
    </button>
  );
}

const CLIP_PRESETS = [
  { value: 0,  label: "🎵 Full song" },
  { value: 60, label: "1 min" },
  { value: 30, label: "30 sec" },
] as const;

export function BingoLobbySettings({
  settings, onSave,
}: {
  settings: Required<TlRoomSettings>;
  onSave:   (patch: TlRoomSettings) => void;
}) {
  const clip = settings.bingoClipSeconds;
  const isPreset = CLIP_PRESETS.some(p => p.value === clip);
  const [customOpen, setCustomOpen] = useState(!isPreset);
  const [customText, setCustomText] = useState(String(isPreset ? 45 : clip));
  useEffect(() => { if (!isPreset) setCustomText(String(clip)); }, [clip, isPreset]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-sm font-medium mb-2">Board size</p>
        <div className="flex gap-2">
          {[3, 4, 5].map(n => {
            const active = settings.bingoSize === n;
            return (
              <button
                key={n}
                onClick={() => onSave({ bingoSize: n })}
                className="px-4 py-1.5 rounded-md text-sm font-bold transition-all border"
                style={{
                  borderColor: active ? "rgba(var(--color-primary-rgb),0.7)" : "rgba(255,255,255,0.12)",
                  background:  active ? "rgba(var(--color-primary-rgb),0.18)" : "transparent",
                  color:       active ? "rgb(var(--color-primary-rgb))" : "inherit",
                  fontFamily:  "var(--font-mono)",
                }}
              >
                {n}×{n}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <p className="text-sm font-medium mb-2">What wins?</p>
        <div className="grid grid-cols-3 gap-2">
          {([
            { value: "line",      label: "➖ One line",  hint: "Any row, column or diagonal" },
            { value: "two-lines", label: "🟰 Two lines", hint: "Any two rows, columns or diagonals" },
            { value: "full",      label: "⬛ Full board", hint: "Every word crossed off" },
          ] as const).map(o => (
            <OptionCard key={o.value} active={settings.bingoWinMode === o.value} label={o.label} hint={o.hint}
              onClick={() => onSave({ bingoWinMode: o.value as BingoWinMode })} />
          ))}
        </div>
      </div>

      <div>
        <p className="text-sm font-medium mb-2">How are ticks checked?</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {([
            { value: "off",    label: "🙌 No check",     hint: "Players just cross words off" },
            { value: "track",  label: "#️⃣ Track number", hint: "Pick which track the word was in; the game checks it" },
            { value: "search", label: "🔍 Find the song", hint: "Pick the track number AND search the exact song" },
          ] as const).map(o => (
            <OptionCard key={o.value} active={settings.bingoCheckMode === o.value} label={o.label} hint={o.hint}
              onClick={() => onSave({ bingoCheckMode: o.value as BingoCheckMode })} />
          ))}
        </div>
      </div>

      {settings.bingoCheckMode !== "off" && (
        <div>
          <p className="text-sm font-medium mb-2">Word matching</p>
          <div className="grid grid-cols-2 gap-2">
            {([
              { value: "partial", label: "🧩 Partial",    hint: "\"You\" matches Your, \"Child\" matches Childish" },
              { value: "whole",   label: "🔤 Whole word", hint: "\"You\" only matches You" },
            ] as const).map(o => (
              <OptionCard key={o.value} active={settings.bingoWordMatch === o.value} label={o.label} hint={o.hint}
                onClick={() => onSave({ bingoWordMatch: o.value as BingoWordMatch })} />
            ))}
          </div>
        </div>
      )}

      <div>
        <p className="text-sm font-medium mb-2">How long does each song play?</p>
        <div className="flex gap-2 flex-wrap">
          {CLIP_PRESETS.map(p => {
            const active = !customOpen && clip === p.value;
            return (
              <button
                key={p.value}
                onClick={() => { setCustomOpen(false); onSave({ bingoClipSeconds: p.value }); }}
                className="px-3 py-1.5 rounded-md text-sm font-semibold transition-all border"
                style={{
                  borderColor: active ? "rgba(var(--color-primary-rgb),0.7)" : "rgba(255,255,255,0.12)",
                  background:  active ? "rgba(var(--color-primary-rgb),0.18)" : "transparent",
                }}
              >
                {p.label}
              </button>
            );
          })}
          <button
            onClick={() => setCustomOpen(true)}
            className="px-3 py-1.5 rounded-md text-sm font-semibold transition-all border"
            style={{
              borderColor: customOpen ? "rgba(var(--color-primary-rgb),0.7)" : "rgba(255,255,255,0.12)",
              background:  customOpen ? "rgba(var(--color-primary-rgb),0.18)" : "transparent",
            }}
          >
            ⏱ Custom
          </button>
        </div>
        {customOpen && (
          <div className="flex items-center gap-3 mt-3">
            <input
              type="number"
              min={10} max={600}
              value={customText}
              onChange={e => setCustomText(e.target.value)}
              onBlur={() => {
                const n = Math.max(10, Math.min(600, Math.round(Number(customText) || 45)));
                setCustomText(String(n));
                onSave({ bingoClipSeconds: n });
              }}
              className="w-24 rounded-lg px-3 py-1.5 text-sm"
              style={{
                background: "rgba(var(--surface-raised-rgb),0.5)",
                border:     "1px solid rgba(255,255,255,0.1)",
                color:      "inherit",
                fontFamily: "var(--font-mono)",
              }}
            />
            <span className="text-sm" style={{ color: "rgb(var(--text-muted-rgb))" }}>seconds (10–600)</span>
          </div>
        )}
        <p className="text-xs mt-2" style={{ color: "rgb(var(--text-muted-rgb))" }}>
          The next song starts automatically. The host can also skip or pause.
        </p>
      </div>
    </div>
  );
}
