// Board Display and Persistence Logic
import { db } from "./supabase-client.js";
import {
  loadChallenges, allChallenges, getChallengeById, shuffleArray,
  gameNames, normalizeGameKey,
  saveBoardState, loadBoardState, getUrlParams,
  customChallengeId, csvChallengeId,
  TEAM_COLORS, TEAM_LABELS, TEAM_EMOJIS,
  iconMap,
} from "./shared.js";

const gridEl = document.getElementById("bingoGrid");
const backBtn = document.getElementById("backBtn");
const shareBtn = document.getElementById("shareBtn");
const resetBtn = document.getElementById("resetBtn");
const fullscreenBtn = document.getElementById("fullscreenBtn");
const muteBtn = document.getElementById("muteBtn");
const claimLogBtn = document.getElementById("claimLogBtn");
const claimLogSidebar = document.getElementById("claimLogSidebar");
const claimLogEntries = document.getElementById("claimLogEntries");
const closeClaimLog = document.getElementById("closeClaimLog");
const toastContainer = document.getElementById("toastContainer");
const bingoVictoryModal = document.getElementById("bingoVictoryModal");
const dismissVictoryBtn = document.getElementById("dismissVictoryBtn");
const lobbyPlayerBar = document.getElementById("lobbyPlayerBar");
const playerBarItems = document.getElementById("playerBarItems");

// Mode detection
const urlParams = new URLSearchParams(window.location.search);
const lobbyId = urlParams.get("lobby");
const urlPlayerId = urlParams.get("player");
const isLobbyMode = !!lobbyId;

// Shared state
let currentChallengeIds = []; // array of prefixed IDs ("csv_1", "custom_5") in lobby mode; plain numbers in solo
let boardState = {};           // { challengeId: { team, playerName } } in lobby mode; { id: "blue"|"red" } in solo
let versusInterval = 5;
let nextVersusTime = null;
let versusTimerId = null;
let activeVersusChallengeId = null;
let nextVersusChallengeId = null;
let boardSize = 5;
let freeCenter = false;
let unlockedVersus = new Set();
let soundEnabled = true;
let bingoShown = false;
let claimLogData = [];

// Lobby-specific
let myPlayerId = null;
let myTeam = null;
let isHost = false;
let lobbyPlayers = [];
let customChallengesMap = {}; // id → challenge object for custom challenges

// Audio context for claim sound
let audioCtx = null;
function playClaimSound() {
  if (!soundEnabled) return;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, audioCtx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.25);
    osc.start(audioCtx.currentTime);
    osc.stop(audioCtx.currentTime + 0.25);
  } catch (e) { /* audio not supported */ }
}

muteBtn.addEventListener("click", () => {
  soundEnabled = !soundEnabled;
  muteBtn.textContent = soundEnabled ? "🔔 Sound ON" : "🔕 Sound OFF";
});

claimLogBtn.addEventListener("click", () => {
  claimLogSidebar.style.display = claimLogSidebar.style.display === "none" ? "flex" : "none";
});
closeClaimLog.addEventListener("click", () => { claimLogSidebar.style.display = "none"; });

dismissVictoryBtn.addEventListener("click", () => { bingoVictoryModal.style.display = "none"; });

// ── INIT ─────────────────────────────────────────────────────────────────────

loadChallenges().then(async () => {
  if (isLobbyMode) {
    await initLobbyMode();
  } else {
    initSoloMode();
  }
});

// ── SOLO MODE (unchanged logic) ───────────────────────────────────────────────

