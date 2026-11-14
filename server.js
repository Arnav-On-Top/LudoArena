const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { WebSocketServer, WebSocket } = require("ws");
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const rooms = new Map();
const COLORS = ["red", "blue", "green", "yellow"];
function createTokens() {
  return {
    red: [-1, -1, -1, -1],
    blue: [-1, -1, -1, -1],
    green: [-1, -1, -1, -1],
    yellow: [-1, -1, -1, -1]
  };
}
function getAvailableColor(room) {
  const used = new Set(room.players.map(player => player.color));
  return COLORS.find(color => !used.has(color)) || null;
}
function send(socket, data) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(data));
  }
}
function broadcast(room, data) {
  for (const player of room.players) {
    send(player.socket, data);
  }
}
function updateRoom(room) {
  const players = room.players.map(({ id, name, color }) => ({
    id,
    name,
    color
  }));
  broadcast(room, {
    type: "update",
    players,
    tokens: room.tokens,
    turn: room.turn,
    dice: room.dice,
    started: room.started,
    winner: room.winner,
    message: room.message
  });
}
function createPlayer(room, socket, name) {
  const color = getAvailableColor(room);
  if (!color) return null;
  return {
    id: crypto.randomBytes(8).toString("hex"),
    name: name.slice(0, 20),
    color,
    socket
  };
}
function attachPlayer(socket, roomCode, room, player) {
  room.players.push(player);
  socket.roomCode = roomCode;
  socket.playerId = player.id;
  if (room.players.length >= 2) {
    room.started = true;
    room.message =
      "Game started! " + room.players[room.turn].name + " goes first.";
  }
  send(socket, {
    type: "joined",
    room: roomCode,
    playerId: player.id
  });
  updateRoom(room);
}
function createRoom(socket, name) {
  let roomCode;
  do {
    roomCode = Math.random().toString(36).slice(2, 8).toUpperCase();
  } while (rooms.has(roomCode));
  const room = {
    players: [],
    tokens: createTokens(),
    turn: 0,
    dice: 0,
    started: false,
    winner: null,
    message: "Waiting for another player..."
  };
  rooms.set(roomCode, room);
  const player = createPlayer(room, socket, name);
  if (!player) return;

  attachPlayer(socket, roomCode, room, player);
}
function joinRoom(socket, roomCode, name) {
  const room = rooms.get(roomCode);
  if (!room) {
    return send(socket, {
      type: "error",
      message: "Room not found!"
    });
  }
  if (room.players.length >= 4) {
    return send(socket, {
      type: "error",
      message: "Room is full!"
    });
  }
  if (room.winner) {
    return send(socket, {
      type: "error",
      message: "This game has already finished!"
    });
  }
  const player = createPlayer(room, socket, name);
  if (!player) {
    return send(socket, {
      type: "error",
      message: "No player colours are available."
    });
  }
  attachPlayer(socket, roomCode, room, player);
}
function getCurrentPlayer(room) {
  return room.players[room.turn];
}
function canMove(room, player, index) {
  if (!room.started || room.winner || room.dice === 0) {
    return false;
  }
  const current = getCurrentPlayer(room);
  if (!current || current.id !== player.id) {
    return false;
  }
  const position = room.tokens[player.color][index];
  if (position === -1 && room.dice !== 6) {
    return false;
  }
  if (position !== -1 && position + room.dice > 57) {
    return false;
  }
  return true;
}
function advanceTurn(room) {
  room.turn = (room.turn + 1) % room.players.length;
}
function rollDice(room, player) {
  if (!room.started || room.winner || room.dice !== 0) {
    return;
  }
  const current = getCurrentPlayer(room);
  if (!current || current.id !== player.id) {
    return;
  }
  const rolled = Math.floor(Math.random() * 6) + 1;
  room.dice = rolled;
  room.lastRoll = rolled;
  room.message = player.name + " rolled " + rolled + ".";
  let hasMove = false;
  for (let i = 0; i < 4; i++) {
    if (canMove(room, player, i)) {
      hasMove = true;
      break;
    }
  }
  if (!hasMove) {
    room.dice = 0;
    if (rolled !== 6) {
      advanceTurn(room);
      room.message =
        player.name + " rolled " + rolled +
        " - no possible move. Turn passed.";
    } else {
      room.message =
        player.name + " rolled 6! Choose a token to move.";
    }
  }
  updateRoom(room);
}
function getTrackPosition(color, steps) {
  const starts = {
    red: 0,
    blue: 13,
    yellow: 26,
    green: 39
  };
  return (starts[color] + steps) % 52;
}
function moveToken(room, player, index) {
  if (!canMove(room, player, index)) {
    return;
  }
  const tokens = room.tokens;
  const color = player.color;
  const dice = room.dice;
  const currentPosition = tokens[color][index];
  tokens[color][index] =
    currentPosition === -1 ? 0 : currentPosition + dice;
  const newPosition = tokens[color][index];
  let captured = false;
  if (newPosition < 52) {
    const mySquare = getTrackPosition(color, newPosition);
    for (const opponent of room.players) {
      if (opponent.color === color) continue;
      for (let i = 0; i < 4; i++) {
        const opponentSteps = tokens[opponent.color][i];
        if (
          opponentSteps >= 0 &&
          opponentSteps < 52 &&
          getTrackPosition(opponent.color, opponentSteps) === mySquare
        ) {
          tokens[opponent.color][i] = -1;
          captured = true;
          room.message =
            player.name + " captured " + opponent.name + "'s token!";
        }
      }
    }
  }
  if (tokens[color].every(position => position === 57)) {
    room.winner = player.name;
    room.dice = 0;
    room.message = player.name + " won the game!";
    return updateRoom(room);
  }
  const rolled = room.dice;
  room.dice = 0;
  if (rolled !== 6) {
    advanceTurn(room);
  }
  if (!captured) {
    room.message = player.name + " moved a token.";
  }
  updateRoom(room);
}
function removePlayer(socket) {
  const roomCode = socket.roomCode;
  const room = rooms.get(roomCode);
  if (!room) return;
  const leavingIndex = room.players.findIndex(
    player => player.id === socket.playerId
  );
  if (leavingIndex === -1) return;
  const oldTurn = room.turn;
  room.players.splice(leavingIndex, 1);
  if (room.players.length === 0) {
    rooms.delete(roomCode);
    return;
  }
  if (leavingIndex < oldTurn) {
    room.turn--;
  }
  if (room.turn >= room.players.length) {
    room.turn = 0;
  }
  room.dice = 0;
  if (room.players.length < 2) {
    room.started = false;
    room.turn = 0;
    room.tokens = createTokens();
    room.winner = null;
    room.message = "Waiting for another player...";
  } else {
    room.message = "A player disconnected.";
  }

  updateRoom(room);
}
const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname
    );
  } catch {
    res.writeHead(400);
    return res.end("Bad request");
  }
  const requested =
    pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = path.resolve(PUBLIC_DIR, requested);
  if (
    filePath !== PUBLIC_DIR &&
    !filePath.startsWith(PUBLIC_DIR + path.sep)
  ) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8"
  };
  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404, {
        "Content-Type": "text/plain; charset=utf-8"
      });
      return res.end("File not found");
    }
    res.writeHead(200, {
      "Content-Type":
        types[path.extname(filePath)] ||
        "application/octet-stream"
    });
    res.end(content);
  });
});
const wss = new WebSocketServer({ server });
wss.on("connection", socket => {
  console.log("Player connected");
  socket.on("message", raw => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return send(socket, {
        type: "error",
        message: "Invalid message received."
      });
    }
    if (message.type === "create") {
      const name = String(message.name || "")
        .trim()
        .slice(0, 20);
      if (!name) {
        return send(socket, {
          type: "error",
          message: "Please enter your name."
        });
      }
      if (socket.roomCode) return;

      createRoom(socket, name);
    }
    if (message.type === "join") {
      const name = String(message.name || "")
        .trim()
        .slice(0, 20);
      const code = String(message.room || "")
        .trim()
        .toUpperCase();
      if (!name || !code) {
        return send(socket, {
          type: "error",
          message: "Enter your name and room code."
        });
      }
      if (socket.roomCode) return;
      joinRoom(socket, code, name);
    }
    if (message.type === "roll" || message.type === "move") {
      const room = rooms.get(socket.roomCode);
      if (!room) return;
      const player = room.players.find(
        p => p.id === socket.playerId
      );
      if (!player) return;
      if (message.type === "roll") {
        rollDice(room, player);
      }
      if (message.type === "move") {
        const index = Number(message.index);
        if (
          Number.isInteger(index) &&
          index >= 0 &&
          index < 4
        ) {
          moveToken(room, player, index);
        }
      }
    }
  });
  socket.on("close", () => {
    console.log("Player disconnected");
    removePlayer(socket);
  });
});
server.listen(PORT, "0.0.0.0", () => {
  console.log("Ludo server running on port " + PORT);
});