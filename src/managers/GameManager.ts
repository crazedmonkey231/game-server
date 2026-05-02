import type { Application, Request, Response } from "express";
import type { Server as IOServer, Socket } from "socket.io";
import type { IGame, Room, Player, Thing } from "../types/index.js";
import { getPlayer } from "../utils/index.js";

const EVENT_TICK_RATE = 1000 / 30; // 30 Hz

function isValidRoomId(roomId: string): boolean {
  return roomId === "sandbox" || roomId === "lobby" || roomId.startsWith("room");
}

/** Guards against prototype-polluting keys and enforces safe game ID format */
function isSafeGameId(key: string): boolean {
  return (
    /^[a-z0-9][a-z0-9-]*$/.test(key) &&
    key !== "__proto__" &&
    key !== "constructor" &&
    key !== "prototype"
  );
}

// ─── Game wrapper ─────────────────────────────────────────────────────────────

class Game {
  readonly gameId: string;
  readonly gameType: string;
  readonly instance: IGame;
  readonly rooms: Record<string, Room> = {};

  constructor(gameId: string, gameType: string, instance: IGame) {
    this.gameId = gameId;
    this.gameType = gameType;
    this.instance = instance;
  }

  addGameState(roomId: string): Room {
    if (!this.rooms[roomId]) {
      this.rooms[roomId] = {
        roomId,
        roomName: `${this.gameId}:${roomId}`,
        currentPlayerIndex: 0,
        started: false,
        paused: false,
        gameOver: false,
        timer: 0,
        cache: {},
        players: {},
        things: {},
        weather: {},
        camera: {},
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
    return this.getPlayers(roomId).filter((p) => p.data.isAi === false);
  }

  getPlayersAiOnly(roomId: string): Player[] {
    return this.getPlayers(roomId).filter((p) => p.data.isAi === true);
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
      if (player.data.isAi) {
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
      const gameState = this.rooms[roomId];
      const outState: unknown[] = [];
      this.instance.update(io, gameState, outState);
      if (gameState.gameOver) {
        io.to(gameState.roomName).emit("gameEnded", { reason: "Game Over" });
        this.movePlayersToRoom(roomId, "lobby");
        io.to(gameState.roomName).emit("playersMoved", { toRoom: "lobby" });
        delete this.rooms[roomId];
        continue;
      }
      if (this.getPlayerCountInRoom(roomId) === 0) {
        delete this.rooms[roomId];
        continue;
      }
      if (outState.length > 0) {
        io.to(gameState.roomName).emit("serverUpdate", { things: outState });
      }
    }
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

const games: Record<string, Game> = {};
let availableGameTypes: Record<string, new () => IGame> = {};

function loadGameMap(gameMap: Record<string, new () => IGame>): void {
  availableGameTypes = gameMap;
  for (const gameId in gameMap) {
    games[gameId] = new Game(gameId, gameId, new gameMap[gameId]());
  }
}

export class GameManager {
  private io: IOServer;
  private serverTick: ReturnType<typeof setInterval>;

  constructor(app: Application, io: IOServer, gameMap: Record<string, new () => IGame>) {
    this.io = io;
    loadGameMap(gameMap);

    this.serverTick = setInterval(() => {
      for (const gameId in games) {
        games[gameId].update(io);
      }
    }, EVENT_TICK_RATE);

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
    games[gameId] = new Game(gameId, gameType, new GameClass());
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
    delete games[gameId];
    res.json({ success: true });
  }

  destroy(): void {
    clearInterval(this.serverTick);
  }
}