function initSoloMode() {
  const query = new URLSearchParams(window.location.search);
  const modeInfo = document.getElementById("matchModeInfo");
  if (modeInfo) modeInfo.textContent = "👤 Solo mode";

  const urlInterval = parseInt(query.get("interval"), 10);
  const savedInterval = parseInt(localStorage.getItem("versusInterval"), 10);
  versusInterval = isFinite(urlInterval) && urlInterval >= 1 ? urlInterval : (isFinite(savedInterval) && savedInterval >= 1 ? savedInterval : 5);
  versusInterval = Math.max(1, Math.min(60, versusInterval));

  const urlSize = parseInt(query.get("size"), 10);
  const savedSize = parseInt(localStorage.getItem("boardSize"), 10);
  boardSize = isFinite(urlSize) && urlSize >= 3 && urlSize <= 9 ? urlSize : (isFinite(savedSize) && savedSize >= 3 && savedSize <= 9 ? savedSize : 5);

  const urlFree = query.get("free");
  const savedFree = localStorage.getItem("freeSpace");
  freeCenter = urlFree === "1" || urlFree === "true" || savedFree === "true";

  const urlChallenges = getUrlParams(); // returns plain numbers
  const neededChallenges = boardSize * boardSize - (freeCenter ? 1 : 0);

  if (urlChallenges && urlChallenges.length === neededChallenges) {
    currentChallengeIds = urlChallenges;
    const saved = loadBoardState();
    if (JSON.stringify(saved.ids) === JSON.stringify(urlChallenges)) {
      // Convert solo board state format to internal format { id: "blue"|"red" }
      boardState = saved.state;
    }
  } else {
    const saved = loadBoardState();
    if (saved.ids.length === neededChallenges) {
      currentChallengeIds = saved.ids;
      boardState = saved.state;
    } else {
      alert("❌ No board found. Please generate one from the home page.");
      window.location.href = "index.html";
      return;
    }
  }

  const savedNextVersus = parseInt(localStorage.getItem("nextVersusTimestamp"), 10);
  const savedNextChallenge = parseInt(localStorage.getItem("nextVersusChallengeId"), 10);
  const savedActiveChallenge = parseInt(localStorage.getItem("activeVersusChallengeId"), 10);
  const savedUnlocked = JSON.parse(localStorage.getItem("unlockedVersusChallengeIds") || "[]");
  const now = Date.now();

  nextVersusTime = isFinite(savedNextVersus) && savedNextVersus > now ? savedNextVersus : now + versusInterval * 60 * 1000;
  if (!isFinite(savedNextVersus) || savedNextVersus <= now) localStorage.setItem("nextVersusTimestamp", nextVersusTime);

  if (isFinite(savedNextChallenge)) nextVersusChallengeId = savedNextChallenge;
  if (isFinite(savedActiveChallenge)) activeVersusChallengeId = savedActiveChallenge;
  if (Array.isArray(savedUnlocked)) unlockedVersus = new Set(savedUnlocked.map(Number));

  document.getElementById("boardFooter").innerHTML = "<p>📘 Left-click to claim for blue | 🖱️ Right-click to claim for red</p>";

  renderBoard();
  updateScores();
  if (nextVersusChallengeId) highlightNextVersusCell();
  setupVersusTimer();
  updateVersusDisplay();
}

// ── LOBBY MODE ────────────────────────────────────────────────────────────────

async function initLobbyMode() {
  myPlayerId = urlPlayerId || sessionStorage.getItem("playerId");

  if (!myPlayerId) {
    window.location.href = `join.html?lobby=${lobbyId}`;
    return;
  }

  const modeInfo = document.getElementById("matchModeInfo");
  if (modeInfo) {
    modeInfo.textContent = "🌐 Online Lobby: " + lobbyId.toUpperCase();
    modeInfo.classList.add("host-active");
  }

  // Fetch lobby
  const { data: lobbyData, error: lobbyError } = await db.from("lobbies").select("*").eq("id", lobbyId).single();
  if (lobbyError || !lobbyData) {
    alert("Lobby not found.");
    window.location.href = "index.html";
    return;
  }

  // Fetch this player (retry once to handle brief DB propagation lag after join)
  let playerData = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data } = await db.from("players").select("*").eq("id", myPlayerId).single();
    if (data) { playerData = data; break; }
    if (attempt === 0) await new Promise(r => setTimeout(r, 600));
  }
  if (!playerData) {
    window.location.href = `join.html?lobby=${lobbyId}`;
    return;
  }
  if (playerData.kicked) {
    alert("You have been kicked from this game.");
    window.location.href = "index.html";
    return;
  }

  myTeam = playerData.team;
  isHost = playerData.is_host;
  const isSpectator = playerData.is_spectator;

  const settings = lobbyData.settings || {};
  boardSize = settings.boardSize || 5;
  freeCenter = settings.freeSpace || false;
  versusInterval = settings.versusInterval || 5;

  // Load custom challenges if any
  const boardIds = lobbyData.board_challenge_ids || [];
  const customIds = boardIds.filter(item => item.source === "custom").map(item => item.id);
  if (customIds.length > 0) {
    const { data: customs } = await db.from("custom_challenges").select("*").eq("lobby_id", lobbyId);
    (customs || []).forEach(c => {
      customChallengesMap[c.id] = {
        id: customChallengeId(c.id),
        text: c.text,
        type: c.type,
        game: c.game,
        source: "custom"
      };
    });
  }

  // Build currentChallengeIds as prefixed strings
  currentChallengeIds = boardIds.map(item => item.id);

  // Load existing claims
  const { data: claims } = await db.from("claims").select("*").eq("lobby_id", lobbyId);
  (claims || []).forEach(claim => {
    boardState[claim.challenge_id] = { team: claim.team, playerName: claim.player_name };
  });

  // Load claim log
  claimLogData = (claims || []).sort((a, b) => new Date(a.claimed_at) - new Date(b.claimed_at));
  renderClaimLog();

  // Load versus state
  const { data: vsData } = await db.from("versus_state").select("*").eq("lobby_id", lobbyId).single();
  if (vsData) {
    activeVersusChallengeId = vsData.active_challenge_id || null;
    nextVersusChallengeId = vsData.next_challenge_id || null;
    nextVersusTime = vsData.next_versus_timestamp || (Date.now() + versusInterval * 60 * 1000);
    unlockedVersus = new Set((vsData.unlocked_challenge_ids || []).map(String));
  }

  // Load players
  const { data: playersData } = await db.from("players").select("*").eq("lobby_id", lobbyId).eq("kicked", false);
  lobbyPlayers = playersData || [];
  renderPlayerBar();

  // Update footer
  if (isSpectator) {
    document.getElementById("boardFooter").innerHTML = "<p>👁️ You are spectating — you cannot claim tiles</p>";
  } else {
    document.getElementById("boardFooter").innerHTML = `<p>Click a tile to claim it for ${TEAM_EMOJIS[myTeam] || ""} <strong>${TEAM_LABELS[myTeam] || myTeam} Team</strong> | Right-click to unclaim</p>`;
  }

  // Build score containers for all teams
  buildScoreContainers(settings.teamCount || 2);

  lobbyPlayerBar.style.display = "flex";
  renderBoard();
  updateScores();
  if (nextVersusChallengeId) highlightNextVersusCell();
  // Apply active-versus class if a challenge is currently active
  if (activeVersusChallengeId) {
    const activeCell = gridEl.querySelector(`[data-challenge-id='${activeVersusChallengeId}']`);
    if (activeCell) activeCell.classList.add("active-versus");
  }
  setupVersusTimer();
  updateVersusDisplay();
  subscribeToLobbyUpdates();
}

