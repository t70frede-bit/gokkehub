// ── Typed token catalogue ───────────────────────────────────────────────────
// One row per earned token in tl_team_tokens; the `type` column points back
// at the spec below. Categories drive when a token can be used.

export type TokenCategory =
  | "before_song"     // before deciding to listen / move on
  | "during_listen"   // while your team is on the song
  | "before_pass"     // after listening, before passing the turn
  | "opponent_turn"   // played on the other team's turn
  | "anytime";

export type TokenType =
  // before_song
  | "cover_reveal_before"
  | "genre_picker"
  | "artist_picker"
  // during_listen
  | "song_skipper"
  | "card_remover"
  | "year_span_5"
  | "cover_reveal"
  | "more_or_less"
  | "reference_point"
  // before_pass
  | "recovery"
  | "pass_along"
  | "opponent_genre_picker"
  // opponent_turn
  | "steal_by_year"
  | "force_lock"
  | "song_limiter"
  // anytime
  | "token_counter";

export interface TokenSpec {
  type:        TokenType;
  category:    TokenCategory;
  name:        string;
  short:       string;        // 1-2 word label for the chip
  description: string;
  icon:        string;        // emoji for v1; can swap to SVG later
  /** False until the effect is wired end-to-end — UI shows "coming soon". */
  implemented: boolean;
}

export const CATEGORY_META: Record<TokenCategory, { label: string; icon: string; tooltip: string }> = {
  before_song:   { label: "Before song",     icon: "▶",  tooltip: "Use before listening to the next song" },
  during_listen: { label: "While listening", icon: "🎧", tooltip: "Use while your team is on a song" },
  before_pass:   { label: "Before passing",  icon: "⤴",  tooltip: "Use after listening, before passing the turn" },
  opponent_turn: { label: "Opponent's turn", icon: "👁",  tooltip: "Played while the other team is on the song" },
  anytime:       { label: "Anytime",         icon: "⚡", tooltip: "Use whenever applicable" },
};

export const TOKEN_CATALOG: Record<TokenType, TokenSpec> = {
  // ── before_song ──────────────────────────────────────────────────────────
  cover_reveal_before: {
    type: "cover_reveal_before",
    category: "before_song",
    name: "Cover Reveal (before)",
    short: "Cover",
    description: "See the cover art of the next song before deciding whether to play it.",
    icon: "🖼️",
    implemented: false,
  },
  genre_picker: {
    type: "genre_picker",
    category: "before_song",
    name: "Genre Picker",
    short: "Genre pick",
    description: "Pick one of three genres for the next card. You can't earn tokens from that round.",
    icon: "🎼",
    implemented: false,
  },
  artist_picker: {
    type: "artist_picker",
    category: "before_song",
    name: "Artist Picker",
    short: "Artist pick",
    description: "Pick one of three artists for the next card. You can't earn tokens from that round.",
    icon: "🎤",
    implemented: false,
  },

  // ── during_listen ────────────────────────────────────────────────────────
  song_skipper: {
    type: "song_skipper",
    category: "during_listen",
    name: "Song Skipper",
    short: "Skip",
    description: "Skip the current song. Your pending cards stay safe and the turn ends.",
    icon: "⏭️",
    implemented: true,
  },
  card_remover: {
    type: "card_remover",
    category: "during_listen",
    name: "Card Remover",
    short: "Remove",
    description: "Remove a card from your timeline but keep the point.",
    icon: "🗑️",
    implemented: false,
  },
  year_span_5: {
    type: "year_span_5",
    category: "during_listen",
    name: "+/- 5 Years",
    short: "± 5",
    description: "Widens your placement window by 5 years on each side. Place between cards and you're correct if the actual year is within ±5 of either edge.",
    icon: "📐",
    implemented: true,
  },
  cover_reveal: {
    type: "cover_reveal",
    category: "during_listen",
    name: "Cover Reveal",
    short: "Cover",
    description: "Show the cover art of the current song.",
    icon: "🖼️",
    implemented: true,
  },
  more_or_less: {
    type: "more_or_less",
    category: "during_listen",
    name: "Before or After",
    short: "Before?",
    description: "Pick a card. We'll tell you whether the current song is from before or after that year.",
    icon: "↕️",
    implemented: true,
  },
  reference_point: {
    type: "reference_point",
    category: "during_listen",
    name: "Reference Point",
    short: "Ref",
    description: "Get a fresh song from the same year as the current one to compare against.",
    icon: "📍",
    implemented: false,
  },

  // ── before_pass ──────────────────────────────────────────────────────────
  recovery: {
    type: "recovery",
    category: "before_pass",
    name: "Recovery",
    short: "Save 1",
    description: "If you guess wrong, pick one card from your pending pile to save.",
    icon: "🛟",
    implemented: false,
  },
  pass_along: {
    type: "pass_along",
    category: "before_pass",
    name: "Pass Along",
    short: "Pass",
    description: "Hear three song snippets and pick which one your opponents get next.",
    icon: "🔀",
    implemented: false,
  },
  opponent_genre_picker: {
    type: "opponent_genre_picker",
    category: "before_pass",
    name: "Opponent Genre Picker",
    short: "Genre→",
    description: "Pick one of three genres for the opponent's next song.",
    icon: "🎯",
    implemented: false,
  },

  // ── opponent_turn ────────────────────────────────────────────────────────
  steal_by_year: {
    type: "steal_by_year",
    category: "opponent_turn",
    name: "Steal by Year",
    short: "Steal",
    description: "If the opponent gets the year wrong, the year stays hidden and your team can guess the exact year to take the card.",
    icon: "🥷",
    implemented: false,
  },
  force_lock: {
    type: "force_lock",
    category: "opponent_turn",
    name: "Force Lock",
    short: "Lock",
    description: "Lock all of the opponent's pending cards. Their turn ends after this song.",
    icon: "🔒",
    implemented: true,
  },
  song_limiter: {
    type: "song_limiter",
    category: "opponent_turn",
    name: "Song Limiter",
    short: "20s",
    description: "Cut the opponent's song to 20 seconds.",
    icon: "⏱️",
    implemented: false,
  },

  // ── anytime ──────────────────────────────────────────────────────────────
  token_counter: {
    type: "token_counter",
    category: "anytime",
    name: "Token Counter",
    short: "Counter",
    description: "Cancel a token your opponent just played. Pops up after they use one.",
    icon: "🛡️",
    implemented: false,
  },
};

export const ALL_TOKEN_TYPES: TokenType[] = Object.keys(TOKEN_CATALOG) as TokenType[];
export const IMPLEMENTED_TOKEN_TYPES: TokenType[] =
  ALL_TOKEN_TYPES.filter(t => TOKEN_CATALOG[t].implemented);

// Random typed token to grant when a team earns a bonus. Pulls from
// implemented types only so you can always actually use it.
export function randomEarnableToken(): TokenType {
  const pool = IMPLEMENTED_TOKEN_TYPES.length > 0 ? IMPLEMENTED_TOKEN_TYPES : ALL_TOKEN_TYPES;
  return pool[Math.floor(Math.random() * pool.length)];
}
