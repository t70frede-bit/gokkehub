// Music Bingo — pure board logic shared by the Lobby/Bingo pages and the
// Pages Functions (start.ts builds boards, bingo.ts validates ticks).
//
// No DOM, no Supabase, no Workers APIs: everything here is deterministic
// given its inputs (plus an injectable RNG) so it can be unit-tested.
//
// A board word is a single word taken from a song TITLE or ARTIST in the
// room's track pool. A player crosses it off by recognising a song that
// contains it. Matching is always done on the normalised form, so
// "Don't" / "dont" / "DON’T" are the same word, and title words are shown
// in their base form so one square covers every form of the word.

import type { SpotifyTrack, BingoWinMode, BingoWordMatch, TlRoomSettings } from "./types";

// Short, ubiquitous words make useless squares ("the" is in half the
// catalogue). Anything under 3 letters is dropped by length already.
const STOPWORDS = new Set([
  "the", "and", "you", "your", "for", "with", "feat", "featuring", "are",
  "was", "but", "not", "all", "from", "this", "that", "its", "his", "her",
  "our", "out", "can", "she", "him", "they", "them", "who", "what", "how",
  "when", "into", "onto", "off", "yeah", "ooh", "has", "had", "have",
  "been", "will", "just", "than", "then", "there", "their", "were", "one",
  "remix", "remastered", "remaster", "version", "edit", "live", "mix",
  "radio", "original", "mono", "stereo", "acoustic", "demo", "single",
]);

const MIN_WORD_LEN = 3;

/** Normalise one word for matching: lowercase, apostrophes joined, accents
 *  and every other non-alphanumeric character removed. */
