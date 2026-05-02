// import type { Server as IOServer } from "socket.io";
// import type { Room, Player, Thing } from "../src/types/index.js";
// import { BaseGame } from "../src/games/BaseGame.js";
// import { getPlayer, fetchJsonSync } from "../src/utils/index.js";

// interface LevelData {
//   paused?: boolean;
//   camera?: Record<string, unknown>;
//   weather?: Record<string, unknown>;
//   things: Array<Record<string, unknown>>;
// }

// interface HexTileGridData {
//   radius: number;
//   size: number;
//   height: number;
//   layers: Record<string, Array<{ owner: string; type: string; colorData: unknown; q: number; r: number }>>;
//   attacks: Record<string, boolean>;
// }

// export class CreationGame extends BaseGame {
//   readonly name = "CreationGame";
//   readonly description = "A dice game.";
//   isPersistent = false;
//   private collectedCredits = 0;
//   private size = 1;

//   create(room: Room): void {
//     const { roomId } = room;
//     if (roomId === "lobby") return;

//     let boardSize = 1;
//     if (roomId.includes("Small")) boardSize = 1;
//     else if (roomId.includes("Medium")) boardSize = 2;
//     else if (roomId.includes("Large")) boardSize = 3;
//     else if (roomId.includes("Huge")) boardSize = 4;
//     else if (roomId.includes("Giant")) boardSize = 5;

//     this.size = boardSize;

//     fetchJsonSync<LevelData>("games/CreationGameData", "level", (data) => {
//       this.onFetch(room, data, boardSize);
//     });
//   }

//   aiPlayerMax(): number {
//     return this.size;
//   }

//   addAiPlayers(): Player[] {
//     const aiPlayers: Player[] = [];
//     for (let i = 0; i < this.size; i++) {
//       const aiId = `ai_${Date.now()}_${Math.floor(Math.random() * 1000)}_${i}`;
//       aiPlayers.push(getPlayer(aiId, `AI_${aiId}`, true));
//     }
//     return aiPlayers;
//   }

//   private onFetch(game: Room, data: LevelData, boardSize: number): void {
//     game.paused = data.paused ?? false;
//     game.camera = data.camera ?? {};
//     game.weather = data.weather ?? {};
//     game.currentPlayerIndex = 0;
//     game.timer = 0;
//     game.started = false;

//     const cameraDist = 8 + boardSize;
//     (game.camera as { transform: { position: { x: number; y: number; z: number } } }).transform.position = {
//       x: 0,
//       y: cameraDist + 8,
//       z: cameraDist,
//     };

//     for (const objData of data.things) {
//       if (objData.type === "HexTileGrid") {
//         const hexData = objData.data as HexTileGridData;
//         hexData.radius = boardSize;
//         hexData.layers = {};
//         hexData.attacks = {};
//         const hexRadius = boardSize;
//         for (let q = -hexRadius; q <= hexRadius; q++) {
//           const r1 = Math.max(-hexRadius, -q - hexRadius);
//           const r2 = Math.min(hexRadius, -q + hexRadius);
//           for (let r = r1; r <= r2; r++) {
//             hexData.layers[`${q},${r}`] = [];
//             hexData.attacks[`${q},${r}`] = false;
//           }
//         }
//       }
//       game.things[objData.id as string] = objData as unknown as Thing;
//     }
//   }

//   private emit(io: IOServer, game: Room, message: string, data: unknown): void {
//     io.to(game.roomName).emit(message, data);
//   }

//   update(io: IOServer, game: Room, outState: unknown[]): void {
//     if (game.roomId === "lobby") return;
//     if (game.gameOver) return;

//     const { cache, players, things, started } = game;
//     const playerIds = Object.keys(players);
//     const playerCount = playerIds.length;

//     if (cache.playerCount !== playerCount) {
//       cache.playerCount = playerCount;
//     }

