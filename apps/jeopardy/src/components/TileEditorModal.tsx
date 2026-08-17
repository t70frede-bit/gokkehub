import { useRef, useState, type ReactNode } from "react";
import { Button, Modal, Toggle } from "@gokkehub/ui";
import MediaBlockEditor from "./MediaBlockEditor";
import QuestionOverlay from "./Board/QuestionOverlay";
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
  /** Shown in the preview's header, exactly as the big screen would. */
  category?:     string;
  categoryDesc?: string;
  value?:        number;
}

const inputStyle = {
  background: "rgb(var(--surface-input-rgb))",
  border:     "1px solid rgb(var(--border-rgb))",
  color:      "rgb(var(--text-primary-rgb))",
} as const;

const labelStyle = { color: "rgb(var(--text-secondary-rgb))" } as const;

type Side = "q" | "a";

let blockSeq = 0;
function newBlockId(tileKey: string, side: Side): string {
  blockSeq += 1;
  return `${tileKey}-${side}-${Date.now().toString(36)}${blockSeq}`;
}

// A block is "empty" while its media hasn't been uploaded yet, or its text is
// blank. Empty blocks are editing scaffolding — they never reach the config.
function isEmpty(b: JpBlock): boolean {
  return b.type === "text" ? !b.text.trim() : !b.url;
}
function clean(blocks: JpBlock[]): JpBlock[] {
  return blocks
    .filter(b => !isEmpty(b))
    .map(b => (b.type === "text" ? { ...b, text: b.text.trim() } : b));
}

const BLOCK_LABEL: Record<JpBlock["type"], string> = {
  text:  "📝 Text",
  image: "🖼 Image",
  audio: "🎵 Audio",
  video: "🎬 Video",
};

/**
 * Ordered block list for one side of a tile. Blocks render on the big screen
 * in this order, so ↑/↓ is the layout control — buttons rather than drag,
 * because the host builds games on a phone as often as a laptop.
 */
