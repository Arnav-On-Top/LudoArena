const socket = new WebSocket(
  (location.protocol === "https:" ? "wss://" : "ws://") +
  location.host
);
let myPlayerId = null;
let roomCode = "";
let gameData = null;
const diceFaces = [
  "🎲", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"
];
const PATH = [
  [6,1],[6,2],[6,3],[6,4],[6,5],
  [5,6],[4,6],[3,6],[2,6],[1,6],[0,6],
  [0,7],[0,8],
  [1,8],[2,8],[3,8],[4,8],[5,8],
  [6,9],[6,10],[6,11],[6,12],[6,13],[6,14],
  [7,14],[8,14],
  [8,13],[8,12],[8,11],[8,10],[8,9],
  [9,8],[10,8],[11,8],[12,8],[13,8],[14,8],
  [14,7],[14,6],
  [13,6],[12,6],[11,6],[10,6],[9,6],
  [8,5],[8,4],[8,3],[8,2],[8,1],[8,0],
  [7,0],[6,0]
];
const STARTS = {
  red: 0,
  blue: 13,
  yellow: 26,
  green: 39
};
const HOME_POSITIONS = {
  red: [[2,2],[2,4],[4,2],[4,4]],
  blue: [[2,10],[2,12],[4,10],[4,12]],
  green: [[10,2],[10,4],[12,2],[12,4]],
  yellow: [[10,10],[10,12],[12,10],[12,12]]
};
const HOME_LANES = {
  red: [[7,1],[7,2],[7,3],[7,4],[7,5]],
  blue: [[1,7],[2,7],[3,7],[4,7],[5,7]],
  green: [[13,7],[12,7],[11,7],[10,7],[9,7]],
  yellow: [[7,13],[7,12],[7,11],[7,10],[7,9]]
};
const START_COLORS = {
  0: "red",
  13: "blue",
  26: "yellow",
  39: "green"
};
socket.addEventListener("open", () => {
  document.getElementById("connectionStatus").textContent =
    "Connected to game server.";
});
socket.addEventListener("close", () => {
  document.getElementById("connectionStatus").textContent =
    "Disconnected from server. Refresh to reconnect.";
  document.getElementById("rollButton").disabled = true;
});
socket.addEventListener("error", () => {
  document.getElementById("connectionStatus").textContent =
    "Could not connect to the game server.";
});
socket.addEventListener("message", event => {
  let data;
  try {
    data = JSON.parse(event.data);
  } catch {
    return;
  }
  if (data.type === "joined") {
    myPlayerId = data.playerId;
    roomCode = data.room;
    document.getElementById("joinScreen").style.display = "none";
    document.getElementById("gameScreen").style.display = "block";
    document.getElementById("roomCode").textContent = roomCode;
    document.getElementById("joinMessage").textContent = "";
  } else if (data.type === "error") {
    document.getElementById("joinMessage").textContent =
      data.message;
  } else if (data.type === "update") {
    gameData = data;
    drawGame();
  }
});
function sendMessage(data) {
  if (socket.readyState !== WebSocket.OPEN) {
    document.getElementById("joinMessage").textContent =
      "Not connected to the server yet.";
    return false;
  }
  socket.send(JSON.stringify(data));
  return true;
}
function createRoom() {
  const name = document
    .getElementById("playerName")
    .value.trim();
  if (!name) {
    alert("Please enter your name!");
    return;
  }
  sendMessage({
    type: "create",
    name
  });
}
function joinRoom() {
  const name = document
    .getElementById("playerName")
    .value.trim();
  const code = document
    .getElementById("roomCodeInput")
    .value.trim()
    .toUpperCase();
  if (!name) {
    alert("Please enter your name!");
    return;
  }
  if (!code) {
    alert("Please enter room code!");
    return;
  }
  sendMessage({
    type: "join",
    name,
    room: code
  });
}
async function copyRoomCode() {
  try {
    await navigator.clipboard.writeText(roomCode);
    alert("Room code copied!");
  } catch {
    alert("Copy failed. Your room code is: " + roomCode);
  }
}
function createTrack() {
  const grid = document.getElementById("boardGrid");
  grid.innerHTML = "";
  const pathMap = new Map(
    PATH.map((position, index) => [
      position.join(","),
      index
    ])
  );
  const laneMap = new Map();
  for (const color in HOME_LANES) {
    HOME_LANES[color].forEach(position => {
      laneMap.set(position.join(","), color);
    });
  }
  for (let row = 0; row < 15; row++) {
    for (let col = 0; col < 15; col++) {
      const cell = document.createElement("div");
      const key = row + "," + col;
      cell.className = "cell";
      if (row < 6 && col < 6) {
        cell.classList.add("base-red");
      } else if (row < 6 && col > 8) {
        cell.classList.add("base-blue");
      } else if (row > 8 && col < 6) {
        cell.classList.add("base-green");
      } else if (row > 8 && col > 8) {
        cell.classList.add("base-yellow");
      }
      for (const color in HOME_POSITIONS) {
        if (
          HOME_POSITIONS[color].some(
            position =>
              position[0] === row &&
              position[1] === col
          )
        ) {
          cell.classList.add("home-slot");
        }
      }
      if (pathMap.has(key)) {
        cell.classList.add("path-cell");
        const index = pathMap.get(key);
        if (START_COLORS[index]) {
          cell.classList.add(
            "start-" + START_COLORS[index]
          );
        }
      }
      if (laneMap.has(key)) {
        cell.classList.add(
          "lane-" + laneMap.get(key)
        );
      }
      grid.appendChild(cell);
    }
  }
}
function getTokenPosition(color, steps, index) {
  if (steps === -1) {
    return HOME_POSITIONS[color][index];
  }
  if (steps >= 52 && steps <= 56) {
    return HOME_LANES[color][steps - 52];
  }
  if (steps === 57) {
    return [7, 7];
  }
  const pathIndex = (STARTS[color] + steps) % 52;
  return PATH[pathIndex];
}
function drawTokens() {
  const tokenArea = document.getElementById("tokens");
  tokenArea.innerHTML = "";
  if (!gameData) return;
  const currentPlayer = gameData.players[gameData.turn];
  for (const player of gameData.players) {
    for (let i = 0; i < 4; i++) {
      const steps = gameData.tokens[player.color][i];
      const [row, col] = getTokenPosition(
        player.color,
        steps,
        i
      );
      const token = document.createElement("button");
      token.className =
        "token " + player.color + "-token";
      token.textContent = String(i + 1);
      token.style.gridRow = String(row + 1);
      token.style.gridColumn = String(col + 1);
      token.title = player.name + " - Token " + (i + 1);
      const isMyTurn =
        currentPlayer &&
        currentPlayer.id === myPlayerId;
      const canSelect =
        player.id === myPlayerId &&
        isMyTurn &&
        gameData.started &&
        gameData.dice !== 0 &&
        !gameData.winner;
      token.disabled = !canSelect;
      token.addEventListener("click", () => {
        sendMessage({
          type: "move",
          index: i
        });
      });
      tokenArea.appendChild(token);
    }
  }
}
function drawPlayers() {
  const playerList = document.getElementById("playerList");
  playerList.innerHTML = "";
  if (!gameData) return;
  gameData.players.forEach((player, index) => {
    const card = document.createElement("div");
    card.className = "player-card";
    if (
      gameData.turn === index &&
      gameData.started &&
      !gameData.winner
    ) {
      card.classList.add("active");
    }
    const name = document.createElement("h3");
    name.textContent = player.name;
    name.className = player.color + "-text";
    const color = document.createElement("p");
    color.textContent = player.color.toUpperCase();
    card.append(name, color);
    playerList.appendChild(card);
  });
}
function rollDice() {
  if (!gameData || !gameData.started || gameData.winner) {
    return;
  }
  sendMessage({
    type: "roll"
  });
}
function drawGame() {
  drawTokens();
  drawPlayers();
  document.getElementById("dice").textContent =
    gameData.dice === 0
      ? "🎲"
      : diceFaces[gameData.dice];
  const status = document.getElementById("gameStatus");
  const message = document.getElementById("gameMessage");
  const rollButton = document.getElementById("rollButton");
  const currentPlayer = gameData.players[gameData.turn];
  if (gameData.winner) {
    status.textContent = "🏆 " + gameData.winner + " WON!";
    message.textContent = "Congratulations! Game finished.";
  } else if (!gameData.started) {
    status.textContent = "Waiting for players...";
    message.textContent =
      "Share your room code with your friends!";
  } else {
    status.textContent = currentPlayer
      ? currentPlayer.name + "'s Turn"
      : "Waiting...";
    message.textContent = gameData.message;
  }
  rollButton.disabled =
    !gameData.started ||
    !currentPlayer ||
    currentPlayer.id !== myPlayerId ||
    gameData.dice !== 0 ||
    !!gameData.winner;
}
createTrack();