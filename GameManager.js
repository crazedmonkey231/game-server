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

// GameManager handles multiple games and rooms
class GameManager {
  static gameStates = {};
  static gameInstances = {};
  constructor(app, io, games) {
    this.io = io;
    for (const gameId in games) {
      if (!GameManager.gameStates[gameId]){
        this.getGameState(gameId);
      }
      if (!GameManager.gameInstances[gameId]){
        GameManager.gameInstances[gameId] = new games[gameId]();
      }
    }

    // Server tick to update game state
    this.serverTick = setInterval(() => {
      io.emit("serverTick", { timestamp: Date.now() });
      for (const gameId in GameManager.gameStates) {
        for (const roomId in GameManager.gameStates[gameId]) {
          this.update(io, gameId, roomId);
        }
      }
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
      for (const gameId in GameManager.gameStates) {
        totalPlayers += Object.keys(GameManager.gameStates[gameId].players).length;
      }
      res.json({ playerCount: totalPlayers });
    });

    // Expose endpoint to get number of players in each game
    app.get("/api/gameManager/playersInPerGames", (req, res) => {
      const counts = {};
      for (const gameId in GameManager.gameStates) {
        const rooms = Object.keys(GameManager.gameStates[gameId]);
        counts[gameId] = 0;
        for (const roomId of rooms) {
          counts[gameId] += Object.keys(
            GameManager.gameStates[gameId][roomId].players
          ).length;
        }
      }
      res.json({ playerCounts: counts });
    });

    // Expose endpoint to get total players and active game count
    app.get("/api/gameManager/summary", (req, res) => {
      let totalPlayers = 0;
      let activeGames = 0;
      for (const gameId in GameManager.gameStates) {
        const rooms = Object.keys(GameManager.gameStates[gameId]);
        for (const roomId of rooms) {
          const playerCount = Object.keys(
            GameManager.gameStates[gameId][roomId].players
          ).length;
          if (playerCount > 0) {
            totalPlayers += playerCount;
            activeGames += 1;
          }
        }
      }
      res.json({ totalPlayers, activeGames });
    });

    // Handle socket connections
    io.on("connection", (socket) => {
      const { gameId, roomId, name, transform } =
        socket.handshake.query;
      if (
        !gameId ||
        !GameManager.gameStates[gameId] ||
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

      // Add player to game state
      const player = {
        roomId,
        id: socket.id,
        name: name || `${socket.id}`,
        score: 0,
        speed: 0.3,
        type: "BasicBoxThing",
        gameplayTags: ["player"],
        transform: JSON.parse(transform) || {
          position: { x: 0, y: 0, z: 0 },
          rotation: { isEuler: true, _x: 0, _y: 0, _z: 0, _order: "XYZ" },
          scale: { x: 1, y: 1, z: 1 },
        },
      };

      game.players[socket.id] = player;
      game.things[socket.id] = player;

      // Send them initial state for THIS game
      socket.emit("init", {
        you: socket.id,
        things: game.things,
      });

      // Notify others in the room about the new player
      socket.to(roomName).emit("playerJoined", {
        player: player,
        things: game.things,
      });

      // Handle input for THIS game only
      socket.on("playerInput", (input) => {
        const player = this.getPlayer(socket);
        if (!player) return;
        GameManager.gameInstances[gameId].playerInput(player, input);
        this.updateThingTransform(socket, socket.id, {
          position: player.transform.position,
        });
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

      socket.on("respawnThing", (thingId) => {
        const thing = game.cache[thingId];
        if (!thing) return;
        game.things[thingId] = thing;
        delete game.cache[thingId];
        io.to(roomName).emit("thingAdded", thing);
      });

      socket.on("removeThing", (thingId) => {
        const thing = game.things[thingId];
        if (!thing) return;
        delete game.things[thingId];
        game.cache[thingId] = thing;
        io.to(roomName).emit("thingRemoved", thingId);
      });

      socket.on("disposeThing", (thingId) => {
        let disposed = false;
        if (game.cache[thingId]) {
          delete game.cache[thingId];
          disposed = true;
        }
        if (game.things[thingId]) {
          delete game.things[thingId];
          disposed = true;
        }
        if (!disposed) return;
        io.to(roomName).emit("thingDisposed", thingId);
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

      socket.on("setVelocity", ({ id, velocity }) => {
        const thing = this.getThing(gameId, roomId, id);
        if (!thing) return;
        thing.velocity = velocity;
      });

      socket.on("setSpeed", ({ id, speed }) => {
        const thing = this.getThing(gameId, roomId, id);
        if (!thing) return;
        thing.speed = speed;
      });

      socket.on("setThingData", ({ id, data }) => {
        const thing = this.getThing(gameId, roomId, id);
        if (!thing) return;
        for (const key in data) {
          thing.data = thing.data || {};
          thing.data[key] = data[key];
        }
      });

      // -- Chat and room management --

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
        delete game.players[socket.id];
        delete game.things[socket.id];
        socket.leave(roomName);

        socket.data.roomId = newRoomId;

        game = this.getGameStateFromSocket(socket);
        roomName = game.roomName;
        player.roomId = newRoomId;
        game.players[socket.id] = player;
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

  async update(io, gameId, roomId) {
    const game = GameManager.gameStates[gameId][roomId];
    // check if there are players in the game
    const playerCount = Object.values(game.things).filter((thing) =>
      thing.gameplayTags?.includes("player")
    ).length;
    // Remove empty games to save memory
    if (playerCount === 0 && !GameManager.gameInstances[gameId].isPersistent) {
      delete GameManager.gameStates[gameId][roomId];
      return;
    }
    const newState = [];
    GameManager.gameInstances[gameId].update(game, newState);
    if (newState.length > 0) {
      io.to(game.roomName).emit("serverUpdate", { things: newState });
    }
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
    if (!GameManager.gameStates[gameId]) {
      GameManager.gameStates[gameId] = {};
    }
    if (!GameManager.gameStates[gameId][roomId]) {
      GameManager.gameStates[gameId][roomId] = {
        roomName: `${gameId}:${ROOM_ID_PREFIX}${roomId}`,
        cache: {},
        players: {},
        things: {},
      };
    }
    return GameManager.gameStates[gameId][roomId];
  }

  getGameInstance(gameId) {
    return GameManager.gameInstances[gameId];
  }

  playerNotify(req, res) {
    const { message } = req.body;
    console.warn("Player Notify:", message);
    this.io.emit("playerNotify", { message });
    res.json({ success: true });
  }
}

module.exports = GameManager;
