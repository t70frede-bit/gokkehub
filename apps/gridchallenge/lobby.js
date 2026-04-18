// Lobby Page Logic
const params = new URLSearchParams(window.location.search);
const lobbyId = params.get("lobby");
const urlPlayerId = params.get("player");

const playerId = urlPlayerId || sessionStorage.getItem("playerId");
let isHost = false;
let lobby = null;
let players = [];
let customChallenges = [];
let poolMode = "standard";
let freeCenter = false;
let subscription = null;

const lobbyCodeDisplay = document.getElementById("lobbyCodeDisplay");
const copyLinkBtn = document.getElementById("copyLinkBtn");
const hostSettingsPanel = document.getElementById("hostSettingsPanel");
const startGamePanel = document.getElementById("startGamePanel");
const startGameBtn = document.getElementById("startGameBtn");
const startGameError = document.getElementById("startGameError");
const playerWaitingPanel = document.getElementById("playerWaitingPanel");
const lobbyPlayerList = document.getElementById("lobbyPlayerList");
const playerCountEl = document.getElementById("playerCount");
const lobbyStatusText = document.getElementById("lobbyStatusText");
const lobbyRoleText = document.getElementById("lobbyRoleText");
const customChallengePanel = document.getElementById("customChallengePanel");
const customChallengeList = document.getElementById("customChallengeList");
const customChallengeToggleBar = document.getElementById("customChallengeToggleBar");
const toggleCustomFormBtn = document.getElementById("toggleCustomFormBtn");
const poolToggle = document.getElementById("poolToggle");
const lobbyBoardSize = document.getElementById("lobbyBoardSize");
const lobbyVersusCount = document.getElementById("lobbyVersusCount");
const lobbyVersusInterval = document.getElementById("lobbyVersusInterval");
const lobbyFreeSpaceBtn = document.getElementById("lobbyFreeSpaceBtn");
const teamCountSelect = document.getElementById("teamCountSelect");
const lobbyGamesGrid = document.getElementById("lobbyGamesGrid");

if (!lobbyId || !playerId) {
  alert("Missing lobby or player info. Redirecting to home.");
  window.location.href = "index.html";
}

lobbyCodeDisplay.textContent = lobbyId.toUpperCase();

copyLinkBtn.addEventListener("click", () => {
  const joinUrl = window.location.origin + window.location.pathname.replace("lobby.html", "") + "join.html?lobby=" + lobbyId;
  navigator.clipboard.writeText(joinUrl).then(() => {
    copyLinkBtn.textContent = "✅ Copied!";
    setTimeout(() => { copyLinkBtn.textContent = "📋 Copy Join Link"; }, 2000);
  });
});

// Free space toggle
lobbyFreeSpaceBtn.addEventListener("click", () => {
  freeCenter = !freeCenter;
  lobbyFreeSpaceBtn.textContent = freeCenter ? "Free space ON" : "Free space OFF";
  lobbyFreeSpaceBtn.setAttribute("aria-pressed", freeCenter.toString());
  lobbyFreeSpaceBtn.classList.toggle("active", freeCenter);
});

// Pool mode toggle (host only — syncs to players via Supabase)
poolToggle.querySelectorAll(".pool-option").forEach(btn => {
  btn.addEventListener("click", async () => {
    poolMode = btn.dataset.pool;
    poolToggle.querySelectorAll(".pool-option").forEach(b => b.classList.toggle("active", b === btn));
    updateCustomChallengeVisibility();
    // Persist so players see the change in real-time
    if (isHost && lobbyId) {
      const settings = buildCurrentSettings();
      await db.from("lobbies").update({ settings }).eq("id", lobbyId);
    }
  });
});

// Toggle custom challenge form for non-host players
toggleCustomFormBtn.addEventListener("click", () => {
  const isVisible = customChallengePanel.style.display !== "none";
  customChallengePanel.style.display = isVisible ? "none" : "block";
  toggleCustomFormBtn.textContent = isVisible ? "➕ Add Custom Challenge" : "➖ Hide Form";
});

function updateCustomChallengeVisibility() {
  const showCustom = poolMode === "standard+custom" || poolMode === "custom";
  // Show the toggle button to all players; hide everything if custom not enabled
  customChallengeToggleBar.style.display = showCustom ? "block" : "none";
  if (!showCustom) customChallengePanel.style.display = "none";
  // If host, always show the panel expanded when custom is enabled
  if (isHost && showCustom) customChallengePanel.style.display = "block";
}

