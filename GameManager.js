// GameManager module for handling multiple games and rooms
const EVENT_TICK_RATE = 1000 / 30; // 30 times per second
const VALID_ROOM_ID = (roomId) => {
  if (roomId === "sandbox") return true;
  if (roomId === "lobby") return true;
  if (roomId.startsWith("room")) return true;
  return false;
};

const games = {}; // gameId -> Game class instance

class Game {
  constructor(gameId, instance) {
    this.gameId = gameId;
    this.instance = instance;
    this.rooms = {}; // roomId -> game state
  }

  addGameState(roomId) {
    if (!this.rooms[roomId]) {
      this.rooms[roomId] = {
        roomId: roomId,
        roomName: `${this.gameId}:${roomId}`,
        paused: false,
        cache: {},
        players: {},
        things: {},
        weather: {},
        camera: {},
        timer: 0,
        currentPlayerIndex: 0,
        started: false,
      };
      this.instance.create(this.rooms[roomId]);
    }
    return this.rooms[roomId];
  }

  addPlayer(roomId, player) {
    if (!this.rooms[roomId]) {
      this.addGameState(roomId);
    }
    this.rooms[roomId].players[player.id] = player;
    this.rooms[roomId].things[player.id] = player;
  }

  removePlayer(roomId, playerId) {
    if (!this.rooms[roomId]) return;
    delete this.rooms[roomId].players[playerId];
    delete this.rooms[roomId].things[playerId];
    if (
      Object.keys(this.rooms[roomId].players).length === 0 &&
      roomId !== "lobby" &&
      !this.instance.isPersistent
    ) {
      delete this.rooms[roomId];
    }
  }

  addThing(roomId, thing) {
    this.rooms[roomId].things[thing.id] = thing;
  }

  removeThing(roomId, thingId) {
    delete this.rooms[roomId].things[thingId];
  }

  getRoom(roomId) {
    return this.addGameState(roomId);
  }

  getRoomName(roomId) {
    return this.addGameState(roomId).roomName;
  }

  getPlayersInRoom(roomId) {
    return Object.values(this.addGameState(roomId).players);
  }

  getPlayerCountInRoom(roomId) {
    return Object.keys(this.addGameState(roomId).players).length;
  }

  getPlayerCountPerRoom() {
    const counts = {};
    for (const roomId in this.rooms) {
      counts[roomId] = Object.keys(this.addGameState(roomId).players).length;
    }
    return counts;
  }

  getPlayerCount() {
    let count = 0;
    for (const roomId in this.rooms) {
      count += Object.keys(this.rooms[roomId].players).length;
    }
    return count;
  }

  movePlayersToRoom(fromRoomId, toRoomId) {
    const fromRoom = this.addGameState(fromRoomId);
    const toRoom = this.addGameState(toRoomId);
    for (const playerId in fromRoom.players) {
      const player = fromRoom.players[playerId];
      player.score = 0;
      toRoom.players[playerId] = player;
      toRoom.things[playerId] = player;
      delete fromRoom.players[playerId];
      delete fromRoom.things[playerId];
    }
  }

  update(io) {
    for (const roomId in this.rooms) {
      const gameState = this.rooms[roomId];
      const outState = [];
      this.instance.update(io, gameState, outState);
      if (gameState.gameOver) {
        io.to(gameState.roomName).emit("gameEnded", { reason: "Game Over" });
        this.movePlayersToRoom(roomId, "lobby");
        io.to(gameState.roomName).emit("playersMoved", { toRoom: "lobby" });
        delete this.rooms[roomId];
        continue;
      }
      if (gameState.players.length === 0) {
        delete this.rooms[roomId];
        continue;
      }
      if (outState.length > 0) {
        io.to(gameState.roomName).emit("serverUpdate", { things: outState });
      }
    }
  }
}

// -- GameManager Endpoints --

// Expose player notify endpoint, used for notifying players for upcoming server events
function playerNotify(req, res) {
  const { message } = req.body;
  console.warn("Player Notify:", message);
  this.io.emit("playerNotify", { message });
  res.json({ success: true });
}

// Expose endpoint to get number of players in a game
function playersInGame(req, res) {
  const { gameId, roomId } = req.params;
  const game = this.getGameState(gameId, roomId);
  res.json({ playerCount: Object.keys(game.players).length });
}

// Expose endpoint to get number of players in all games
function playersInAllGames(req, res) {
  let totalPlayers = 0;
  for (const gameId in games) {
    totalPlayers += games[gameId].getPlayerCount();
  }
  res.json({ playerCount: totalPlayers });
}

