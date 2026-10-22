import { describe, it, expect } from "vitest";
import {
  normalizeWord, stripTitleExtras, trackWords, trackHasWord, generateBoard, baseForm,
  distinctWordCount, boardLines, completedLines, hasWon,
} from "./bingo";

// Small seeded RNG so board generation is reproducible.
function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

const POOL = [
  { name: "Bohemian Rhapsody - Remastered 2011", artist: "Queen" },
  { name: "Don't Stop Me Now",                    artist: "Queen" },
  { name: "Under Pressure",                       artist: "Queen, David Bowie" },
  { name: "Total Eclipse of the Heart",           artist: "Bonnie Tyler" },
  { name: "Crazy in Love (feat. Jay-Z)",          artist: "Beyoncé" },
  { name: "Highway to Hell",                      artist: "AC/DC" },
  { name: "Shape of You",                         artist: "Ed Sheeran" },
  { name: "Dancing Queen",                        artist: "ABBA" },
  { name: "Smells Like Teen Spirit",              artist: "Nirvana" },
  { name: "Billie Jean",                          artist: "Michael Jackson" },
  { name: "Wonderwall",                           artist: "Oasis" },
  { name: "Hey Jude",                             artist: "The Beatles" },
];

describe("normalizeWord", () => {
  it("ignores case, apostrophes and accents", () => {
    expect(normalizeWord("Don't")).toBe("dont");
    expect(normalizeWord("DON’T")).toBe("dont");
    expect(normalizeWord("Beyoncé")).toBe("beyonce");
  });
});

describe("stripTitleExtras", () => {
  it("drops version labels and features", () => {
    expect(stripTitleExtras("Bohemian Rhapsody - Remastered 2011")).toBe("Bohemian Rhapsody");
    expect(stripTitleExtras("Crazy in Love (feat. Jay-Z)")).toBe("Crazy in Love");
    expect(stripTitleExtras("Song [Live at Wembley]")).toBe("Song");
  });
});

describe("trackWords", () => {
  it("takes title and artist words, skipping stopwords and short words", () => {
    const words = trackWords(POOL[3]).map(w => w.norm);
    expect(words).toEqual(["total", "eclipse", "heart", "bonnie", "tyler"]);
  });
  it("shows squares in ALL CAPS, keeping apostrophes", () => {
    expect(trackWords(POOL[1]).map(w => w.display)).toEqual(["DON'T", "STOP", "NOW", "QUEEN"]);
  });
  it("puts title words in base form but leaves artist names alone", () => {
    const t = { name: "Loving Hearts Dancing", artist: "The Rolling Stones" };
    expect(trackWords(t).map(w => w.display)).toEqual(["LOVE", "HEART", "DANCE", "ROLLING", "STONES"]);
  });
  it("splits collaborations and slashes", () => {
    expect(trackWords(POOL[2]).map(w => w.norm)).toEqual(["under", "pressure", "queen", "david", "bowie"]);
    expect(trackWords(POOL[5]).map(w => w.norm)).toEqual(["highway", "hell"]);
  });
});

describe("baseForm", () => {
  it.each([
    ["hearts", "heart"], ["babies", "baby"], ["kisses", "kiss"], ["loving", "love"],
    ["loved", "love"], ["dancing", "dance"], ["running", "run"], ["stopped", "stop"],
    ["dreaming", "dream"], ["walking", "walk"], ["rolling", "roll"], ["playing", "play"],
    ["crying", "cry"], ["cried", "cry"],
  ])("%s → %s", (w, base) => expect(baseForm(w)).toBe(base));
  it.each(["spring", "sing", "need", "nothing", "morning", "christmas", "kiss", "opening", "always", "boss"])(
    "leaves %s alone", w => expect(baseForm(w)).toBe(w));
});

describe("trackHasWord", () => {
  it("matches the normalised word in title or artist", () => {
    expect(trackHasWord(POOL[1], "DONT", "whole")).toBe(true);
    expect(trackHasWord(POOL[2], "Bowie", "whole")).toBe(true);
    expect(trackHasWord(POOL[0], "Remastered", "whole")).toBe(false);
    expect(trackHasWord(POOL[4], "Jay", "whole")).toBe(false);
  });
  it("accepts any form of the square's word", () => {
    const t = { name: "Loving You Is Easy", artist: "Sade" };
    expect(trackHasWord(t, "LOVE", "whole")).toBe(true);
    expect(trackHasWord({ name: "Hearts on Fire", artist: "X" }, "HEART", "whole")).toBe(true);
  });
  it("whole-word mode doesn't match inside a longer word", () => {
    const gambino = { name: "Redbone", artist: "Childish Gambino" };
    expect(trackHasWord(gambino, "Child", "whole")).toBe(false);
    expect(trackHasWord(gambino, "Child", "partial")).toBe(true);
    expect(trackHasWord(gambino, "Bone", "partial")).toBe(true);
    expect(trackHasWord(gambino, "Bones", "partial")).toBe(false);
  });
  it("partial mode still ignores version labels", () => {
    expect(trackHasWord(POOL[0], "Master", "partial")).toBe(false);
  });
});

describe("generateBoard", () => {
  it("fills a board with distinct words from the pool", () => {
    const board = generateBoard(POOL, 5, seeded(1))!;
    expect(board).toHaveLength(25);
    expect(new Set(board.map(normalizeWord)).size).toBe(25);
    for (const w of board) expect(POOL.some(t => trackHasWord(t, w))).toBe(true);
  });
  it("spreads squares over many songs", () => {
    // Songs 3..11 share no words, so each square maps to exactly one song.
    const pool = POOL.slice(3);
    const board = generateBoard(pool, 3, seeded(7))!;
    const songsUsed = new Set(board.map(w => pool.findIndex(t => trackHasWord(t, w))));
    expect(songsUsed.size).toBe(9);
  });
  it("returns null when the pool is too small", () => {
    expect(distinctWordCount(POOL.slice(0, 2))).toBeLessThan(9);
    expect(generateBoard(POOL.slice(0, 2), 3, seeded(3))).toBeNull();
  });
});

describe("win detection", () => {
  it("knows rows, columns and diagonals", () => {
    expect(boardLines(3)).toHaveLength(8);
    expect(completedLines(3, new Set([0, 4, 8]))).toEqual([[0, 4, 8]]);
  });
  it("applies the win mode", () => {
    const oneLine = new Set([0, 1, 2]);
    expect(hasWon(3, oneLine, "line")).toBe(true);
    expect(hasWon(3, oneLine, "two-lines")).toBe(false);
    expect(hasWon(3, new Set([0, 1, 2, 3, 6]), "two-lines")).toBe(true);
    expect(hasWon(3, new Set([0, 1, 2, 3, 4, 5, 6, 7]), "full")).toBe(false);
    expect(hasWon(3, new Set([0, 1, 2, 3, 4, 5, 6, 7, 8]), "full")).toBe(true);
  });
});