function buildScoreContainers(teamCount) {
  const container = document.getElementById("teamScoreContainer");
  container.innerHTML = "";
  TEAM_COLORS.slice(0, teamCount).forEach(team => {
    const div = document.createElement("div");
    div.className = `team ${team}`;
    div.style.borderColor = teamBorderColor(team);
    div.innerHTML = `<span class="team-icon">${TEAM_EMOJIS[team]}</span><span class="team-label">${TEAM_LABELS[team]} Team</span><span class="team-count" id="count-${team}">0</span>`;
    container.appendChild(div);
  });
}

function teamBorderColor(team) {
  const map = { blue: "rgba(31,79,216,0.6)", red: "rgba(193,18,31,0.6)", green: "rgba(40,180,60,0.6)", yellow: "rgba(220,180,0,0.6)" };
  return map[team] || "rgba(138,43,226,0.3)";
}

function renderPlayerBar() {
  playerBarItems.innerHTML = "";
  lobbyPlayers.forEach(p => {
    const span = document.createElement("span");
    span.className = "player-bar-item" + (p.is_spectator ? " spectator" : " team-" + p.team);
    span.textContent = (p.is_spectator ? "👁️" : (TEAM_EMOJIS[p.team] || "")) + " " + p.name;
    playerBarItems.appendChild(span);
  });
}

function subscribeToLobbyUpdates() {
  db.channel("board-" + lobbyId)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "claims", filter: `lobby_id=eq.${lobbyId}` }, (payload) => {
      handleRemoteClaim(payload.new, "insert");
    })
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "claims", filter: `lobby_id=eq.${lobbyId}` }, (payload) => {
      handleRemoteClaim(payload.old, "delete");
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "players", filter: `lobby_id=eq.${lobbyId}` }, () => {
      reloadPlayers();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "versus_state", filter: `lobby_id=eq.${lobbyId}` }, (payload) => {
      if (!isHost) syncVersusState(payload.new);
    })
    .subscribe();

  // Watch for being kicked
  db.channel("kick-watch-" + myPlayerId)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "players", filter: `id=eq.${myPlayerId}` }, (payload) => {
      if (payload.new.kicked) {
        alert("You have been kicked from the game.");
        window.location.href = "index.html";
      }
    })
    .subscribe();
}

async function reloadPlayers() {
  const { data } = await db.from("players").select("*").eq("lobby_id", lobbyId).eq("kicked", false);
  lobbyPlayers = data || [];
  renderPlayerBar();
}

function handleRemoteClaim(claimRow, type) {
  const cid = claimRow.challenge_id;
  if (type === "insert") {
    boardState[cid] = { team: claimRow.team, playerName: claimRow.player_name };
    claimLogData.push(claimRow);
    renderClaimLog();
    playClaimSound();
    const challengeText = getChallengeTextById(cid);
    showToast(`${TEAM_EMOJIS[claimRow.team] || ""} <strong>${escapeHtml(claimRow.player_name)}</strong> claimed: ${escapeHtml(challengeText)}`);
    // boardState is now updated — safe to check versus completion
    handleVersusCompletion(cid);
  } else {
    delete boardState[cid];
  }

  const cell = gridEl.querySelector(`[data-challenge-id='${cid}']`);
  if (cell) applyClaimStateToCell(cell, cid);
  updateScores();
  checkAndHighlightBingo();
}

