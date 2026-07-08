import { useEffect, useState, type ReactNode } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Button, Input, Panel, Toggle, useToast } from "@gokkehub/ui";
import { useSession } from "../hooks/useSession";
import { storePlayerId } from "../hooks/useRoom";
import { supabase } from "../lib/supabase";
import TileEditorModal from "../components/TileEditorModal";
import type {
  JpBoardConfig, JpBuzzDisplayMode, JpCollaborator, JpGame, JpGameConfig,
  JpPowerupType, JpTileConfig, LaunchGameResponse, CollabPermissions,
} from "../lib/types";
import { DEFAULT_JP_CONFIG, POWERUP_META } from "../lib/types";

const inputStyle = {
  background: "rgb(var(--surface-input-rgb))",
  border:     "1px solid rgb(var(--border-rgb))",
  color:      "rgb(var(--text-primary-rgb))",
} as const;
const labelStyle = { color: "rgb(var(--text-secondary-rgb))" } as const;

export default function SetupWizardPage() {
  const navigate          = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { gameId }        = useParams();
  const { session }       = useSession();
  const { addToast }      = useToast();

  const [game,          setGame]          = useState<JpGame | null>(null);
  const [title,         setTitle]         = useState("");
  const [config,        setConfig]        = useState<JpGameConfig | null>(null);
  const [dirty,         setDirty]         = useState(false);
  const [busy,          setBusy]          = useState(false);
  const [loadErr,       setLoadErr]       = useState<string | null>(null);
  const [editTile,      setEditTile]      = useState<{ boardIdx: number; key: string } | null>(null);
  const [finalEdit,     setFinalEdit]     = useState(false);
  // Collaborators
  const [collabs,       setCollabs]       = useState<JpCollaborator[]>([]);
  const [invitePerms,   setInvitePerms]   = useState<CollabPermissions>({ editQuestions: true, editSettings: false });
  const [inviteUrl,     setInviteUrl]     = useState<string | null>(null);
  const [collabBusy,    setCollabBusy]    = useState(false);
  const [inviteBusy,    setInviteBusy]    = useState(false);
  const [editingCollab, setEditingCollab] = useState<string | null>(null); // userId being edited

  // Warn before navigating away with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const inviteToken = searchParams.get("invite");

  const acceptInvite = async () => {
    if (!gameId || !inviteToken) return;
    setCollabBusy(true);
    const res = await fetch(`/game/${gameId}/accept-invite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ token: inviteToken }),
    });
    setCollabBusy(false);
    const body = await res.json().catch(() => null) as { error?: string; gameId?: string } | null;
    if (!res.ok) { addToast(body?.error ?? "Failed to accept invite"); return; }
    setSearchParams({}, { replace: true });
    addToast("You've been added as a collaborator!");
  };

  const generateInvite = async () => {
    if (!gameId) return;
    setInviteBusy(true);
    const res = await fetch(`/game/${gameId}/collaborators`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ permissions: invitePerms }),
    });
    setInviteBusy(false);
    const body = await res.json().catch(() => null) as { inviteUrl?: string; error?: string } | null;
    if (!res.ok || !body?.inviteUrl) { addToast(body?.error ?? "Failed to generate link"); return; }
    setInviteUrl(body.inviteUrl);
  };

  const removeCollab = async (userId: string) => {
    if (!gameId) return;
    const name = collabs.find(c => c.userId === userId)?.userId ?? "this collaborator";
    if (!window.confirm(`Remove ${name} from this game?`)) return;
    const res = await fetch(`/game/${gameId}/collaborators`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ userId }),
    });
    const body = await res.json().catch(() => null) as { collaborators?: JpCollaborator[]; error?: string } | null;
    if (!res.ok) { addToast(body?.error ?? "Failed to remove"); return; }
    setCollabs(body?.collaborators ?? []);
  };

  const updateCollabPerms = async (userId: string, permissions: CollabPermissions) => {
    if (!gameId) return;
    const res = await fetch(`/game/${gameId}/collaborators`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ userId, permissions }),
    });
    const body = await res.json().catch(() => null) as { collaborators?: JpCollaborator[]; error?: string } | null;
    if (!res.ok) { addToast(body?.error ?? "Failed to update"); return; }
    setCollabs(body?.collaborators ?? []);
    setEditingCollab(null);
  };

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
      setCollabs(g.collaborators ?? []);
      // Backfill config sections added after the game was created.
      setConfig({ ...DEFAULT_JP_CONFIG, ...g.config });
    })();
    return () => { cancelled = true; };
  }, [gameId]);

  const patch = (updates: Partial<JpGameConfig>) => {
    if (!config) return;
    setConfig({ ...config, ...updates });
    setDirty(true);
  };

  const patchBoard = (idx: number, bp: Partial<JpBoardConfig>) => {
    if (!config) return;
    const boards = [...config.boards];
    boards[idx] = { ...boards[idx], ...bp };
    patch({ boards });
  };

  const setBoard2Mode = (mode: JpGameConfig["board2Mode"]) => {
    if (!config) return;
    const boards = [...config.boards];
    if ((mode === "custom" || mode === "doubleUp") && !boards[1]) {
      const b0 = boards[0];
      // doubleUp pre-populates with doubled point values; questions start empty.
      const pointValues = mode === "doubleUp"
        ? b0.pointValues.map(v => v * 2)
        : [...b0.pointValues];
      boards[1] = { categories: [...b0.categories], rows: b0.rows, pointValues, tiles: {} };
    }
    patch({ board2Mode: mode, boards });
  };

  const saveTile = (tile: JpTileConfig | null) => {
    if (!config || !editTile) return;
    const board = config.boards[editTile.boardIdx];
    if (!board) return;
    const tiles = { ...board.tiles };
    if (tile) tiles[editTile.key] = tile; else delete tiles[editTile.key];
    patchBoard(editTile.boardIdx, { tiles });
    setEditTile(null);
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
    if (final.enabled && !finalQText.trim()) {
      addToast("Final Jeopardy is enabled but has no question — write a question or disable it.");
      return;
    }
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
  if (!game || !config) {
    return <div className="flex-1 flex items-center justify-center opacity-60">Loading…</div>;
  }

  const isOwner    = game.host_id === session?.userId;
  const board2Mode = config.board2Mode ?? "off";
  const filledCount = Object.keys(config.boards[0].tiles).length;
  const teamsCfg    = config.teams ?? DEFAULT_JP_CONFIG.teams!;
  const powerups    = config.powerups ?? DEFAULT_JP_CONFIG.powerups!;
  const dangerous   = config.dangerous ?? DEFAULT_JP_CONFIG.dangerous!;
  const final       = config.finalJeopardy ?? DEFAULT_JP_CONFIG.finalJeopardy!;
  const finalQText  = final.questionBlocks.find(b => b.type === "text")?.text ?? "";

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

  // ── One full board editor (categories + rows + question grid) ────────
  const boardEditor = (idx: number): ReactNode => {
    const board = config.boards[idx];
    if (!board) return null;
    return (
      <>
        <h3 className="text-sm font-bold uppercase tracking-widest mb-2" style={labelStyle}>Categories</h3>
        <div className="flex flex-col gap-2">
          {board.categories.map((cat, i) => (
            <div key={i} className="flex gap-2 items-center">
              <div className="flex-1">
                <Input value={cat} onChange={e => {
                  const categories = [...board.categories];
                  categories[i] = e.target.value;
                  patchBoard(idx, { categories });
                }} />
              </div>
              <Button variant="danger" size="sm" disabled={board.categories.length <= 1}
                onClick={() => {
                  const tilesInCol = Object.keys(board.tiles).filter(k => k.startsWith(`${i}-`)).length;
                  if (tilesInCol > 0 && !window.confirm(
                    `Delete "${board.categories[i]}"? It has ${tilesInCol} question${tilesInCol > 1 ? "s" : ""} that will be removed.`
                  )) return;
                  const tiles: typeof board.tiles = {};
                  for (const [key, tile] of Object.entries(board.tiles)) {
                    const [col, row] = key.split("-").map(Number);
                    if (col === i) continue;
                    tiles[`${col > i ? col - 1 : col}-${row}`] = tile;
                  }
                  patchBoard(idx, { categories: board.categories.filter((_, c) => c !== i), tiles });
                }}>
                ✕
              </Button>
            </div>
          ))}
          <Button variant="ghost" size="sm" disabled={board.categories.length >= 8}
            onClick={() => patchBoard(idx, { categories: [...board.categories, `Category ${board.categories.length + 1}`] })}>
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
                patchBoard(idx, { pointValues });
              }} />
              <Button variant="danger" size="sm" disabled={board.rows <= 1}
                onClick={() => {
                  const tiles: typeof board.tiles = {};
                  for (const [key, tile] of Object.entries(board.tiles)) {
                    const [col, r] = key.split("-").map(Number);
                    if (r === row) continue;
                    tiles[`${col}-${r > row ? r - 1 : r}`] = tile;
                  }
                  patchBoard(idx, {
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
            onClick={() => patchBoard(idx, {
              rows:        board.rows + 1,
              pointValues: [...board.pointValues, (board.pointValues[board.pointValues.length - 1] ?? 100) + 100],
            })}>
            + Add row
          </Button>
        </div>

        <h3 className="text-sm font-bold uppercase tracking-widest mt-6 mb-2" style={labelStyle}>Questions</h3>
        <p className="text-sm mb-3" style={labelStyle}>Click a tile to edit its question, answer, media, and answer mode.</p>
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
                <button key={key} type="button" onClick={() => setEditTile({ boardIdx: idx, key })}
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
      </>
    );
  };

  const editingBoard = editTile ? config.boards[editTile.boardIdx] : null;

  return (
    <div className="flex-1 w-full max-w-4xl mx-auto p-4 sm:p-6 flex flex-col gap-5">

      {/* ── Invite acceptance banner ────────────────────────────────────── */}
      {inviteToken && !isOwner && (
        <div className="rounded-xl p-4 flex items-center gap-4"
          style={{ background: "rgba(var(--color-primary-rgb),0.12)", border: "1px solid rgba(var(--color-primary-rgb),0.35)" }}>
          <div className="flex-1">
            <p className="font-bold">You've been invited to collaborate on this game.</p>
            <p className="text-sm mt-0.5" style={labelStyle}>Accept to join the editor. The link expires in 24 hours.</p>
          </div>
          <Button loading={collabBusy} onClick={acceptInvite}>Accept invite</Button>
        </div>
      )}

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
        <div className="flex flex-col gap-4 mt-3">
          <Toggle
            options={[
              { value: "solo",  label: "🙋 Solo — everyone for themselves" },
              { value: "teams", label: "👥 Teams" },
            ]}
            value={teamsCfg.mode}
            onChange={v => patch({ teams: { ...teamsCfg, mode: v as "solo" | "teams" } })}
          />
          {teamsCfg.mode === "teams" && (
            <div className="flex flex-wrap items-end gap-4">
              <label className="flex items-center gap-2 text-sm font-semibold" style={labelStyle}>
                Teams
                <input type="number" min={2} max={8} value={teamsCfg.count}
                  onChange={e => patch({ teams: { ...teamsCfg, count: Math.min(8, Math.max(2, Number(e.target.value) || 2)) } })}
                  className="w-16 px-2 py-1.5 rounded-md text-sm outline-none" style={inputStyle} />
              </label>
              <div className="flex-1 min-w-56">
                <p className="text-sm font-medium mb-2" style={labelStyle}>Who can buzz</p>
                <Toggle
                  options={[
                    { value: "anyone",  label: "Anyone on the team" },
                    { value: "captain", label: "⭐ Captain only" },
                  ]}
                  value={teamsCfg.buzzerMode}
                  onChange={v => patch({ teams: { ...teamsCfg, buzzerMode: v as "anyone" | "captain" } })}
                />
              </div>
            </div>
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

      {/* ── Board 1 ────────────────────────────────────────────────────── */}
      <Panel>
        <div className="mb-4">
          <h2 className="text-lg font-bold mb-2">
            {board2Mode === "off" ? "Board" : "Board 1"}
          </h2>
          <Toggle
            options={[
              { value: "off",      label: "Single board" },
              { value: "doubleUp", label: "＋ Double-up board 2 (2× points)" },
              { value: "custom",   label: "＋ Custom board 2" },
            ]}
            value={board2Mode}
            onChange={v => setBoard2Mode(v as JpGameConfig["board2Mode"])}
          />
        </div>
        {boardEditor(0)}

        <div className="flex flex-col gap-4 mt-5">
          <div>
            <p className="text-sm font-medium mb-2" style={labelStyle}>Default on-buzz display</p>
            <Toggle
              options={[
                { value: "stay",       label: "Stay visible" },
                { value: "disappear",  label: "Disappear" },
                { value: "typewriter", label: "⌨ Typewriter" },
              ]}
              value={config.buzzer.defaultBuzzDisplayMode}
              onChange={v => patch({ buzzer: { ...config.buzzer, defaultBuzzDisplayMode: v as JpBuzzDisplayMode } })}
            />
          </div>
          <div>
            <p className="text-sm font-medium mb-2" style={labelStyle}>After a wrong answer</p>
            <Toggle
              options={[
                { value: "rebuzz", label: "🔄 Must Re-Buzz — fresh race" },
                { value: "lockIn", label: "📋 Queue Lock-In — next is called" },
              ]}
              value={config.buzzer.queueMode}
              onChange={v => patch({ buzzer: { ...config.buzzer, queueMode: v as JpGameConfig["buzzer"]["queueMode"] } })}
            />
          </div>
        </div>
      </Panel>

      {/* ── Board 2 ────────────────────────────────────────────────────── */}
      {(board2Mode === "custom" || board2Mode === "doubleUp") && (
        <Panel>
          <h2 className="text-lg font-bold mb-1">
            {board2Mode === "doubleUp" ? "Board 2 — double-up (2× points)" : "Board 2"}
          </h2>
          {board2Mode === "doubleUp" && (
            <p className="text-sm mb-3" style={labelStyle}>
              Pre-filled with board 1's categories and doubled point values. Questions are independent — write harder versions for the second round.
            </p>
          )}
          {boardEditor(1)}
        </Panel>
      )}

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
                    {rowRangeEditor(cfg.rowRange, config.boards[0].rows, r =>
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
                {rowRangeEditor(dangerous.buzzed.rowRange, config.boards[0].rows, r =>
                  patch({ dangerous: { buzzed: { ...dangerous.buzzed, rowRange: r } } }))}
              </>
            )}
          </div>

          {board2Mode !== "off" && (
            <div>
              <p className="text-sm font-medium mb-2" style={labelStyle}>Power-ups between boards</p>
              <Toggle
                options={[
                  { value: "persist", label: "Carry over to board 2" },
                  { value: "reset",   label: "Reset — earn fresh ones" },
                ]}
                value={config.powerupCarryover ?? "persist"}
                onChange={v => patch({ powerupCarryover: v as "persist" | "reset" })}
              />
            </div>
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
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="ghost" onClick={() => setFinalEdit(true)}>
                {final.questionBlocks.length ? "✎ Edit question & answer" : "+ Write the question"}
              </Button>
              {finalQText && (
                <span className="text-sm truncate max-w-md" style={labelStyle}>"{finalQText}"</span>
              )}
              {final.questionBlocks.some(b => b.type === "image") && <span>🖼</span>}
              {final.questionBlocks.some(b => b.type === "audio") && <span>🎵</span>}
              {final.questionBlocks.some(b => b.type === "video") && <span>🎬</span>}
            </div>
          </div>
        )}
      </Panel>

      {/* ── Collaborators (owner only) ──────────────────────────────────── */}
      {isOwner && (
        <Panel>
          <h2 className="text-lg font-bold mb-1">Collaborators</h2>
          <p className="text-sm mb-4" style={labelStyle}>
            Share an invite link so others can help build the game. Each link is single-use and expires after 24 hours.
          </p>

          {/* Current list */}
          {collabs.length > 0 && (
            <div className="flex flex-col gap-3 mb-4">
              {collabs.map(c => (
                <div key={c.userId} className="rounded-lg p-3 flex flex-col gap-2"
                  style={{ background: "rgb(var(--surface-raised-rgb))", border: "1px solid rgb(var(--border-rgb))" }}>
                  <div className="flex items-center gap-3">
                    {c.avatar && <img src={c.avatar} className="w-8 h-8 rounded-full" />}
                    <div className="flex-1">
                      <p className="font-bold text-sm">{c.displayName}</p>
                      <p className="text-xs" style={labelStyle}>
                        {[c.permissions.editQuestions && "Edit questions", c.permissions.editSettings && "Edit settings"]
                          .filter(Boolean).join(" · ") || "No permissions"}
                      </p>
                    </div>
                    <Button variant="ghost" size="sm"
                      onClick={() => setEditingCollab(editingCollab === c.userId ? null : c.userId)}>
                      {editingCollab === c.userId ? "Cancel" : "Edit"}
                    </Button>
                    <Button variant="danger" size="sm" onClick={() => removeCollab(c.userId)}>Remove</Button>
                  </div>

                  {editingCollab === c.userId && (() => {
                    const cur = collabs.find(x => x.userId === c.userId)!;
                    return (
                      <div className="flex flex-col gap-2 pt-2 border-t" style={{ borderColor: "rgb(var(--border-rgb))" }}>
                        <label className="flex items-center gap-2 text-sm">
                          <input type="checkbox" className="accent-current"
                            checked={cur.permissions.editQuestions}
                            onChange={e => updateCollabPerms(c.userId, { ...cur.permissions, editQuestions: e.target.checked })} />
                          Can edit questions (tiles, images, audio/video)
                        </label>
                        <label className="flex items-center gap-2 text-sm">
                          <input type="checkbox" className="accent-current"
                            checked={cur.permissions.editSettings}
                            onChange={e => updateCollabPerms(c.userId, { ...cur.permissions, editSettings: e.target.checked })} />
                          Can edit game settings (teams, buzzers, powerups, title)
                        </label>
                      </div>
                    );
                  })()}
                </div>
              ))}
            </div>
          )}

          {/* Generate invite */}
          <div className="flex flex-col gap-3 rounded-lg p-3"
            style={{ background: "rgb(var(--surface-raised-rgb))", border: "1px solid rgb(var(--border-rgb))" }}>
            <p className="text-sm font-bold">Generate invite link</p>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="accent-current"
                checked={invitePerms.editQuestions}
                onChange={e => setInvitePerms(p => ({ ...p, editQuestions: e.target.checked }))} />
              Can edit questions
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="accent-current"
                checked={invitePerms.editSettings}
                onChange={e => setInvitePerms(p => ({ ...p, editSettings: e.target.checked }))} />
              Can edit settings
            </label>
            <div className="flex gap-2 items-center flex-wrap">
              <Button size="sm" loading={inviteBusy} onClick={generateInvite}>
                Generate link
              </Button>
              {inviteUrl && (
                <>
                  <code className="text-xs px-2 py-1 rounded flex-1 min-w-0 truncate"
                    title={inviteUrl}
                    style={{ background: "rgb(var(--surface-rgb))", color: "rgb(var(--text-secondary-rgb))" }}>
                    {inviteUrl}
                  </code>
                  <Button size="sm" variant="ghost"
                    onClick={() => { navigator.clipboard.writeText(inviteUrl); addToast("Copied!"); }}>
                    Copy
                  </Button>
                </>
              )}
            </div>
            {inviteUrl && (
              <p className="text-xs" style={labelStyle}>Single-use · expires in 24 hours · share via Discord or any chat</p>
            )}
          </div>
        </Panel>
      )}

      {editTile !== null && editingBoard && (
        <TileEditorModal
          gameId={game.id}
          tileKey={`b${editTile.boardIdx}-${editTile.key}`}
          title={`Board ${editTile.boardIdx + 1}: ${editingBoard.categories[Number(editTile.key.split("-")[0])]} — ${editingBoard.pointValues[Number(editTile.key.split("-")[1])]}`}
          tile={editingBoard.tiles[editTile.key]}
          onSave={saveTile}
          onClose={() => setEditTile(null)}
        />
      )}

      {finalEdit && (
        <TileEditorModal
          simple
          gameId={game.id}
          tileKey="final"
          title="Final Jeopardy question"
          tile={{
            questionBlocks: final.questionBlocks,
            answerBlocks:   final.answerBlocks,
            answerMode:     "standard",
          }}
          onSave={tile => {
            patch({
              finalJeopardy: {
                ...final,
                questionBlocks: tile?.questionBlocks ?? [],
                answerBlocks:   tile?.answerBlocks ?? [],
              },
            });
            setFinalEdit(false);
          }}
          onClose={() => setFinalEdit(false)}
        />
      )}
    </div>
  );
}