// Expose endpoint to get number of players in each game
function playersInPerGames(req, res) {
  const counts = {};
  for (const gameId in games) {
    counts[gameId] = games[gameId].getPlayerCount();
  }
  res.json({ playerCounts: counts });
}

// Expose endpoint to get total players and active game count
function summary(req, res) {
  let totalPlayers = 0;
  let activeGames = 0;
  for (const gameId in games) {
    const playerCount = games[gameId].getPlayerCount();
    if (playerCount > 0) {
      activeGames += 1;
      totalPlayers += playerCount;
    }
  }
  res.json({ totalPlayers, activeGames });
}

// -- GameManager Socket Handling --

function getPlayer(id, name) {
  colorData = {
    r: Math.floor(Math.random() * 100) / 100,
    g: Math.floor(Math.random() * 100) / 100,
    b: Math.floor(Math.random() * 100) / 100,
    a: 1,
  };
  return {
    id: id,
    name: name || `${id}`,
    score: 0,
    speed: 0.3,
    type: "BasicCapsuleThing",
    gameplayTags: ["player"],
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { isEuler: true, _x: 0, _y: 0, _z: 0, _order: "XYZ" },
      scale: { x: 1, y: 1, z: 1 },
    },
    data: {
      health: 3,
      credits: 0,
      dice: 0,
      colorData: colorData,
    },
  };
}

function onConnection(io, socket) {
  // Handle new socket connection
  const { gameId, roomId, name } = socket.handshake.query;

  const data = socket.data;

  data.gameId = gameId;
  data.roomId = roomId;

  data.game = games[gameId];
  data.room = data.game.getRoom(roomId);
  data.roomName = data.game.getRoomName(roomId);
  data.player = getPlayer(socket.id, name);
  data.game.addPlayer(data.roomId, data.player);

  socket.join(data.roomName);

  socket.emit("init", {
    you: socket.id,
    game: data.room,
  });

  socket.on("playerInput", (input) => {
    data.player.input = input;
  });

  socket.to(data.roomName).emit("playerJoined", {
    player: data.player,
    game: data.room,
  });

  socket.on("playerChangeRoom", (newRoomId) => {
    if (!VALID_ROOM_ID(newRoomId)) return;
    console.log(
      `Player ${socket.id} changing room from ${socket.data.roomId} to ${newRoomId}`
    );

    io.to(data.roomName).emit("playerLeft", { playerId: socket.id });
    socket.leave(data.roomName);
    data.game.removePlayer(data.roomId, socket.id);

    data.roomId = newRoomId;
    data.room = data.game.getRoom(newRoomId);
    data.roomName = data.game.getRoomName(newRoomId);
    data.game.addPlayer(data.roomId, data.player);

    socket.join(data.roomName);
    io.to(data.roomName).emit("playerJoined", {
      playerCount: data.game.getPlayerCountInRoom(data.roomId),
      player: data.player,
      game: data.room,
    });
  });

  socket.on("disconnect", () => {
    data.game.removePlayer(data.roomId, socket.id);
    socket.to(data.roomName).emit("playerLeft", {
      playerId: socket.id,
      playerCount: data.game.getPlayerCountInRoom(data.roomId),
    });
  });
}

function loadGameMap(gameMap) {
  for (const gameId in gameMap) {
    games[gameId] = new Game(gameId, new gameMap[gameId]());
  }
}

// GameManager handles multiple games and rooms
class GameManager {
  constructor(app, io, gameMap) {
    loadGameMap(gameMap);

    // Server tick to update game state
    this.serverTick = setInterval(() => {
      // io.emit("serverTick", { timestamp: Date.now() });
      for (const gameId in games) {
        games[gameId].update(io);
      }
    }, EVENT_TICK_RATE); // 30 times per second

    app.post("/api/gameManager/playerNotify", playerNotify.bind(this));

    app.get(
      "/api/gameManager/playersInGame/:gameId/:roomId",
      playersInGame.bind(this)
    );
    app.get("/api/gameManager/playersInAllGames", playersInAllGames.bind(this));
    app.get("/api/gameManager/playersInPerGames", playersInPerGames.bind(this));
    app.get("/api/gameManager/summary", summary.bind(this));

    // Handle socket connections
    io.on("connection", (socket) => {
      onConnection(io, socket);
    });
  }
}

module.exports = GameManager;