function BlockListEditor({
  gameId, tileKey, side, blocks, setBlocks, allowRevealMode,
}: {
  gameId:   string;
  tileKey:  string;
  side:     Side;
  blocks:   JpBlock[];
  setBlocks: React.Dispatch<React.SetStateAction<JpBlock[]>>;
  /** Question side only: images can be silhouetted/blurred until reveal. */
  allowRevealMode: boolean;
}) {
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [error,       setError]       = useState<string | null>(null);
  const fileRef    = useRef<HTMLInputElement>(null);
  const pendingRef = useRef<string | null>(null);

  const patchAt  = (id: string, patch: Partial<JpBlock>) =>
    setBlocks(bs => bs.map(b => (b.id === id ? { ...b, ...patch } as JpBlock : b)));
  const removeId = (id: string) => setBlocks(bs => bs.filter(b => b.id !== id));
  const move     = (i: number, dir: -1 | 1) =>
    setBlocks(bs => {
      const j = i + dir;
      if (j < 0 || j >= bs.length) return bs;
      const next = [...bs];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const pickImage = (id: string) => { pendingRef.current = id; fileRef.current?.click(); };

  const uploadImage = async (file: File) => {
    const id = pendingRef.current;
    if (!id) return;
    setUploadingId(id);
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
      patchAt(id, { url: body.url } as Partial<JpImageBlock>);
    } catch {
      setError("Upload failed");
    } finally {
      setUploadingId(null);
      pendingRef.current = null;
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {blocks.map((b, i) => (
        <div key={b.id} className="flex flex-col gap-2 rounded-md p-2"
          style={{ border: "1px solid rgb(var(--border-rgb))" }}>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-widest" style={labelStyle}>
              {BLOCK_LABEL[b.type]}
            </span>
            {blocks.length > 1 && (
              <span className="text-xs" style={labelStyle}>#{i + 1}</span>
            )}
            <div className="ml-auto flex gap-1">
              <Button variant="ghost" size="sm" disabled={i === 0} onClick={() => move(i, -1)}>↑</Button>
              <Button variant="ghost" size="sm" disabled={i === blocks.length - 1} onClick={() => move(i, 1)}>↓</Button>
              <Button variant="danger" size="sm" onClick={() => removeId(b.id)}>✕</Button>
            </div>
          </div>

          {b.type === "text" && (
            <textarea value={b.text} rows={3} placeholder="Text…"
              onChange={e => patchAt(b.id, { text: e.target.value })}
              className="w-full px-4 py-2.5 rounded-md font-sans text-base outline-none" style={inputStyle} />
          )}

          {b.type === "image" && (
            b.url ? (
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-3">
                  <img src={b.url} alt="" className="h-16 rounded-md object-cover" />
                  <Button variant="ghost" size="sm" loading={uploadingId === b.id}
                    onClick={() => pickImage(b.id)}>Replace</Button>
                </div>
                {allowRevealMode && (
                  <div>
                    <p className="text-sm font-medium mb-2" style={labelStyle}>Image reveal</p>
                    <Toggle
                      options={[
                        { value: "off",        label: "Normal" },
                        { value: "silhouette", label: "Silhouette" },
                        { value: "pixelated",  label: "Blurred" },
                        { value: "animated",   label: "Slow sharpen" },
                      ]}
                      value={b.revealMode ?? "off"}
                      onChange={v => patchAt(b.id, { revealMode: v as JpRevealMode } as Partial<JpImageBlock>)}
                    />
                  </div>
                )}
              </div>
            ) : (
              <Button variant="ghost" size="sm" loading={uploadingId === b.id}
                onClick={() => pickImage(b.id)}>Upload image</Button>
            )
          )}

          {(b.type === "audio" || b.type === "video") && (
            <MediaBlockEditor gameId={gameId} blockId={b.id}
              block={b.url ? b as JpMediaBlock : null}
              onChange={nb => (nb ? patchAt(b.id, nb) : removeId(b.id))} />
          )}
        </div>
      ))}

      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" size="sm"
          onClick={() => setBlocks(bs => [...bs, { id: newBlockId(tileKey, side), type: "text", text: "" }])}>
          + Text
        </Button>
        <Button variant="ghost" size="sm"
          onClick={() => setBlocks(bs => [...bs, { id: newBlockId(tileKey, side), type: "image", url: "" }])}>
          + Image
        </Button>
        <Button variant="ghost" size="sm"
          onClick={() => setBlocks(bs => [...bs, { id: newBlockId(tileKey, side), type: "audio", url: "" }])}>
          + Audio / video
        </Button>
      </div>

      {/* Media blocks all start together when the side is revealed — two clips
          means two clips at once, which is almost never what you want. */}
      {blocks.filter(b => (b.type === "audio" || b.type === "video") && b.url).length > 1 && (
        <p className="text-xs" style={{ color: "rgb(var(--color-danger-rgb))" }}>
          ⚠ More than one clip on this side — they'll all play at the same time.
        </p>
      )}

      <input ref={fileRef} type="file" accept="image/*" className="hidden"
        onChange={e => e.target.files?.[0] && uploadImage(e.target.files[0])} />
      {error && <p className="text-sm" style={{ color: "rgb(var(--color-danger-rgb))" }}>{error}</p>}
    </div>
  );
}

export default function TileEditorModal({
  gameId, tileKey, title, tile, onSave, onClose, simple = false,
  category, categoryDesc, value,
}: TileEditorModalProps) {
  const [qBlocks, setQBlocks] = useState<JpBlock[]>(() => tile?.questionBlocks ?? []);
  const [aBlocks, setABlocks] = useState<JpBlock[]>(() => tile?.answerBlocks ?? []);

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

  const [error, setError] = useState<string | null>(null);

  // Preview-as-player: the real big-screen renderer, driven by the draft.
  const [preview,      setPreview]      = useState(false);
  const [pvSide,       setPvSide]       = useState<Side>("q");
  const [pvStage,      setPvStage]      = useState(0);
  const [pvBuzzed,     setPvBuzzed]     = useState(false);
  const [pvNonce,      setPvNonce]      = useState(0);

  const cleanQ = clean(qBlocks);
  const cleanA = clean(aBlocks);
  const hasQuestion = cleanQ.length > 0;
  const qHasVisual  = cleanQ.some(b => b.type !== "text");

  const clearTile = () => {
    if (window.confirm("Clear this tile and remove the question?")) onSave(null);
  };

  const handleClose = () => {
    const hasEdits = hasQuestion || cleanA.length > 0 || mode !== "standard";
    if (hasEdits && !window.confirm("Discard unsaved changes?")) return;
    onClose();
  };

  const save = () => {
    if (!hasQuestion) {
      setError("Add at least a question text or media before saving."); return;
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

    const questionBlocks = cleanQ;
    const answerBlocks   = [...cleanA];

    // A question image with a visual effect (silhouette/blur/sharpen) is useless
    // to the host unless the plain version shows at reveal — add it once, on save.
    if (!answerBlocks.some(b => b.type === "image")) {
      for (const b of questionBlocks) {
        if (b.type === "image" && (b.revealMode ?? "off") !== "off") {
          answerBlocks.push({ ...b, id: `${b.id}-reveal`, revealMode: "off" });
        }
      }
    }

    const out: JpTileConfig = { questionBlocks, answerBlocks, answerMode: mode };
    if (display !== "default") out.buzzDisplayMode = display;
    if (order !== "together" && qHasVisual) out.revealOrder = order;
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

  const mediaLabel = (() => {
    const m = cleanQ.find(b => b.type === "audio" || b.type === "video");
    if (m) return m.type === "video" ? "video" : "audio";
    return "image";
  })();

  return (
    <Modal open onClose={handleClose} maxWidth="560px">
      <div className="flex flex-col gap-4">
        <h3 className="text-lg font-bold">{title}</h3>

        {/* ── Question side ─────────────────────────────────────────── */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <p className="text-sm font-medium" style={labelStyle}>Question</p>
            <span className="text-xs" style={labelStyle}>
              — shown on the big screen in this order
            </span>
          </div>
          <BlockListEditor gameId={gameId} tileKey={tileKey} side="q"
            blocks={qBlocks} setBlocks={setQBlocks} allowRevealMode />
        </div>

        {qHasVisual && (
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
            {order !== "together" && (
              <p className="text-xs mt-1" style={labelStyle}>
                {order === "textFirst"
                  ? `All text shows first; your host controller gets a "Reveal ${mediaLabel} & open buzzers" button.`
                  : `Images and clips show first; your host controller gets a "📝 Reveal text & open buzzers" button.`}
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
          <p className="text-sm font-medium mb-2" style={labelStyle}>Answer (revealed after the question)</p>
          <BlockListEditor gameId={gameId} tileKey={tileKey} side="a"
            blocks={aBlocks} setBlocks={setABlocks} allowRevealMode={false} />
        </div>

        {error && <p className="text-sm" style={{ color: "rgb(var(--color-danger-rgb))" }}>{error}</p>}

        <div className="flex flex-wrap justify-between gap-2">
          {tile && (
            <Button variant="danger" onClick={clearTile}>Clear tile</Button>
          )}
          <div className="flex gap-2 ml-auto">
            <Button variant="ghost" disabled={!hasQuestion}
              onClick={() => { setPvSide("q"); setPvStage(0); setPvBuzzed(false); setPreview(true); }}>
              👁 Preview
            </Button>
            <Button variant="ghost" onClick={handleClose}>Cancel</Button>
            <Button onClick={save}>Save tile</Button>
          </div>
        </div>
      </div>

      {/* ── Preview-as-player ──────────────────────────────────────────
          The actual big-screen component, so what you see here is what the
          room sees — including staged reveal and the on-buzz display mode. */}
      {preview && (
        <Modal open onClose={() => setPreview(false)} maxWidth="900px">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-bold">Big screen preview</h3>
              <div className="ml-auto flex flex-wrap gap-2">
                <Toggle
                  options={[
                    { value: "q", label: "Question" },
                    { value: "a", label: "Answer" },
                  ]}
                  value={pvSide}
                  onChange={v => setPvSide(v as Side)}
                />
              </div>
            </div>

            <div className="relative w-full rounded-xl overflow-hidden"
              style={{ height: "min(60vh, 460px)", background: "rgb(var(--bg-rgb))", border: "1px solid rgb(var(--border-rgb))" }}>
              <QuestionOverlay
                category={category ?? "Category"}
                categoryDesc={categoryDesc}
                value={value ?? 0}
                blocks={pvSide === "q" ? cleanQ : cleanA}
                questionRevealed
                displayMode={display === "default" ? "stay" : display}
                buzzed={pvSide === "q" && pvBuzzed}
                mediaNonce={pvNonce}
                soundOn
                revealOrder={pvSide === "q" ? order : "together"}
                revealStage={pvSide === "q" ? pvStage : 1}
              />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {pvSide === "q" && order !== "together" && (
                <Toggle
                  options={[
                    { value: "0", label: "Before reveal" },
                    { value: "1", label: "After reveal" },
                  ]}
                  value={String(pvStage)}
                  onChange={v => setPvStage(Number(v))}
                />
              )}
              {pvSide === "q" && mode === "standard" && (
                <label className="flex items-center gap-2 text-sm" style={labelStyle}>
                  <input type="checkbox" checked={pvBuzzed} className="accent-current"
                    onChange={e => setPvBuzzed(e.target.checked)} />
                  Someone buzzed in
                </label>
              )}
              <Button variant="ghost" size="sm" onClick={() => setPvNonce(n => n + 1)}>↻ Replay media</Button>
              <Button className="ml-auto" onClick={() => setPreview(false)}>Done</Button>
            </div>
          </div>
        </Modal>
      )}
    </Modal>
  );
}