//     if (playerCount >= 2 && !started) {
//       game.started = true;
//       this.emit(io, game, "gameStarted", { players: playerIds, playerCount });
//       for (const playerId of playerIds) {
//         const player = players[playerId];
//         player.data.health = 3;
//         player.data.credits = 0;
//         player.data.dice = 0;
//         player.data.isAi = player.data.isAi || false;
//       }
//       game.currentPlayerIndex = 0;
//       const firstPlayerId = playerIds[game.currentPlayerIndex];
//       const firstPlayer = players[firstPlayerId];
//       firstPlayer.data.dice = 1;
//       this.emit(io, game, "turnStarted", {
//         playerId: firstPlayerId,
//         rollsLeft: firstPlayer.data.dice,
//         credits: firstPlayer.data.credits,
//         score: firstPlayer.score,
//         health: firstPlayer.data.health,
//       });
//     }

//     if (!game.started) return;

//     const currentPlayerId = playerIds[game.currentPlayerIndex];
//     let currentPlayer = players[currentPlayerId];
//     if (!currentPlayer) {
//       currentPlayer = { input: { endTurn: true } } as unknown as Player;
//     }
//     const input = (currentPlayer.input ?? {}) as Record<string, unknown>;

//     // Process AI player input
//     if (currentPlayer.data.isAi) {
//       currentPlayer.data.markedForRemoval = false;
//       currentPlayer.data.thinkTimer = ((currentPlayer.data.thinkTimer as number) || 0) + 1;
//       if ((currentPlayer.data.thinkTimer as number) < 20) return;
//       currentPlayer.data.thinkTimer = 0;

//       const grid = things.Thing_HexTileGrid as unknown as { id: string; data: HexTileGridData };
//       const hasTargetAttack = Object.values(grid.data.attacks).some((v) => v === true);

//       if (!hasTargetAttack && currentPlayer.data.dice === 0 && currentPlayer.data.credits === 0) {
//         input.endTurn = true;
//       } else if ((currentPlayer.data.dice as number) > 0) {
//         input.rollDice = true;
//         input.thingId = things.Thing_GameDice.id;
//       } else if ((currentPlayer.data.credits as number) > 0) {
//         const targets = Object.keys(grid.data.layers).filter(
//           (key) => grid.data.layers[key].length < 6
//         );
//         if (targets.length > 0) {
//           let foundPrioritized = false;
//           for (const key of targets) {
//             const layers = grid.data.layers[key];
//             const aiLayerIndex = layers.findIndex((layer) => layer.owner === currentPlayerId);
//             if (aiLayerIndex !== -1) {
//               const [q, r] = key.split(",").map(Number);
//               input.type = "addLayerToTile";
//               input.q = q;
//               input.r = r;
//               input.thingId = grid.id;
//               foundPrioritized = true;
//               break;
//             }
//           }
//           if (!foundPrioritized) {
//             const randIndex = Math.floor(Math.random() * targets.length);
//             const targetKey = targets[randIndex];
//             const [q, r] = targetKey.split(",").map(Number);
//             input.type = "addLayerToTile";
//             input.q = q;
//             input.r = r;
//             input.thingId = grid.id;
//           }
//         }
//       } else if (hasTargetAttack) {
//         const attackKeys = Object.keys(grid.data.attacks).filter(
//           (key) => grid.data.attacks[key] === true
//         );
//         if (attackKeys.length > 0) {
//           const randIndex = Math.floor(Math.random() * attackKeys.length);
//           const targetKey = attackKeys[randIndex];
//           const [q, r] = targetKey.split(",").map(Number);
//           input.attack = { q, r };
//         }
//       } else {
//         input.endTurn = true;
//       }
//     }

