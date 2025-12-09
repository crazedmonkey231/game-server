const { getPlayer, fetchJsonSync } = require("../Utils");

class CreationGame {
  constructor() {
    this.name = "CreationGame";
    this.description = "A dice game.";
    this.isPersistent = false; // game state is not persistent
    this.collectedCredits = 0;
    this.size = 1;
  }

  create(room) {
    const { roomId } = room;
    if (roomId === "lobby") return;
    // console.log(`Creating new CreationGame in room: ${roomId}`);

    // Determine board size based on roomId
    let boardSize = 1;
    if (roomId.includes("Small")) {
      boardSize = 1;
    } else if (roomId.includes("Medium")) {
      boardSize = 2;
    } else if (roomId.includes("Large")) {
      boardSize = 3;
    } else if (roomId.includes("Huge")) {
      boardSize = 4;
    } else if (roomId.includes("Giant")) {
      boardSize = 5;
    } else {
      boardSize = 1;
    }
    this.size = boardSize;

    fetchJsonSync("games/CreationGameData", "level", (data) => {
      this.onFetch(room, data, boardSize);
    });
  }

  aiPlayerMax(){
    return this.size
  }

  addAiPlayers() {
    let aiPlayers = [];
    for (let i = 0; i < this.size; i++) {
      const aiId = `ai_${Date.now()}_${Math.floor(Math.random() * 1000)}_${i}`;
      const aiPlayer = getPlayer(aiId, `AI_${aiId}`, true);
      aiPlayers.push(aiPlayer);
    }
    return aiPlayers;
  }

  onFetch(game, data, boardSize) {
    game.paused = data.paused || false;
    game.camera = data.camera || {};
    game.weather = data.weather || {};

    game.currentPlayerIndex = 0;
    game.timer = 0;
    game.started = false;

    const cameraDist = 8 + boardSize;
    game.camera.transform.position = {
      x: 0,
      y: cameraDist + 8,
      z: cameraDist,
    };

    const objList = data.things;
    for (const objData of objList) {
      if (objData.type === "HexTileGrid") {
        objData.data.radius = boardSize;

        // Initialize layers
        objData.data.layers = {};
        objData.data.attacks = {};
        const hexRadius = boardSize;
        for (let q = -hexRadius; q <= hexRadius; q++) {
          const r1 = Math.max(-hexRadius, -q - hexRadius);
          const r2 = Math.min(hexRadius, -q + hexRadius);
          for (let r = r1; r <= r2; r++) {
            objData.data.layers[`${q},${r}`] = [];
            objData.data.attacks[`${q},${r}`] = false;
          }
        }
      }
      game.things[objData.id] = objData;
    }
  }

  emit(io, game, message, data) {
    io.to(game.roomName).emit(message, data);
  }

