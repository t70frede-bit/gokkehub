import type { JpBoardConfig, JpBoardState } from "../../lib/types";
import { ANSWER_MODE_META } from "../../lib/types";

interface BoardGridProps {
  board:  JpBoardConfig;
  state:  JpBoardState;
  /** Present on the host controller; absent on the big screen (passive). */
  onTileSelect?: (tileKey: string) => void;
  /** Smaller text/padding for the host's phone. */
  compact?: boolean;
  /**
   * Mark each unplayed tile with its answer-mode glyph. HOST ONLY — its own
   * flag rather than piggybacking on `compact`, because showing this on the big
   * screen would tell the room a tile is a ranking question before it's picked.
   */
  showTypes?: boolean;
}

export default function BoardGrid({
  board, state, onTileSelect, compact = false, showTypes = false,
}: BoardGridProps) {
  const cols = board.categories.length;
  return (
    <div
      className="grid gap-1.5 sm:gap-2 w-full"
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
    >
      {board.categories.map((cat, col) => (
        <div
          key={`cat-${col}`}
          className={`rounded-md text-center font-bold uppercase tracking-wide flex items-center justify-center
            ${compact ? "text-[10px] px-1 py-1.5 min-h-8" : "text-sm sm:text-base px-2 py-3 min-h-16"}`}
          style={{
            background: "rgb(var(--surface-raised-rgb))",
            border:     "1px solid rgb(var(--border-rgb))",
            color:      "rgb(var(--text-primary-rgb))",
          }}
        >
          {state.revealedCategories.includes(col) ? cat : "???"}
        </div>
      ))}
      {Array.from({ length: board.rows }, (_, row) =>
        board.categories.map((_, col) => {
          const key      = `${col}-${row}`;
          const spent    = state.spentTiles.includes(key);
          const active   = state.activeQuestion?.tileKey === key;
          const tile     = board.tiles[key];
          const hasQ     = !!tile?.questionBlocks?.length;
          const canPick  = !!onTileSelect && !spent && !state.activeQuestion && hasQ;
          // Only worth showing while the tile is still in play.
          const modeMeta = showTypes && hasQ && !spent
            ? ANSWER_MODE_META[tile?.answerMode ?? "standard"]
            : null;
          return (
            <button
              key={key}
              type="button"
              disabled={!canPick}
              title={
                modeMeta ? modeMeta.label
                  : onTileSelect && !hasQ && !spent ? "No question set"
                  : undefined
              }
              onClick={() => canPick && onTileSelect(key)}
              className={`jp-tile relative rounded-md font-black text-center flex items-center justify-center
                ${compact ? "text-sm py-2 min-h-9" : "text-xl sm:text-3xl py-4 min-h-16 sm:min-h-20"}
                ${spent ? "jp-tile-spent" : ""}
                ${canPick ? "jp-tile-selectable cursor-pointer" : "cursor-default"}`}
              style={{
                background: active
                  ? "rgba(var(--color-primary-rgb), 0.25)"
                  : "rgb(var(--surface-input-rgb))",
                border: active
                  ? "1px solid rgb(var(--color-primary-rgb))"
                  : "1px solid rgb(var(--border-rgb))",
                color: hasQ || spent
                  ? "rgb(var(--color-primary-rgb))"
                  : "rgba(var(--text-secondary-rgb), 0.35)",
              }}
            >
              {modeMeta && (
                // Absolutely placed so the point value stays optically centred.
                // Standard buzzer tiles sit back — they're the majority, and the
                // host is scanning for the ones that behave differently.
                <span
                  aria-hidden="true"
                  className={`absolute leading-none pointer-events-none
                    ${compact ? "top-0.5 right-1 text-[9px]" : "top-1 right-1.5 text-xs"}`}
                  style={{ opacity: tile?.answerMode === "standard" || !tile?.answerMode ? 0.4 : 0.9 }}
                >
                  {modeMeta.icon}
                </span>
              )}
              {spent ? "" : board.pointValues[row] ?? ""}
            </button>
          );
        })
      )}
    </div>
  );
}
