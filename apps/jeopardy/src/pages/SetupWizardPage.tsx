import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button, Input, Modal, Panel, useToast } from "@gokkehub/ui";
import { useSession } from "../hooks/useSession";
import { storePlayerId } from "../hooks/useRoom";
import { supabase } from "../lib/supabase";
import type { JpBoardConfig, JpGame, JpGameConfig, JpTileConfig, LaunchGameResponse } from "../lib/types";

// MVP editor: one page instead of a multi-step wizard. Board shape + point
// values + a click-a-tile question editor with text blocks only. The full
// block-based builder (images, audio, video, reveal modes) replaces the
// tile modal in a later pass.

function textOf(tile: JpTileConfig | undefined, side: "questionBlocks" | "answerBlocks"): string {
  return tile?.[side]?.map(b => b.text).join("\n") ?? "";
}

export default function SetupWizardPage() {
  const navigate     = useNavigate();
  const { gameId }   = useParams();
  const { session }  = useSession();
  const { addToast } = useToast();

  const [game,    setGame]    = useState<JpGame | null>(null);
  const [title,   setTitle]   = useState("");
  const [config,  setConfig]  = useState<JpGameConfig | null>(null);
  const [dirty,   setDirty]   = useState(false);
  const [busy,    setBusy]    = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  // Tile modal state
  const [editKey, setEditKey] = useState<string | null>(null);
  const [qText,   setQText]   = useState("");
  const [aText,   setAText]   = useState("");

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
      setConfig(g.config);
    })();
    return () => { cancelled = true; };
  }, [gameId]);

  const board = config?.boards[0];

  const patchBoard = (patch: Partial<JpBoardConfig>) => {
    if (!config || !board) return;
    setConfig({ ...config, boards: [{ ...board, ...patch }] });
    setDirty(true);
  };

  const openTile = (key: string) => {
    const tile = board?.tiles[key];
    setQText(textOf(tile, "questionBlocks"));
    setAText(textOf(tile, "answerBlocks"));
    setEditKey(key);
  };

  const saveTile = () => {
    if (!board || !editKey) return;
    const tiles = { ...board.tiles };
    if (qText.trim()) {
      tiles[editKey] = {
        questionBlocks: [{ id: `${editKey}-q`, type: "text", text: qText.trim() }],
        answerBlocks:   [{ id: `${editKey}-a`, type: "text", text: aText.trim() }],
        answerMode:     "standard",
      };
    } else {
      delete tiles[editKey];
    }
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

  const filledCount = Object.keys(board.tiles).length;
  const totalTiles  = board.categories.length * board.rows;

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
        <p className="mt-2 text-xs" style={{ color: "rgb(var(--text-secondary-rgb))" }}>
          {filledCount}/{totalTiles} tiles have questions. Empty tiles show greyed out on the board.
        </p>
      </Panel>

      <Panel>
        <h2 className="text-lg font-bold mb-3">Categories</h2>
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
                  // Drop the category column and remap tile keys after it.
                  const tiles: typeof board.tiles = {};
                  for (const [key, tile] of Object.entries(board.tiles)) {
                    const [col, row] = key.split("-").map(Number);
                    if (col === i) continue;
                    tiles[`${col > i ? col - 1 : col}-${row}`] = tile;
                  }
                  patchBoard({ categories: board.categories.filter((_, c) => c !== i), tiles });
                }}
              >
                ✕
              </Button>
            </div>
          ))}
          <Button variant="ghost" size="sm" disabled={board.categories.length >= 8}
            onClick={() => patchBoard({ categories: [...board.categories, `Category ${board.categories.length + 1}`] })}
          >
            + Add category
          </Button>
        </div>

        <h2 className="text-lg font-bold mt-6 mb-3">Rows & point values</h2>
        <div className="flex flex-col gap-2">
          {board.pointValues.map((v, row) => (
            <div key={row} className="flex gap-2 items-center">
              <span className="w-14 text-sm" style={{ color: "rgb(var(--text-secondary-rgb))" }}>
                Row {row + 1}
              </span>
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
                }}
              >
                ✕
              </Button>
            </div>
          ))}
          <Button variant="ghost" size="sm" disabled={board.rows >= 8}
            onClick={() => patchBoard({
              rows:        board.rows + 1,
              pointValues: [...board.pointValues, (board.pointValues[board.pointValues.length - 1] ?? 100) + 100],
            })}
          >
            + Add row
          </Button>
        </div>
      </Panel>

      <Panel>
        <h2 className="text-lg font-bold mb-3">Questions</h2>
        <p className="text-sm mb-3" style={{ color: "rgb(var(--text-secondary-rgb))" }}>
          Click a tile to edit its question and answer.
        </p>
        <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${board.categories.length}, minmax(0, 1fr))` }}>
          {board.categories.map((cat, col) => (
            <div key={`h-${col}`} className="text-[10px] sm:text-xs font-bold text-center uppercase truncate py-1">
              {cat}
            </div>
          ))}
          {Array.from({ length: board.rows }, (_, row) =>
            board.categories.map((_, col) => {
              const key    = `${col}-${row}`;
              const filled = !!board.tiles[key];
              return (
                <button key={key} type="button" onClick={() => openTile(key)}
                  className="rounded-md py-3 font-bold text-sm sm:text-base transition-colors"
                  style={{
                    background: filled ? "rgba(var(--color-primary-rgb), 0.18)" : "rgb(var(--surface-input-rgb))",
                    border:     filled
                      ? "1px solid rgba(var(--color-primary-rgb), 0.6)"
                      : "1px dashed rgb(var(--border-rgb))",
                    color: filled ? "rgb(var(--color-primary-rgb))" : "rgba(var(--text-secondary-rgb), 0.6)",
                  }}
                >
                  {board.pointValues[row]}
                </button>
              );
            })
          )}
        </div>
      </Panel>

      <Modal open={editKey !== null} onClose={() => setEditKey(null)}>
        {editKey !== null && (
          <div className="flex flex-col gap-4">
            <h3 className="text-lg font-bold">
              {board.categories[Number(editKey.split("-")[0])]} — {board.pointValues[Number(editKey.split("-")[1])]}
            </h3>
            <label className="flex flex-col gap-2 text-sm font-semibold"
              style={{ color: "rgb(var(--text-secondary-rgb))" }}
            >
              Question
              <textarea
                value={qText}
                onChange={e => setQText(e.target.value)}
                rows={3}
                className="w-full px-4 py-2.5 rounded-md font-sans text-base outline-none"
                style={{
                  background: "rgb(var(--surface-input-rgb))",
                  border:     "1px solid rgb(var(--border-rgb))",
                  color:      "rgb(var(--text-primary-rgb))",
                }}
              />
            </label>
            <label className="flex flex-col gap-2 text-sm font-semibold"
              style={{ color: "rgb(var(--text-secondary-rgb))" }}
            >
              Answer (only the host sees this during play)
              <textarea
                value={aText}
                onChange={e => setAText(e.target.value)}
                rows={2}
                className="w-full px-4 py-2.5 rounded-md font-sans text-base outline-none"
                style={{
                  background: "rgb(var(--surface-input-rgb))",
                  border:     "1px solid rgb(var(--border-rgb))",
                  color:      "rgb(var(--text-primary-rgb))",
                }}
              />
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditKey(null)}>Cancel</Button>
              <Button onClick={saveTile}>{qText.trim() ? "Save tile" : "Clear tile"}</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
