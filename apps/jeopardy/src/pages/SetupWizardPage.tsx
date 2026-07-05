import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button, Input, Panel, useToast } from "@gokkehub/ui";
import { useSession } from "../hooks/useSession";
import { storePlayerId } from "../hooks/useRoom";
import { supabase } from "../lib/supabase";
import TileEditorModal from "../components/TileEditorModal";
import type {
  JpBoardConfig, JpBuzzDisplayMode, JpGame, JpGameConfig, JpPowerupType,
  JpTileConfig, LaunchGameResponse,
} from "../lib/types";
import { DEFAULT_JP_CONFIG, POWERUP_META } from "../lib/types";

const inputStyle = {
  background: "rgb(var(--surface-input-rgb))",
  border:     "1px solid rgb(var(--border-rgb))",
  color:      "rgb(var(--text-primary-rgb))",
} as const;
const labelStyle = { color: "rgb(var(--text-secondary-rgb))" } as const;

export default function SetupWizardPage() {
  const navigate     = useNavigate();
  const { gameId }   = useParams();
  const { session }  = useSession();
  const { addToast } = useToast();

  const [game,     setGame]     = useState<JpGame | null>(null);
  const [title,    setTitle]    = useState("");
  const [config,   setConfig]   = useState<JpGameConfig | null>(null);
  const [boardIdx, setBoardIdx] = useState(0);
  const [dirty,    setDirty]    = useState(false);
  const [busy,     setBusy]     = useState(false);
  const [loadErr,  setLoadErr]  = useState<string | null>(null);
  const [editKey,  setEditKey]  = useState<string | null>(null);

  useEffect(() => {
    if (!gameId) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.from("jp_games").select("*").eq("id", gameId).maybeSingle();
      if (cancelled) return;
      if (error || !data) { setLoadErr("Game not found."); return; }
      const g = data as JpGame;
      setGame(g);
      setTitle(g.title);
      // Backfill config sections added after the game was created.
      setConfig({ ...DEFAULT_JP_CONFIG, ...g.config });
    })();
    return () => { cancelled = true; };
  }, [gameId]);

  const board2Mode = config?.board2Mode ?? "off";
  const editingBoard2 = boardIdx === 1 && board2Mode === "custom";
  const board = editingBoard2 ? config?.boards[1] : config?.boards[0];

  const patch = (updates: Partial<JpGameConfig>) => {
    if (!config) return;
    setConfig({ ...config, ...updates });
    setDirty(true);
  };

  const patchBoard = (bp: Partial<JpBoardConfig>) => {
    if (!config || !board) return;
    const boards = [...config.boards];
    boards[editingBoard2 ? 1 : 0] = { ...board, ...bp };
    patch({ boards });
  };

  const setBoard2Mode = (mode: JpGameConfig["board2Mode"]) => {
    if (!config) return;
    const boards = [...config.boards];
    if (mode === "custom" && !boards[1]) {
      const b0 = boards[0];
      boards[1] = { categories: [...b0.categories], rows: b0.rows, pointValues: [...b0.pointValues], tiles: {} };
    }
    if (mode !== "custom") setBoardIdx(0);
    patch({ board2Mode: mode, boards });
  };

  const saveTile = (tile: JpTileConfig | null) => {
    if (!board || !editKey) return;
    const tiles = { ...board.tiles };
    if (tile) tiles[editKey] = tile; else delete tiles[editKey];
    patchBoard({ tiles });
    setEditKey(null);
  };

  const save = async (): Promise<boolean> => {
    if (!gameId || !config) return false;
    setBusy(true);
    const res = await fetch(`/game/${gameId}/update`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body:    JSON.stringify({ title, config }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => null) as { error?: string } | null;
      addToast(body?.error ?? "Save failed");
      return false;
    }
    setDirty(false);
    addToast("Saved");
    return true;
  };

  const launch = async () => {
    if (dirty && !(await save())) return;
    if (!gameId) return;
    setBusy(true);
    const res  = await fetch(`/game/${gameId}/launch`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body:    JSON.stringify({ host_name: session?.displayName ?? "Host" }),
    });
    const body = await res.json().catch(() => null) as (LaunchGameResponse & { error?: string }) | null;
    setBusy(false);
    if (!res.ok || !body?.room_id) {
      addToast(body?.error ?? "Launch failed");
      return;
    }
    storePlayerId(body.room_id, body.player_id);
    navigate(`/lobby/${body.room_id}`);
  };

  if (loadErr) return <div className="flex-1 flex items-center justify-center">{loadErr}</div>;
  if (!game || !config || !board) {
    return <div className="flex-1 flex items-center justify-center opacity-60">Loading…</div>;
  }

  const filledCount = Object.keys(config.boards[0].tiles).length;
  const teamsCfg    = config.teams ?? DEFAULT_JP_CONFIG.teams!;
  const powerups    = config.powerups ?? DEFAULT_JP_CONFIG.powerups!;
  const dangerous   = config.dangerous ?? DEFAULT_JP_CONFIG.dangerous!;
  const final       = config.finalJeopardy ?? DEFAULT_JP_CONFIG.finalJeopardy!;

  const rowRangeEditor = (
    range: [number, number], maxRows: number, onChange: (r: [number, number]) => void
  ) => (
    <span className="flex items-center gap-1 text-sm" style={labelStyle}>
      rows
      <input type="number" min={1} max={maxRows} value={range[0] + 1}
        onChange={e => onChange([Math.max(0, Number(e.target.value) - 1), range[1]])}
        className="w-14 px-2 py-1 rounded-md text-sm outline-none" style={inputStyle} />
      –
      <input type="number" min={1} max={maxRows} value={range[1] + 1}
        onChange={e => onChange([range[0], Math.max(0, Number(e.target.value) - 1)])}
        className="w-14 px-2 py-1 rounded-md text-sm outline-none" style={inputStyle} />
    </span>
  );

  return (
    <div className="flex-1 w-full max-w-4xl mx-auto p-4 sm:p-6 flex flex-col gap-5">
      <Panel>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-52">
            <Input label="Game title" value={title}
              onChange={e => { setTitle(e.target.value); setDirty(true); }} />
          </div>
          <Button variant="ghost" onClick={save} loading={busy} disabled={!dirty}>
            {dirty ? "Save" : "Saved"}
          </Button>
          <Button onClick={launch} loading={busy} disabled={filledCount === 0}>
            Launch game
          </Button>
        </div>
        <p className="mt-2 text-xs" style={labelStyle}>
          {filledCount} tiles with questions on board 1
          {board2Mode === "custom" ? `, ${Object.keys(config.boards[1]?.tiles ?? {}).length} on board 2` : ""}.
        </p>
      </Panel>

      {/* ── Teams ──────────────────────────────────────────────────────── */}
      <Panel>
        <h2 className="text-lg font-bold mb-1">Teams</h2>
        <div className="flex flex-wrap items-center gap-4 mt-3">
          <label className="flex items-center gap-2 text-sm font-semibold" style={labelStyle}>
            Mode
            <select value={teamsCfg.mode}
              onChange={e => patch({ teams: { ...teamsCfg, mode: e.target.value as "solo" | "teams" } })}
              className="px-3 py-2 rounded-md text-sm outline-none" style={inputStyle}>
              <option value="solo">Solo — everyone plays for themselves</option>
              <option value="teams">Teams</option>
            </select>
          </label>
          {teamsCfg.mode === "teams" && (
            <>
              <label className="flex items-center gap-2 text-sm font-semibold" style={labelStyle}>
                Teams
                <input type="number" min={2} max={8} value={teamsCfg.count}
                  onChange={e => patch({ teams: { ...teamsCfg, count: Math.min(8, Math.max(2, Number(e.target.value) || 2)) } })}
                  className="w-16 px-2 py-1.5 rounded-md text-sm outline-none" style={inputStyle} />
              </label>
              <label className="flex items-center gap-2 text-sm font-semibold" style={labelStyle}>
                Buzzing
                <select value={teamsCfg.buzzerMode}
                  onChange={e => patch({ teams: { ...teamsCfg, buzzerMode: e.target.value as "anyone" | "captain" } })}
                  className="px-3 py-2 rounded-md text-sm outline-none" style={inputStyle}>
                  <option value="anyone">Anyone on the team</option>
                  <option value="captain">Captain only</option>
                </select>
              </label>
            </>
          )}
        </div>
        {teamsCfg.mode === "teams" && (
          <>
            {teamsCfg.count > 4 && (
              <p className="text-sm mt-2" style={{ color: "rgb(var(--color-danger-rgb))" }}>
                More than 4 teams gets chaotic — recommended max is 4.
              </p>
            )}
            <p className="text-xs mt-2" style={labelStyle}>
              Multiple choice, closest number, ranking, and Final Jeopardy are always answered on the
              captain's phone — the team gathers around it.
            </p>
          </>
        )}
      </Panel>

      {/* ── Boards ─────────────────────────────────────────────────────── */}
      <Panel>
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <h2 className="text-lg font-bold flex-1">Board setup</h2>
          <select value={board2Mode} onChange={e => setBoard2Mode(e.target.value as JpGameConfig["board2Mode"])}
            className="px-3 py-2 rounded-md text-sm outline-none" style={inputStyle}>
            <option value="off">Single board</option>
            <option value="doubleUp">Board 2 = double-up (same questions, 2× points)</option>
            <option value="custom">Board 2 = custom (own questions)</option>
          </select>
        </div>

        {board2Mode === "custom" && (
          <div className="flex gap-2 mb-4">
            {[0, 1].map(i => (
              <button key={i} type="button" onClick={() => setBoardIdx(i)}
                className="px-4 py-1.5 rounded-md font-bold text-sm"
                style={{
                  background: boardIdx === i ? "rgba(var(--color-primary-rgb), 0.18)" : "transparent",
                  border: boardIdx === i
                    ? "1px solid rgb(var(--color-primary-rgb))"
                    : "1px solid rgb(var(--border-rgb))",
                  color: boardIdx === i ? "rgb(var(--color-primary-rgb))" : "rgb(var(--text-secondary-rgb))",
                }}>
                Board {i + 1}
              </button>
            ))}
          </div>
        )}

        <h3 className="text-sm font-bold uppercase tracking-widest mb-2" style={labelStyle}>Categories</h3>
        <div className="flex flex-col gap-2">
          {board.categories.map((cat, i) => (
            <div key={i} className="flex gap-2 items-center">
              <div className="flex-1">
                <Input value={cat} onChange={e => {
                  const categories = [...board.categories];
                  categories[i] = e.target.value;
                  patchBoard({ categories });
                }} />
              </div>
              <Button variant="danger" size="sm" disabled={board.categories.length <= 1}
                onClick={() => {
                  const tiles: typeof board.tiles = {};
                  for (const [key, tile] of Object.entries(board.tiles)) {
                    const [col, row] = key.split("-").map(Number);
                    if (col === i) continue;
                    tiles[`${col > i ? col - 1 : col}-${row}`] = tile;
                  }
                  patchBoard({ categories: board.categories.filter((_, c) => c !== i), tiles });
                }}>
                ✕
              </Button>
            </div>
          ))}
          <Button variant="ghost" size="sm" disabled={board.categories.length >= 8}
            onClick={() => patchBoard({ categories: [...board.categories, `Category ${board.categories.length + 1}`] })}>
            + Add category
          </Button>
        </div>

        <h3 className="text-sm font-bold uppercase tracking-widest mt-6 mb-2" style={labelStyle}>Rows & point values</h3>
        <div className="flex flex-col gap-2">
          {board.pointValues.map((v, row) => (
            <div key={row} className="flex gap-2 items-center">
              <span className="w-14 text-sm" style={labelStyle}>Row {row + 1}</span>
              <Input type="number" value={v} className="max-w-32" onChange={e => {
                const pointValues = [...board.pointValues];
                pointValues[row] = Number(e.target.value) || 0;
                patchBoard({ pointValues });
              }} />
              <Button variant="danger" size="sm" disabled={board.rows <= 1}
                onClick={() => {
                  const tiles: typeof board.tiles = {};
                  for (const [key, tile] of Object.entries(board.tiles)) {
                    const [col, r] = key.split("-").map(Number);
                    if (r === row) continue;
                    tiles[`${col}-${r > row ? r - 1 : r}`] = tile;
                  }
                  patchBoard({
                    rows:        board.rows - 1,
                    pointValues: board.pointValues.filter((_, r) => r !== row),
                    tiles,
                  });
                }}>
                ✕
              </Button>
            </div>
          ))}
          <Button variant="ghost" size="sm" disabled={board.rows >= 8}
            onClick={() => patchBoard({
              rows:        board.rows + 1,
              pointValues: [...board.pointValues, (board.pointValues[board.pointValues.length - 1] ?? 100) + 100],
            })}>
            + Add row
          </Button>
        </div>

        <h3 className="text-sm font-bold uppercase tracking-widest mt-6 mb-2" style={labelStyle}>
          Questions {board2Mode === "custom" ? `— board ${boardIdx + 1}` : ""}
        </h3>
        <p className="text-sm mb-3" style={labelStyle}>Click a tile to edit its question, answer, images, and answer mode.</p>
        <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${board.categories.length}, minmax(0, 1fr))` }}>
          {board.categories.map((cat, col) => (
            <div key={`h-${col}`} className="text-[10px] sm:text-xs font-bold text-center uppercase truncate py-1">
              {cat}
            </div>
          ))}
          {Array.from({ length: board.rows }, (_, row) =>
            board.categories.map((_, col) => {
              const key    = `${col}-${row}`;
              const tile   = board.tiles[key];
              const badge  = tile && tile.answerMode !== "standard"
                ? { multipleChoice: "abc", closestNumber: "123", ranking: "1→8" }[tile.answerMode]
                : tile?.questionBlocks.some(b => b.type === "video") ? "🎬"
                : tile?.questionBlocks.some(b => b.type === "audio") ? "🎵"
                : tile?.questionBlocks.some(b => b.type === "image") ? "🖼" : null;
              return (
                <button key={key} type="button" onClick={() => setEditKey(key)}
                  className="relative rounded-md py-3 font-bold text-sm sm:text-base transition-colors"
                  style={{
                    background: tile ? "rgba(var(--color-primary-rgb), 0.18)" : "rgb(var(--surface-input-rgb))",
                    border: tile
                      ? "1px solid rgba(var(--color-primary-rgb), 0.6)"
                      : "1px dashed rgb(var(--border-rgb))",
                    color: tile ? "rgb(var(--color-primary-rgb))" : "rgba(var(--text-secondary-rgb), 0.6)",
                  }}>
                  {board.pointValues[row]}
                  {badge && (
                    <span className="absolute top-0.5 right-1 text-[9px] opacity-80">{badge}</span>
                  )}
                </button>
              );
            })
          )}
        </div>

        <div className="flex flex-wrap gap-5 mt-5">
          <label className="flex items-center gap-2 text-sm font-semibold" style={labelStyle}>
            Default on-buzz display
            <select value={config.buzzer.defaultBuzzDisplayMode}
              onChange={e => patch({ buzzer: { ...config.buzzer, defaultBuzzDisplayMode: e.target.value as JpBuzzDisplayMode } })}
              className="px-3 py-2 rounded-md text-sm outline-none" style={inputStyle}>
              <option value="stay">Stay visible</option>
              <option value="disappear">Disappear on buzz</option>
              <option value="typewriter">Typewriter (freezes on buzz)</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm font-semibold" style={labelStyle}>
            After a wrong answer
            <select value={config.buzzer.queueMode}
              onChange={e => patch({ buzzer: { ...config.buzzer, queueMode: e.target.value as JpGameConfig["buzzer"]["queueMode"] } })}
              className="px-3 py-2 rounded-md text-sm outline-none" style={inputStyle}>
              <option value="rebuzz">Must Re-Buzz — everyone competes fresh</option>
              <option value="lockIn">Queue Lock-In — next in queue is called</option>
            </select>
          </label>
        </div>
      </Panel>

      {/* ── Power-ups & dangerous tiles ────────────────────────────────── */}
      <Panel>
        <h2 className="text-lg font-bold mb-1">Special tiles</h2>
        <p className="text-sm mb-4" style={labelStyle}>
          Hidden on random filled tiles at launch — completely invisible until someone answers them.
          Answer a power-up tile correctly and you choose: take the points, or claim the power-up.
        </p>
        <div className="flex flex-col gap-3">
          {(Object.keys(POWERUP_META) as JpPowerupType[]).map(type => {
            const meta = POWERUP_META[type];
            const cfg  = powerups[type];
            return (
              <div key={type} className="flex flex-wrap items-center gap-3 rounded-md px-3 py-2"
                style={{ border: "1px solid rgb(var(--border-rgb))" }}>
                <label className="flex items-center gap-2 font-semibold min-w-44">
                  <input type="checkbox" checked={cfg.enabled} className="accent-current"
                    onChange={e => patch({ powerups: { ...powerups, [type]: { ...cfg, enabled: e.target.checked } } })} />
                  {meta.icon} {meta.name}
                </label>
                <span className="text-xs flex-1 min-w-40" style={labelStyle}>{meta.desc}</span>
                {cfg.enabled && (
                  <>
                    {type === "sniper" && (
                      <span className="flex items-center gap-1 text-sm" style={labelStyle}>
                        <input type="number" step={50} value={cfg.advantageMs ?? 200}
                          onChange={e => patch({ powerups: { ...powerups, sniper: { ...cfg, advantageMs: Number(e.target.value) || 0 } } })}
                          className="w-20 px-2 py-1 rounded-md text-sm outline-none" style={inputStyle} />
                        ms head-start
                      </span>
                    )}
                    {type === "buffer" && (
                      <span className="flex items-center gap-1 text-sm" style={labelStyle}>
                        <input type="number" step={50} value={cfg.reductionAmount ?? 100}
                          onChange={e => patch({ powerups: { ...powerups, buffer: { ...cfg, reductionAmount: Number(e.target.value) || 0 } } })}
                          className="w-20 px-2 py-1 rounded-md text-sm outline-none" style={inputStyle} />
                        pts less loss
                      </span>
                    )}
                    {rowRangeEditor(cfg.rowRange, board.rows, r =>
                      patch({ powerups: { ...powerups, [type]: { ...cfg, rowRange: r } } }))}
                  </>
                )}
              </div>
            );
          })}

          <div className="flex flex-wrap items-center gap-3 rounded-md px-3 py-2"
            style={{ border: "1px solid rgba(var(--color-danger-rgb), 0.4)" }}>
            <label className="flex items-center gap-2 font-semibold min-w-44">
              <input type="checkbox" checked={dangerous.buzzed.enabled} className="accent-current"
                onChange={e => patch({ dangerous: { buzzed: { ...dangerous.buzzed, enabled: e.target.checked } } })} />
              💥 Buzzed
            </label>
            <span className="text-xs flex-1 min-w-40" style={labelStyle}>
              Whoever picks this tile is instantly buzzed in and must answer
            </span>
            {dangerous.buzzed.enabled && (
              <>
                <span className="flex items-center gap-1 text-sm" style={labelStyle}>
                  <input type="number" min={1} max={5} value={dangerous.buzzed.count}
                    onChange={e => patch({ dangerous: { buzzed: { ...dangerous.buzzed, count: Math.max(1, Number(e.target.value) || 1) } } })}
                    className="w-14 px-2 py-1 rounded-md text-sm outline-none" style={inputStyle} />
                  per board
                </span>
                {rowRangeEditor(dangerous.buzzed.rowRange, board.rows, r =>
                  patch({ dangerous: { buzzed: { ...dangerous.buzzed, rowRange: r } } }))}
              </>
            )}
          </div>

          {board2Mode !== "off" && (
            <label className="flex items-center gap-2 text-sm font-semibold" style={labelStyle}>
              Power-ups between boards
              <select value={config.powerupCarryover ?? "persist"}
                onChange={e => patch({ powerupCarryover: e.target.value as "persist" | "reset" })}
                className="px-3 py-2 rounded-md text-sm outline-none" style={inputStyle}>
                <option value="persist">Carry over to board 2</option>
                <option value="reset">Reset — earn fresh ones</option>
              </select>
            </label>
          )}
        </div>
      </Panel>

      {/* ── Final Jeopardy ─────────────────────────────────────────────── */}
      <Panel>
        <label className="flex items-center gap-2 text-lg font-bold">
          <input type="checkbox" checked={final.enabled} className="accent-current"
            onChange={e => patch({ finalJeopardy: { ...final, enabled: e.target.checked } })} />
          Final Jeopardy
        </label>
        <p className="text-sm mt-1" style={labelStyle}>
          Everyone wagers points on one last question, answers on their phone, and you judge each answer.
        </p>
        {final.enabled && (
          <div className="flex flex-col gap-3 mt-4">
            <Input label="Category (shown before wagering)" value={final.category}
              onChange={e => patch({ finalJeopardy: { ...final, category: e.target.value } })} />
            <label className="flex flex-col gap-2 text-sm font-semibold" style={labelStyle}>
              Question
              <textarea rows={3}
                value={final.questionBlocks.find(b => b.type === "text")?.text ?? ""}
                onChange={e => patch({
                  finalJeopardy: {
                    ...final,
                    questionBlocks: e.target.value.trim()
                      ? [{ id: "final-q", type: "text", text: e.target.value }]
                      : [],
                  },
                })}
                className="w-full px-4 py-2.5 rounded-md font-sans text-base outline-none" style={inputStyle} />
            </label>
            <label className="flex flex-col gap-2 text-sm font-semibold" style={labelStyle}>
              Answer (host only)
              <textarea rows={2}
                value={final.answerBlocks.find(b => b.type === "text")?.text ?? ""}
                onChange={e => patch({
                  finalJeopardy: {
                    ...final,
                    answerBlocks: e.target.value.trim()
                      ? [{ id: "final-a", type: "text", text: e.target.value }]
                      : [],
                  },
                })}
                className="w-full px-4 py-2.5 rounded-md font-sans text-base outline-none" style={inputStyle} />
            </label>
          </div>
        )}
      </Panel>

      {editKey !== null && (
        <TileEditorModal
          gameId={game.id}
          tileKey={editKey}
          title={`${board.categories[Number(editKey.split("-")[0])]} — ${board.pointValues[Number(editKey.split("-")[1])]}`}
          tile={board.tiles[editKey]}
          onSave={saveTile}
          onClose={() => setEditKey(null)}
        />
      )}
    </div>
  );
}
