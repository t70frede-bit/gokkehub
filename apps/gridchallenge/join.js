// Join Lobby Page Logic
const params = new URLSearchParams(window.location.search);
const lobbyId = params.get("lobby");

const playerNameInput = document.getElementById("playerName");
const teamPicker = document.getElementById("teamPicker");
const joinBtn = document.getElementById("joinBtn");
const joinError = document.getElementById("joinError");
const lobbyCodeDisplay = document.getElementById("lobbyCodeDisplay");

let selectedTeam = null;
let lobby = null;
let gameAlreadyStarted = false;

if (!lobbyId) {
  showError("No lobby code found in the URL. Ask the host for the correct link.");
} else {
  lobbyCodeDisplay.textContent = lobbyId.toUpperCase();
  loadLobby();
}

async function loadLobby() {
  joinBtn.textContent = "Loading...";
  joinBtn.disabled = true;

  // Check for a saved session for this lobby (rejoin flow)
  const savedPlayerId = localStorage.getItem("playerId_" + lobbyId);
  const savedName = localStorage.getItem("playerName_" + lobbyId);
  if (savedPlayerId && savedName) {
    // Verify the player record still exists and isn't kicked
    const { data: savedPlayer } = await db.from("players").select("*").eq("id", savedPlayerId).single();
    if (savedPlayer && !savedPlayer.kicked) {
      showRejoinBanner(savedPlayer);
    }
  }

  const { data, error } = await db.from("lobbies").select("*").eq("id", lobbyId).single();
  if (error || !data) {
    showError("Lobby not found. The code may be wrong or the lobby has ended.");
    return;
  }
  if (data.status === "finished") {
    showError("This lobby has finished.");
    return;
  }

  lobby = data;
  gameAlreadyStarted = data.status === "playing";

  buildTeamPicker();
  playerNameInput.disabled = false;
  playerNameInput.focus();
  joinBtn.textContent = gameAlreadyStarted ? "Join Game" : "Join Lobby";
  joinBtn.disabled = false;
}

function showRejoinBanner(player) {
  const banner = document.createElement("div");
  banner.className = "rejoin-banner";
  const teamLabel = player.is_spectator ? "Spectator" : (TEAM_LABELS[player.team] || player.team);
  banner.innerHTML = `
    <strong>Welcome back, ${escapeHtml(player.name)}!</strong>
    <p>You were previously in this lobby as ${teamLabel}.</p>
    <button class="generate-btn" id="rejoinBtn">↩ Rejoin as ${escapeHtml(player.name)}</button>
  `;
  document.querySelector(".join-card").prepend(banner);
  document.getElementById("rejoinBtn").addEventListener("click", () => {
    restoreSession(player);
    const dest = gameAlreadyStarted
      ? `board.html?lobby=${lobbyId}&player=${player.id}`
      : `lobby.html?lobby=${lobbyId}&player=${player.id}`;
    window.location.href = dest;
  });
}

function restoreSession(player) {
  sessionStorage.setItem("playerId", player.id);
  sessionStorage.setItem("playerName", player.name);
  sessionStorage.setItem("playerTeam", player.team || "");
  sessionStorage.setItem("isSpectator", player.is_spectator ? "true" : "false");
  sessionStorage.setItem("lobbyId", lobbyId);
}

function buildTeamPicker() {
  teamPicker.innerHTML = "";
  const settings = lobby.settings || {};
  const teamCount = settings.teamCount || 2;
  const activeTeams = TEAM_COLORS.slice(0, teamCount);

  activeTeams.forEach(team => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "team-circle team-" + team;
    btn.dataset.team = team;
    btn.title = TEAM_LABELS[team] + " Team";
    btn.innerHTML = TEAM_EMOJIS[team] + "<span>" + TEAM_LABELS[team] + "</span>";
    btn.addEventListener("click", () => selectTeam(team));
    teamPicker.appendChild(btn);
  });

  const spectatorBtn = document.createElement("button");
  spectatorBtn.type = "button";
  spectatorBtn.className = "team-circle team-spectator";
  spectatorBtn.dataset.team = "spectator";
  spectatorBtn.title = "Watch only";
  spectatorBtn.innerHTML = "👁️<span>Spectate</span>";
  spectatorBtn.addEventListener("click", () => selectTeam("spectator"));
  teamPicker.appendChild(spectatorBtn);
}

function selectTeam(team) {
  selectedTeam = team === "spectator" ? null : team;
  document.querySelectorAll(".team-circle").forEach(btn => {
    btn.classList.toggle("selected", btn.dataset.team === team);
  });
}

playerNameInput.addEventListener("input", () => {
  joinBtn.disabled = playerNameInput.value.trim().length === 0;
});

joinBtn.addEventListener("click", async () => {
  const name = playerNameInput.value.trim();
  if (!name) return;

  joinBtn.disabled = true;
  joinBtn.textContent = "Joining...";

  // Refresh lobby status
  const { data: freshLobby } = await db.from("lobbies").select("status, settings").eq("id", lobbyId).single();
  if (!freshLobby || freshLobby.status === "finished") {
    showError("This lobby has ended.");
    return;
  }
  gameAlreadyStarted = freshLobby.status === "playing";

  const playerId = generatePlayerId();
  const isSpectator = selectedTeam === null;

  const { error } = await db.from("players").insert({
    id: playerId,
    lobby_id: lobbyId,
    name,
    team: isSpectator ? null : selectedTeam,
    is_host: false,
    is_spectator: isSpectator,
    kicked: false
  });

  if (error) {
    showError("Failed to join: " + error.message);
    joinBtn.disabled = false;
    joinBtn.textContent = gameAlreadyStarted ? "Join Game" : "Join Lobby";
    return;
  }

  // Persist to localStorage so player can rejoin after browser close
  localStorage.setItem("playerId_" + lobbyId, playerId);
  localStorage.setItem("playerName_" + lobbyId, name);

  sessionStorage.setItem("playerId", playerId);
  sessionStorage.setItem("playerName", name);
  sessionStorage.setItem("playerTeam", isSpectator ? "" : selectedTeam);
  sessionStorage.setItem("isSpectator", isSpectator ? "true" : "false");
  sessionStorage.setItem("lobbyId", lobbyId);

  // If game already started, go straight to board
  const dest = gameAlreadyStarted
    ? `board.html?lobby=${lobbyId}&player=${playerId}`
    : `lobby.html?lobby=${lobbyId}&player=${playerId}`;
  window.location.href = dest;
});

function showError(msg) {
  joinError.textContent = "❌ " + msg;
  joinError.style.display = "block";
  joinBtn.disabled = true;
  joinBtn.textContent = "Cannot Join";
}

function escapeHtml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