function syncVersusState(vsRow) {
  activeVersusChallengeId = vsRow.active_challenge_id || null;
  nextVersusChallengeId = vsRow.next_challenge_id || null;
  nextVersusTime = vsRow.next_versus_timestamp;
  unlockedVersus = new Set((vsRow.unlocked_challenge_ids || []).map(String));

  // Apply active-versus CSS class (host uses activateNextVersusChallenge; players sync here)
  document.querySelectorAll(".bingo-cell.active-versus").forEach(el => el.classList.remove("active-versus"));
  if (activeVersusChallengeId) {
    const activeCell = gridEl.querySelector(`[data-challenge-id='${activeVersusChallengeId}']`);
    if (activeCell) activeCell.classList.add("active-versus");
  }

  highlightNextVersusCell();
  updateVersusAvailability();
  updateVersusDisplay();
}

// ── CHALLENGE RESOLUTION ──────────────────────────────────────────────────────

// Works for both plain numeric IDs (solo) and prefixed IDs (lobby)
function getChallengeById_any(id) {
  if (typeof id === "string" && id.startsWith("custom_")) {
    const numId = Number(id.slice(7));
    return customChallengesMap[numId] || null;
  }
  const numId = typeof id === "string" && id.startsWith("csv_") ? Number(id.slice(4)) : Number(id);
  return getChallengeById(numId);
}

function getChallengeTextById(id) {
  const ch = getChallengeById_any(id);
  return ch ? ch.text : String(id);
}

// ── RENDERING ─────────────────────────────────────────────────────────────────

function createChallengeCell(challenge, id) {
  const cell = document.createElement("div");
  cell.classList.add("bingo-cell", `type-${challenge.type.trim()}`);
  cell.dataset.challengeId = id;

  const gameKey = isLobbyMode ? challenge.game : normalizeGameKey(challenge.game);
  const displayGame = gameNames[gameKey] || challenge.game;

  cell.innerHTML = `
    <div class="bingo-next-timer">--:--</div>
    <div class="bingo-icon">${iconMap[challenge.type.trim()] || ""}</div>
    <div class="bingo-text">${challenge.text}</div>
    <div class="bingo-game-badge">${displayGame}</div>
    <div class="bingo-claimer"></div>
  `;

  applyClaimStateToCell(cell, id);

  // Versus timer click
  const timerEl = cell.querySelector(".bingo-next-timer");
  if (timerEl && challenge.type.trim() === "versus") {
    timerEl.addEventListener("click", (e) => {
      e.stopPropagation();
      if (isLobbyMode && !isHost) return; // only host can manually advance
      if (String(activeVersusChallengeId) === String(id)) {
        // Demote active back to next-up with a fresh timer (don't start new cycle)
        nextVersusChallengeId = activeVersusChallengeId;
        activeVersusChallengeId = null;
        nextVersusTime = Date.now() + versusInterval * 60 * 1000;
        if (!isLobbyMode) { localStorage.setItem("nextVersusTimestamp", nextVersusTime); saveVersusState(); }
        updateVersusDisplay();
        if (isLobbyMode) writeVersusStateToDb();
      } else if (String(nextVersusChallengeId) === String(id)) {
        // Skip timer → activate. Do NOT start next cycle yet — that happens on claim.
        activateNextVersusChallenge();
        updateVersusDisplay();
        if (isLobbyMode) writeVersusStateToDb();
      }
    });
  }

  // Claim on click
  cell.addEventListener("click", () => handleCellClick(cell, challenge, id));
  cell.addEventListener("contextmenu", e => { e.preventDefault(); handleCellRightClick(cell, challenge, id); });

  return cell;
}

function applyClaimStateToCell(cell, id) {
  const claim = boardState[id];
  const claimerEl = cell.querySelector(".bingo-claimer");

  // Remove all team classes
  cell.classList.remove("claimed-blue", "claimed-red", "claimed-green", "claimed-yellow");

  if (claim && (typeof claim === "string" ? claim : claim.team)) {
    const team = typeof claim === "string" ? claim : claim.team;
    const playerName = typeof claim === "object" ? (claim.playerName || "") : "";
    cell.classList.add("claimed-" + team);
    if (claimerEl && playerName) claimerEl.textContent = playerName;
    else if (claimerEl) claimerEl.textContent = "";
  } else {
    if (claimerEl) claimerEl.textContent = "";
  }
}

