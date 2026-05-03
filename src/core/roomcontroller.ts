import { IGame, GameState, Thing, Player } from "../types";
import { getPlayer, getRoomName } from "../utils";
import type { Server as IOServer } from "socket.io";
import { serverTickRate } from "./gameserver";

interface RoomUpdate {
  things: Thing[];
  players: Player[];
}

/** The RoomController class is a wrapper around a specific game instance, managing its state, players, and rooms */
export class RoomController {
  readonly gameId: string;
  readonly gameType: string;
  readonly instance: IGame;
  readonly gameStates: Record<string, GameState> = {};

  private updateTimer: ReturnType<typeof setInterval>;
  private io: IOServer;

  private pendingUpdates: Record<string, RoomUpdate> = {};

  constructor(gameId: string, gameType: string, instance: IGame, io: IOServer, tickRate: number) {
    this.gameId = gameId;
    this.gameType = gameType;
    this.instance = instance;
    this.io = io;

    this.addGameState("lobby");

    this.updateTimer = setInterval(() => {
      this.update(this.io);
    }, tickRate);
  }

  addGameState(roomId: string): GameState {
    if (!this.gameStates[roomId]) {
      this.gameStates[roomId] = {
        roomId,
        roomName: getRoomName(this.gameId, roomId),
        started: false,
        timer: 0,
        paused: false,
        gameOver: false,
        players: {},
        things: {},
      };
      this.instance.create(this.gameStates[roomId]);
      this.pendingUpdates[roomId] = { things: [], players: [] };
    }
    return this.gameStates[roomId];
  }

  update(io: IOServer): void {
    for (const roomId in this.gameStates) {
      const currentRoomState = this.gameStates[roomId];
      this.instance.update({
        delta: serverTickRate,
        time: Date.now(),
        io,
        currentRoom: currentRoomState,
        updatedPlayers: this.pendingUpdates[roomId].players,
        updatedThings: this.pendingUpdates[roomId].things,
      });
      if (currentRoomState.gameOver) {
        io.to(currentRoomState.roomName).emit("gameEnded", { reason: "Game Over" });
        this.movePlayersToRoom(roomId, "lobby");
        io.to(getRoomName(this.gameId, "lobby")).emit("playersMoved", { toRoom: "lobby" });
        delete this.gameStates[roomId];
        continue;
      }
      if (roomId !== "lobby" && this.getPlayerCountInRoom(roomId) === 0) {
        delete this.gameStates[roomId];
        continue;
      }
      if (this.pendingUpdates[roomId].things.length > 0 || this.pendingUpdates[roomId].players.length > 0) {
        const serverUpdate: Partial<GameState> = {
          started: currentRoomState.started,
          timer: currentRoomState.timer,
          paused: currentRoomState.paused,
          gameOver: currentRoomState.gameOver,
          players: this.pendingUpdates[roomId].players.reduce((acc, player) => {
            acc[player.id] = player;
            return acc;
          }, {} as Record<string, Player>),
          things: this.pendingUpdates[roomId].things.reduce((acc, thing) => {
            acc[thing.id] = thing;
            return acc;
          }, {} as Record<string, Thing>),
        };
        io.to(currentRoomState.roomName).emit("serverUpdate", serverUpdate);
        this.pendingUpdates[roomId] = { things: [], players: [] }; // Clear pending updates after emitting
      }
    }
  }

  destroy(): void {
    clearInterval(this.updateTimer);
  }

  private emit(roomId: string, message: string, data: unknown): void {
    this.io.to(getRoomName(this.gameId, roomId)).emit(message, data);
  }

  getGameState(roomId: string): GameState {
    return this.gameStates[roomId];
  }

  addPlayer(roomId: string, player: Player): void {
    if (!this.gameStates[roomId]) this.addGameState(roomId);
    this.gameStates[roomId].players[player.id] = player;
    this.emit(roomId, "playerJoined", { playerId: player.id, roomId });
  }