// Versus fields visibility
document.querySelectorAll(".type-select").forEach(cb => {
  cb.addEventListener("change", updateVersusFieldsVisibility);
});
function updateVersusFieldsVisibility() {
  const versusChecked = [...document.querySelectorAll(".type-select")].some(cb => cb.value === "versus" && cb.checked);
  document.getElementById("versusCountField").style.display = versusChecked ? "" : "none";
  document.getElementById("versusIntervalField").style.display = versusChecked ? "" : "none";
}
updateVersusFieldsVisibility();

// Custom challenge submission
document.getElementById("submitCustomBtn").addEventListener("click", submitCustomChallenge);

async function submitCustomChallenge() {
  const text = document.getElementById("customText").value.trim();
  const type = document.getElementById("customType").value;
  const game = document.getElementById("customGame").value.trim();
  if (!text || !game) { alert("Please fill in the challenge text and game name."); return; }

  const playerName = sessionStorage.getItem("playerName") || "Unknown";
  const { error } = await db.from("custom_challenges").insert({
    lobby_id: lobbyId, player_id: playerId, player_name: playerName,
    text, type, game
  });
  if (error) { alert("Failed to submit challenge: " + error.message); return; }

  document.getElementById("customText").value = "";
  document.getElementById("customGame").value = "";
}

// Init
async function init() {
  const { data: lobbyData, error: lobbyError } = await db.from("lobbies").select("*").eq("id", lobbyId).single();
  if (lobbyError || !lobbyData) {
    alert("Lobby not found.");
    window.location.href = "index.html";
    return;
  }
  lobby = lobbyData;

  if (lobby.status === "playing") {
    redirectToBoard();
    return;
  }

  const { data: playerData } = await db.from("players").select("*").eq("id", playerId).single();
  if (!playerData) {
    alert("Player session not found. Please rejoin.");
    window.location.href = `join.html?lobby=${lobbyId}`;
    return;
  }

  if (playerData.kicked) {
    alert("You have been kicked from this lobby.");
    window.location.href = "index.html";
    return;
  }

  isHost = playerData.is_host;

  // Restore host settings from lobby
  const settings = lobby.settings || {};
  if (settings.boardSize) lobbyBoardSize.value = settings.boardSize;
  if (settings.versusCount !== undefined) lobbyVersusCount.value = settings.versusCount;
  if (settings.versusInterval) lobbyVersusInterval.value = settings.versusInterval;
  if (settings.teamCount) teamCountSelect.value = settings.teamCount;
  if (settings.freeSpace) {
    freeCenter = settings.freeSpace;
    lobbyFreeSpaceBtn.textContent = freeCenter ? "Free space ON" : "Free space OFF";
    lobbyFreeSpaceBtn.classList.toggle("active", freeCenter);
  }
  if (settings.poolMode) {
    poolMode = settings.poolMode;
    poolToggle.querySelectorAll(".pool-option").forEach(b => b.classList.toggle("active", b.dataset.pool === poolMode));
  }
  if (settings.types) {
    document.querySelectorAll(".type-select").forEach(cb => {
      cb.checked = settings.types.includes(cb.value);
    });
    updateVersusFieldsVisibility();
  }
  updateCustomChallengeVisibility();

  await loadChallenges();
  buildGameSelectors(settings.games);

  if (isHost) {
    hostSettingsPanel.style.display = "block";
    startGamePanel.style.display = "block";
    lobbyRoleText.textContent = "🎙️ You are the host";
    lobbyStatusText.textContent = "Lobby is open — share the link so players can join!";
  } else {
    playerWaitingPanel.style.display = "block";
    lobbyRoleText.textContent = "👤 Waiting for host to start...";
  }

  await loadPlayers();
  await loadCustomChallenges();
  subscribeToUpdates();
}

function buildGameSelectors(selectedGames) {
  const games = [...new Set(allChallenges.map(c => c.game.trim()))].filter(v => v).sort();
  lobbyGamesGrid.innerHTML = "";
  games.forEach(game => {
    const label = document.createElement("label");
    label.className = "game-checkbox";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "game-select";
    input.value = game;
    input.checked = !selectedGames || selectedGames.length === 0 || selectedGames.includes(game);
    const span = document.createElement("span");
    span.className = "game-label";
    span.textContent = gameNames[game] || game;
    label.appendChild(input);
    label.appendChild(span);
    lobbyGamesGrid.appendChild(label);
  });
}

async function loadPlayers() {
  const { data } = await db.from("players").select("*").eq("lobby_id", lobbyId).eq("kicked", false).order("created_at");
  players = data || [];
  renderPlayerList();
}

async function loadCustomChallenges() {
  const { data } = await db.from("custom_challenges").select("*").eq("lobby_id", lobbyId).order("id");
  customChallenges = data || [];
  renderCustomChallengeList();
}

