// Landing Page Logic

// ── MENU NAVIGATION ────────────────────────────────────────────────────────────

const menuCards   = document.getElementById("menuCards");
const joinPanel   = document.getElementById("joinPanel");
const soloPanel   = document.getElementById("soloPanel");

function showPanel(panel) {
  menuCards.style.display = "none";
  [joinPanel, soloPanel].forEach(p => p.style.display = "none");
  if (panel) panel.style.display = "block";
}

function showMenu() {
  [joinPanel, soloPanel].forEach(p => p.style.display = "none");
  menuCards.style.display = "flex";
}

document.getElementById("menuJoinBtn").addEventListener("click", () => {
  showPanel(joinPanel);
  document.getElementById("lobbyCodeInput").focus();
});

document.getElementById("menuSoloBtn").addEventListener("click", () => {
  showPanel(soloPanel);
});

document.getElementById("menuHostBtn").addEventListener("click", () => {
  document.getElementById("hostSetupOverlay").style.display = "flex";
  document.getElementById("hostName").focus();
});

document.getElementById("joinBackBtn").addEventListener("click", showMenu);
document.getElementById("soloBackBtn").addEventListener("click", showMenu);

// ── JOIN LOBBY ─────────────────────────────────────────────────────────────────

document.getElementById("goJoinBtn").addEventListener("click", () => {
  const code = document.getElementById("lobbyCodeInput").value.trim().toLowerCase();
  if (!code) { document.getElementById("lobbyCodeInput").focus(); return; }
  window.location.href = `join.html?lobby=${code}`;
});

document.getElementById("lobbyCodeInput").addEventListener("keydown", e => {
  if (e.key === "Enter") document.getElementById("goJoinBtn").click();
});

// ── SOLO GAME ──────────────────────────────────────────────────────────────────

const generateBtn     = document.getElementById("generateBtn");
const gamesGrid       = document.getElementById("gamesGrid");
const typeCheckboxes  = document.querySelectorAll(".type-select");
const versusSettings  = document.getElementById("versusSettings");
const versusIntervalInput = document.getElementById("versusInterval");
const versusCountInput    = document.getElementById("versusCount");
const boardSizeInput      = document.getElementById("boardSize");
const freeSpaceBtn        = document.getElementById("freeSpaceBtn");
const freeSpaceCheckbox   = document.getElementById("freeSpace");

let freeCenter = false;

freeSpaceBtn.addEventListener("click", () => {
  freeCenter = !freeCenter;
  freeSpaceCheckbox.checked = freeCenter;
  freeSpaceBtn.classList.toggle("active", freeCenter);
  freeSpaceBtn.setAttribute("aria-pressed", freeCenter.toString());
  freeSpaceBtn.textContent = freeCenter ? "Free space ON" : "Free space OFF";
});

loadChallenges().then(() => {
  buildGameSelectors();
  generateBtn.disabled = false;
  setupTypeListeners();
  updateVersusSettingsVisibility();
});

function setupTypeListeners() {
  typeCheckboxes.forEach(cb => cb.addEventListener("change", updateVersusSettingsVisibility));
}

function updateVersusSettingsVisibility() {
  const on = Array.from(typeCheckboxes).some(cb => cb.value === "versus" && cb.checked);
  versusSettings.style.display = on ? "block" : "none";
}

function buildGameSelectors() {
  const games = [...new Set(allChallenges.map(c => c.game.trim()))].filter(v => v).sort();
  gamesGrid.innerHTML = "";
  games.forEach(game => {
    const label = document.createElement("label");
    label.className = "game-checkbox";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "game-select";
    input.value = game;
    input.checked = true;
    const span = document.createElement("span");
    span.className = "game-label";
    span.textContent = gameNames[game] || game;
    label.appendChild(input);
    label.appendChild(span);
    gamesGrid.appendChild(label);
  });
}

function getSelectedGames() {
  return [...document.querySelectorAll(".game-select")].filter(cb => cb.checked).map(cb => cb.value);
}

function getSelectedTypes() {
  return [...typeCheckboxes].filter(cb => cb.checked).map(cb => cb.value);
}

function getFilteredChallenges() {
  const selectedGames = getSelectedGames();
  const selectedTypes = getSelectedTypes();
  return allChallenges.filter(c => selectedGames.includes(c.game.trim()) && selectedTypes.includes(c.type.trim()));
}

function readBoardSettings() {
  const boardSize = Math.max(3, Math.min(9, parseInt(boardSizeInput.value, 10) || 5));
  const interval  = parseInt(versusIntervalInput.value, 10);
  const safeInterval = isNaN(interval) || interval < 1 ? 5 : Math.min(interval, 60);
  const requestedVersus = Math.max(0, parseInt(versusCountInput.value, 10) || 0);
  return { boardSize, safeInterval, requestedVersus };
}

generateBtn.addEventListener("click", generateAndRedirect);

