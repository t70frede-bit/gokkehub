// Game name normalization utilities

export const GAME_NAMES: Record<string, string> = {
  overwatch:      "Overwatch",
  lol:            "League of Legends",
  cs2:            "CS2",
  slaythespire:   "Slay the Spire",
  slaythespire2:  "Slay the Spire 2",
  bindingofisaac: "Binding of Isaac",
  wow:            "World of Warcraft",
  peak:           "Peak",
  darksouls3:     "Dark Souls 3",
  eldenring:      "Elden Ring",
  codmw2:         "Call of Duty: MW2",
  geoguessr:      "GeoGuessr",
  bloonstd6:      "Bloons TD 6",
  _2048:          "2048",
  partyanimals:   "Party Animals",
  minecraft:      "Minecraft",
  geometrydash:   "Geometry Dash",
  ultimatechickenhorse: "Ultimate Chicken Horse",
  muck:           "Muck",
};

/** Display name for a normalized key — falls back to the key itself. */
export function getGameDisplayName(key: string): string {
  return GAME_NAMES[key] ?? key;
}

/** Simple-Icons CDN slug overrides — only needed when slug differs from the key. */
export const GAME_ICON_SLUGS: Record<string, string> = {
  lol:            "leagueoflegends",
  cs2:            "counterstrike",
  slaythespire:   "slaythespire",
  slaythespire2:  "slaythespire",
  bindingofisaac: "bindingofisaac",
  wow:            "worldofwarcraft",
  darksouls3:     "darksouls",
  codmw2:         "callofduty",
  bloonstd6:      "bloonstd6",
  _2048:          "2048",
  partyanimals:   "partyanimals",
};

export function getGameIconUrl(key: string): string | null {
  const slug = GAME_ICON_SLUGS[key] ?? key;
  // Only return URLs for known games — unknown games get no icon
  if (!GAME_NAMES[key]) return null;
  return `https://cdn.jsdelivr.net/npm/simple-icons@v11/icons/${slug}.svg`;
}

/** Alias map: lowercase display strings → canonical normalized key */
export const GAME_ALIAS_MAP: Record<string, string> = {
  // League of Legends
  "lol":                          "lol",
  "league of legends":            "lol",
  "league-of-legends":            "lol",
  "league":                       "lol",
  // CS2
  "cs2":                          "cs2",
  "counter strike 2":             "cs2",
  "counter-strike 2":             "cs2",
  "counterstrike2":               "cs2",
  // Call of Duty
  "mw2":                          "codmw2",
  "call of duty mw2":             "codmw2",
  "call of duty modern warfare 2":"codmw2",
  "codmw2":                       "codmw2",
  // Overwatch
  "overwatch":                    "overwatch",
  "overwatch 2":                  "overwatch",
  // Slay the Spire
  "slay the spire":               "slaythespire",
  "slaythespire":                 "slaythespire",
  "slay the spire 2":             "slaythespire2",
  "slaythespire2":                "slaythespire2",
  // Binding of Isaac
  "binding of isaac":             "bindingofisaac",
  "the binding of isaac":         "bindingofisaac",
  // WoW
  "world of warcraft":            "wow",
  "wow":                          "wow",
  // FromSoft
  "darksouls":                    "darksouls3",
  "darksouls3":                   "darksouls3",
  "dark souls 3":                 "darksouls3",
  "dark souls iii":               "darksouls3",
  "elden ring":                   "eldenring",
  "elden ring nightreign":        "eldenring",
  // Misc
  "geoguessr":                    "geoguessr",
  "geo guessr":                   "geoguessr",
  "bloons td6":                   "bloonstd6",
  "bloons td 6":                  "bloonstd6",
  "2048":                         "_2048",
  "party animals":                "partyanimals",
  "partyanimals":                 "partyanimals",
  "minecraft":                    "minecraft",
  "mincraft":                     "minecraft", // common typo in CSV
  "geometry dash":                "geometrydash",
  "ultimate chicken horse":       "ultimatechickenhorse",
  "muck":                         "muck",
  "peak":                         "peak",
};

/**
 * Normalize any raw game name string (from CSV, user input, Steam API) into
 * a stable lowercase key suitable for use as a DB/filter value.
 */
export function normalizeGameKey(raw: string | null | undefined): string {
  if (!raw || typeof raw !== "string") return "";
  const key = raw.trim().toLowerCase();
  return GAME_ALIAS_MAP[key] ?? key.replace(/[^a-z0-9]/g, "");
}
