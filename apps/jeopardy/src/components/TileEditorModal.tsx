import { useRef, useState, type ReactNode } from "react";
import { Button, Modal } from "@gokkehub/ui";
import MediaBlockEditor from "./MediaBlockEditor";
import type {
  JpAnswerMode, JpBlock, JpBuzzDisplayMode, JpClosestNumberConfig,
  JpImageBlock, JpMediaBlock, JpMultipleChoiceConfig, JpRankingConfig,
  JpRevealMode, JpTileConfig, UploadResponse,
} from "../lib/types";

interface TileEditorModalProps {
  gameId:   string;
  tileKey:  string;
  title:    string;                       // "Category — 300"
  tile:     JpTileConfig | undefined;
  onSave:   (tile: JpTileConfig | null) => void;
  onClose:  () => void;
  /** Final Jeopardy: blocks only — no answer modes or buzz-display options. */
  simple?:  boolean;
}

const inputStyle = {
  background: "rgb(var(--surface-input-rgb))",
  border:     "1px solid rgb(var(--border-rgb))",
  color:      "rgb(var(--text-primary-rgb))",
} as const;

const labelStyle = { color: "rgb(var(--text-secondary-rgb))" } as const;

function firstText(blocks: JpBlock[] | undefined): string {
  return (blocks ?? []).filter(b => b.type === "text").map(b => (b as { text: string }).text).join("\n");
}
function firstImage(blocks: JpBlock[] | undefined): JpImageBlock | null {
  return ((blocks ?? []).find(b => b.type === "image") as JpImageBlock | undefined) ?? null;
}
function firstMedia(blocks: JpBlock[] | undefined): JpMediaBlock | null {
  return ((blocks ?? []).find(b => b.type === "audio" || b.type === "video") as JpMediaBlock | undefined) ?? null;
}