function handleCellClick(cell, challenge, id) {
  if (isLobbyMode) {
    const isSpectator = sessionStorage.getItem("isSpectator") === "true";
    if (isSpectator) return;

    if (challenge.type.trim() === "versus") {
      const isClaimed = !!boardState[id];
      const isUnlocked = unlockedVersus.has(String(id));
      if (!isClaimed && String(activeVersusChallengeId) !== String(id) && !isUnlocked) return;

      // Versus tiles: left-click claims for your team (overrides any current owner — for error correction)
      // Right-click is used to unclaim; here just claim/override
      const existing = boardState[id];
      const currentTeam = typeof existing === "string" ? existing : existing?.team;
      if (currentTeam === myTeam) {
        unclaimLobbyTile(id); // toggle off if already yours
      } else {
        claimLobbyTile(id);   // claim/override
      }
      return;
    }

    const existing = boardState[id];
    if (existing && (typeof existing === "string" ? existing : existing.team) === myTeam) {
      unclaimLobbyTile(id);
    } else if (!existing) {
      claimLobbyTile(id);
    }
    return;
  }

  // Solo mode
  if (challenge.type.trim() === "versus") {
    const isClaimed = boardState[id] === "blue" || boardState[id] === "red";
    const isUnlocked = unlockedVersus.has(Number(id));
    if (!isClaimed && activeVersusChallengeId !== id && !isUnlocked) return;
  }

  if (boardState[id] === "blue") {
    boardState[id] = "";
    cell.classList.remove("claimed-blue");
  } else {
    boardState[id] = "blue";
    cell.classList.remove("claimed-red");
    cell.classList.add("claimed-blue");
  }
  handleVersusCompletion(id);
  saveBoardState(currentChallengeIds, boardState);
  saveVersusState();
  updateScores();
}

function handleCellRightClick(cell, challenge, id) {
  if (isLobbyMode) {
    const isSpectator = sessionStorage.getItem("isSpectator") === "true";
    if (isSpectator) return;
    const existing = boardState[id];
    if (existing) {
      const owner = typeof existing === "string" ? existing : existing.team;
      if (owner === myTeam) unclaimLobbyTile(id);
    }
    return;
  }

  // Solo mode
  if (challenge.type.trim() === "versus") {
    const isClaimed = boardState[id] === "blue" || boardState[id] === "red";
    const isUnlocked = unlockedVersus.has(Number(id));
    if (!isClaimed && activeVersusChallengeId !== id && !isUnlocked) return;
  }

  if (boardState[id] === "red") {
    boardState[id] = "";
    cell.classList.remove("claimed-red");
  } else {
    boardState[id] = "red";
    cell.classList.remove("claimed-blue");
    cell.classList.add("claimed-red");
  }
  handleVersusCompletion(id);
  saveBoardState(currentChallengeIds, boardState);
  saveVersusState();
  updateScores();
}

async function claimLobbyTile(challengeId) {
  const playerName = sessionStorage.getItem("playerName") || "Player";
  await db.from("claims").upsert({
    lobby_id: lobbyId,
    challenge_id: String(challengeId),
    player_id: myPlayerId,
    player_name: playerName,
    team: myTeam
  });
  // Do NOT call handleVersusCompletion here — boardState isn't updated yet.
  // handleRemoteClaim fires for everyone (including the claimer) after Supabase
  // processes the insert, at which point boardState is correct.
}

async function unclaimLobbyTile(challengeId) {
  await db.from("claims").delete().eq("lobby_id", lobbyId).eq("challenge_id", String(challengeId));
}

function createFreeSpaceCell() {
  const cell = document.createElement("div");
  cell.classList.add("bingo-cell", "free-space");
  cell.innerHTML = `<div class="bingo-text">FREE SPACE</div>`;
  return cell;
}

function renderBoard() {
  gridEl.innerHTML = "";
  gridEl.style.gridTemplateColumns = `repeat(${boardSize}, 1fr)`;
  document.documentElement.style.setProperty("--board-size", boardSize);
  const totalCells = boardSize * boardSize;
  const centerIndex = Math.floor(totalCells / 2);
  let challengeIndex = 0;

  for (let i = 0; i < totalCells; i++) {
    if (freeCenter && i === centerIndex) {
      gridEl.appendChild(createFreeSpaceCell());
      continue;
    }
    const challengeId = currentChallengeIds[challengeIndex++];
    const challenge = getChallengeById_any(challengeId);
    if (!challenge) {
      gridEl.appendChild(createFreeSpaceCell());
      continue;
    }
    gridEl.appendChild(createChallengeCell(challenge, challengeId));
  }
}

// ── SCORES ────────────────────────────────────────────────────────────────────

function updateScores() {
  if (isLobbyMode) {
    const counts = {};
    TEAM_COLORS.forEach(t => { counts[t] = 0; });
    Object.values(boardState).forEach(claim => {
      const team = typeof claim === "string" ? claim : claim?.team;
      if (team && counts[team] !== undefined) counts[team]++;
    });
    TEAM_COLORS.forEach(team => {
      const el = document.getElementById("count-" + team);
      if (el) el.textContent = counts[team] || 0;
    });
  } else {
    const blueCount = Object.values(boardState).filter(v => v === "blue").length;
    const redCount = Object.values(boardState).filter(v => v === "red").length;
    const blueEl = document.getElementById("blueCount");
    const redEl = document.getElementById("redCount");
    if (blueEl) blueEl.textContent = blueCount;
    if (redEl) redEl.textContent = redCount;
  }
  checkAndHighlightBingo();
}