export function normalizeWord(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/['’‘`´]/g, "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/** Drop version labels so "(Remastered 2011)", "[Live]", "- Radio Edit" and
 *  "(feat. X)" never become board words. Bingo is more aggressive than the
 *  guess grader: anything in brackets or after " - " goes, because a
 *  missing word costs nothing here and a junk word costs a square. */
export function stripTitleExtras(title: string): string {
  return title
    .replace(/[([][^()[\]]*[)\]]/g, " ")
    .split(/\s+[-–—]\s+/)[0]
    .replace(/\s+(feat\.?|ft\.?|featuring)\s+.*$/i, "")
    .trim();
}

interface WordToken { norm: string; display: string }

// ── Base forms ──────────────────────────────────────────────────────────────
// Squares show the base form of a title word (LOVE, not LOVING / LOVED /
// LOVES) and a tick accepts any form of it. This is a small, deliberately
// conservative English stemmer, not a dictionary: when a rule can't tell
// the base form apart from a real word ("opening" → open? opene?) it leaves
// the word alone. Artist names are never stemmed — they're names.

// Words that look inflected but aren't (or whose "base" isn't a word).
const BASE_FORM_EXCEPTIONS = new Set([
  "morning", "evening", "darling", "ceiling", "wedding", "pudding", "sterling",
  "nothing", "something", "everything", "anything", "thing", "things",
  "naked", "wicked", "sacred", "hundred", "kindred", "beloved", "blessed",
  "always", "perhaps", "christmas", "texas", "vegas", "atlas", "chaos",
  "news", "series", "species", "lyrics", "physics", "jeans",
]);

const VOWEL = /[aeiouy]/;

/** Base form of a normalised word: "hearts" → "heart", "babies" → "baby",
 *  "loving" → "love", "running" → "run", "dreamed" → "dream". */
export function baseForm(w: string): string {
  if (w.length <= 3 || BASE_FORM_EXCEPTIONS.has(w)) return w;
  if (w.endsWith("ied") && w.length > 4) return `${w.slice(0, -3)}y`;   // cried → cry
  for (const suf of ["ing", "ed"]) {
    if (!w.endsWith(suf)) continue;
    const stem = w.slice(0, -suf.length);
    if (stem.length < 3 || !VOWEL.test(stem)) return w;          // "sing", "spring", "need"
    if (/([^aeiouylsfz])\1$/.test(stem)) return stem.slice(0, -1); // running → run, stopped → stop
    if (/[vcz]$/.test(stem) || /[^aeiou]u$/.test(stem)) return `${stem}e`; // loving → love, dancing → dance
    if (/y$/.test(stem)) return stem;                             // playing → play, crying → cry
    if (/[aeiou]{2}[^aeiouy]$/.test(stem) || /[^aeiouy]{2}$/.test(stem)) return stem; // dreaming, walking
    return w;                                                     // opening, making: can't tell
  }
  if (w.endsWith("ies") && w.length > 4) return `${w.slice(0, -3)}y`;
  if (/(ss|x|z|ch|sh)es$/.test(w)) return w.slice(0, -2);
  if (w.endsWith("s") && !/(ss|us|is|as|os)$/.test(w)) return w.slice(0, -1);
  return w;
}

function tokens(text: string, stem: boolean): WordToken[] {
  const out: WordToken[] = [];
  for (const piece of text.split(/[\s/\-–—_,&+]+/)) {
    // Trim surrounding punctuation for display but keep inner apostrophes.
    const raw  = piece.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    const norm = normalizeWord(raw);
    const base = stem ? baseForm(norm) : norm;
    if (base.length < MIN_WORD_LEN || STOPWORDS.has(norm) || STOPWORDS.has(base)) continue;
    // Squares are ALL CAPS. Keep the original spelling ("DON'T") when the
    // word was already in base form; otherwise show the base form.
    out.push({ norm: base, display: (base === norm ? raw : base).toUpperCase() });
  }
  return out;
}

/** Every usable word in a track's title (in base form) and artist credit. */
export function trackWords(track: Pick<SpotifyTrack, "name" | "artist">): WordToken[] {
  const seen = new Set<string>();
  const out: WordToken[] = [];
  for (const t of [...tokens(stripTitleExtras(track.name), true), ...tokens(track.artist, false)]) {
    if (seen.has(t.norm)) continue;
    seen.add(t.norm);
    out.push(t);
  }
  return out;
}

/** True when the square `word` appears in the track, in any form ("LOVE"
 *  matches "Loving"). "whole" needs the whole word; "partial" (the default)
 *  also accepts it inside a longer word ("YOU" matches "Your", "CHILD"
 *  matches "Childish"). Every word of the title and artist is checked,
 *  including short and stop words that never become squares themselves. */
export function trackHasWord(
  track: Pick<SpotifyTrack, "name" | "artist">,
  word: string,
  match: BingoWordMatch = "partial",
): boolean {
  const n = normalizeWord(word);
  if (!n) return false;
  return `${stripTitleExtras(track.name)} ${track.artist}`
    .split(/[\s/\-–—_,&+]+/)
    .map(normalizeWord)
    .filter(Boolean)
    .some(w => {
      const forms = [w, baseForm(w)];
      return match === "whole" ? forms.includes(n) : forms.some(f => f.includes(n));
    });
}

export type Rng = () => number;

function shuffle<T>(arr: T[], rng: Rng): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** How many distinct words a pool offers — the Lobby uses it to say
 *  whether the chosen board size can be filled. */
export function distinctWordCount(pool: Pick<SpotifyTrack, "name" | "artist">[]): number {
  const all = new Set<string>();
  for (const t of pool) for (const w of trackWords(t)) all.add(w.norm);
  return all.size;
}

/**
 * Build one size×size board from the songs that will be played.
 *
 * Words are drawn round-robin across a shuffled song list (one random word
 * per song per pass) instead of from one flat word bag. A flat draw lets a
 * single wordy title ("Total Eclipse of the Heart") take five squares,
 * which makes a board hinge on one song. Round-robin spreads the squares
 * over as many songs as possible.
 *
 * Returns null when the pool doesn't have size² distinct words.
 */
export function generateBoard(
  pool: Pick<SpotifyTrack, "name" | "artist">[],
  size: number,
  rng: Rng = Math.random,
): string[] | null {
  const need = size * size;
  const perTrack = shuffle(pool, rng).map(t => shuffle(trackWords(t), rng));
  const used = new Set<string>();
  const board: string[] = [];
  let progressed = true;
  while (board.length < need && progressed) {
    progressed = false;
    for (const words of perTrack) {
      if (board.length >= need) break;
      while (words.length > 0) {
        const w = words.pop()!;
        if (used.has(w.norm)) continue;
        used.add(w.norm);
        board.push(w.display);
        progressed = true;
        break;
      }
    }
  }
  return board.length === need ? shuffle(board, rng) : null;
}

/** All rows, columns and both diagonals as cell-index lists. */
export function boardLines(size: number): number[][] {
  const lines: number[][] = [];
  for (let r = 0; r < size; r++) lines.push(Array.from({ length: size }, (_, c) => r * size + c));
  for (let c = 0; c < size; c++) lines.push(Array.from({ length: size }, (_, r) => r * size + c));
  lines.push(Array.from({ length: size }, (_, i) => i * size + i));
  lines.push(Array.from({ length: size }, (_, i) => i * size + (size - 1 - i)));
  return lines;
}

export function completedLines(size: number, marked: Set<number>): number[][] {
  return boardLines(size).filter(line => line.every(c => marked.has(c)));
}

export function hasWon(size: number, marked: Set<number>, mode: BingoWinMode): boolean {
  if (mode === "full") return marked.size >= size * size;
  const lines = completedLines(size, marked).length;
  return mode === "two-lines" ? lines >= 2 : lines >= 1;
}

/** Where a running room is played: bingo rooms have their own page. */
export function playPath(room: { id: string; settings?: { gameMode?: string } | null }): string {
  return room.settings?.gameMode === "bingo" ? `/bingo/${room.id}` : `/game/${room.id}`;
}

/** One-line descriptions for the non-host settings summary and the game page. */
export function describeBingo(settings: Required<TlRoomSettings>): { board: string; win: string; check: string; clip: string } {
  return {
    board: `${settings.bingoSize}×${settings.bingoSize}`,
    win:   settings.bingoWinMode === "full" ? "full board" : settings.bingoWinMode === "two-lines" ? "two lines" : "one line",
    check: settings.bingoCheckMode === "off" ? "no check"
      : `${settings.bingoCheckMode === "search" ? "track number + find the song" : "track number"}${settings.bingoWordMatch === "partial" ? ", partial words count" : ""}`,
    clip:  settings.bingoClipSeconds === 0 ? "full song" : `${settings.bingoClipSeconds} s per song`,
  };
}
