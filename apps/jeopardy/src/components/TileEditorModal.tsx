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

// Extra content type beyond text: "none" = text only, "image" = + image, "media" = + audio/video.
// Text is always present — it's the question read aloud, the base.
type ExtraContent = "none" | "image" | "media";

function firstText(blocks: JpBlock[] | undefined): string {
  return (blocks ?? []).filter(b => b.type === "text").map(b => (b as { text: string }).text).join("\n");
}
function firstImage(blocks: JpBlock[] | undefined): JpImageBlock | null {
  return ((blocks ?? []).find(b => b.type === "image") as JpImageBlock | undefined) ?? null;
}
function firstMedia(blocks: JpBlock[] | undefined): JpMediaBlock | null {
  return ((blocks ?? []).find(b => b.type === "audio" || b.type === "video") as JpMediaBlock | undefined) ?? null;
}
function initExtra(blocks: JpBlock[] | undefined): ExtraContent {
  if ((blocks ?? []).some(b => b.type === "audio" || b.type === "video")) return "media";
  if ((blocks ?? []).some(b => b.type === "image")) return "image";
  return "none";
}

export default function TileEditorModal({ gameId, tileKey, title, tile, onSave, onClose, simple = false }: TileEditorModalProps) {
  const [qText, setQText] = useState(firstText(tile?.questionBlocks));
  const [aText, setAText] = useState(firstText(tile?.answerBlocks));
  const [qImage, setQImage] = useState<JpImageBlock | null>(firstImage(tile?.questionBlocks));
  const [aImage, setAImage] = useState<JpImageBlock | null>(firstImage(tile?.answerBlocks));
  const [qMedia, setQMedia] = useState<JpMediaBlock | null>(firstMedia(tile?.questionBlocks));
  const [aMedia, setAMedia] = useState<JpMediaBlock | null>(firstMedia(tile?.answerBlocks));
  // Extra content on top of the always-present text.
  const [qExtra, setQExtra] = useState<ExtraContent>(() => initExtra(tile?.questionBlocks));
  const [aExtra, setAExtra] = useState<ExtraContent>(() => initExtra(tile?.answerBlocks));

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
  const [rkTopLabel,    setRkTopLabel]    = useState(rkInit?.topLabel    ?? "");
  const [rkBottomLabel, setRkBottomLabel] = useState(rkInit?.bottomLabel ?? "");

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
    if (!qText.trim() && !(qExtra === "image" && qImage) && !(qExtra === "media" && qMedia)) {
      onSave(null); return;
    }

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
    if (qText.trim())                        questionBlocks.push({ id: `${tileKey}-q`, type: "text", text: qText.trim() });
    if (qExtra === "image" && qImage)        questionBlocks.push({ ...qImage, revealMode: reveal });
    if (qExtra === "media" && qMedia)        questionBlocks.push(qMedia);

    const answerBlocks: JpBlock[] = [];
    if (aText.trim())                        answerBlocks.push({ id: `${tileKey}-a`, type: "text", text: aText.trim() });
    if (aExtra === "image" && aImage) {
      answerBlocks.push(aImage);
    } else if (aExtra === "none" && qExtra === "image" && qImage && reveal !== "off") {
      // Question image has a visual effect (blur/silhouette/sharpen) — auto-add the
      // same image to the answer side without any effect so the host sees it clearly.
      answerBlocks.push({ ...qImage, id: `${tileKey}-a-img`, revealMode: "off" });
    }
    if (aExtra === "media" && aMedia)        answerBlocks.push(aMedia);

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
      const cfg: JpRankingConfig = {
        items:   rkItems.map(i => i.trim()).filter(Boolean),
        scoring: rkScoring,
      };
      if (rkTopLabel.trim())    cfg.topLabel    = rkTopLabel.trim();
      if (rkBottomLabel.trim()) cfg.bottomLabel = rkBottomLabel.trim();
      out.answerModeConfig = cfg;
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

  const showQImage = qExtra === "image";
  const showQMedia = qExtra === "media";
  const showAImage = aExtra === "image";
  const showAMedia = aExtra === "media";

  return (
    <Modal open onClose={onClose} maxWidth="560px">
      <div className="flex flex-col gap-4">
        <h3 className="text-lg font-bold">{title}</h3>

        {/* ── Question side ─────────────────────────────────────────── */}
        <div>
          <p className="text-sm font-medium mb-2" style={labelStyle}>Question</p>
          <Toggle
            options={[
              { value: "none",  label: "📝 Text only" },
              { value: "image", label: "🖼 + Image" },
              { value: "media", label: "🎵 + Audio / Video" },
            ]}
            value={qExtra}
            onChange={v => setQExtra(v as ExtraContent)}
          />
        </div>

        <textarea value={qText} onChange={e => setQText(e.target.value)} rows={3}
          placeholder="Question text…"
          className="w-full px-4 py-2.5 rounded-md font-sans text-base outline-none" style={inputStyle} />

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

        {(showQImage || showQMedia) && (() => {
          const mediaLabel = showQMedia
            ? (qMedia?.type === "video" ? "video" : "audio")
            : "image";
          const mediaIcon  = showQMedia
            ? (qMedia?.type === "video" ? "🎬" : "🎵")
            : "🖼";
          return (
            <div>
              <p className="text-sm font-medium mb-2" style={labelStyle}>Reveal order</p>
              <Toggle
                options={[
                  { value: "together",   label: "Together" },
                  { value: "textFirst",  label: `Text → then ${mediaLabel}` },
                  { value: "mediaFirst", label: `${mediaLabel.charAt(0).toUpperCase() + mediaLabel.slice(1)} → then text` },
                ]}
                value={order}
                onChange={v => setOrder(v as JpRevealOrder)}
              />
              {order === "textFirst" && (
                <p className="text-xs mt-1" style={labelStyle}>
                  Question text appears first. Your host controller gets a "{mediaIcon} Reveal {mediaLabel} &amp; open buzzers" button.
                </p>
              )}
              {order === "mediaFirst" && (
                <p className="text-xs mt-1" style={labelStyle}>
                  {mediaLabel.charAt(0).toUpperCase() + mediaLabel.slice(1)} appears first. Your host controller gets a "📝 Reveal text &amp; open buzzers" button.
                </p>
              )}
            </div>
          );
        })()}

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
            {cnCorrect !== "" && Number.isFinite(Number(cnCorrect)) && (
              <p className="text-xs rounded-md px-3 py-1.5"
                style={{ background: "rgba(var(--color-primary-rgb), 0.1)", color: "rgb(var(--color-primary-rgb))" }}>
                Auto-answer shown to host: <strong>{cnCorrect} {cnUnit}</strong>
              </p>
            )}
          </div>
        )}

        {mode === "ranking" && (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-semibold" style={labelStyle}>Items in the CORRECT order (top first)</p>
            {listEditor(rkItems, setRkItems, 8)}
            <div className="flex gap-2">
              <div className="flex-1">
                <p className="text-xs mb-1" style={labelStyle}>Top label (e.g. "Highest")</p>
                <input value={rkTopLabel} placeholder="Most / High / Largest…"
                  onChange={e => setRkTopLabel(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-md text-sm outline-none" style={inputStyle} />
              </div>
              <div className="flex-1">
                <p className="text-xs mb-1" style={labelStyle}>Bottom label (e.g. "Lowest")</p>
                <input value={rkBottomLabel} placeholder="Least / Low / Smallest…"
                  onChange={e => setRkBottomLabel(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-md text-sm outline-none" style={inputStyle} />
              </div>
            </div>
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
          <p className="text-sm font-medium mb-2" style={labelStyle}>Answer (host only)</p>
          <Toggle
            options={[
              { value: "none",  label: "📝 Text only" },
              { value: "image", label: "🖼 + Image" },
              { value: "media", label: "🎵 + Audio / Video" },
            ]}
            value={aExtra}
            onChange={v => setAExtra(v as ExtraContent)}
          />
        </div>

        <textarea value={aText} onChange={e => setAText(e.target.value)} rows={2}
          placeholder="Answer text…"
          className="w-full px-4 py-2.5 rounded-md font-sans text-base outline-none" style={inputStyle} />

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
            {qText.trim() || (qExtra === "image" && qImage) || (qExtra === "media" && qMedia)
              ? "Save tile" : "Clear tile"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