// ── BINGO DETECTION ───────────────────────────────────────────────────────────

function checkAndHighlightBingo() {
  document.querySelectorAll(".bingo-cell.bingo-winner").forEach(el => el.classList.remove("bingo-winner"));

  const grid = [];
  for (let i = 0; i < boardSize; i++) grid[i] = [];

  const totalCells = boardSize * boardSize;
  const centerIndex = Math.floor(totalCells / 2);
  let challengeIndex = 0;
  let cellIndex = 0;

  for (let i = 0; i < boardSize; i++) {
    for (let j = 0; j < boardSize; j++) {
      if (freeCenter && cellIndex === centerIndex) {
        grid[i][j] = { id: null, state: "free" };
      } else {
        const cid = currentChallengeIds[challengeIndex++];
        const claim = boardState[cid];
        const state = typeof claim === "string" ? claim : (claim?.team || "");
        grid[i][j] = { id: cid, state };
      }
      cellIndex++;
    }
  }

  const winnerIds = [];
  let winningTeam = null;

  function checkSlice(slice) {
    if (!slice || slice.length < 5) return;
    const first = slice[0].state;
    if (first !== "blue" && first !== "red" && first !== "green" && first !== "yellow" && first !== "free") return;
    if (first === "free") return;
    if (slice.every(c => c && (c.state === first || c.state === "free"))) {
      slice.forEach(c => { if (c.id) winnerIds.push(c.id); });
      winningTeam = first;
    }
  }

  for (let i = 0; i < boardSize; i++) {
    for (let j = 0; j <= boardSize - 5; j++) checkSlice([grid[i][j], grid[i][j+1], grid[i][j+2], grid[i][j+3], grid[i][j+4]]);
  }
  for (let j = 0; j < boardSize; j++) {
    for (let i = 0; i <= boardSize - 5; i++) checkSlice([grid[i][j], grid[i+1][j], grid[i+2][j], grid[i+3][j], grid[i+4][j]]);
  }
  for (let i = 0; i <= boardSize - 5; i++) {
    for (let j = 0; j <= boardSize - 5; j++) checkSlice([grid[i][j], grid[i+1][j+1], grid[i+2][j+2], grid[i+3][j+3], grid[i+4][j+4]]);
  }
  for (let i = 0; i <= boardSize - 5; i++) {
    for (let j = 4; j < boardSize; j++) checkSlice([grid[i][j], grid[i+1][j-1], grid[i+2][j-2], grid[i+3][j-3], grid[i+4][j-4]]);
  }

  winnerIds.forEach(id => {
    const cell = gridEl.querySelector(`[data-challenge-id='${id}']`);
    if (cell) cell.classList.add("bingo-winner");
  });

  if (winningTeam && !bingoShown) {
    bingoShown = true;
    showBingoVictory(winningTeam);
  }
}

function showBingoVictory(team) {
  document.getElementById("bingoVictoryEmoji").textContent = TEAM_EMOJIS[team] || "🏆";
  document.getElementById("bingoVictoryTitle").textContent = "BINGO!";
  document.getElementById("bingoVictoryTeam").textContent = (TEAM_LABELS[team] || team) + " Team wins!";
  bingoVictoryModal.style.display = "flex";
  playClaimSound();
}

// ── VERSUS TIMER ──────────────────────────────────────────────────────────────

function updateVersusDisplay() {
  // Must highlight cells FIRST so the correct class is on the DOM before we set text
  highlightNextVersusCell();
  updateVersusAvailability();

  let timerLabel = "--:--";
  if (nextVersusTime) {
    const countdown = Math.max(0, nextVersusTime - Date.now());
    const mm = String(Math.floor(countdown / 60000)).padStart(2, "0");
    const ss = String(Math.floor((countdown % 60000) / 1000)).padStart(2, "0");
    timerLabel = `${mm}:${ss}`;
  }

  document.querySelectorAll(".bingo-cell.next-up-versus .bingo-next-timer").forEach(el => {
    el.textContent = `Next in ${timerLabel}`;
  });
  document.querySelectorAll(".bingo-cell.active-versus .bingo-next-timer").forEach(el => {
    el.textContent = "ACTIVE";
  });
}

