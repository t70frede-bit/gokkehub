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

export function getGameDisplayName(key: string): string {
  return GAME_NAMES[key] ?? key;
}

export const GAME_ALIAS_MAP: Record<string, string> = {
  "lol":                          "lol",
  "league of legends":            "lol",
  "league-of-legends":            "lol",
  "league":                       "lol",
  "cs2":                          "cs2",
  "counter strike 2":             "cs2",
  "counter-strike 2":             "cs2",
  "counterstrike2":               "cs2",
  "mw2":                          "codmw2",
  "call of duty mw2":             "codmw2",
  "call of duty modern warfare 2":"codmw2",
  "codmw2":                       "codmw2",
  "overwatch":                    "overwatch",
  "overwatch 2":                  "overwatch",
  "slay the spire":               "slaythespire",
  "slaythespire":                 "slaythespire",
  "slay the spire 2":             "slaythespire2",
  "slaythespire2":                "slaythespire2",
  "binding of isaac":             "bindingofisaac",
  "the binding of isaac":         "bindingofisaac",
  "world of warcraft":            "wow",
  "wow":                          "wow",
  "darksouls":                    "darksouls3",
  "darksouls3":                   "darksouls3",
  "dark souls 3":                 "darksouls3",
  "dark souls iii":               "darksouls3",
  "elden ring":                   "eldenring",
  "elden ring nightreign":        "eldenring",
  "geoguessr":                    "geoguessr",
  "geo guessr":                   "geoguessr",
  "bloons td6":                   "bloonstd6",
  "bloons td 6":                  "bloonstd6",
  "2048":                         "_2048",
  "party animals":                "partyanimals",
  "partyanimals":                 "partyanimals",
  "minecraft":                    "minecraft",
  "mincraft":                     "minecraft",
  "geometry dash":                "geometrydash",
  "ultimate chicken horse":       "ultimatechickenhorse",
  "muck":                         "muck",
  "peak":                         "peak",
};

export function normalizeGameKey(raw: string | null | undefined): string {
  if (!raw || typeof raw !== "string") return "";
  const key = raw.trim().toLowerCase();
  return GAME_ALIAS_MAP[key] ?? key.replace(/[^a-z0-9]/g, "");
}
