const grid = document.getElementById("bingoGrid");
const generateBtn = document.getElementById("generateBtn");
const gameCheckboxes = document.querySelectorAll(".game-select");

let allChallenges = [];

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

// Load CSV
Papa.parse("challenges.csv", {
  download: true,
  header: true,
  delimiter: ";",
  complete: function(results) {
    allChallenges = results.data.filter(c => c.text && c.type && c.game);
    console.log(`Loaded ${allChallenges.length} challenges`);
  }
});

// Helper: Shuffle array
function shuffleArray(arr) {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// Helper: Get selected games
function getSelectedGames() {
  const selected = [];
  gameCheckboxes.forEach(checkbox => {
    if (checkbox.checked) {
      selected.push(checkbox.value);
    }
  });
  return selected;
}

// Helper: Filter challenges by selected games
function getFilteredChallenges() {
  const selectedGames = getSelectedGames();
  return allChallenges.filter(challenge => 
    selectedGames.includes(challenge.game.trim())
  );
}

// Generate board
function generateBoard() {
  const filteredChallenges = getFilteredChallenges();
  
  if (filteredChallenges.length < 25) {
    alert(`⚠️ You need at least 25 challenges! Currently: ${filteredChallenges.length}\nTry selecting more games.`);
    return;
  }

  // Clear grid
  grid.innerHTML = "";

  // Shuffle and take 25
  const shuffled = shuffleArray(filteredChallenges);
  const selectedChallenges = shuffled.slice(0, 25);

  // Create cells
  selectedChallenges.forEach(challenge => {
    const cell = document.createElement("div");
    cell.classList.add("bingo-cell", `type-${challenge.type.trim()}`);

    const gameEmoji = gameEmojis[challenge.game.trim()] || "🎯";

    cell.innerHTML = `
      <div class="bingo-icon">${iconMap[challenge.type.trim()]}</div>
      <div class="bingo-text">${challenge.text}</div>
      <div class="bingo-game-badge">${gameEmoji} ${challenge.game.trim()}</div>
    `;

    // Left click = blue
    cell.addEventListener("click", () => {
      cell.classList.remove("claimed-red");
      cell.classList.toggle("claimed-blue");
    });

    // Right click = red
    cell.addEventListener("contextmenu", e => {
      e.preventDefault();
      cell.classList.remove("claimed-blue");
      cell.classList.toggle("claimed-red");
    });

    grid.appendChild(cell);
  });
}

// Event listeners
generateBtn.addEventListener("click", generateBoard);

// Generate initial board when page loads (after CSV is loaded)
setTimeout(() => {
  generateBoard();
}, 500);
