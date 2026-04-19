// @ts-expect-error — @types/papaparse not yet installed in workspace
import Papa from "papaparse";
import { normalizeGameKey } from "./gameKeys";
import type { Challenge, ChallengeRef, ChallengeSource, ChallengeType, LobbySettings } from "./types";

// ── CSV loading ───────────────────────────────────────────────────────────────

interface CsvRow {
  id: string;
  text: string;
  type: string;
  game: string;
}

let _csvChallenges: Challenge[] = [];
let _loadPromise: Promise<Challenge[]> | null = null;

export function loadCsvChallenges(): Promise<Challenge[]> {
  if (_loadPromise) return _loadPromise;
  _loadPromise = new Promise((resolve) => {
    Papa.parse("/challenges.csv", {
      download: true,
      header: true,
      delimiter: ";",
      complete(results: { data: unknown[] }) {
        const rows = results.data as CsvRow[];
        _csvChallenges = rows
          .filter((r) => r.text && r.type && r.game)
          .map((r) => ({
            id: `csv_${r.id.trim()}`,
            text: r.text.trim(),
            type: r.type.trim().toLowerCase() as ChallengeType,
            game: normalizeGameKey(r.game),
            source: "csv" as ChallengeSource,
          }));
        console.log(`[challenges] loaded ${_csvChallenges.length} CSV challenges`);
        resolve(_csvChallenges);
      },
      error() {
        console.error("[challenges] failed to load challenges.csv");
        resolve([]);
      },
    });
  });
  return _loadPromise;
}

export function getCsvChallenges(): Challenge[] {
  return _csvChallenges;
}

// ── ID helpers ────────────────────────────────────────────────────────────────

export function csvChallengeId(n: number | string): string {
  return `csv_${n}`;
}

export function customChallengeId(n: number | string): string {
  return `custom_${n}`;
}

export function playerChallengeId(uuid: string): string {
  return uuid; // player challenges use raw UUIDs
}

/** Parse a prefixed challenge ID back into source + raw id. */
export function parseChallengeRef(id: string): ChallengeRef {
  if (id.startsWith("csv_")) return { id, source: "csv" };
  if (id.startsWith("custom_")) return { id, source: "custom" };
  return { id, source: "player" };
}

// ── Pool building ─────────────────────────────────────────────────────────────

export interface BuiltPool {
  challenges: Challenge[];
  error: string | null;
}

/**
 * Build the ordered challenge pool for a lobby start.
 * Custom challenges come first so they are more likely to appear on the board.
 */
export function buildChallengePool(
  csvChallenges: Challenge[],
  customChallenges: Challenge[],
  settings: Pick<LobbySettings, "games" | "types" | "poolMode">,
): Challenge[] {
  const { games, types, poolMode } = settings;

  const matchesFilter = (c: Challenge) =>
    (games.length === 0 || games.includes(c.game)) &&
    (types.length === 0 || types.includes(c.type));

  const csvPool    = csvChallenges.filter(matchesFilter);
  const customPool = customChallenges.filter(matchesFilter);

  switch (poolMode) {
    case "standard":
      return csvPool;
    case "custom":
      return customPool;
    case "standard+custom":
    default:
      return [...customPool, ...csvPool]; // custom first
  }
}

/**
 * Shuffle an array (Fisher-Yates), returning a new array.
 */
export function shuffleArray<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Select the final ordered set of challenges for a board.
 * Returns null if there aren't enough challenges.
 */
export function selectBoardChallenges(
  pool: Challenge[],
  settings: Pick<LobbySettings, "boardWidth" | "boardHeight" | "versusCount" | "freeSpace">,
): Challenge[] | null {
  const { boardWidth, boardHeight, versusCount, freeSpace } = settings;
  const totalCells = boardWidth * boardHeight;
  const needed = totalCells - (freeSpace ? 1 : 0);

  const versusPool = pool.filter((c) => c.type === "versus");
  const otherPool  = pool.filter((c) => c.type !== "versus");

  const actualVersus = Math.min(versusCount, versusPool.length);
  const neededOther  = needed - actualVersus;

  if (otherPool.length < neededOther) return null;

  const selectedVersus = shuffleArray(versusPool).slice(0, actualVersus);
  const selectedOther  = shuffleArray(otherPool).slice(0, neededOther);

  return shuffleArray([...selectedVersus, ...selectedOther]);
}

// ── Bingo detection ───────────────────────────────────────────────────────────

/**
 * Given a flat board state map (challengeId → team | "free" | ""),
 * check for bingo (winLength consecutive same-team cells in any line).
 *
 * Returns the winning team and the winning cell IDs, or null if no winner.
 */
export function checkBingo(
  boardIds: string[],
  boardState: Record<string, string>,
  boardWidth: number,
  boardHeight: number,
  winLength: number,
  freeSpace: boolean,
): { team: string; winnerIds: string[] } | null {
  const totalCells = boardWidth * boardHeight;
  const centerIndex = Math.floor(totalCells / 2);

  // Build 2D grid of { id, team }
  type Cell = { id: string | null; team: string };
  const grid: Cell[][] = [];
  let challengeIndex = 0;

  for (let r = 0; r < boardHeight; r++) {
    grid[r] = [];
    for (let c = 0; c < boardWidth; c++) {
      const flat = r * boardWidth + c;
      if (freeSpace && flat === centerIndex) {
        grid[r][c] = { id: null, team: "free" };
      } else {
        const id = boardIds[challengeIndex++] ?? null;
        grid[r][c] = { id, team: id ? (boardState[id] ?? "") : "" };
      }
    }
  }

  const winnerIds: string[] = [];
  let winningTeam: string | null = null;

  function checkSlice(slice: Cell[]) {
    if (slice.length < winLength) return;
    const first = slice[0].team;
    if (!first || first === "" || first === "free") return;
    if (slice.every((cell) => cell.team === first || cell.team === "free")) {
      slice.forEach((cell) => { if (cell.id) winnerIds.push(cell.id); });
      winningTeam = first;
    }
  }

  // Rows
  for (let r = 0; r < boardHeight; r++) {
    for (let c = 0; c <= boardWidth - winLength; c++) {
      checkSlice(grid[r].slice(c, c + winLength));
    }
  }
  // Columns
  for (let c = 0; c < boardWidth; c++) {
    for (let r = 0; r <= boardHeight - winLength; r++) {
      checkSlice(Array.from({ length: winLength }, (_, i) => grid[r + i][c]));
    }
  }
  // Diagonals ↘
  for (let r = 0; r <= boardHeight - winLength; r++) {
    for (let c = 0; c <= boardWidth - winLength; c++) {
      checkSlice(Array.from({ length: winLength }, (_, i) => grid[r + i][c + i]));
    }
  }
  // Diagonals ↙
  for (let r = 0; r <= boardHeight - winLength; r++) {
    for (let c = winLength - 1; c < boardWidth; c++) {
      checkSlice(Array.from({ length: winLength }, (_, i) => grid[r + i][c - i]));
    }
  }

  if (!winningTeam) return null;
  return { team: winningTeam, winnerIds: [...new Set(winnerIds)] };
}
