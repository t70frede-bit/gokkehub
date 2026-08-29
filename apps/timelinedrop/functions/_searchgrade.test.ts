import { describe, it, expect } from "vitest";
import { artistCreditMatches, gradeSearchPick } from "./_supabase";
import type { AcceptedAnswerRow } from "./_supabase";

// Grading for guessMode: "search" (migration 030). Pure functions — no
// Supabase or Workers runtime needed.
//
// The property that matters most here is that the two fields are graded
// INDEPENDENTLY, because the shop economy pays 1 coin per correct field:
// right artist + wrong song, and right song + wrong artist, must each still
// resolve to exactly one true.

const NONE: AcceptedAnswerRow[] = [];

describe("artistCreditMatches", () => {
  it("matches an identical credit", () => {
    expect(artistCreditMatches("Queen", "Queen")).toBe(true);
  });

  it("is case, accent and punctuation insensitive", () => {
    expect(artistCreditMatches("beyonce", "Beyoncé")).toBe(true);
    expect(artistCreditMatches("AC/DC", "ac dc")).toBe(true);
  });

  // The single biggest false-negative source in search mode: Spotify and
  // Deezer disagree constantly on who gets billed on a collaboration.
  it("matches when only one side lists the collaborator", () => {
    expect(artistCreditMatches("Queen", "Queen, David Bowie")).toBe(true);
    expect(artistCreditMatches("Queen, David Bowie", "Queen")).toBe(true);
  });

  it("matches on the non-first artist too", () => {
    expect(artistCreditMatches("David Bowie", "Queen, David Bowie")).toBe(true);
  });

  it("handles feat./ft./& separators", () => {
    expect(artistCreditMatches("Beyoncé feat. Jay-Z", "Beyoncé")).toBe(true);
    expect(artistCreditMatches("Jay-Z", "Beyoncé ft. Jay-Z")).toBe(true);
    expect(artistCreditMatches("Simon", "Simon & Garfunkel")).toBe(true);
  });

  // Names that contain a separator would be shredded by the split, so the
  // whole-string fallback has to catch them.
  it("still matches a band whose own name contains a separator", () => {
    expect(artistCreditMatches("Earth, Wind & Fire", "Earth, Wind & Fire")).toBe(true);
  });

  it("rejects a genuinely different artist", () => {
    expect(artistCreditMatches("Oasis", "Blur")).toBe(false);
    expect(artistCreditMatches("", "Queen")).toBe(false);
  });
});

describe("gradeSearchPick", () => {
  const TRACK_ID = "spotify123";
  const TITLE    = "Under Pressure - Remastered 2011";
  const ARTIST   = "Queen, David Bowie";

  it("an exact id match wins outright, whatever the strings say", () => {
    const g = gradeSearchPick(
      { spotifyId: TRACK_ID, title: "totally different", artist: "nobody" },
      TRACK_ID, TITLE, ARTIST, NONE,
    );
    expect(g).toEqual({ artistCorrect: true, songnameCorrect: true, songMatchedBy: "id" });
  });

  it("grades a correct pick from another catalogue via strings", () => {
    // Deezer spells it without Spotify's remaster suffix.
    const g = gradeSearchPick(
      { spotifyId: undefined, title: "Under Pressure", artist: "Queen" },
      TRACK_ID, TITLE, ARTIST, NONE,
    );
    expect(g.songnameCorrect).toBe(true);
    expect(g.artistCorrect).toBe(true);
  });

  // The user-facing rule: each half earns its own coin.
  it("right artist, wrong song → artist only", () => {
    const g = gradeSearchPick(
      { title: "Bohemian Rhapsody", artist: "Queen" },
      TRACK_ID, TITLE, ARTIST, NONE,
    );
    expect(g.artistCorrect).toBe(true);
    expect(g.songnameCorrect).toBe(false);
  });

  it("right song, wrong artist → song only (a cover or live cut)", () => {
    const g = gradeSearchPick(
      { title: "Under Pressure", artist: "Glee Cast" },
      TRACK_ID, TITLE, ARTIST, NONE,
    );
    expect(g.artistCorrect).toBe(false);
    expect(g.songnameCorrect).toBe(true);
  });

  it("neither right → both false", () => {
    const g = gradeSearchPick(
      { title: "Wonderwall", artist: "Oasis" },
      TRACK_ID, TITLE, ARTIST, NONE,
    );
    expect(g).toEqual({ artistCorrect: false, songnameCorrect: false, songMatchedBy: "none" });
  });

  it("accepts a variant the accepted-answers table has learned", () => {
    // What a resolved dispute writes: the nickname is now globally accepted.
    const learned: AcceptedAnswerRow[] = [{
      track_id:          "t",
      kind:              "songname",
      answer_normalized: "teenage wasteland",
      answer_original:   "Teenage Wasteland",
      confirmations:     1,
    }];
    const g = gradeSearchPick(
      { title: "Teenage Wasteland", artist: "The Who" },
      "t", "Baba O'Riley", "The Who", learned,
    );
    expect(g.songnameCorrect).toBe(true);
    expect(g.songMatchedBy).toBe("stored");
  });

  it("a suffixed pick still matches a bare canonical title", () => {
    const g = gradeSearchPick(
      { title: "Imagine - Remastered 2010", artist: "John Lennon" },
      "t", "Imagine", "John Lennon", NONE,
    );
    expect(g.songnameCorrect).toBe(true);
  });
});