//     if (input.endTurn) {
//       game.timer = 0;
//       game.currentPlayerIndex = (game.currentPlayerIndex + 1) % playerCount;
//       const nextPlayerId = playerIds[game.currentPlayerIndex];
//       const nextPlayer = players[nextPlayerId];
//       nextPlayer.data.dice = (nextPlayer.data.dice as number) + 1;
//       currentPlayer.input = {};
//       nextPlayer.input = {};
//       this.emit(io, game, "turnEnded", {
//         previousPlayerId: currentPlayerId,
//         nextPlayerId,
//         score: nextPlayer.score,
//         credits: nextPlayer.data.credits,
//         rollsLeft: nextPlayer.data.dice,
//         health: nextPlayer.data.health,
//       });
//     } else if (input.rollDice && (currentPlayer.data.dice as number) > 0) {
//       currentPlayer.data.markedForRemoval = false;
//       const diceRoll = Math.floor(Math.random() * 6) + 1;
//       currentPlayer.data.dice = (currentPlayer.data.dice as number) - 1;
//       currentPlayer.data.diceRef = input.thingId;
//       currentPlayer.data.credits = (currentPlayer.data.credits as number) + diceRoll;
//       this.emit(io, game, "diceRolled", {
//         playerId: currentPlayerId,
//         thingId: input.thingId,
//         roll: diceRoll,
//         rollsLeft: currentPlayer.data.dice,
//         credits: currentPlayer.data.credits,
//         score: currentPlayer.score,
//         health: currentPlayer.data.health,
//       });
//     } else if (input.attack) {
//       currentPlayer.data.markedForRemoval = false;
//       currentPlayer.score += 100;
//       const { q, r } = input.attack as { q: number; r: number };
//       const grid = things.Thing_HexTileGrid as unknown as { data: HexTileGridData; id: string };
//       if (grid) {
//         grid.data.attacks = grid.data.attacks ?? {};
//         const key = `${q},${r}`;
//         if (grid.data.attacks[key]) {
//           grid.data.attacks[key] = false;
//           grid.data.layers[key] = [];
//           const effectRoll = Math.floor(Math.random() * 6) + 1;
//           let target: Player | null = null;
//           let gridTargets: Array<{ q: number; r: number }> = [];
//           let getGridTargets = false;
//           let gridTargetAmount = 0;
//           let removeLayers = false;
//           let getOpponent = false;

//           switch (effectRoll) {
//             case 1:
//               currentPlayer.data.credits = (currentPlayer.data.credits as number) + 3;
//               break;
//             case 2:
//               currentPlayer.data.dice = (currentPlayer.data.dice as number) + 2;
//               break;
//             case 3:
//               getOpponent = true;
//               break;
//             case 4:
//               currentPlayer.data.credits = (currentPlayer.data.credits as number) + 3;
//               currentPlayer.data.dice = (currentPlayer.data.dice as number) + 1;
//               getGridTargets = true;
//               gridTargetAmount = 2;
//               removeLayers = true;
//               break;
//             case 5:
//               currentPlayer.data.credits = (currentPlayer.data.credits as number) + 5;
//               getGridTargets = true;
//               gridTargetAmount = 3;
//               removeLayers = true;
//               break;
//             case 6:
//               currentPlayer.data.dice = (currentPlayer.data.dice as number) + 2;
//               currentPlayer.data.credits = (currentPlayer.data.credits as number) + 6;
//               getGridTargets = true;
//               gridTargetAmount = 4;
//               removeLayers = true;
//               getOpponent = true;
//               break;
//             default:
//               break;
//           }

//           if (getOpponent) {
//             const opponentIds = playerIds.filter((id) => id !== currentPlayerId);
//             if (opponentIds.length > 0) {
//               const randIndex = Math.floor(Math.random() * opponentIds.length);
//               target = players[opponentIds[randIndex]];
//             }
//           }

//           if (getGridTargets) {
//             const allTargets = Object.keys(grid.data.layers);
//             while (gridTargets.length < gridTargetAmount && allTargets.length > 0) {
//               const randIndex = Math.floor(Math.random() * allTargets.length);
//               const targetKey = allTargets.splice(randIndex, 1)[0];
//               gridTargets.push({
//                 q: parseInt(targetKey.split(",")[0]),
//                 r: parseInt(targetKey.split(",")[1]),
//               });
//               if (removeLayers) {
//                 grid.data.layers[targetKey] = [];
//                 grid.data.attacks[targetKey] = false;
//               }
//             }
//           }