function renderPlayerList() {
  playerCountEl.textContent = "(" + players.length + ")";
  if (players.length === 0) {
    lobbyPlayerList.innerHTML = '<p class="waiting-text">No players yet...</p>';
    return;
  }

  lobbyPlayerList.innerHTML = "";
  const activePlayers = players.filter(p => !p.is_spectator);
  const spectators = players.filter(p => p.is_spectator);

  [...activePlayers, ...spectators].forEach(p => {
    const row = document.createElement("div");
    row.className = "lobby-player-row";
    const isGM = p.is_host && p.is_spectator;
    const teamBadge = isGM
      ? '<span class="player-team-badge gm">🎙️ Game Master</span>'
      : p.is_spectator
        ? '<span class="player-team-badge spectator">👁️ Spectator</span>'
        : `<span class="player-team-badge team-${p.team}">${TEAM_EMOJIS[p.team] || ""} ${TEAM_LABELS[p.team] || p.team}</span>`;
    const hostBadge = p.is_host ? '<span class="host-badge">HOST</span>' : "";
    const kickBtn = (isHost && !p.is_host)
      ? `<button class="kick-btn" data-player-id="${p.id}">✕ Kick</button>`
      : "";
    row.innerHTML = `<span class="player-name">${escapeHtml(p.name)}</span>${teamBadge}${hostBadge}${kickBtn}`;
    lobbyPlayerList.appendChild(row);
  });

  // Attach kick handlers
  lobbyPlayerList.querySelectorAll(".kick-btn").forEach(btn => {
    btn.addEventListener("click", () => kickPlayer(btn.dataset.playerId));
  });
}

function renderCustomChallengeList() {
  customChallengeList.innerHTML = "";
  if (customChallenges.length === 0) {
    customChallengeList.innerHTML = '<p class="waiting-text">No custom challenges yet.</p>';
    return;
  }
  customChallenges.forEach(c => {
    const div = document.createElement("div");
    div.className = "custom-challenge-item";
    const canDelete = isHost || c.player_id === playerId; // GM/host or submitter
    const deleteBtn = canDelete
      ? `<button class="kick-btn delete-custom-btn" data-id="${c.id}" title="Delete">✕</button>`
      : "";
    div.innerHTML = `<strong>${escapeHtml(c.text)}</strong> <span class="challenge-meta">${iconMap[c.type] || ""} ${escapeHtml(c.game)} — by ${escapeHtml(c.player_name)}</span>${deleteBtn}`;
    customChallengeList.appendChild(div);
  });

  customChallengeList.querySelectorAll(".delete-custom-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.dataset.id);
      btn.disabled = true;
      const { error } = await db.from("custom_challenges").delete().eq("id", id);
      if (error) {
        alert("Failed to delete: " + error.message);
        btn.disabled = false;
      } else {
        // Remove locally immediately; subscription will also refresh
        customChallenges = customChallenges.filter(c => c.id !== id);
        renderCustomChallengeList();
      }
    });
  });
}

async function kickPlayer(targetPlayerId) {
  if (!confirm("Kick this player?")) return;
  await db.from("players").update({ kicked: true }).eq("id", targetPlayerId);
}

function buildCurrentSettings() {
  const selectedGames = [...document.querySelectorAll(".game-select")].filter(cb => cb.checked).map(cb => cb.value);
  const selectedTypes = [...document.querySelectorAll(".type-select")].filter(cb => cb.checked).map(cb => cb.value);
  return {
    boardSize: Math.max(3, Math.min(9, parseInt(lobbyBoardSize.value, 10) || 5)),
    versusInterval: Math.max(1, Math.min(60, parseInt(lobbyVersusInterval.value, 10) || 5)),
    versusCount: Math.max(0, parseInt(lobbyVersusCount.value, 10) || 0),
    freeSpace: freeCenter,
    games: selectedGames,
    types: selectedTypes,
    poolMode,
    teamCount: parseInt(teamCountSelect.value, 10) || 2
  };
}

function subscribeToUpdates() {
  subscription = db.channel("lobby-" + lobbyId)
    .on("postgres_changes", { event: "*", schema: "public", table: "players", filter: `lobby_id=eq.${lobbyId}` }, () => {
      loadPlayers();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "custom_challenges", filter: `lobby_id=eq.${lobbyId}` }, () => {
      loadCustomChallenges();
    })
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "lobbies", filter: `id=eq.${lobbyId}` }, (payload) => {
      if (payload.new.status === "playing") {
        redirectToBoard();
      }
      // Sync pool mode change to players in real-time
      if (!isHost && payload.new.settings?.poolMode) {
        poolMode = payload.new.settings.poolMode;
        updateCustomChallengeVisibility();
      }
    })
    .subscribe();

  // Watch for being kicked
  db.channel("player-kick-" + playerId)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "players", filter: `id=eq.${playerId}` }, (payload) => {
      if (payload.new.kicked) {
        alert("You have been kicked from the lobby.");
        window.location.href = "index.html";
      }
    })
    .subscribe();
}

