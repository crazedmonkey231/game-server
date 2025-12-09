const fetchJsonSync = require("../Utils").fetchJsonSync;

class BasicGame {
  constructor() {
    this.name = "BasicGame";
    this.description = "A basic game template.";
    this.isPersistent = false; // game state is not persistent
  }

  create(gameState) {
    const { roomId } = gameState;
    if (roomId === "lobby") return;
    // console.log(`Creating new BasicGame in room: ${roomId}`);
    fetchJsonSync("games/BasicGameData", "level", (data) => {
      this.initStateData(gameState, data);
    });
  }

  initStateData(gameState, data) {
    const { paused, camera, weather, things } = data;

    // Initialize game state from fetched data
    gameState.paused = paused || false;
    gameState.camera = camera || {};
    gameState.weather = weather || {};
    for (const thing of things) {
      gameState.things[thing.id] = thing;
    }

    // Initialize other game state variables
    gameState.currentPlayerIndex = 0;
    gameState.timer = 0;
    gameState.started = false;
  }

  emit(io, gameState, message, data) {
    io.to(gameState.roomName).emit(message, data);
  }

  update(io, gameState, outState) {
    if (gameState.roomId === "lobby") return;
    if (gameState.gameOver) return;

    // Extract state info
    const { players } = gameState;
    const playerIds = Object.keys(players);
    const playerCount = playerIds.length;

    // Helper function to emit messages
    const emit = (msg, data) => {
      this.emit(io, gameState, msg, data);
    }

    // Basic start condition
    if (!gameState.started && playerCount >= 2) {
      gameState.started = true;
      emit("gameStarted", {
        players: playerIds,
        playerCount: playerCount,
      });
    }

    // Simple timer update
    if (gameState.started) {
      gameState.timer += 1;
      emit("gameUpdate", {
        timer: gameState.timer,
      });
      if (gameState.timer >= 1000) {
        gameState.gameOver = true;
        emit("gameOver", {
          reason: "Time limit reached",
        });
      }
    }
  }
}

module.exports = BasicGame;