  update(io, game, outState) {
    if (game.roomId === "lobby") return;
    if (game.gameOver) return;

    const { cache, players, things, started } = game;
    const playerIds = Object.keys(players);
    const playerCount = playerIds.length;

    if (cache.playerCount !== playerCount) {
      // console.log(`CreationGame: Player count changed to ${playerCount}`);
      cache.playerCount = playerCount;
    }

    if (playerCount >= 2 && !started) {
      game.started = true;
      this.emit(io, game, "gameStarted", {
        players: playerIds,
        playerCount: playerCount,
      });
      for (const playerId of playerIds) {
        const player = players[playerId];
        player.data.health = 3;
        player.data.credits = 0;
        player.data.dice = 0;
        player.data.isAi = player.data.isAi || false;
      }
      game.currentPlayerIndex = 0;
      const firstPlayerId = playerIds[game.currentPlayerIndex];
      const firstPlayer = players[firstPlayerId];
      firstPlayer.data.dice = 1;
      this.emit(io, game, "turnStarted", {
        playerId: firstPlayerId,
        rollsLeft: firstPlayer.data.dice,
        credits: firstPlayer.data.credits,
        score: firstPlayer.score,
        health: firstPlayer.data.health,
      });
    }

    if (game.started) {
      const currentPlayerId = playerIds[game.currentPlayerIndex];
      let currentPlayer = players[currentPlayerId];
      if (!currentPlayer) {
        currentPlayer = { input: { endTurn: true } };
      }
      const input = currentPlayer.input || {};

      game.timer += 1;
      if (game.timer > 1000) {
        game.timer = 0;
        if (currentPlayer.data.markedForRemoval) {
          this.emit(io, game, "playerRemoved", {
            playerId: currentPlayerId,
            playerCount: playerCount - 1,
          });
          // console.log(`CreationGame: Removing player ${currentPlayerId}`);
          delete players[currentPlayerId];
          delete things[currentPlayerId];
          return;
        } else {
          currentPlayer.data.markedForRemoval = true;
        }
        input.endTurn = true;
      }

      // Process Ai player input
      if (currentPlayer.data.isAi) {
        currentPlayer.data.markedForRemoval = false;
        currentPlayer.data.thinkTimer =
          (currentPlayer.data.thinkTimer || 0) + 1;
        if (currentPlayer.data.thinkTimer < 30) {
          return;
        }
        currentPlayer.data.thinkTimer = 0;
        let hasTargetAttack = Object.values(things.Thing_HexTileGrid.data.attacks).some((v => v === true));
        if (!hasTargetAttack && currentPlayer.data.dice === 0 && currentPlayer.data.credits === 0) {
          input.endTurn = true;
        } else if (currentPlayer.data.dice > 0) {
          input.rollDice = true;
          input.thingId = things.Thing_GameDice.id;
        } else if (currentPlayer.data.credits > 0) {
          const grid = things.Thing_HexTileGrid;
          const targets = Object.keys(grid.data.layers).filter(key => grid.data.layers[key].length < 6);
          // Check if the target layer is less than the max of 6
          if (targets.length > 0) {
            // Find a target to add a layer to prioritizing the ones where AI has layers already
            let foundPrioritized = false;
            for (let i = 0; i < targets.length; i++) {
              const key = targets[i];
              const layers = grid.data.layers[key];
              const aiLayerIndex = layers.findIndex(layer => layer.owner === currentPlayerId);
              if (aiLayerIndex !== -1) {
                const [q, r] = key.split(",").map((v) => parseInt(v));
                input.type = "addLayerToTile";
                input.q = q;
                input.r = r;
                input.thingId = grid.id;
                foundPrioritized = true;
                break;
              }
            }
            if (!foundPrioritized) {
              // No prioritized target found, just pick a random one
              const randIndex = Math.floor(Math.random() * targets.length);
              const targetKey = targets[randIndex];
              const [q, r] = targetKey.split(",").map((v) => parseInt(v));
              input.type = "addLayerToTile";
              input.q = q;
              input.r = r;
              input.thingId = grid.id;
            }
          }
        } else if (hasTargetAttack) {
          // Find a target to attack
          const grid = things.Thing_HexTileGrid;
          const attackKeys = Object.keys(grid.data.attacks).filter(key => grid.data.attacks[key] === true);
          if (attackKeys.length > 0) {
            const randIndex = Math.floor(Math.random() * attackKeys.length);
            const targetKey = attackKeys[randIndex];
            const [q, r] = targetKey.split(",").map((v) => parseInt(v));
            input.attack = { q: q, r: r };
          }
        } else {
          input.endTurn = true;
        }
      }

      if (input.endTurn) {
        game.timer = 0;
        game.currentPlayerIndex = (game.currentPlayerIndex + 1) % playerCount;
        const nextPlayerId = playerIds[game.currentPlayerIndex];
        const nextPlayer = players[nextPlayerId];
        nextPlayer.data.dice += 1;
        currentPlayer.input = {};
        nextPlayer.data.input = {};
        this.emit(io, game, "turnEnded", {
          previousPlayerId: currentPlayerId,
          nextPlayerId: nextPlayerId,
          score: nextPlayer.score,
          credits: nextPlayer.data.credits,
          rollsLeft: nextPlayer.data.dice,
          health: nextPlayer.data.health,
        });
      } else if (input.rollDice && currentPlayer.data.dice > 0) {
        currentPlayer.data.markedForRemoval = false;
        // Simulate dice roll
        const diceRoll = Math.floor(Math.random() * 6) + 1;
        currentPlayer.data.dice -= 1;
        currentPlayer.data.diceRef = input.thingId;
        currentPlayer.data.credits += diceRoll;
        this.emit(io, game, "diceRolled", {
          playerId: currentPlayerId,
          thingId: input.thingId,
          roll: diceRoll,
          rollsLeft: currentPlayer.data.dice,
          credits: currentPlayer.data.credits,
          score: currentPlayer.score,
          health: currentPlayer.data.health,
        });
      } else if (input.attack) {
        currentPlayer.data.markedForRemoval = false;
        currentPlayer.score += 100;
        // console.log("Processing attack input:", input);
        const { q, r } = input.attack;
        const grid = things.Thing_HexTileGrid;
        if (grid) {
          grid.data.attacks = grid.data.attacks || {};
          const key = `${q},${r}`;
          if (grid.data.attacks[key]) {
            grid.data.attacks[key] = false;
            grid.data.layers[key] = [];
            const effectRoll = Math.floor(Math.random() * 6) + 1;
            // const effectRoll = 3;
            let target = null;
            let gridTargets = [];
            let getGridTargets = false;
            let gridTargetAmount = 0;
            let removeLayers = false;
            let getOpponent = false;
            switch (effectRoll) {
              case 1:
                currentPlayer.data.credits += 1;
                break;
              case 2:
                currentPlayer.data.dice += 1;
                break;
              case 3:
                // Choose random opponent to target
                getOpponent = true;
                break;
              case 4:
                currentPlayer.data.credits += 3;
                getGridTargets = true;
                gridTargetAmount = 2;
                removeLayers = true;
                break;
              case 5:
                currentPlayer.data.credits += 5;
                getGridTargets = true;
                gridTargetAmount = 3;
                removeLayers = true;
                break;
              case 6:
                currentPlayer.data.dice += 1;
                getGridTargets = true;
                gridTargetAmount = 4;
                removeLayers = true;
                getOpponent = true;
                break;
              default:
                break;
            }
            if (getOpponent) {
              const opponentIds = playerIds.filter(
                (id) => id !== currentPlayerId
              );
              if (opponentIds.length > 0) {
                const randIndex = Math.floor(
                  Math.random() * opponentIds.length
                );
                target = players[opponentIds[randIndex]];
              }
            }
            if (getGridTargets) {
              const targets = Object.keys(grid.data.layers);
              while (
                gridTargets.length < gridTargetAmount &&
                targets.length > 0
              ) {
                const randIndex = Math.floor(Math.random() * targets.length);
                const targetKey = targets.splice(randIndex, 1)[0];
                gridTargets.push({
                  q: parseInt(targetKey.split(",")[0]),
                  r: parseInt(targetKey.split(",")[1]),
                });
                if (removeLayers) {
                  grid.data.layers[targetKey] = [];
                  grid.data.attacks[targetKey] = false;
                }
              }
            }
            if (target) {
              target.data.health -= 1;
              if (target.data.health < 0) target.data.health = 0;
              currentPlayer.score += 500;
            }
            const isLastPlayer =
              playerCount === 2 &&
              Object.values(players).filter((p) => p.data.health > 0).length ===
                1;
            this.emit(io, game, "tileAttackRemoved", {
              effectRoll: effectRoll,
              effectData: {
                playerId: currentPlayerId,
                score: currentPlayer.score,
                credits: currentPlayer.data.credits,
                rollsLeft: currentPlayer.data.dice,
                health: currentPlayer.data.health,
                targetId: target ? target.id : null,
                targetHealth: target ? target.data.health : null,
                killTarget: target && target.data.health <= 0,
                isLastPlayer: isLastPlayer,
                gridTargets: gridTargets || null,
                removeLayers: removeLayers || false,
                gridTargetAmount: gridTargetAmount || 0,
                sourceTile: { q: q, r: r },
              },
            });
          }
        }
      } else if (input.type === "addLayerToTile") {
        currentPlayer.data.markedForRemoval = false;
        if (currentPlayer.data.credits <= 0) {
          return;
        }
        const grid = things[input.thingId];
        if (grid && grid.type === "HexTileGrid") {
          let shift = false;
          let attack = false;
          grid.data.layers = grid.data.layers || {};
          const { q, r } = input;
          const key = `${q},${r}`;

          if (!grid.data.attacks) {
            grid.data.attacks = {};
          }
          if (grid.data.attacks[key]) {
            // Already attacked this tile
            return;
          }

          if (!grid.data.layers[key]) {
            grid.data.layers[key] = [];
          }

          // Add a layer
          grid.data.layers[key].push({
            owner: currentPlayerId,
            type: "Default",
            colorData: currentPlayer.data.colorData,
            q: q,
            r: r,
          });

          if (grid.data.layers[key].length > 6) {
            shift = true;
            grid.data.layers[key].shift();
            // console.log("Shifting layers on tile:", grid.data.layers[key]);
          }
          if (grid.data.layers[key].length === 6) {
            attack = grid.data.layers[key].every(
              (layer) => layer.owner === currentPlayerId
            );
          }
          grid.data.attacks[key] = attack;

          currentPlayer.data.credits -= 1;
          if (currentPlayer.data.credits < 0) {
            currentPlayer.data.credits = 0;
          }

          this.emit(io, game, "tileLayerAdded", {
            playerId: currentPlayerId,
            colorData: currentPlayer.data.colorData,
            thingId: things.Thing_HexTileGrid.id,
            q: q,
            r: r,
            diceRollData: {
              decoratedRoll: true,
              thingId: currentPlayer.data.diceRef,
              roll: Math.max(Math.min(6, currentPlayer.data.credits), 1),
            },
            score: currentPlayer.score,
            credits: currentPlayer.data.credits,
            rollsLeft: currentPlayer.data.dice,
            health: currentPlayer.data.health,
            shift: shift,
            attack: attack,
          });
        }
      }

      const positionArc = (2 * Math.PI) / playerCount;
      for (let i = 0; i < playerCount; i++) {
        const playerId = playerIds[i];
        const player = players[playerId];
        const angle = i * positionArc;
        const radius = things.Thing_HexTileGrid.data.radius + 6;
        player.position = {
          x: Math.cos(angle) * radius,
          y: 1,
          z: Math.sin(angle) * radius,
        };
        outState.push({
          id: player.id,
          position: player.position,
        });
        
        player.input = {};
      }
    }
  }
}

module.exports = CreationGame;
