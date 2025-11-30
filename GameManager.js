// GameManager module for handling multiple games and rooms
const ROOM_ID_PREFIX = "room-";
const VALID_ROOM_ID = [
  "sandbox",
  "lobby",
  "room1",
  "room2",
  "room3",
  "room4",
  "room5",
];

function getRoomName(socket) {
  return `${socket.data.gameId}:${ROOM_ID_PREFIX}${socket.data.roomId}`;
}

// GameManager handles multiple games and rooms
class GameManager {
  constructor(app, io, games) {
    this.io = io;
    this.gameStates = {};
    for (const gameId of games) {
      this.getGameState(gameId);
    }

    // Server tick to update game state
    this.serverTick = setInterval(() => {
      io.emit("serverTick");
    }, 1000 / 30); // 30 times per second

    // Expose player notify endpoint, used for notifying players for upcoming server events
    app.post("/api/gameManager/playerNotify", this.playerNotify.bind(this));

    // Expose endpoint to get number of players in a game
    app.get("/api/gameManager/playersInGame/:gameId", (req, res) => {
      const { gameId } = req.params;
      const game = this.getGameState(gameId);
      res.json({ playerCount: Object.keys(game.players).length });
    });

    // Expose endpoint to get number of players in all games
    app.get("/api/gameManager/playersInAllGames", (req, res) => {
      let totalPlayers = 0;
      for (const gameId in this.gameStates) {
        totalPlayers += Object.keys(this.gameStates[gameId].players).length;
      }
      res.json({ playerCount: totalPlayers });
    });

    // Expose endpoint to get number of players in each game
    app.get("/api/gameManager/playersInPerGames", (req, res) => {
      const counts = {};
      for (const gameId in this.gameStates) {
        counts[gameId] = Object.keys(this.gameStates[gameId].players).length;
      }
      res.json({ playerCounts: counts });
    });

    // Handle socket connections
    io.on("connection", (socket) => {
      const { gameId, roomId, name, score, speed, transform } =
        socket.handshake.query;
      if (
        !gameId ||
        !this.gameStates[gameId] ||
        !VALID_ROOM_ID.includes(roomId)
      ) {
        socket.disconnect(true);
        return;
      }

      socket.data.gameId = gameId; // store on socket
      socket.data.roomId = roomId; // store on socket

      const roomName = getRoomName(socket);
      socket.join(roomName); // join that game’s room

      console.log(
        `Socket ${socket.id} joined game ${gameId}, room ${roomName}`
      );

      const game = this.getGameState(gameId);
      console.log(
        `Current players in game ${gameId}:`,
        Object.keys(game.players)
      );

      // Add player to game state
      game.players[socket.id] = {
        roomId,
        name: name || `${socket.id}`,
        score: parseInt(score) || 0,
        speed: parseFloat(speed) || 0.01,
        transform: JSON.parse(transform) || {
          position: { x: 0, y: 0, z: 0 },
          rotation: { isEuler: true, _x: 0, _y: 0, _z: 0, _order: "XYZ" },
          scale: { x: 1, y: 1, z: 1 },
        },
      };

      // Send them initial state for THIS game
      socket.emit("init", {
        you: socket.id,
        players: game.players,
        things: game.things,
      });

      // Let other players in *this game* know
      socket.to(roomName).emit("playerJoined", {
        id: socket.id,
        ...game.players[socket.id],
      });

      // Handle input for THIS game only
      socket.on("playerInput", (input) => {
        const player = this.getPlayer(socket);
        if (!player) return;
        if (!input) return;
        if (gameId === "default-game") {
          const speed = player.speed;
          const playerPos = player.transform.position;
          if (input.left) playerPos.x -= speed;
          if (input.right) playerPos.x += speed;
          if (input.forward) playerPos.z -= speed;
          if (input.backward) playerPos.z += speed;
          if (input.up) playerPos.y += speed;
          if (input.down) playerPos.y -= speed;
          // Broadcast new position to room
          const roomName = getRoomName(socket);
          io.to(roomName).emit("playerMoved", {
            id: socket.id,
            position: player.transform.position,
          });
        }
      });

      socket.on("playerScore", (points) => {
        const player = this.getPlayer(socket);
        if (!player) return;
        player.score += points;
        const roomName = getRoomName(socket);
        io.to(roomName).emit("playerScored", {
          id: socket.id,
          score: player.score,
        });
      });

      socket.on("playerTransform", (transform) => {
        const player = this.getPlayer(socket);
        if (!player) return;
        player.transform = transform;
        const roomName = getRoomName(socket);
        io.to(roomName).emit("playerTransformed", {
          id: socket.id,
          transform: player.transform,
        });
      });

      socket.on("playerPosition", (position) => {
        const player = this.getPlayer(socket);
        if (!player) return;
        player.transform.position = position;
        const roomName = getRoomName(socket);
        io.to(roomName).emit("playerMoved", {
          id: socket.id,
          position: player.transform.position,
        });
      });

      socket.on("playerRotation", (rotation) => {
        const player = this.getPlayer(socket);
        if (!player) return;
        player.transform.rotation = rotation;
        const roomName = getRoomName(socket);
        io.to(roomName).emit("playerRotated", {
          id: socket.id,
          rotation: player.transform.rotation,
        });
      });

      socket.on("playerScale", (scale) => {
        const player = this.getPlayer(socket);
        if (!player) return;
        player.transform.scale = scale;
        const roomName = getRoomName(socket);
        io.to(roomName).emit("playerScaled", {
          id: socket.id,
          scale: player.transform.scale,
        });
      });

      socket.on("playerPositionRotation", ({ position, rotation }) => {
        const player = this.getPlayer(socket);
        if (!player) return;
        player.transform.position = position;
        player.transform.rotation = rotation;
        const roomName = getRoomName(socket);
        io.to(roomName).emit("playerMovedRotated", {
          id: socket.id,
          position: player.transform.position,
          rotation: player.transform.rotation,
        });
      });

      socket.on("playerPositionScale", ({ position, scale }) => {
        const player = this.getPlayer(socket);
        if (!player) return;
        player.transform.position = position;
        player.transform.scale = scale;
        const roomName = getRoomName(socket);
        io.to(roomName).emit("playerMovedScaled", {
          id: socket.id,
          position: player.transform.position,
          scale: player.transform.scale,
        });
      });

      socket.on(
        "playerPositionRotationScale",
        ({ position, rotation, scale }) => {
          const player = this.getPlayer(socket);
          if (!player) return;
          player.transform.position = position;
          player.transform.rotation = rotation;
          player.transform.scale = scale;
          const roomName = getRoomName(socket);
          io.to(roomName).emit("playerMovedRotatedScaled", {
            id: socket.id,
            position: player.transform.position,
            rotation: player.transform.rotation,
            scale: player.transform.scale,
          });
        }
      );

      socket.on("spawnThing", (thingData) => {
        const game = this.getGameState(socket.data.gameId);
        game.things[thingData.id] = thingData;
        const roomName = getRoomName(socket);
        io.to(roomName).emit("thingSpawned", thingData);
      });

      socket.on("despawnThing", (thingId) => {
        const game = this.getGameState(socket.data.gameId);
        delete game.things[thingId];
        const roomName = getRoomName(socket);
        io.to(roomName).emit("thingDespawned", thingId);
      });

      socket.on("thingPosition", ({ id, position }) => {
        const game = this.getGameState(socket.data.gameId);
        if (!game.things[id]) return;
        const transform = game.things[id].transform;
        transform.position = position;
        const roomName = getRoomName(socket);
        io.to(roomName).emit("thingMoved", { id, position });
      });

      socket.on("thingRotation", ({ id, rotation }) => {
        const game = this.getGameState(socket.data.gameId);
        if (!game.things[id]) return;
        const transform = game.things[id].transform;
        transform.rotation = rotation;
        const roomName = getRoomName(socket);
        io.to(roomName).emit("thingRotated", { id, rotation });
      });

      socket.on("thingScale", ({ id, scale }) => {
        const game = this.getGameState(socket.data.gameId);
        if (!game.things[id]) return;
        const transform = game.things[id].transform;
        transform.scale = scale;
        const roomName = getRoomName(socket);
        io.to(roomName).emit("thingScaled", { id, scale });
      });

      socket.on("thingPositionRotation", ({ id, position, rotation }) => {
        const game = this.getGameState(socket.data.gameId);
        if (!game.things[id]) return;
        const transform = game.things[id].transform;
        transform.position = position;
        transform.rotation = rotation;
        const roomName = getRoomName(socket);
        io.to(roomName).emit("thingMovedRotated", {
          id, position, rotation
        });
      });

      socket.on("thingPositionScale", ({ id, position, scale }) => {
        const game = this.getGameState(socket.data.gameId);
        if (!game.things[id]) return;
        const transform = game.things[id].transform;
        transform.position = position;
        transform.scale = scale;
        const roomName = getRoomName(socket);
        io.to(roomName).emit("thingMovedScaled", {
          id, position, scale
        });
      });

      socket.on("thingPositionRotationScale", ({ id, position, rotation, scale }) => {
        const game = this.getGameState(socket.data.gameId);
        if (!game.things[id]) return;
        const transform = game.things[id].transform;
        transform.position = position;
        transform.rotation = rotation;
        transform.scale = scale;
        const roomName = getRoomName(socket);
        io.to(roomName).emit("thingMovedRotatedScaled", {
          id, position, rotation, scale
        });
      });

      socket.on("chatMessage", (message) => {
        const roomName = getRoomName(socket);
        io.to(roomName).emit("chatMessage", {
          from: socket.id,
          message,
        });
      });

      socket.on("getAllRoomPlayerCount", () => {
        const gameId = socket.data.gameId;
        const game = this.getGameState(gameId);
        const roomCounts = {};
        for (const roomId of VALID_ROOM_ID) {
          roomCounts[roomId] = 0;
        }
        for (const socketId of Object.keys(game.players)) {
          const player = game.players[socketId];
          roomCounts[player.roomId] += 1;
        }
        socket.emit("allRoomPlayerCount", roomCounts);
      });

      socket.on("playerChangeRoom", (newRoomId) => {
        if (!VALID_ROOM_ID.includes(newRoomId)) return;
        const gameId = socket.data.gameId;
        const oldRoomId = socket.data.roomId;
        const oldRoomName = `${gameId}:${ROOM_ID_PREFIX}${oldRoomId}`;
        const newRoomName = `${gameId}:${ROOM_ID_PREFIX}${newRoomId}`;
        socket.leave(oldRoomName);
        socket.join(newRoomName);
        socket.data.roomId = newRoomId;
        const game = this.getGameState(gameId);
        game.players[socket.id].roomId = newRoomId;
        io.to(oldRoomName).emit("playerLeftRoom", socket.id);
        io.to(newRoomName).emit("playerJoinedRoom", {
          id: socket.id,
          ...game.players[socket.id],
        });
      });

      socket.on("disconnect", () => {
        const gameId = socket.data.gameId;
        const roomName = getRoomName(socket);
        const game = this.getGameState(gameId);
        delete game.players[socket.id];
        io.to(roomName).emit("playerLeft", socket.id);
      });
    });
  }

  getPlayer(socket) {
    const gameId = socket.data.gameId;
    const game = this.getGameState(gameId);
    return game.players[socket.id];
  }

  getGameState(gameId) {
    if (!this.gameStates[gameId]) {
      this.gameStates[gameId] = {
        players: {},
        things: {},
      };
    }
    return this.gameStates[gameId];
  }

  playerNotify(req, res) {
    const { message } = req.body;
    console.log("Player Notify:", message);
    this.io.emit("playerNotify", { message });
    res.json({ success: true });
  }
}

module.exports = GameManager;