//           if (target) {
//             target.data.health = (target.data.health as number) - 1;
//             if ((target.data.health as number) < 0) target.data.health = 0;
//             currentPlayer.score += 500;
//             if ((target.data.health as number) <= 0) {
//               delete players[target.id];
//               delete things[target.id];
//             }
//           }

//           const isLastPlayer =
//             playerCount === 2 &&
//             Object.values(players).filter((p) => (p.data.health as number) > 0).length === 1;

//           this.emit(io, game, "tileAttackRemoved", {
//             effectRoll,
//             effectData: {
//               playerId: currentPlayerId,
//               score: currentPlayer.score,
//               credits: currentPlayer.data.credits,
//               rollsLeft: currentPlayer.data.dice,
//               health: currentPlayer.data.health,
//               targetId: target ? target.id : null,
//               targetHealth: target ? target.data.health : null,
//               killTarget: target && (target.data.health as number) <= 0,
//               isLastPlayer,
//               gridTargets: gridTargets.length > 0 ? gridTargets : null,
//               removeLayers,
//               gridTargetAmount,
//               sourceTile: { q, r },
//             },
//           });
//         }
//       }
//     } else if (input.type === "addLayerToTile") {
//       currentPlayer.data.markedForRemoval = false;
//       if ((currentPlayer.data.credits as number) <= 0) return;

//       const grid = things[input.thingId as string] as unknown as { data: HexTileGridData; id: string; type: string };
//       if (grid && grid.type === "HexTileGrid") {
//         let shift = false;
//         let attack = false;
//         grid.data.layers = grid.data.layers ?? {};
//         const q = input.q as number;
//         const r = input.r as number;
//         const key = `${q},${r}`;

//         grid.data.attacks = grid.data.attacks ?? {};
//         if (grid.data.attacks[key]) return;

//         grid.data.layers[key] = grid.data.layers[key] ?? [];
//         grid.data.layers[key].push({
//           owner: currentPlayerId,
//           type: "Default",
//           colorData: currentPlayer.data.colorData,
//           q,
//           r,
//         });

//         if (grid.data.layers[key].length > 6) {
//           shift = true;
//           grid.data.layers[key].shift();
//         }
//         if (grid.data.layers[key].length === 6) {
//           attack = grid.data.layers[key].every((layer) => layer.owner === currentPlayerId);
//         }
//         grid.data.attacks[key] = attack;

//         currentPlayer.data.credits = (currentPlayer.data.credits as number) - 1;
//         if ((currentPlayer.data.credits as number) < 0) currentPlayer.data.credits = 0;

//         const hexGrid = things.Thing_HexTileGrid as unknown as { data: HexTileGridData; id: string };
//         this.emit(io, game, "tileLayerAdded", {
//           playerId: currentPlayerId,
//           colorData: currentPlayer.data.colorData,
//           thingId: hexGrid.id,
//           q,
//           r,
//           diceRollData: {
//             decoratedRoll: true,
//             thingId: currentPlayer.data.diceRef,
//             roll: Math.max(Math.min(6, currentPlayer.data.credits as number), 1),
//           },
//           score: currentPlayer.score,
//           credits: currentPlayer.data.credits,
//           rollsLeft: currentPlayer.data.dice,
//           health: currentPlayer.data.health,
//           shift,
//           attack,
//         });
//       }
//     }

//     // Update player positions in an arc
//     const positionArc = (2 * Math.PI) / playerCount;
//     const hexGrid = things.Thing_HexTileGrid as unknown as { data: HexTileGridData };
//     for (let i = 0; i < playerCount; i++) {
//       const playerId = playerIds[i];
//       const player = players[playerId];
//       if (!player) continue;
//       const angle = i * positionArc;
//       const radius = hexGrid.data.radius + 6;
//       player.position = {
//         x: Math.cos(angle) * radius,
//         y: 1,
//         z: Math.sin(angle) * radius,
//       };
//       outState.push({ id: player.id, position: player.position });
//       player.input = {};
//     }
//   }
// }
