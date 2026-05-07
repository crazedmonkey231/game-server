import { IGame, GameState, Thing, Player } from "../types";
import { getPlayer, getRoomName } from "../utils";
import type { Server as IOServer } from "socket.io";
import { serverTickRate } from "./gameserver";

interface RoomUpdate {
  things: Thing[];
  players: Player[];
}

/** The MatchManager class is a wrapper around a specific game instance and its states */
export class MatchManager {
  private totalPlayTime = 0;

  readonly gameId: string;
  readonly gameType: string;
  readonly instance: IGame;
  readonly gameStates: Map<string, GameState> = new Map<string, GameState>();

  private updateTimer: ReturnType<typeof setInterval>;
  private io: IOServer;

  private pendingUpdates: Map<string, RoomUpdate> = new Map<string, RoomUpdate>();

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

  private emit(roomId: string, message: string, data: unknown): void {
    this.io.to(getRoomName(this.gameId, roomId)).emit(message, data);
  }

  addGameState(roomId: string, players: Player[] = [], things: Thing[] = []): GameState {
    if (!this.gameStates.has(roomId)) {
      this.gameStates.set(roomId, {
        roomId,
        roomName: getRoomName(this.gameId, roomId),
        started: false,
        timer: 0,
        paused: false,
        gameOver: false,
        players: players.reduce((acc, player) => {
          acc[player.id] = player;
          return acc;
        }, {} as Record<string, Player>),
        things: things.reduce((acc, thing) => {
          acc[thing.id] = thing;
          return acc;
        }, {} as Record<string, Thing>),
      });
      this.instance.create(this.gameStates.get(roomId)!);
      this.pendingUpdates.set(roomId, { things: [], players: [] });
    }
    return this.gameStates.get(roomId)!;
  }

  update(io: IOServer): void {
    for (const [roomId, currentRoomState] of this.gameStates) {
      this.instance.update({
        delta: serverTickRate,
        time: Date.now(),
        io,
        currentRoom: currentRoomState,
        updatedPlayers: this.pendingUpdates.get(roomId)!.players,
        updatedThings: this.pendingUpdates.get(roomId)!.things,
      });
      if (this.pendingUpdates.get(roomId)!.things.length > 0 || this.pendingUpdates.get(roomId)!.players.length > 0) {
        const serverUpdate: Partial<GameState> = {
          started: currentRoomState.started,
          timer: currentRoomState.timer,
          paused: currentRoomState.paused,
          gameOver: currentRoomState.gameOver,
          players: this.pendingUpdates.get(roomId)!.players.reduce((acc, player) => {
            acc[player.id] = player;
            return acc;
          }, {} as Record<string, Player>),
          things: this.pendingUpdates.get(roomId)!.things.reduce((acc, thing) => {
            acc[thing.id] = thing;
            return acc;
          }, {} as Record<string, Thing>),
        };
        io.to(currentRoomState.roomName).emit("serverUpdate", serverUpdate);
        this.pendingUpdates.set(roomId, { things: [], players: [] }); // Clear pending updates after emitting
      }
      if (currentRoomState.gameOver) {
        io.to(currentRoomState.roomName).emit("gameEnded", { reason: "Game Over" });
        this.movePlayersToRoom(roomId, "lobby");
        io.to(getRoomName(this.gameId, "lobby")).emit("playersMoved", { toRoom: "lobby" });
        this.gameStates.delete(roomId);
        continue;
      }
      // if (!this.instance.isPersistent && roomId !== "lobby" && this.getPlayerCountInRoom(roomId) === 0) {
      //   this.gameStates.delete(roomId);
      //   continue;
      // }
    }
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
          this.pendingUpdates.get(roomId)!.players.push(attacker);
        }
      }
    }
    this.pendingUpdates.get(roomId)!.players.push(target);
  }

  destroy(): void {
    clearInterval(this.updateTimer);
  }

  getGameState(roomId: string): GameState {
    return this.gameStates.get(roomId)!;
  }

  addPlayer(roomId: string, player: Player): void {
    if (!this.gameStates.has(roomId)) {
      this.addGameState(roomId, [player]);
    } else {
      this.pendingUpdates.get(roomId)!.players.push(player);
      this.gameStates.get(roomId)!.players[player.id] = player;
    }
    this.emit(roomId, "playerJoined", { player });
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
    const gameState = this.gameStates.get(roomId);
    if (!gameState) {
      console.warn(`Attempted to remove player from non-existent room ${roomId} in game ${this.gameId}, GameStates:`, this.gameStates);
      return;
    }
    const player = gameState.players[playerId];
    delete gameState.players[playerId];
    this.emit(roomId, "playerLeft", { player });
    if (
      this.getPlayerCountInRoom(roomId) === 0 &&
      roomId !== "lobby" &&
      !this.instance.isPersistent
    ) {
      this.emit(roomId, "roomClosed", { roomId });
      this.gameStates.delete(roomId);
      this.pendingUpdates.delete(roomId);
    }
  }

  addThing(roomId: string, thing: Thing): void {
    this.getGameState(roomId).things[thing.id] = thing;
    this.pendingUpdates.get(roomId)!.things.push(thing);
    this.gameStates.get(roomId)!.things[thing.id] = thing;
    this.emit(roomId, "thingAdded", { thing });
  }

  removeThing(roomId: string, thingId: string): void {
    const thing = this.getGameState(roomId).things[thingId];
    delete this.getGameState(roomId).things[thingId];
    this.emit(roomId, "thingRemoved", { thing });
  }

  getPlayers(roomId: string): Player[] {
    const roomState = this.gameStates.get(roomId);
    if (!roomState) {
      console.warn(`Attempted to get players for non-existent room ${roomId} in game ${this.gameId}`);
      return [];
    }
    return Object.values(roomState.players);
  }

  getPlayersNoAi(roomId: string): Player[] {
    return this.getPlayers(roomId).filter((p) => p.isAi === false);
  }

  getPlayersAiOnly(roomId: string): Player[] {
    return this.getPlayers(roomId).filter((p) => p.isAi === true);
  }

  getPlayerCountInRoom(roomId: string): number {
    return this.getPlayersNoAi(roomId).length;
  }

  getPlayerCountPerRoom(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const roomId of this.gameStates.keys()) {
      counts[roomId] = this.getPlayers(roomId).length;
    }
    return counts;
  }

  getPlayerCount(): number {
    let count = 0;
    for (const roomId of this.gameStates.keys()) {
      count += this.getPlayers(roomId).length;
    }
    return count;
  }

  addPlayTime(delta: number): void {
    this.totalPlayTime += delta;
  }

  getPlayTime(): number {
    return this.totalPlayTime;
  }

  movePlayersToRoom(fromRoomId: string, toRoomId: string, playerId?: string): void {
    const playersToMove = playerId ? [this.getPlayers(fromRoomId).find(p => p.id === playerId)].filter(Boolean) : this.getPlayers(fromRoomId);
    for (const player of playersToMove) {
      if (!player) continue;
      this.removePlayer(fromRoomId, player.id);
      this.addPlayer(toRoomId, player);
    }
  }

  deleteRoom(roomId: string): void {
    this.emit(roomId, "roomClosed", { roomId });
    this.gameStates.delete(roomId);
    this.pendingUpdates.delete(roomId);
  }

  hasRoom(roomId: string): boolean {
    return this.gameStates.has(roomId);
  }
}