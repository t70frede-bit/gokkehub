import { useEffect, useRef, useState } from "react";
import { Button, Toggle } from "@gokkehub/ui";
import type { JpMediaBlock, UploadResponse } from "../lib/types";

interface MediaBlockEditorProps {
  gameId:  string;
  blockId: string;
  block:   JpMediaBlock | null;
  onChange: (block: JpMediaBlock | null) => void;
}

const labelStyle = { color: "rgb(var(--text-secondary-rgb))" } as const;

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

// Upload + trim/fade/on-buzz settings for one audio or video block.
// Trimming is a stored playback window — the file is never re-encoded.
export default function MediaBlockEditor({ gameId, blockId, block, onChange }: MediaBlockEditorProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [duration, setDuration]   = useState<number | null>(null);
  const fileRef    = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);

  // Learn the clip's duration for the trim sliders.
  useEffect(() => {
    setDuration(null);
    if (!block) return;
    const probe = document.createElement(block.type === "video" ? "video" : "audio");
    probe.preload = "metadata";
    probe.src = block.url;
    probe.onloadedmetadata = () => setDuration(Number.isFinite(probe.duration) ? probe.duration : null);
    return () => { probe.src = ""; };
  }, [block?.url]);

  const upload = async (file: File) => {
    const isMedia = file.type.startsWith("audio/") || file.type.startsWith("video/");
    if (!isMedia) { setError("Pick an audio or video file"); return; }
    setUploading(true);
    setError(null);
    try {
      const res = await fetch(`/game/${gameId}/upload`, {
        method:  "POST",
        headers: { "Content-Type": file.type },
        credentials: "include",
        body:    file,
      });
      const body = await res.json().catch(() => null) as (UploadResponse & { error?: string }) | null;
      if (!res.ok || !body?.url) {
        setError(body?.error ?? "Upload failed");
        return;
      }
      onChange(file.type.startsWith("video/")
        ? { id: blockId, type: "video", url: body.url, onBuzz: "freeze" }
        : { id: blockId, type: "audio", url: body.url, onBuzz: "stop" });
    } catch {
      setError("Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const previewTrim = () => {
    const el = previewRef.current;
    if (!el || !block) return;
    el.currentTime = block.trimStart ?? 0;
    void el.play();
  };

  if (!block) {
    return (
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" loading={uploading} onClick={() => fileRef.current?.click()}>
          + Audio / video clip
        </Button>
        <input ref={fileRef} type="file" accept="audio/*,video/mp4,video/webm" className="hidden"
          onChange={e => e.target.files?.[0] && upload(e.target.files[0])} />
        {error && <p className="text-sm" style={{ color: "rgb(var(--color-danger-rgb))" }}>{error}</p>}
      </div>
    );
  }

  const start = block.trimStart ?? 0;
  const end   = block.trimEnd ?? duration ?? 0;
  const patch = (p: Partial<JpMediaBlock>) => onChange({ ...block, ...p } as JpMediaBlock);

  return (
    <div className="flex flex-col gap-3 rounded-md p-3" style={{ border: "1px solid rgb(var(--border-rgb))" }}>
      <div className="flex items-center gap-3">
        <span className="font-bold text-sm">{block.type === "video" ? "🎬 Video clip" : "🎵 Audio clip"}</span>
        <Button variant="ghost" size="sm" onClick={previewTrim}>▶ Preview</Button>
        <Button variant="danger" size="sm" onClick={() => onChange(null)}>Remove</Button>
      </div>

      {block.type === "video" ? (
        <video ref={previewRef as React.RefObject<HTMLVideoElement>} src={block.url}
          controls muted={block.muted ?? false} className="max-h-40 rounded-md" />
      ) : (
        <audio ref={previewRef as React.RefObject<HTMLAudioElement>} src={block.url} controls className="w-full" />
      )}

      {duration !== null && (
        <div className="flex flex-col gap-1">
          <div className="flex justify-between text-xs" style={labelStyle}>
            <span>Play from {fmt(start)}</span>
            <span>to {fmt(end)} / {fmt(duration)}</span>
          </div>
          <input type="range" min={0} max={Math.floor(duration)} step={1} value={start}
            className="w-full accent-current"
            onChange={e => {
              const v = Number(e.target.value);
              patch({ trimStart: v, trimEnd: Math.max(v + 1, block.trimEnd ?? duration) });
            }} />
          <input type="range" min={0} max={Math.ceil(duration)} step={1} value={end}
            className="w-full accent-current"
            onChange={e => {
              const v = Number(e.target.value);
              patch({ trimEnd: v, trimStart: Math.min(start, Math.max(0, v - 1)) });
            }} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-4 text-sm font-semibold" style={labelStyle}>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={block.fadeIn ?? false} className="accent-current"
            onChange={e => patch({ fadeIn: e.target.checked })} />
          Fade in
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={block.fadeOut ?? false} className="accent-current"
            onChange={e => patch({ fadeOut: e.target.checked })} />
          Fade out
        </label>
        {block.type === "video" && (
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={block.muted ?? false} className="accent-current"
              onChange={e => patch({ muted: e.target.checked })} />
            Mute video
          </label>
        )}
      </div>
      <div>
        <p className="text-sm font-medium mb-1" style={labelStyle}>When someone buzzes</p>
        {block.type === "video" ? (
          <Toggle
            options={[
              { value: "freeze",   label: "Freeze frame" },
              { value: "stop",     label: "Stop" },
              { value: "continue", label: "Keep playing" },
            ]}
            value={block.onBuzz ?? "freeze"}
            onChange={v => patch({ onBuzz: v as "stop" | "freeze" | "continue" })}
          />
        ) : (
          <Toggle
            options={[
              { value: "stop",     label: "Stop" },
              { value: "fadeOut",  label: "Fade out" },
              { value: "continue", label: "Keep playing" },
            ]}
            value={block.onBuzz ?? "stop"}
            onChange={v => patch({ onBuzz: v as "stop" | "fadeOut" | "continue" })}
          />
        )}
      </div>
      {error && <p className="text-sm" style={{ color: "rgb(var(--color-danger-rgb))" }}>{error}</p>}
    </div>
  );
}