function chooseRandomVersusChallenge() {
  const candidates = currentChallengeIds
    .map(id => ({ id, challenge: getChallengeById_any(id) }))
    .filter(item => {
      if (!item.challenge || item.challenge.type.trim() !== "versus") return false;
      const claim = boardState[item.id];
      return !claim || (typeof claim === "string" ? !claim : !claim.team);
    });

  if (candidates.length === 0) { nextVersusChallengeId = null; return; }
  nextVersusChallengeId = candidates[Math.floor(Math.random() * candidates.length)].id;
  if (!isLobbyMode) localStorage.setItem("nextVersusChallengeId", nextVersusChallengeId);
}

function activateNextVersusChallenge() {
  if (!nextVersusChallengeId) return;
  activeVersusChallengeId = nextVersusChallengeId;
  unlockedVersus.add(String(activeVersusChallengeId));
  nextVersusChallengeId = null;
  if (!isLobbyMode) localStorage.removeItem("nextVersusChallengeId");

  document.querySelectorAll(".bingo-cell.next-up-versus").forEach(el => el.classList.remove("next-up-versus"));
  document.querySelectorAll(".bingo-cell.active-versus").forEach(el => el.classList.remove("active-versus"));

  const activeCell = gridEl.querySelector(`[data-challenge-id='${activeVersusChallengeId}']`);
  if (activeCell) {
    activeCell.classList.add("active-versus");
    activeCell.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  updateVersusAvailability();
  if (!isLobbyMode) saveVersusState();
}

function highlightNextVersusCell() {
  document.querySelectorAll(".bingo-cell.next-up-versus").forEach(el => {
    el.classList.remove("next-up-versus");
    const t = el.querySelector(".bingo-next-timer");
    if (t) t.textContent = "";
  });
  if (!nextVersusChallengeId) return;
  const nextCell = gridEl.querySelector(`[data-challenge-id='${nextVersusChallengeId}']`);
  if (nextCell) {
    nextCell.classList.add("next-up-versus");
    nextCell.classList.remove("unavailable");
  }
  updateVersusAvailability();
}

function updateVersusAvailability() {
  gridEl.querySelectorAll(".bingo-cell.type-versus").forEach(cell => {
    const id = cell.dataset.challengeId;
    const claim = boardState[id];
    const isClaimed = typeof claim === "string" ? !!claim : !!claim?.team;
    const isUnlocked = unlockedVersus.has(String(id));
    const isActive = String(activeVersusChallengeId) === String(id);
    const isNext = String(nextVersusChallengeId) === String(id);

    if (isActive || isNext || isClaimed || isUnlocked) {
      cell.classList.remove("unavailable");
    } else {
      cell.classList.add("unavailable");
    }
  });
}

function saveVersusState() {
  localStorage.setItem("activeVersusChallengeId", activeVersusChallengeId != null ? String(activeVersusChallengeId) : "");
  localStorage.setItem("nextVersusChallengeId", nextVersusChallengeId != null ? String(nextVersusChallengeId) : "");
  localStorage.setItem("unlockedVersusChallengeIds", JSON.stringify([...unlockedVersus]));
}

async function writeVersusStateToDb() {
  if (!isLobbyMode || !isHost) return;
  await db.from("versus_state").upsert({
    lobby_id: lobbyId,
    active_challenge_id: activeVersusChallengeId ? String(activeVersusChallengeId) : null,
    next_challenge_id: nextVersusChallengeId ? String(nextVersusChallengeId) : null,
    next_versus_timestamp: nextVersusTime,
    unlocked_challenge_ids: [...unlockedVersus]
  });
}

function loadNextVersusCycle() {
  nextVersusTime = Date.now() + versusInterval * 60 * 1000;
  if (!isLobbyMode) localStorage.setItem("nextVersusTimestamp", nextVersusTime);
  if (!nextVersusChallengeId) chooseRandomVersusChallenge();
  if (!isLobbyMode) saveVersusState();
}

function setupVersusTimer() {
  const hasVersus = currentChallengeIds.some(id => {
    const ch = getChallengeById_any(id);
    return ch && ch.type.trim() === "versus";
  });
  if (!hasVersus) return;
  if (versusTimerId) clearInterval(versusTimerId);
  if (!nextVersusChallengeId) chooseRandomVersusChallenge();
  updateVersusDisplay();

  // Non-host lobby players get a display-only timer (no activation — that's host's job)
  if (isLobbyMode && !isHost) {
    versusTimerId = setInterval(() => { updateVersusDisplay(); }, 1000);
    return;
  }

  versusTimerId = setInterval(() => {
    if (activeVersusChallengeId) { updateVersusDisplay(); return; }
    if (nextVersusTime && Date.now() >= nextVersusTime) {
      // Timer hit 0 → activate. Next cycle starts only when the challenge is claimed.
      activateNextVersusChallenge();
      if (isLobbyMode) writeVersusStateToDb();
    }
    updateVersusDisplay();
  }, 1000);
}

function handleVersusCompletion(challengeId) {
  const claim = boardState[challengeId];
  const team = typeof claim === "string" ? claim : claim?.team;
  if (String(challengeId) === String(activeVersusChallengeId) && team) {
    const cell = gridEl.querySelector(`[data-challenge-id='${challengeId}']`);
    if (cell) {
      cell.classList.remove("active-versus", "next-up-versus");
      const t = cell.querySelector(".bingo-next-timer");
      if (t) t.textContent = "";
    }
    unlockedVersus.add(String(challengeId));
    activeVersusChallengeId = null;

    if (!isLobbyMode) {
      // Solo: this player drives everything locally
      loadNextVersusCycle();
      saveVersusState();
    } else if (isHost) {
      // Lobby host: pick next challenge, start timer, write to DB so all players sync
      loadNextVersusCycle();
      writeVersusStateToDb();
    }
    // Non-host players: do nothing here — syncVersusState() will fire when host writes to DB

    updateVersusDisplay();
  }
}

// ── TOAST NOTIFICATIONS ───────────────────────────────────────────────────────

function showToast(html) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = html;
  toastContainer.appendChild(toast);
  requestAnimationFrame(() => { toast.classList.add("toast-visible"); });
  setTimeout(() => {
    toast.classList.remove("toast-visible");
    setTimeout(() => toast.remove(), 400);
  }, 4000);
}

