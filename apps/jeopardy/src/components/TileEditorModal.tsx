import { useRef, useState, type ReactNode } from "react";
import { Button, Modal, Toggle } from "@gokkehub/ui";
import MediaBlockEditor from "./MediaBlockEditor";
import type {
  JpAnswerMode, JpBlock, JpBuzzDisplayMode, JpClosestNumberConfig,
  JpImageBlock, JpMediaBlock, JpMultipleChoiceConfig, JpRankingConfig,
  JpRevealMode, JpRevealOrder, JpTileConfig, UploadResponse,
} from "../lib/types";

interface TileEditorModalProps {
  gameId:   string;
  tileKey:  string;
  title:    string;
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

type ContentType = "text" | "image" | "media";

function firstText(blocks: JpBlock[] | undefined): string {
  return (blocks ?? []).filter(b => b.type === "text").map(b => (b as { text: string }).text).join("\n");
}
function firstImage(blocks: JpBlock[] | undefined): JpImageBlock | null {
  return ((blocks ?? []).find(b => b.type === "image") as JpImageBlock | undefined) ?? null;
}
function firstMedia(blocks: JpBlock[] | undefined): JpMediaBlock | null {
  return ((blocks ?? []).find(b => b.type === "audio" || b.type === "video") as JpMediaBlock | undefined) ?? null;
}
function initTypes(blocks: JpBlock[] | undefined, defaultText = true): ContentType[] {
  const types: ContentType[] = [];
  if (defaultText || (blocks ?? []).some(b => b.type === "text")) types.push("text");
  if ((blocks ?? []).some(b => b.type === "image")) types.push("image");
  if ((blocks ?? []).some(b => b.type === "audio" || b.type === "video")) types.push("media");
  if (types.length === 0) types.push("text");
  return types;
}

// Multi-select chip toggle — same visual style as the shared Toggle component.
function ContentToggle({ types, onChange }: {
  types: ContentType[];
  onChange: (types: ContentType[]) => void;
}) {
  const options: { value: ContentType; label: string }[] = [
    { value: "text",  label: "📝 Text" },
    { value: "image", label: "🖼 Image" },
    { value: "media", label: "🎵 Audio / Video" },
  ];
  return (
    <div className="flex rounded-md overflow-hidden"
      style={{ background: "rgb(var(--surface-raised-rgb))", border: "1px solid rgb(var(--border-rgb))" }}>
      {options.map(opt => {
        const active = types.includes(opt.value);
        return (
          <button key={opt.value} type="button"
            className="flex-1 px-3 py-2 text-sm font-bold transition-all duration-150 border-none cursor-pointer"
            style={active
              ? { background: "rgba(var(--color-primary-rgb), 0.18)", color: "rgb(var(--color-primary-rgb))" }
              : { background: "transparent", color: "rgb(var(--text-secondary-rgb))" }}
            onClick={() => {
              const next = active
                ? types.filter(t => t !== opt.value)
                : [...types, opt.value];
              // Always keep at least one type active.
              if (next.length > 0) onChange(next);
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export default function TileEditorModal({ gameId, tileKey, title, tile, onSave, onClose, simple = false }: TileEditorModalProps) {
  const [qText, setQText] = useState(firstText(tile?.questionBlocks));
  const [aText, setAText] = useState(firstText(tile?.answerBlocks));
  const [qImage, setQImage] = useState<JpImageBlock | null>(firstImage(tile?.questionBlocks));
  const [aImage, setAImage] = useState<JpImageBlock | null>(firstImage(tile?.answerBlocks));
  const [qMedia, setQMedia] = useState<JpMediaBlock | null>(firstMedia(tile?.questionBlocks));
  const [aMedia, setAMedia] = useState<JpMediaBlock | null>(firstMedia(tile?.answerBlocks));
  // Which content types are toggled on for each side.
  const [qTypes, setQTypes] = useState<ContentType[]>(() => initTypes(tile?.questionBlocks, true));
  const [aTypes, setATypes] = useState<ContentType[]>(() => initTypes(tile?.answerBlocks, false));

  const [reveal,  setReveal]  = useState<JpRevealMode>(qImage?.revealMode ?? "off");
  const [display, setDisplay] = useState<JpBuzzDisplayMode | "default">(tile?.buzzDisplayMode ?? "default");
  const [order,   setOrder]   = useState<JpRevealOrder>(tile?.revealOrder ?? "together");
  const [mode,    setMode]    = useState<JpAnswerMode>(tile?.answerMode ?? "standard");

  const mcInit = tile?.answerMode === "multipleChoice" ? tile.answerModeConfig as JpMultipleChoiceConfig : null;
  const cnInit = tile?.answerMode === "closestNumber"  ? tile.answerModeConfig as JpClosestNumberConfig  : null;
  const rkInit = tile?.answerMode === "ranking"        ? tile.answerModeConfig as JpRankingConfig        : null;

  const [mcOptions,   setMcOptions]   = useState<string[]>(mcInit?.options ?? ["", ""]);
  const [mcCorrect,   setMcCorrect]   = useState(mcInit?.correctIndex ?? 0);
  const [mcFirstOnly, setMcFirstOnly] = useState(mcInit?.firstCorrectOnly ?? false);

  const [cnInput,   setCnInput]   = useState<"field" | "slider">(cnInit?.input ?? "field");
  const [cnMin,     setCnMin]     = useState(String(cnInit?.min ?? 0));
  const [cnMax,     setCnMax]     = useState(String(cnInit?.max ?? 100));
  const [cnUnit,    setCnUnit]    = useState(cnInit?.unit ?? "");
  const [cnCorrect, setCnCorrect] = useState(cnInit ? String(cnInit.correct) : "");

  const [rkItems,   setRkItems]   = useState<string[]>(rkInit?.items ?? ["", ""]);
  const [rkScoring, setRkScoring] = useState<"exact" | "partial">(rkInit?.scoring ?? "partial");

  const [uploading, setUploading] = useState<"q" | "a" | null>(null);
  const [error,     setError]     = useState<string | null>(null);
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
      if (!res.ok || !body?.url) { setError(body?.error ?? "Upload failed"); return; }
      const block: JpImageBlock = { id: `${tileKey}-${side}img`, type: "image", url: body.url };
      if (side === "q") setQImage(block); else setAImage(block);
    } catch {
      setError("Upload failed");
    } finally {
      setUploading(null);
    }
  };

  const save = () => {
    const hasQ = (qTypes.includes("text") && qText.trim()) ||
                 (qTypes.includes("image") && qImage) ||
                 (qTypes.includes("media") && qMedia);
    if (!hasQ) { onSave(null); return; }

    if (mode === "multipleChoice") {
      const opts = mcOptions.map(o => o.trim()).filter(Boolean);
      if (opts.length < 2)          { setError("Multiple choice needs at least 2 options"); return; }
      if (mcCorrect >= opts.length) { setError("Pick which option is correct"); return; }
    }
    if (mode === "closestNumber" && !Number.isFinite(Number(cnCorrect))) {
      setError("Closest number needs the correct number"); return;
    }
    if (mode === "ranking" && rkItems.map(i => i.trim()).filter(Boolean).length < 2) {
      setError("Ranking needs at least 2 items"); return;
    }

    const questionBlocks: JpBlock[] = [];
    if (qTypes.includes("text")  && qText.trim()) questionBlocks.push({ id: `${tileKey}-q`,      type: "text",  text: qText.trim() });
    if (qTypes.includes("image") && qImage)        questionBlocks.push({ ...qImage, revealMode: reveal });
    if (qTypes.includes("media") && qMedia)        questionBlocks.push(qMedia);

    const answerBlocks: JpBlock[] = [];
    if (aTypes.includes("text")  && aText.trim()) answerBlocks.push({ id: `${tileKey}-a`,      type: "text",  text: aText.trim() });
    if (aTypes.includes("image") && aImage)        answerBlocks.push(aImage);
    if (aTypes.includes("media") && aMedia)        answerBlocks.push(aMedia);

    const out: JpTileConfig = { questionBlocks, answerBlocks, answerMode: mode };
    if (display !== "default") out.buzzDisplayMode = display;
    if (order !== "together" && questionBlocks.some(b => b.type !== "text")) out.revealOrder = order;
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

  const listEditor = (
    items: string[], setItems: (v: string[]) => void, max: number,
    extra?: (i: number) => ReactNode
  ) => (
    <div className="flex flex-col gap-1.5">
      {items.map((item, i) => (
        <div key={i} className="flex gap-2 items-center">
          {extra?.(i)}
          <input value={item} onChange={e => setItems(items.map((v, j) => j === i ? e.target.value : v))}
            className="flex-1 px-3 py-1.5 rounded-md text-sm outline-none" style={inputStyle} />
          <Button variant="danger" size="sm" disabled={items.length <= 2}
            onClick={() => setItems(items.filter((_, j) => j !== i))}>✕</Button>
        </div>
      ))}
      <Button variant="ghost" size="sm" disabled={items.length >= max}
        onClick={() => setItems([...items, ""])}>+ Add</Button>
    </div>
  );

  const showQImage = qTypes.includes("image");
  const showQMedia = qTypes.includes("media");
  const showAImage = aTypes.includes("image");
  const showAMedia = aTypes.includes("media");

  return (
    <Modal open onClose={onClose} maxWidth="560px">
      <div className="flex flex-col gap-4">
        <h3 className="text-lg font-bold">{title}</h3>

        {/* ── Question side ─────────────────────────────────────────── */}
        <div>
          <p className="text-sm font-medium mb-2" style={labelStyle}>Question content</p>
          <ContentToggle types={qTypes} onChange={setQTypes} />
        </div>

        {qTypes.includes("text") && (
          <textarea value={qText} onChange={e => setQText(e.target.value)} rows={3}
            placeholder="Question text…"
            className="w-full px-4 py-2.5 rounded-md font-sans text-base outline-none" style={inputStyle} />
        )}

        {showQImage && (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-3">
              {qImage ? (
                <>
                  <img src={qImage.url} alt="" className="h-16 rounded-md object-cover" />
                  <Button variant="danger" size="sm" onClick={() => setQImage(null)}>Remove image</Button>
                </>
              ) : (
                <Button variant="ghost" size="sm" loading={uploading === "q"}
                  onClick={() => qFileRef.current?.click()}>
                  Upload question image
                </Button>
              )}
              <input ref={qFileRef} type="file" accept="image/*" className="hidden"
                onChange={e => e.target.files?.[0] && upload("q", e.target.files[0])} />
            </div>
            {qImage && (
              <div>
                <p className="text-sm font-medium mb-2" style={labelStyle}>Image reveal</p>
                <Toggle
                  options={[
                    { value: "off",        label: "Normal" },
                    { value: "silhouette", label: "Silhouette" },
                    { value: "pixelated",  label: "Blurred" },
                    { value: "animated",   label: "Slow sharpen" },
                  ]}
                  value={reveal}
                  onChange={v => setReveal(v as JpRevealMode)}
                />
              </div>
            )}
          </div>
        )}

        {showQMedia && (
          <MediaBlockEditor gameId={gameId} blockId={`${tileKey}-qmedia`}
            block={qMedia} onChange={setQMedia} />
        )}

        {(showQImage || showQMedia) && (
          <div>
            <p className="text-sm font-medium mb-2" style={labelStyle}>Reveal order on the big screen</p>
            <Toggle
              options={[
                { value: "together",   label: "All at once" },
                { value: "textFirst",  label: "Text first" },
                { value: "mediaFirst", label: "Media first" },
              ]}
              value={order}
              onChange={v => setOrder(v as JpRevealOrder)}
            />
            {order !== "together" && (
              <p className="text-xs mt-1" style={labelStyle}>
                You reveal the held-back part from your host controller when you're ready.
              </p>
            )}
          </div>
        )}

        {/* ── Answer mode ───────────────────────────────────────────── */}
        {!simple && (
          <div>
            <p className="text-sm font-medium mb-2" style={labelStyle}>Answer mode</p>
            <Toggle
              options={[
                { value: "standard",       label: "🔴 Buzz" },
                { value: "multipleChoice", label: "abc Choice" },
                { value: "closestNumber",  label: "123 Closest" },
                { value: "ranking",        label: "1→8 Ranking" },
              ]}
              value={mode}
              onChange={v => setMode(v as JpAnswerMode)}
            />
          </div>
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
              <div>
                <p className="text-sm font-medium mb-1" style={labelStyle}>Input</p>
                <Toggle
                  options={[
                    { value: "field",  label: "Free number" },
                    { value: "slider", label: "Slider" },
                  ]}
                  value={cnInput}
                  onChange={v => setCnInput(v as "field" | "slider")}
                />
              </div>
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
            <div>
              <p className="text-sm font-medium mb-1" style={labelStyle}>Scoring</p>
              <Toggle
                options={[
                  { value: "partial", label: "Partial credit" },
                  { value: "exact",   label: "All-or-nothing" },
                ]}
                value={rkScoring}
                onChange={v => setRkScoring(v as "exact" | "partial")}
              />
            </div>
          </div>
        )}

        {/* ── Display mode ──────────────────────────────────────────── */}
        {!simple && mode === "standard" && (
          <div>
            <p className="text-sm font-medium mb-2" style={labelStyle}>On-buzz display</p>
            <Toggle
              options={[
                { value: "default",    label: "Board default" },
                { value: "stay",       label: "Stay" },
                { value: "disappear",  label: "Disappear" },
                { value: "typewriter", label: "Typewriter" },
              ]}
              value={display}
              onChange={v => setDisplay(v as JpBuzzDisplayMode | "default")}
            />
          </div>
        )}

        {/* ── Answer side ───────────────────────────────────────────── */}
        <div>
          <p className="text-sm font-medium mb-2" style={labelStyle}>Answer content (host only)</p>
          <ContentToggle types={aTypes} onChange={setATypes} />
        </div>

        {aTypes.includes("text") && (
          <textarea value={aText} onChange={e => setAText(e.target.value)} rows={2}
            placeholder="Answer text…"
            className="w-full px-4 py-2.5 rounded-md font-sans text-base outline-none" style={inputStyle} />
        )}

        {showAImage && (
          <div className="flex flex-wrap items-center gap-3">
            {aImage ? (
              <>
                <img src={aImage.url} alt="" className="h-12 rounded-md object-cover" />
                <Button variant="danger" size="sm" onClick={() => setAImage(null)}>Remove image</Button>
              </>
            ) : (
              <Button variant="ghost" size="sm" loading={uploading === "a"}
                onClick={() => aFileRef.current?.click()}>
                Upload answer image
              </Button>
            )}
            <input ref={aFileRef} type="file" accept="image/*" className="hidden"
              onChange={e => e.target.files?.[0] && upload("a", e.target.files[0])} />
          </div>
        )}

        {showAMedia && (
          <MediaBlockEditor gameId={gameId} blockId={`${tileKey}-amedia`}
            block={aMedia} onChange={setAMedia} />
        )}

        {error && <p className="text-sm" style={{ color: "rgb(var(--color-danger-rgb))" }}>{error}</p>}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save}>
            {(qTypes.includes("text") && qText.trim()) || (qTypes.includes("image") && qImage) || (qTypes.includes("media") && qMedia)
              ? "Save tile" : "Clear tile"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
