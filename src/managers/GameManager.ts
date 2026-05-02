import type { Application, Request, Response } from "express";
import type { Server as IOServer, Socket } from "socket.io";
import type { IGame, Room, Player, Thing } from "../types/index.js";
import { getPlayer, isSafeGameId, isValidRoomId } from "../utils/index.js";
import { BlankGame } from "../games/BlankGame.js";

const EVENT_TICK_RATE = 1000 / 30; // 30 Hz

// ─── Game wrapper ─────────────────────────────────────────────────────────────

/** The Game class is a wrapper around a specific game instance, managing its state, players, and rooms */
class Game {
  readonly gameId: string;
  readonly gameType: string;
  readonly instance: IGame;
  readonly rooms: Record<string, Room> = {};

  private updateTimer: ReturnType<typeof setInterval>;
  private io: IOServer;

  private updatedThings: Thing[] = [];
  private updatedPlayers: Player[] = [];

  constructor(gameId: string, gameType: string, instance: IGame, io: IOServer) {
    this.gameId = gameId;
    this.gameType = gameType;
    this.instance = instance;
    this.io = io;

    this.updateTimer = setInterval(() => {
      this.update(this.io);
    }, EVENT_TICK_RATE);
  }

  addGameState(roomId: string): Room {
    if (!this.rooms[roomId]) {
      this.rooms[roomId] = {
        roomId,
        roomName: `${this.gameId}:${roomId}`,
        started: false,
        timer: 0,
        paused: false,
        gameOver: false,
        players: {},
        things: {},
      };
      this.instance.create(this.rooms[roomId]);
    }
    return this.rooms[roomId];
  }

  addPlayer(roomId: string, player: Player): void {
    if (!this.rooms[roomId]) this.addGameState(roomId);
    this.rooms[roomId].players[player.id] = player;
    this.rooms[roomId].things[player.id] = player;
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
    if (!this.rooms[roomId]) return;
    delete this.rooms[roomId].players[playerId];
    delete this.rooms[roomId].things[playerId];
    if (
      this.getPlayerCountInRoom(roomId) === 0 &&
      roomId !== "lobby" &&
      !this.instance.isPersistent
    ) {
      delete this.rooms[roomId];
    }
  }

  addThing(roomId: string, thing: Thing): void {
    this.rooms[roomId].things[thing.id] = thing;
  }

  removeThing(roomId: string, thingId: string): void {
    delete this.rooms[roomId].things[thingId];
  }

  getRoom(roomId: string): Room {
    return this.addGameState(roomId);
  }

  getRoomName(roomId: string): string {
    return this.addGameState(roomId).roomName;
  }

  getPlayers(roomId: string): Player[] {
    const players = this.addGameState(roomId).players;
    return Object.values(players).filter((p) => p.gameplayTags.includes("player"));
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
    for (const roomId in this.rooms) {
      counts[roomId] = this.getPlayers(roomId).length;
    }
    return counts;
  }

  getPlayerCount(): number {
    let count = 0;
    for (const roomId in this.rooms) {
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
        delete fromRoom.things[playerId];
        continue;
      }
      toRoom.players[playerId] = player;
      toRoom.things[playerId] = player;
      delete fromRoom.players[playerId];
      delete fromRoom.things[playerId];
    }
  }

  deleteRoom(roomId: string): void {
    delete this.rooms[roomId];
  }

  update(io: IOServer): void {
    for (const roomId in this.rooms) {
      const currentRoomState = this.rooms[roomId];
      this.updatedThings = [];
      this.updatedPlayers = [];
      this.instance.update(io, currentRoomState, this.updatedPlayers, this.updatedThings);
      if (currentRoomState.gameOver) {
        io.to(currentRoomState.roomName).emit("gameEnded", { reason: "Game Over" });
        this.movePlayersToRoom(roomId, "lobby");
        io.to(currentRoomState.roomName).emit("playersMoved", { toRoom: "lobby" });
        delete this.rooms[roomId];
        continue;
      }
      if (this.getPlayerCountInRoom(roomId) === 0) {
        delete this.rooms[roomId];
        continue;
      }
      if (this.updatedThings.length > 0 || this.updatedPlayers.length > 0) {
        const serverUpdate: Partial<Room> = {
          started: currentRoomState.started,
          timer: currentRoomState.timer,
          paused: currentRoomState.paused,
          gameOver: currentRoomState.gameOver,
          players: this.updatedPlayers.reduce((acc, player) => {
            acc[player.id] = player;
            return acc;
          }, {} as Record<string, Player>),
          things: this.updatedThings.reduce((acc, thing) => {
            acc[thing.id] = thing;
            return acc;
          }, {} as Record<string, Thing>),
        };
        io.to(currentRoomState.roomName).emit("serverUpdate", serverUpdate);
      }
    }
  }

  destroy(): void {
    clearInterval(this.updateTimer);
  }
}

