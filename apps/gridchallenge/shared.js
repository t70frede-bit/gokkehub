// Shared constants and functions
const APP_VERSION = "1.3.1";
document.addEventListener("DOMContentLoaded", () => {
  const el = document.getElementById("versionTag");
  if (el) el.textContent = "v" + APP_VERSION;
});
const iconMap = {
  single: "👤",
  group: "👥",
  versus: "👤–👤"
};

const gameEmojis = {
  overwatch: "🎮",
  lol: "⚔️",
  cs2: "🔫",
  slaythespire: "🃏",
  bindingofisaac: "😢",
  wow: "🐉"
};

const gameNames = {
  overwatch: "Overwatch",
  lol: "League of Legends",
  cs2: "CS2",
  slaythespire: "Slay the Spire",
  bindingofisaac: "Binding of Isaac",
  wow: "World of Warcraft",
  peak: "Peak",
  darksouls3: "Dark Souls 3",
  eldenring: "Elden Ring",
  codmw2: "Call of Duty: MW2",
  geoguessr: "GeoGuessr",
  bloonstd6: "Bloons TD 6",
  _2048: "2048",
  partyanimals: "Party Animals"
};

const gameIconUrls = {
  overwatch: "https://cdn.jsdelivr.net/npm/simple-icons@v11/icons/overwatch.svg",
  lol: "https://cdn.jsdelivr.net/npm/simple-icons@v11/icons/leagueoflegends.svg",
  cs2: "https://cdn.jsdelivr.net/npm/simple-icons@v11/icons/counterstrike.svg",
  slaythespire: "https://cdn.jsdelivr.net/npm/simple-icons@v11/icons/slaythespire.svg",
  bindingofisaac: "https://cdn.jsdelivr.net/npm/simple-icons@v11/icons/bindingofisaac.svg",
  wow: "https://cdn.jsdelivr.net/npm/simple-icons@v11/icons/worldofwarcraft.svg",
  peak: "https://cdn.jsdelivr.net/npm/simple-icons@v11/icons/peak.svg",
  darksouls3: "https://cdn.jsdelivr.net/npm/simple-icons@v11/icons/darksouls.svg",
  eldenring: "https://cdn.jsdelivr.net/npm/simple-icons@v11/icons/eldenring.svg",
  codmw2: "https://cdn.jsdelivr.net/npm/simple-icons@v11/icons/callofduty.svg",
  geoguessr: "https://cdn.jsdelivr.net/npm/simple-icons@v11/icons/geoguessr.svg",
  bloonstd6: "https://cdn.jsdelivr.net/npm/simple-icons@v11/icons/bloonstd6.svg",
  _2048: "https://cdn.jsdelivr.net/npm/simple-icons@v11/icons/2048.svg",
  partyanimals: "https://cdn.jsdelivr.net/npm/simple-icons@v11/icons/partyanimals.svg"
};

function createGameIconElement(gameKey) {
  // No icon needed in current design; return empty fragment.
  const wrapper = document.createElement("span");
  wrapper.className = "game-icon-wrapper";
  return wrapper;
}

const gameAliasMap = {
  "lol": "lol",
  "league of legends": "lol",
  "league-of-legends": "lol",
  "league": "lol",
  "cs2": "cs2",
  "counter strike 2": "cs2",
  "counter-strike 2": "cs2",
  "mw2": "codmw2",
  "call of duty mw2": "codmw2",
  "call of duty modern warfare 2": "codmw2",
  "codmw2": "codmw2",
  "overwatch": "overwatch",
  "slay the spire": "slaythespire",
  "binding of isaac": "bindingofisaac",
  "world of warcraft": "wow",
  "wow": "wow",
  "peak": "peak",
  "darksouls": "darksouls3",
  "darksouls3": "darksouls3",
  "elden ring": "eldenring",
  "elden ring nightreign": "eldenring",
  "geoguessr": "geoguessr",
  "geo guessr": "geoguessr",
  "bloons td6": "bloonstd6",
  "bloons td 6": "bloonstd6",
  "2048": "_2048",
  "party animals": "partyanimals",
  "partyanimals": "partyanimals"
};

function normalizeGameKey(rawGame) {
  if (!rawGame || typeof rawGame !== "string") return "";
  const key = rawGame.trim().toLowerCase();
  return gameAliasMap[key] || key.replace(/[^a-z0-9]/g, "");
}

let allChallenges = [];

// Load CSV data
function loadChallenges() {
  return new Promise((resolve) => {
    Papa.parse("challenges.csv", {
      download: true,
      header: true,
      delimiter: ";",
      complete: function(results) {
        allChallenges = results.data
          .filter(c => c.text && c.type && c.game)
          .map(c => {
            const canonicalGame = normalizeGameKey(c.game);
            return {
              ...c,
              game: canonicalGame,
              text: c.text.trim(),
              type: c.type.trim().toLowerCase(),
              id: Number(c.id)
            };
          });

        console.log(`Loaded ${allChallenges.length} challenges`);
        resolve(allChallenges);
      }
    });
  });
}

// Shuffle array
function shuffleArray(arr) {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// Get challenge by ID
function getChallengeById(id) {
  return allChallenges.find(c => c.id == id);
}

// Save board state to localStorage
function saveBoardState(challengeIds, boardState) {
  localStorage.setItem("currentBoardIds", JSON.stringify(challengeIds));
  localStorage.setItem("boardState", JSON.stringify(boardState));
  localStorage.setItem("lastBoardTime", new Date().getTime());
}

// Load board state from localStorage
function loadBoardState() {
  return {
    ids: JSON.parse(localStorage.getItem("currentBoardIds") || "[]"),
    state: JSON.parse(localStorage.getItem("boardState") || "{}")
  };
}

// Get URL parameters
function getUrlParams() {
  const params = new URLSearchParams(window.location.search);
  const challenges = params.get("challenges");
  return challenges ? challenges.split(",").map(Number) : null;
}

// --- Lobby / multiplayer helpers ---

function generateLobbyId() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (let i = 0; i < 6; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

function generatePlayerId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return "player-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// Challenge IDs are prefixed to distinguish CSV vs custom challenges
function csvChallengeId(n) { return "csv_" + n; }
function customChallengeId(n) { return "custom_" + n; }

function parseChallengeId(id) {
  if (typeof id !== "string") return null;
  if (id.startsWith("csv_")) return { source: "csv", id: Number(id.slice(4)) };
  if (id.startsWith("custom_")) return { source: "custom", id: Number(id.slice(7)) };
  // Legacy: plain numbers from URL params (solo mode)
  const n = Number(id);
  if (!isNaN(n)) return { source: "csv", id: n };
  return null;
}

const TEAM_COLORS = ["blue", "red", "green", "yellow"];
const TEAM_LABELS = { blue: "Blue", red: "Red", green: "Green", yellow: "Yellow" };
const TEAM_EMOJIS = { blue: "🔵", red: "🔴", green: "🟢", yellow: "🟡" };