export default function TileEditorModal({ gameId, tileKey, title, tile, onSave, onClose, simple = false }: TileEditorModalProps) {
  const [qText, setQText] = useState(firstText(tile?.questionBlocks));
  const [aText, setAText] = useState(firstText(tile?.answerBlocks));
  const [qImage, setQImage] = useState<JpImageBlock | null>(firstImage(tile?.questionBlocks));
  const [aImage, setAImage] = useState<JpImageBlock | null>(firstImage(tile?.answerBlocks));
  const [qMedia, setQMedia] = useState<JpMediaBlock | null>(firstMedia(tile?.questionBlocks));
  const [aMedia, setAMedia] = useState<JpMediaBlock | null>(firstMedia(tile?.answerBlocks));
  const [reveal, setReveal] = useState<JpRevealMode>(qImage?.revealMode ?? "off");
  const [display, setDisplay] = useState<JpBuzzDisplayMode | "">(tile?.buzzDisplayMode ?? "");
  const [mode, setMode] = useState<JpAnswerMode>(tile?.answerMode ?? "standard");

  const mcInit = tile?.answerMode === "multipleChoice" ? tile.answerModeConfig as JpMultipleChoiceConfig : null;
  const cnInit = tile?.answerMode === "closestNumber"  ? tile.answerModeConfig as JpClosestNumberConfig  : null;
  const rkInit = tile?.answerMode === "ranking"        ? tile.answerModeConfig as JpRankingConfig        : null;

  const [mcOptions, setMcOptions] = useState<string[]>(mcInit?.options ?? ["", ""]);
  const [mcCorrect, setMcCorrect] = useState(mcInit?.correctIndex ?? 0);
  const [mcFirstOnly, setMcFirstOnly] = useState(mcInit?.firstCorrectOnly ?? false);

  const [cnInput, setCnInput] = useState<"field" | "slider">(cnInit?.input ?? "field");
  const [cnMin, setCnMin]     = useState(String(cnInit?.min ?? 0));
  const [cnMax, setCnMax]     = useState(String(cnInit?.max ?? 100));
  const [cnUnit, setCnUnit]   = useState(cnInit?.unit ?? "");
  const [cnCorrect, setCnCorrect] = useState(cnInit ? String(cnInit.correct) : "");

  const [rkItems, setRkItems]     = useState<string[]>(rkInit?.items ?? ["", ""]);
  const [rkScoring, setRkScoring] = useState<"exact" | "partial">(rkInit?.scoring ?? "partial");

  const [uploading, setUploading] = useState<"q" | "a" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const qFileRef = useRef<HTMLInputElement>(null);
  const aFileRef = useRef<HTMLInputElement>(null);

  const upload = async (side: "q" | "a", file: File) => {
    setUploading(side);
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
      const block: JpImageBlock = { id: `${tileKey}-${side}img`, type: "image", url: body.url };
      if (side === "q") setQImage(block); else setAImage(block);
    } catch {
      setError("Upload failed");
    } finally {
      setUploading(null);
    }
  };

  const save = () => {
    const hasContent = qText.trim() || qImage || qMedia;
    if (!hasContent) { onSave(null); return; }   // clearing the tile

    if (mode === "multipleChoice") {
      const opts = mcOptions.map(o => o.trim()).filter(Boolean);
      if (opts.length < 2)              { setError("Multiple choice needs at least 2 options"); return; }
      if (mcCorrect >= opts.length)     { setError("Pick which option is correct"); return; }
    }
    if (mode === "closestNumber" && !Number.isFinite(Number(cnCorrect))) {
      setError("Closest number needs the correct number"); return;
    }
    if (mode === "ranking" && rkItems.map(i => i.trim()).filter(Boolean).length < 2) {
      setError("Ranking needs at least 2 items"); return;
    }

    const questionBlocks: JpBlock[] = [];
    if (qText.trim()) questionBlocks.push({ id: `${tileKey}-q`, type: "text", text: qText.trim() });
    if (qImage)       questionBlocks.push({ ...qImage, revealMode: reveal });
    if (qMedia)       questionBlocks.push(qMedia);
    const answerBlocks: JpBlock[] = [];
    if (aText.trim()) answerBlocks.push({ id: `${tileKey}-a`, type: "text", text: aText.trim() });
    if (aImage)       answerBlocks.push(aImage);
    if (aMedia)       answerBlocks.push(aMedia);

    const out: JpTileConfig = { questionBlocks, answerBlocks, answerMode: mode };
    if (display) out.buzzDisplayMode = display as JpBuzzDisplayMode;
    if (mode === "multipleChoice") {
      out.answerModeConfig = {
        options:          mcOptions.map(o => o.trim()).filter(Boolean),
        correctIndex:     mcCorrect,
        firstCorrectOnly: mcFirstOnly,
      } satisfies JpMultipleChoiceConfig;
    } else if (mode === "closestNumber") {
      out.answerModeConfig = {
        input:   cnInput,
        min:     Number(cnMin) || 0,
        max:     Number(cnMax) || 100,
        unit:    cnUnit.trim(),
        correct: Number(cnCorrect),
      } satisfies JpClosestNumberConfig;
    } else if (mode === "ranking") {
      out.answerModeConfig = {
        items:   rkItems.map(i => i.trim()).filter(Boolean),
        scoring: rkScoring,
      } satisfies JpRankingConfig;
    }
    onSave(out);
  };

  const selectClass = "w-full px-3 py-2 rounded-md text-sm outline-none";
  const listEditor = (
    items: string[], setItems: (v: string[]) => void, max: number,
    extra?: (i: number) => ReactNode
  ) => (
    <div className="flex flex-col gap-1.5">
      {items.map((item, i) => (
        <div key={i} className="flex gap-2 items-center">
          {extra?.(i)}
          <input
            value={item}
            onChange={e => setItems(items.map((v, j) => j === i ? e.target.value : v))}
            className="flex-1 px-3 py-1.5 rounded-md text-sm outline-none"
            style={inputStyle}
          />
          <Button variant="danger" size="sm" disabled={items.length <= 2}
            onClick={() => setItems(items.filter((_, j) => j !== i))}>✕</Button>
        </div>
      ))}
      <Button variant="ghost" size="sm" disabled={items.length >= max}
        onClick={() => setItems([...items, ""])}>+ Add</Button>
    </div>
  );

  return (
    <Modal open onClose={onClose} maxWidth="560px">
      <div className="flex flex-col gap-4">
        <h3 className="text-lg font-bold">{title}</h3>

        {/* ── Question side ─────────────────────────────────────────── */}
        <label className="flex flex-col gap-2 text-sm font-semibold" style={labelStyle}>
          Question
          <textarea value={qText} onChange={e => setQText(e.target.value)} rows={3}
            className="w-full px-4 py-2.5 rounded-md font-sans text-base outline-none" style={inputStyle} />
        </label>

        <div className="flex flex-wrap items-center gap-3">
          {qImage ? (
            <>
              <img src={qImage.url} alt="" className="h-16 rounded-md object-cover" />
              <Button variant="danger" size="sm" onClick={() => setQImage(null)}>Remove image</Button>
            </>
          ) : (
            <Button variant="ghost" size="sm" loading={uploading === "q"}
              onClick={() => qFileRef.current?.click()}>
              + Question image
            </Button>
          )}
          <input ref={qFileRef} type="file" accept="image/*" className="hidden"
            onChange={e => e.target.files?.[0] && upload("q", e.target.files[0])} />
          {qImage && (
            <label className="flex items-center gap-2 text-sm font-semibold" style={labelStyle}>
              Reveal
              <select value={reveal} onChange={e => setReveal(e.target.value as JpRevealMode)}
                className={selectClass} style={{ ...inputStyle, width: "auto" }}>
                <option value="off">Normal</option>
                <option value="silhouette">Silhouette</option>
                <option value="pixelated">Blurred</option>
                <option value="animated">Slowly sharpen</option>
              </select>
            </label>
          )}
        </div>

        <MediaBlockEditor gameId={gameId} blockId={`${tileKey}-qmedia`}
          block={qMedia} onChange={setQMedia} />

        {/* ── Answer mode ───────────────────────────────────────────── */}
        {!simple && (
        <label className="flex flex-col gap-2 text-sm font-semibold" style={labelStyle}>
          Answer mode
          <select value={mode} onChange={e => setMode(e.target.value as JpAnswerMode)}
            className={selectClass} style={inputStyle}>
            <option value="standard">Buzz to answer</option>
            <option value="multipleChoice">Multiple choice</option>
            <option value="closestNumber">Closest number</option>
            <option value="ranking">Ranking</option>
          </select>
        </label>
        )}

        {mode === "multipleChoice" && (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-semibold" style={labelStyle}>Options (tick the correct one)</p>
            {listEditor(mcOptions, setMcOptions, 8, i => (
              <input type="radio" name="mc-correct" checked={mcCorrect === i}
                onChange={() => setMcCorrect(i)} className="accent-current" />
            ))}
            <label className="flex items-center gap-2 text-sm" style={labelStyle}>
              <input type="checkbox" checked={mcFirstOnly}
                onChange={e => setMcFirstOnly(e.target.checked)} className="accent-current" />
              Only the fastest correct answer scores
            </label>
          </div>
        )}

        {mode === "closestNumber" && (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-3 items-end">
              <label className="flex flex-col gap-1 text-sm font-semibold" style={labelStyle}>
                Correct number
                <input type="number" value={cnCorrect} onChange={e => setCnCorrect(e.target.value)}
                  className="w-32 px-3 py-1.5 rounded-md text-sm outline-none" style={inputStyle} />
              </label>
              <label className="flex flex-col gap-1 text-sm font-semibold" style={labelStyle}>
                Unit
                <input value={cnUnit} onChange={e => setCnUnit(e.target.value)} placeholder="Kr., %, km…"
                  className="w-28 px-3 py-1.5 rounded-md text-sm outline-none" style={inputStyle} />
              </label>
              <label className="flex flex-col gap-1 text-sm font-semibold" style={labelStyle}>
                Input
                <select value={cnInput} onChange={e => setCnInput(e.target.value as "field" | "slider")}
                  className={selectClass} style={{ ...inputStyle, width: "auto" }}>
                  <option value="field">Free number</option>
                  <option value="slider">Slider</option>
                </select>
              </label>
            </div>
            {cnInput === "slider" && (
              <div className="flex gap-3">
                <label className="flex flex-col gap-1 text-sm font-semibold" style={labelStyle}>
                  Min
                  <input type="number" value={cnMin} onChange={e => setCnMin(e.target.value)}
                    className="w-28 px-3 py-1.5 rounded-md text-sm outline-none" style={inputStyle} />
                </label>
                <label className="flex flex-col gap-1 text-sm font-semibold" style={labelStyle}>
                  Max
                  <input type="number" value={cnMax} onChange={e => setCnMax(e.target.value)}
                    className="w-28 px-3 py-1.5 rounded-md text-sm outline-none" style={inputStyle} />
                </label>
              </div>
            )}
          </div>
        )}

        {mode === "ranking" && (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-semibold" style={labelStyle}>Items in the CORRECT order (top first)</p>
            {listEditor(rkItems, setRkItems, 8)}
            <label className="flex items-center gap-2 text-sm font-semibold" style={labelStyle}>
              Scoring
              <select value={rkScoring} onChange={e => setRkScoring(e.target.value as "exact" | "partial")}
                className={selectClass} style={{ ...inputStyle, width: "auto" }}>
                <option value="partial">Partial credit per correct position</option>
                <option value="exact">All-or-nothing</option>
              </select>
            </label>
          </div>
        )}

        {/* ── Display + answer side ─────────────────────────────────── */}
        {!simple && mode === "standard" && (
          <label className="flex items-center gap-2 text-sm font-semibold" style={labelStyle}>
            On-buzz display
            <select value={display} onChange={e => setDisplay(e.target.value as JpBuzzDisplayMode | "")}
              className={selectClass} style={{ ...inputStyle, width: "auto" }}>
              <option value="">Board default</option>
              <option value="stay">Stay visible</option>
              <option value="disappear">Disappear on buzz</option>
              <option value="typewriter">Typewriter (freezes on buzz)</option>
            </select>
          </label>
        )}

        <label className="flex flex-col gap-2 text-sm font-semibold" style={labelStyle}>
          Answer (only the host sees this during play)
          <textarea value={aText} onChange={e => setAText(e.target.value)} rows={2}
            className="w-full px-4 py-2.5 rounded-md font-sans text-base outline-none" style={inputStyle} />
        </label>
        <div className="flex items-center gap-3">
          {aImage ? (
            <>
              <img src={aImage.url} alt="" className="h-12 rounded-md object-cover" />
              <Button variant="danger" size="sm" onClick={() => setAImage(null)}>Remove image</Button>
            </>
          ) : (
            <Button variant="ghost" size="sm" loading={uploading === "a"}
              onClick={() => aFileRef.current?.click()}>
              + Answer image
            </Button>
          )}
          <input ref={aFileRef} type="file" accept="image/*" className="hidden"
            onChange={e => e.target.files?.[0] && upload("a", e.target.files[0])} />
        </div>
        <MediaBlockEditor gameId={gameId} blockId={`${tileKey}-amedia`}
          block={aMedia} onChange={setAMedia} />

        {error && <p className="text-sm" style={{ color: "rgb(var(--color-danger-rgb))" }}>{error}</p>}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save}>{qText.trim() || qImage ? "Save tile" : "Clear tile"}</Button>
        </div>
      </div>
    </Modal>
  );
}