// ─── Socket data augmentation ─────────────────────────────────────────────────

interface SocketGameData {
  gameId: string;
  roomId: string;
  game: Game;
  room: Room;
  roomName: string;
  player: Player;
}

// ─── GameManager ──────────────────────────────────────────────────────────────

let games: Record<string, Game> = {};
let availableGameTypes: Record<string, new () => IGame> = {
  "blank-game": BlankGame
};

function loadGameMap(gameMap: Record<string, new () => IGame>, io: IOServer): void {
  availableGameTypes = gameMap;
  for (const gameId in gameMap) {
    games[gameId] = new Game(gameId, gameId, new gameMap[gameId](), io);
  }
}

/** The GameManager class is responsible for managing all game instances, handling player connections, and providing API endpoints for game management */
export class GameManager {
  private app: Application;
  private io: IOServer;

  constructor(app: Application, io: IOServer) {
    this.app = app;
    this.io = io;
    loadGameMap(availableGameTypes, io);

    app.post("/api/gameManager/playerNotify", this.playerNotify.bind(this));
    app.get("/api/gameManager/playersInGame/:gameId/:roomId", this.playersInGame.bind(this));
    app.get("/api/gameManager/playersInAllGames", this.playersInAllGames.bind(this));
    app.get("/api/gameManager/playersInPerGames", this.playersInPerGames.bind(this));
    app.get("/api/gameManager/summary", this.summary.bind(this));
    app.get("/api/gameManager/games", this.listGames.bind(this));
    app.post("/api/gameManager/games", this.addGame.bind(this));
    app.delete("/api/gameManager/games/:gameId", this.removeGameById.bind(this));

    io.on("connection", (socket) => {
      this.onConnection(io, socket);
    });
  }

  private getGameState(gameId: string, roomId: string): Room {
    return games[gameId].getRoom(roomId);
  }

  private playerNotify(req: Request, res: Response): void {
    const { message } = req.body as { message: string };
    console.warn("Player Notify:", message);
    this.io.emit("playerNotify", { message });
    res.json({ success: true });
  }

  private playersInGame(req: Request, res: Response): void {
    const gameId = req.params.gameId as string;
    const roomId = req.params.roomId as string;
    const game = this.getGameState(gameId, roomId);
    res.json({ playerCount: Object.keys(game.players).length });
  }

  private playersInAllGames(_req: Request, res: Response): void {
    let totalPlayers = 0;
    for (const gameId in games) {
      totalPlayers += games[gameId].getPlayerCount();
    }
    res.json({ playerCount: totalPlayers });
  }

  private playersInPerGames(_req: Request, res: Response): void {
    const counts: Record<string, number> = {};
    for (const gameId in games) {
      counts[gameId] = games[gameId].getPlayerCount();
    }
    res.json({ playerCounts: counts });
  }