// ── CLAIM LOG ─────────────────────────────────────────────────────────────────

function renderClaimLog() {
  claimLogEntries.innerHTML = "";
  if (claimLogData.length === 0) {
    claimLogEntries.innerHTML = '<p class="waiting-text">No claims yet.</p>';
    return;
  }
  [...claimLogData].reverse().forEach(claim => {
    const div = document.createElement("div");
    div.className = "claim-log-entry";
    const time = new Date(claim.claimed_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const challengeText = getChallengeTextById(claim.challenge_id);
    div.innerHTML = `<span class="claim-log-time">${time}</span> ${TEAM_EMOJIS[claim.team] || ""} <strong>${escapeHtml(claim.player_name)}</strong>: ${escapeHtml(challengeText)}`;
    claimLogEntries.appendChild(div);
  });
}

// ── CONTROLS ──────────────────────────────────────────────────────────────────

fullscreenBtn.addEventListener("click", () => {
  const container = document.querySelector(".bingo-container") || document.documentElement;
  if (!document.fullscreenElement) {
    container.requestFullscreen().then(() => { fullscreenBtn.textContent = "🗗 Exit Fullscreen"; }).catch(() => {});
  } else {
    document.exitFullscreen().then(() => { fullscreenBtn.textContent = "⛶ Fullscreen"; }).catch(() => {});
  }
});

document.addEventListener("fullscreenchange", () => {
  if (document.fullscreenElement) {
    fullscreenBtn.textContent = "🗗 Exit Fullscreen";
    document.body.classList.add("fullscreen-mode");
  } else {
    fullscreenBtn.textContent = "⛶ Fullscreen";
    document.body.classList.remove("fullscreen-mode");
  }
});

backBtn.addEventListener("click", () => {
  if (isLobbyMode) {
    if (confirm("Leave this game and return to the main menu?")) {
      window.location.href = "index.html";
    }
  } else {
    window.location.href = "index.html";
  }
});

shareBtn.addEventListener("click", () => {
  let url;
  if (isLobbyMode) {
    url = window.location.origin + window.location.pathname.replace("board.html", "") + `join.html?lobby=${lobbyId}`;
  } else {
    url = window.location.origin + window.location.pathname.replace("board.html", "") +
      "board.html?challenges=" + currentChallengeIds.join(",") + "&interval=" + versusInterval;
  }
  navigator.clipboard.writeText(url).then(() => alert("✅ Link copied!\n\n" + url)).catch(() => alert("Link:\n\n" + url));
});

resetBtn.addEventListener("click", async () => {
  if (!confirm("🔄 Reset all claims? This cannot be undone.")) return;

  if (isLobbyMode) {
    if (!isHost) { alert("Only the host can reset the board."); return; }
    await db.from("claims").delete().eq("lobby_id", lobbyId);
    boardState = {};
    claimLogData = [];
    renderClaimLog();
  } else {
    boardState = {};
    activeVersusChallengeId = null;
    nextVersusChallengeId = null;
    unlockedVersus.clear();
    localStorage.removeItem("unlockedVersusChallengeIds");
    localStorage.removeItem("activeVersusChallengeId");
    localStorage.removeItem("nextVersusChallengeId");
    saveBoardState(currentChallengeIds, boardState);
    saveVersusState();
  }

  bingoShown = false;
  activeVersusChallengeId = null;
  nextVersusChallengeId = null;
  unlockedVersus.clear();
  loadNextVersusCycle();
  updateScores();
  renderBoard();
  setupVersusTimer();
  if (isLobbyMode && isHost) writeVersusStateToDb();
});

// ── HELPERS ───────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
