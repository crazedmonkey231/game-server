const GAMES = ["default-game"];
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
  constructor(io) {
    this.gameStates = {};

    io.on("connection", (socket) => {
      const { gameId, roomId, name, score, transform } = socket.handshake.query;
      if (!GAMES.includes(gameId) || !VALID_ROOM_ID.includes(roomId)) {
        socket.disconnect(true);
        return;
      }

      socket.data.gameId = gameId; // store on socket
      socket.data.roomId = roomId; // store on socket

      const roomName = `${gameId}:${ROOM_ID_PREFIX}${roomId}`;
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
        name: name || "Anonymous",
        score: parseInt(score) || 0,
        transform: transform || {
          position: { x: 0, y: 0, z: 0 },
          rotation: { isEuler: true, _x: 0, _y: 0, _z: 0, _order: "XYZ" },
          scale: { x: 1, y: 1, z: 1 },
        },
      };

      // Send them initial state for THIS game
      socket.emit("init", {
        you: socket.id,
        players: game.players,
      });

      // Let other players in *this game* know
      socket.to(roomName).emit("playerJoined", {
        id: socket.id,
        ...game.players[socket.id],
      });

      // Handle input for THIS game only
      socket.on("playerInput", (input) => {
        const gameId = socket.data.gameId;
        const game = this.getGameState(gameId);
        const player = game.players[socket.id];
        if (!player) return;
        if (!input) return;
        if (gameId === "default-game") {
          const speed = 5;
          const playerPos = player.transform.position;
          if (input.left) playerPos.x -= speed;
          if (input.right) playerPos.x += speed;
          if (input.up) playerPos.y -= speed;
          if (input.down) playerPos.y += speed;
        }
      });

      socket.on("playerScore", (points) => {
        const gameId = socket.data.gameId;
        const game = this.getGameState(gameId);
        const player = game.players[socket.id];
        if (!player) return;
        player.score += points;
      });

      socket.on("playerTransform", (transform) => {
        const gameId = socket.data.gameId;
        const game = this.getGameState(gameId);
        const player = game.players[socket.id];
        if (!player) return;
        player.transform = transform;
      });

      socket.on("playerPosition", (position) => {
        const gameId = socket.data.gameId;
        const game = this.getGameState(gameId);
        const player = game.players[socket.id];
        if (!player) return;
        player.transform.position = position;
      });

      socket.on("playerRotation", (rotation) => {
        const gameId = socket.data.gameId;
        const game = this.getGameState(gameId);
        const player = game.players[socket.id];
        if (!player) return;
        player.transform.rotation = rotation;
      });

      socket.on("playerScale", (scale) => {
        const gameId = socket.data.gameId;
        const game = this.getGameState(gameId);
        const player = game.players[socket.id];
        if (!player) return;
        player.transform.scale = scale;
      });

      socket.on("chatMessage", (message) => {
        const gameId = socket.data.gameId;
        const roomId = socket.data.roomId;
        const roomName = `${gameId}:${ROOM_ID_PREFIX}${roomId}`;
        io.to(roomName).emit("chatMessage", {
          from: socket.id,
          message,
        });
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

      socket.on("disconnect", () => {
        const gameId = socket.data.gameId;
        const roomId = socket.data.roomId;
        const roomName = `${gameId}:${ROOM_ID_PREFIX}${roomId}`;
        const game = this.getGameState(gameId);
        delete game.players[socket.id];
        io.to(roomName).emit("playerLeft", socket.id);
      });
    });

    // Game loop update to broadcast state every 100ms
    setInterval(() => {
      // Clean up empty games
      for (const gameId of Object.keys(this.gameStates)) {
        const game = this.gameStates[gameId];
        if (Object.keys(game.players).length === 0) {
          delete this.gameStates[gameId];
        }
      }
      // Get updates per game and room
      for (const gameId of Object.keys(this.gameStates)) {
        const game = this.gameStates[gameId];
        const rooms = {};
        // Organize players by their rooms
        for (const socketId of Object.keys(game.players)) {
          const player = game.players[socketId];
          const roomName = `${gameId}:${ROOM_ID_PREFIX}${player.roomId}`;
          if (!rooms[roomName]) {
            rooms[roomName] = new Set();
          }
          rooms[roomName].add(socketId);
        }
        // Broadcast updates per room
        for (const roomName of Object.keys(rooms)) {
          io.to(roomName).emit("update", {
            players: Array.from(rooms[roomName]).reduce((obj, socketId) => {
              obj[socketId] = game.players[socketId];
              return obj;
            }, {}),
          });
        }
      }
    }, 100);
  }

  getGameState(gameId) {
    if (!this.gameStates[gameId]) {
      this.gameStates[gameId] = {
        players: {},
      };
    }
    return this.gameStates[gameId];
  }
}

module.exports = GameManager;