  addAiPlayer(roomId: string): void {
    let aiPlayers: Player[] = [];
    if (this.instance.addAiPlayers) {
      aiPlayers = this.instance.addAiPlayers();
    }
    if (aiPlayers.length === 0) {
      const aiId = `ai_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      aiPlayers = [getPlayer(aiId, `AI_${aiId}`, true)];
    }
    for (const aiPlayer of aiPlayers) {
      this.addPlayer(roomId, aiPlayer);
    }
  }

  removePlayer(roomId: string, playerId: string): void {
    if (!this.gameStates[roomId]) return;
    delete this.gameStates[roomId].players[playerId];
    this.emit(roomId, "playerLeft", { playerId, roomId });
    if (
      this.getPlayerCountInRoom(roomId) === 0 &&
      roomId !== "lobby" &&
      !this.instance.isPersistent
    ) {
      this.emit(roomId, "roomClosed", { roomId });
      delete this.gameStates[roomId];
    }
  }

  addThing(roomId: string, thing: Thing): void {
    this.getGameState(roomId).things[thing.id] = thing;
    this.pendingUpdates[roomId].things.push(thing);
    this.emit(roomId, "thingAdded", { thingId: thing.id, roomId });
  }

  removeThing(roomId: string, thingId: string): void {
    delete this.getGameState(roomId).things[thingId];
    this.emit(roomId, "thingRemoved", { thingId, roomId });
  }

  getPlayers(roomId: string): Player[] {
    const players = this.getGameState(roomId).players;
    return Object.values(players).filter((p) => p.userData.isAi !== true);
  }

  getPlayersNoAi(roomId: string): Player[] {
    return this.getPlayers(roomId).filter((p) => p.userData.isAi === false);
  }

  getPlayersAiOnly(roomId: string): Player[] {
    return this.getPlayers(roomId).filter((p) => p.userData.isAi === true);
  }

  getPlayerCountInRoom(roomId: string): number {
    return this.getPlayersNoAi(roomId).length;
  }

  getPlayerCountPerRoom(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const roomId in this.gameStates) {
      counts[roomId] = this.getPlayers(roomId).length;
    }
    return counts;
  }

  getPlayerCount(): number {
    let count = 0;
    for (const roomId in this.gameStates) {
      count += this.getPlayers(roomId).length;
    }
    return count;
  }

  movePlayersToRoom(fromRoomId: string, toRoomId: string): void {
    const fromRoom = this.addGameState(fromRoomId);
    const toRoom = this.addGameState(toRoomId);
    for (const playerId in fromRoom.players) {
      const player = fromRoom.players[playerId];
      player.score = 0;
      if (player.userData.isAi) {
        delete fromRoom.players[playerId];
        continue;
      }
      toRoom.players[playerId] = player;
      delete fromRoom.players[playerId];
      this.emit(fromRoomId, "playerLeft", { playerId, roomId: fromRoomId });
      this.emit(toRoomId, "playerJoined", { playerId, roomId: toRoomId });
    }
  }

  deleteRoom(roomId: string): void {
    this.emit(roomId, "roomClosed", { roomId });
    delete this.gameStates[roomId];
  }

  applyDamage(roomId: string, attackerId: string, targetId: string, amount: number): void {
    const roomState = this.getGameState(roomId);
    const target = roomState.players[targetId];
    if (!target) return;
    target.health = (target.health || 100) - amount;
    if (target.health <= 0) {
      target.health = 0;
      this.emit(roomId, "playerDied", { playerId: targetId, roomId });
      if (attackerId !== targetId) {
        const attacker = roomState.players[attackerId];
        if (attacker) {
          attacker.score = (attacker.score || 0) + 1;
          this.pendingUpdates[roomId].players.push(attacker);
        }
      }
    }
    this.pendingUpdates[roomId].players.push(target);
  }
}