function redirectToBoard() {
  window.location.href = `board.html?lobby=${lobbyId}&player=${playerId}`;
}

// Start game (host only)
startGameBtn.addEventListener("click", startGame);

async function startGame() {
  startGameBtn.disabled = true;
  startGameBtn.textContent = "Starting...";
  startGameError.style.display = "none";

  const selectedGames = [...document.querySelectorAll(".game-select")].filter(cb => cb.checked).map(cb => cb.value);
  const selectedTypes = [...document.querySelectorAll(".type-select")].filter(cb => cb.checked).map(cb => cb.value);
  const boardSize = Math.max(3, Math.min(9, parseInt(lobbyBoardSize.value, 10) || 5));
  const versusCount = Math.max(0, parseInt(lobbyVersusCount.value, 10) || 0);
  const versusInterval = Math.max(1, Math.min(60, parseInt(lobbyVersusInterval.value, 10) || 5));
  const teamCount = parseInt(teamCountSelect.value, 10) || 2;
  const currentPoolMode = poolMode;

  const settings = { boardSize, versusCount, versusInterval, teamCount, freeSpace: freeCenter, games: selectedGames, types: selectedTypes, poolMode: currentPoolMode };

  // Build challenge pool
  let csvPool = allChallenges.filter(c => selectedGames.includes(c.game.trim()) && selectedTypes.includes(c.type.trim()));
  let customPool = [];

  if (currentPoolMode === "standard+custom" || currentPoolMode === "custom") {
    const { data: customs } = await db.from("custom_challenges").select("*").eq("lobby_id", lobbyId);
    customPool = (customs || []).map((c, i) => ({
      id: customChallengeId(c.id),
      text: c.text,
      type: c.type,
      game: c.game,
      source: "custom"
    }));
  }

  let pool = [];
  if (currentPoolMode === "standard") {
    pool = csvPool.map(c => ({ ...c, id: csvChallengeId(c.id), source: "csv" }));
  } else if (currentPoolMode === "standard+custom") {
    // Custom challenges come first so they're more likely to appear on the board
    pool = [
      ...customPool,
      ...csvPool.map(c => ({ ...c, id: csvChallengeId(c.id), source: "csv" }))
    ];
  } else {
    pool = customPool;
  }

  const totalCells = boardSize * boardSize;
  const freeCellCount = freeCenter ? 1 : 0;
  const neededChallenges = totalCells - freeCellCount;

  const versusPool = pool.filter(c => c.type === "versus");
  const otherPool = pool.filter(c => c.type !== "versus");
  const actualVersusCount = Math.min(versusCount, versusPool.length);
  const neededOther = neededChallenges - actualVersusCount;

  if (otherPool.length < neededOther) {
    showStartError(`Not enough challenges. Need ${neededOther} non-versus but only have ${otherPool.length}. Try adding more games/types or reducing board size.`);
    return;
  }

  const shuffledVersus = shuffleArray(versusPool).slice(0, actualVersusCount);
  const shuffledOther = shuffleArray(otherPool).slice(0, neededOther);
  const selectedChallenges = shuffleArray([...shuffledVersus, ...shuffledOther]);

  const boardChallengeIds = selectedChallenges.map(c => ({ id: c.id, source: c.source }));

  // Write board + start game in DB
  const { error } = await db.from("lobbies").update({
    status: "playing",
    settings,
    board_challenge_ids: boardChallengeIds
  }).eq("id", lobbyId);

  if (error) {
    showStartError("Failed to start game: " + error.message);
    return;
  }

  // Init versus state
  const versusIds = selectedChallenges.filter(c => c.type === "versus").map(c => c.id);
  if (versusIds.length > 0) {
    const firstNext = versusIds[Math.floor(Math.random() * versusIds.length)];
    await db.from("versus_state").upsert({
      lobby_id: lobbyId,
      active_challenge_id: null,
      next_challenge_id: firstNext,
      next_versus_timestamp: Date.now() + versusInterval * 60 * 1000,
      unlocked_challenge_ids: []
    });
  }

  redirectToBoard();
}

function showStartError(msg) {
  startGameError.textContent = "⚠️ " + msg;
  startGameError.style.display = "block";
  startGameBtn.disabled = false;
  startGameBtn.textContent = "🎮 Start Game";
}

function escapeHtml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

init();
