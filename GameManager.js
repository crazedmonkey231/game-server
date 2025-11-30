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
    app.get("/api/gameManager/playersInGame/:gameId/:roomId", (req, res) => {
      const { gameId, roomId } = req.params;
      const game = this.getGameState(gameId, roomId);
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

      let game = this.getGameStateFromSocket(socket);
      let roomName = game.roomName;

      socket.join(roomName); // join that game’s room

      console.log(
        `Socket ${socket.id} joined game ${gameId}, room ${roomName}`
      );

      // Add player to game state
      const player = {
        roomId,
        id: socket.id,
        name: name || `${socket.id}`,
        score: parseInt(score) || 0,
        speed: parseFloat(speed) || 0.01,
        type: "BasicBoxThing",
        transform: JSON.parse(transform) || {
          position: { x: 0, y: 0, z: 0 },
          rotation: { isEuler: true, _x: 0, _y: 0, _z: 0, _order: "XYZ" },
          scale: { x: 1, y: 1, z: 1 },
        },
      };
      game.things[socket.id] = player;

      // Send them initial state for THIS game
      socket.emit("init", {
        you: socket.id,
        things: game.things,
      });

      // Handle input for THIS game only
      socket.on("playerInput", (input) => {
        const player = this.getPlayer(socket);
        if (!player) return;
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
          io.to(roomName).emit("thingMoved", {
            id: socket.id,
            position: player.transform.position,
          });
        }
      });

      socket.on("playerScore", (points) => {
        const player = this.getPlayer(socket);
        if (!player) return;
        player.score += points;
        io.to(roomName).emit("playerScored", {
          id: socket.id,
          score: player.score,
        });
      });

      // -- Thing management --

      socket.on("spawnThing", (thingData) => {
        game.things[thingData.id] = thingData;
        io.to(roomName).emit("thingSpawned", thingData);
      });

      socket.on("addThing", (thingData) => {
        game.things[thingData.id] = thingData;
        io.to(roomName).emit("thingAdded", thingData);
      });

      socket.on("removeThing", (thingId) => {
        delete game.things[thingId];
        io.to(roomName).emit("thingRemoved", thingId);
      });

      socket.on("clearAllThings", () => {
        game.things = {};
        io.to(roomName).emit("allThingsCleared");
      });

      socket.on("thingPosition", ({ id, position }) => {
        this.updateThingTransform(socket, id, { position });
      });

      socket.on("thingRotation", ({ id, rotation }) => {
        this.updateThingTransform(socket, id, { rotation });
      });

      socket.on("thingScale", ({ id, scale }) => {
        this.updateThingTransform(socket, id, { scale });
      });

      socket.on("thingPositionRotation", ({ id, position, rotation }) => {
        this.updateThingTransform(socket, id, { position, rotation });
      });

      socket.on("thingPositionScale", ({ id, position, scale }) => {
        this.updateThingTransform(socket, id, { position, scale });
      });

      socket.on(
        "thingPositionRotationScale",
        ({ id, position, rotation, scale }) => {
          this.updateThingTransform(socket, id, { position, rotation, scale });
        }
      );

      socket.on("chatMessage", (message) => {
        io.to(roomName).emit("chatMessage", {
          from: socket.id,
          message,
        });
      });

      socket.on("getAllRoomPlayerCount", () => {
        const roomCounts = {};
        for (const roomId of VALID_ROOM_ID) {
          roomCounts[roomId] = 0;
          for (const thing of Object.values(game.things)) {
            if (thing.gameplayTags?.includes("player")) {
              roomCounts[roomId] += 1;
            }
          }
        }
        socket.emit("allRoomPlayerCount", roomCounts);
      });

      socket.on("playerChangeRoom", (newRoomId) => {
        if (!VALID_ROOM_ID.includes(newRoomId)) return;
        io.to(roomName).emit("playerLeft", socket.id);
        delete game.things[socket.id];
        socket.leave(roomName);

        socket.data.roomId = newRoomId;

        game = this.getGameStateFromSocket(socket);
        roomName = game.roomName;
        player.roomId = newRoomId;
        game.things[socket.id] = player;
        socket.join(roomName);

        io.to(roomName).emit("playerJoined", {
          player: player,
          things: game.things,
        });
      });

      socket.on("disconnect", () => {
        delete game.things[socket.id];
        io.to(roomName).emit("playerLeft", socket.id);
      });
    });
  }

  /**
   * Update a thing's transform and emit appropriate event
   * @param {object} socket - The socket of the player making the update
   * @param {string} thingId - The ID of the thing to update
   * @param {object} newTransform - The new transform data (position, rotation, scale)
   *
   * Emits:
   * - "thingMoved" if position is updated
   * - "thingRotated" if rotation is updated
   * - "thingScaled" if scale is updated
   * - Combination events like "thingMovedRotated", etc. if multiple are updated
   */
  updateThingTransform(socket, thingId, newTransform) {
    const game = this.getGameStateFromSocket(socket);
    if (!game.things[thingId]) return;
    const transform = game.things[thingId].transform;
    let hasPosition = false;
    let hasRotation = false;
    let hasScale = false;

    let emitEvent = "thing";
    const data = {
      id: thingId,
    };

    if (newTransform.position) {
      hasPosition = true;
      emitEvent += "Moved";
      data.position = newTransform.position;
      transform.position = newTransform.position;
    }
    if (newTransform.rotation) {
      hasRotation = true;
      emitEvent += "Rotated";
      data.rotation = newTransform.rotation;
      transform.rotation = newTransform.rotation;
    }
    if (newTransform.scale) {
      hasScale = true;
      emitEvent += "Scaled";
      data.scale = newTransform.scale;
      transform.scale = newTransform.scale;
    }

    if (!hasPosition && !hasRotation && !hasScale) return;
    this.io.to(game.roomName).emit(emitEvent, data);
  }

  getPlayer(socket) {
    const game = this.getGameStateFromSocket(socket);
    return game.things[socket.id];
  }

  getThing(gameId, roomId, thingId) {
    const game = this.getGameState(gameId, roomId);
    return game.things[thingId];
  }

  getGameStateFromSocket(socket) {
    const gameId = socket.data.gameId;
    const roomId = socket.data.roomId;
    return this.getGameState(gameId, roomId);
  }

  getGameState(gameId, roomId) {
    if (!this.gameStates[gameId]) {
      this.gameStates[gameId] = {};
    }
    if (!this.gameStates[gameId][roomId]) {
      this.gameStates[gameId][roomId] = {
        roomName: `${gameId}:${ROOM_ID_PREFIX}${roomId}`,
        things: {},
      };
    }
    return this.gameStates[gameId][roomId];
  }

  playerNotify(req, res) {
    const { message } = req.body;
    console.warn("Player Notify:", message);
    this.io.emit("playerNotify", { message });
    res.json({ success: true });
  }
}

module.exports = GameManager;