  private summary(_req: Request, res: Response): void {
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

  private onConnection(io: IOServer, socket: Socket): void {
    const query = socket.handshake.query as { gameId?: string; roomId?: string; name?: string };
    const { gameId, roomId, name } = query;

    if (!gameId || !roomId || !games[gameId]) {
      socket.disconnect(true);
      return;
    }

    const data = socket.data as SocketGameData;
    data.gameId = gameId;
    data.roomId = roomId;
    data.game = games[gameId];
    data.room = data.game.getRoom(roomId);
    data.roomName = data.game.getRoomName(roomId);
    data.player = getPlayer(socket.id, name ?? socket.id);
    data.game.addPlayer(data.roomId, data.player);

    socket.join(data.roomName);

    socket.emit("init", { you: socket.id, game: data.room });

    socket.on("playerInput", (input: Record<string, unknown>) => {
      data.player.input = input;
    });

    socket.to(data.roomName).emit("playerJoined", { player: data.player, game: data.room });

    socket.on("playerChangeRoom", (newRoomId: string) => {
      if (!isValidRoomId(newRoomId)) return;
      console.log(`Player ${socket.id} changing room from ${data.roomId} to ${newRoomId}`);

      io.to(data.roomName).emit("playerLeft", { playerId: socket.id });
      socket.leave(data.roomName);
      data.game.removePlayer(data.roomId, socket.id);

      data.roomId = newRoomId;
      data.room = data.game.getRoom(newRoomId);
      data.roomName = data.game.getRoomName(newRoomId);
      data.game.addPlayer(data.roomId, data.player);

      socket.join(data.roomName);

      const currentAiCount = data.game.getPlayersAiOnly(data.roomId).length;
      const maxAi = data.game.instance.aiPlayerMax ? data.game.instance.aiPlayerMax() : 0;
      if (currentAiCount < maxAi) {
        data.game.addAiPlayer(data.roomId);
      }

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

  private listGames(_req: Request, res: Response): void {
    const gameList = Object.values(games).map((g) => ({
      gameId: g.gameId,
      gameType: g.gameType,
      name: g.instance.name,
      playerCount: g.getPlayerCount(),
    }));
    res.json({ games: gameList, availableTypes: Object.keys(availableGameTypes) });
  }

  private addGame(req: Request, res: Response): void {
    if (typeof req.body !== "object" || req.body === null || Array.isArray(req.body)) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }
    const { gameId, gameType } = req.body as Record<string, unknown>;
    if (typeof gameId !== "string" || typeof gameType !== "string") {
      res.status(400).json({ error: "gameId and gameType must be strings" });
      return;
    }
    if (!isSafeGameId(gameId)) {
      res.status(400).json({ error: "Invalid gameId: use lowercase letters, digits, and hyphens only" });
      return;
    }
    if (!isSafeGameId(gameType)) {
      res.status(400).json({ error: "Invalid gameType" });
      return;
    }
    if (games[gameId]) {
      res.status(409).json({ error: `Game "${gameId}" is already registered` });
      return;
    }
    const GameClass = availableGameTypes[gameType];
    if (!GameClass) {
      res.status(404).json({ error: `Unknown game type "${gameType}"` });
      return;
    }
    games[gameId] = new Game(gameId, gameType, new GameClass(), this.io);
    res.status(201).json({ success: true, gameId, gameType });
  }

  private removeGameById(req: Request, res: Response): void {
    const gameId = req.params.gameId as string;
    if (!isSafeGameId(gameId)) {
      res.status(400).json({ error: "Invalid gameId" });
      return;
    }
    if (!games[gameId]) {
      res.status(404).json({ error: `Game "${gameId}" not found` });
      return;
    }
    if (games[gameId].getPlayerCount() > 0) {
      res.status(409).json({ error: `Game "${gameId}" still has active players` });
      return;
    }
    games[gameId].destroy();
    delete games[gameId];
    res.json({ success: true });
  }

  getGames(): Record<string, Game> {
    return games;
  }

  getAvailableGameTypes(): Record<string, new () => IGame> {
    return availableGameTypes;
  }

  getApp(): Application {
    return this.app;
  }

  getIO(): IOServer {
    return this.io;
  }

  getAppAndIO(): { app: Application; io: IOServer } {
    return { app: this.app, io: this.io };
  }

  destroy(): void {
    for (const gameId in games) {
      games[gameId].destroy();
    }
    games = {};
  }
}