function generateAndRedirect() {
  const filteredChallenges = getFilteredChallenges();
  const { boardSize, safeInterval, requestedVersus } = readBoardSettings();
  const totalCells = boardSize * boardSize;
  const neededChallenges = totalCells - (freeCenter ? 1 : 0);

  if (filteredChallenges.length < neededChallenges) {
    alert(`⚠️ You need at least ${neededChallenges} challenges; currently: ${filteredChallenges.length}.`);
    return;
  }

  const filteredVersus = filteredChallenges.filter(c => c.type.trim() === "versus");
  const filteredOther  = filteredChallenges.filter(c => c.type.trim() !== "versus");

  if (requestedVersus > filteredVersus.length) {
    alert(`⚠️ Requested ${requestedVersus} versus challenges but only ${filteredVersus.length} available.`);
    return;
  }

  const versusCount     = Math.min(requestedVersus, filteredVersus.length, neededChallenges);
  const shuffledVersus  = shuffleArray(filteredVersus).slice(0, versusCount);
  const remainingPool   = shuffleArray(filteredChallenges.filter(c => !shuffledVersus.some(v => v.id === c.id)));
  const selectedRemaining = remainingPool.slice(0, neededChallenges - versusCount);
  const selectedChallenges = shuffleArray([...shuffledVersus, ...selectedRemaining]);

  if (selectedChallenges.length !== neededChallenges) {
    alert("⚠️ Could not build board.");
    return;
  }

  const challengeIds = selectedChallenges.map(c => c.id);
  localStorage.setItem("currentBoardIds", JSON.stringify(challengeIds));
  localStorage.setItem("versusInterval", safeInterval);
  localStorage.setItem("boardSize", String(boardSize));
  localStorage.setItem("freeSpace", freeCenter ? "true" : "false");
  localStorage.removeItem("nextVersusTimestamp");
  localStorage.removeItem("nextVersusChallengeId");
  localStorage.removeItem("boardState");

  window.location.href = `board.html?challenges=${challengeIds.join(",")}&interval=${safeInterval}&size=${boardSize}&free=${freeCenter ? "1" : "0"}`;
}

// ── HOST ONLINE LOBBY ──────────────────────────────────────────────────────────

let hostRole = "player";
let hostTeam = "blue";

const hostSetupOverlay  = document.getElementById("hostSetupOverlay");
const hostNameInput     = document.getElementById("hostName");
const hostRoleToggle    = document.getElementById("hostRoleToggle");
const hostTeamPickerField = document.getElementById("hostTeamPickerField");
const confirmHostBtn    = document.getElementById("confirmHostBtn");
const cancelHostBtn     = document.getElementById("cancelHostBtn");

cancelHostBtn.addEventListener("click", () => {
  hostSetupOverlay.style.display = "none";
});

hostRoleToggle.querySelectorAll(".pool-option").forEach(btn => {
  btn.addEventListener("click", () => {
    hostRole = btn.dataset.role;
    hostRoleToggle.querySelectorAll(".pool-option").forEach(b => b.classList.toggle("active", b === btn));
    hostTeamPickerField.style.display = hostRole === "player" ? "block" : "none";
  });
});

document.getElementById("hostTeamPicker").querySelectorAll(".team-circle").forEach(btn => {
  btn.addEventListener("click", () => {
    hostTeam = btn.dataset.team;
    document.getElementById("hostTeamPicker").querySelectorAll(".team-circle").forEach(b => b.classList.toggle("selected", b === btn));
  });
});

confirmHostBtn.addEventListener("click", createLobby);
hostNameInput.addEventListener("keydown", e => { if (e.key === "Enter") createLobby(); });

async function createLobby() {
  const name = hostNameInput.value.trim();
  if (!name) { hostNameInput.focus(); return; }

  confirmHostBtn.disabled = true;
  confirmHostBtn.textContent = "Creating...";

  const lobbyId      = generateLobbyId();
  const hostPlayerId = generatePlayerId();
  const isGM        = hostRole === "gm";

  const settings = {
    boardSize: 5,
    versusInterval: 5,
    versusCount: 5,
    freeSpace: false,
    games: [],
    types: ["single", "group", "versus"],
    poolMode: "standard",
    teamCount: 2
  };

  const { error: lobbyError } = await db.from("lobbies").insert({
    id: lobbyId,
    host_player_id: hostPlayerId,
    status: "waiting",
    settings,
    board_challenge_ids: null
  });

  if (lobbyError) {
    alert("Failed to create lobby: " + lobbyError.message);
    confirmHostBtn.disabled = false;
    confirmHostBtn.textContent = "Create Lobby";
    return;
  }

  const { error: playerError } = await db.from("players").insert({
    id: hostPlayerId,
    lobby_id: lobbyId,
    name,
    team: isGM ? null : hostTeam,
    is_host: true,
    is_spectator: isGM,
    kicked: false
  });

  if (playerError) {
    alert("Failed to register host: " + playerError.message);
    confirmHostBtn.disabled = false;
    confirmHostBtn.textContent = "Create Lobby";
    return;
  }

  sessionStorage.setItem("playerId", hostPlayerId);
  sessionStorage.setItem("playerName", name);
  sessionStorage.setItem("playerTeam", isGM ? "" : hostTeam);
  sessionStorage.setItem("isSpectator", isGM ? "true" : "false");
  sessionStorage.setItem("lobbyId", lobbyId);
  localStorage.setItem("playerId_" + lobbyId, hostPlayerId);
  localStorage.setItem("playerName_" + lobbyId, name);

  window.location.href = `lobby.html?lobby=${lobbyId}&player=${hostPlayerId}`;
}
