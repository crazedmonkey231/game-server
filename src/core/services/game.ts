import type { Application, Request, Response } from "express";
import type { Server as IOServer } from "socket.io";
import { GameState, IGame, Service, Transform } from "../../types";
import { BasicGame } from "../../games/BasicGame";
import { BlankGame } from "../../games/BlankGame";
import { MatchManager } from "../roomcontroller";
import { PlayerSession } from "../playersession";
import { getPlayer, getRoomName, getThing, isSafeKey } from "../../utils";
import { serverState } from "../serverstate";

interface DamageRequest {
  gameId: string;
  roomId: string;
  playerId: string;
  targetId: string;
  amount: number;
}

interface SpawnThingRequest {
  gameId: string;
  roomId: string;
  thingType: string;
  transform: Transform;
  tags?: string[];
}

interface ChangeRoomRequest {
  gameId: string;
  oldRoomId: string;
  newRoomId: string;
}

interface PlayerNotifyRequest {
  gameId: string;
  roomId?: string;
  message: string;
  data: unknown;
}

/** The GameService class manages game instances, player interactions, and game state updates. It serves as the core service for handling all game-related logic and communication with clients. */
export class GameService implements Service {
  name = "GameManager";
  private games: Map<string, MatchManager> = new Map<string, MatchManager>();
  private availableGames: Map<string, new () => IGame> = new Map<string, new () => IGame>([
    ["sandbox", BlankGame], 
    ["basic-game", BasicGame]
  ]);
  private io?: IOServer;

  constructor() { }

  registerRoutes(app: Application, io: IOServer): void {
    this.io = io;
    app.get("/api/gameManager/:gameId/rooms", this.apiListGameRooms.bind(this));
    app.get("/api/gameManager/:gameId/:roomId/players", this.apiPlayersInGameRequest.bind(this));
    app.get("/api/gameManager/playersInAllGames", this.apiPlayersInAllGames.bind(this));
    app.get("/api/gameManager/playersInPerGames", this.apiPlayersInPerGames.bind(this));
    app.get("/api/gameManager/summary", this.apiSummary.bind(this));
    app.get("/api/gameManager/games", this.apiListGames.bind(this));
    app.get("/api/gameManager/:gameId/players", this.apiPlayersInGame.bind(this));
    app.get("/api/gameManager/:gameId/playTime", this.apiPlayTime.bind(this));

    app.post("/api/gameManager/games", this.apiCreateGame.bind(this));
    app.post("/api/gameManager/playerNotify", this.apiPlayerNotify.bind(this));
    app.post("/api/gameManager/:gameId/:roomId/addThing", this.apiAddThing.bind(this));
    app.post("/api/gameManager/:gameId/:roomId/addAiPlayer", this.apiAddPlayerAi.bind(this));

    app.delete("/api/gameManager/:gameId", this.apiRemoveGameById.bind(this));
  }

  hasGame(gameId: string): boolean {
    return this.availableGames.has(gameId);
  }

  getAvailableGames(): string[] {
    return Array.from(this.availableGames.keys());
  }

  createGame(gameId: string, gameType: string): boolean {
    if (this.games.has(gameId)) {
      return false;
    }
    const GameClass = this.availableGames.get(gameType);
    if (!GameClass) {
      return false;
    }
    const game = new MatchManager(gameId, gameType, new GameClass(), this.io!, 1000 / 30);
    this.games.set(gameId, game);
    serverState.event.set(gameId, []);
    return true;
  }

  removeGame(gameId: string): void {
    const game = this.games.get(gameId);
    if (game) {
      game.destroy();
      this.games.delete(gameId);
      serverState.event.removeGame(gameId);
    }
  }

  notifyPlayers(request: PlayerNotifyRequest): void {
    const { gameId, roomId, message, data } = request;
    const game = this.games.get(gameId);
    if (!game) {
      return;
    }
    if (roomId) {
      const roomName = getRoomName(gameId, roomId);
      this.io?.to(roomName).emit("gameNotification", { message, data });
      return;
    } else {
      for (const roomId in game.gameStates) {
        const roomName = getRoomName(gameId, roomId);
        this.io?.to(roomName).emit("gameNotification", { message, data });
      }
    }
  }

  join(gameId: string, roomId: string, connectionInfo: PlayerSession, isAi: boolean): void {
    let game = this.games.get(gameId);
    if (!game) {
      const created = this.createGame(gameId, gameId);
      if (!created) {
        console.error(`Failed to create game with ID ${gameId} and type ${gameId}`);
        return;
      }
      game = this.games.get(gameId)!;
    }
    const socketRoomId = getRoomName(gameId, roomId);
    connectionInfo.socket.join(socketRoomId);
    const player = getPlayer(connectionInfo.socket.id, "Player", isAi);
    connectionInfo.player = player;
    game.addPlayer(roomId, player);
  }

  leave(connectionInfo: PlayerSession): void {
    this.accumulatePlayTime(connectionInfo);
    const game = this.games.get(connectionInfo.gameId);
    if (game && connectionInfo.player) {
      game.removePlayer(connectionInfo.roomId, connectionInfo.player.id);
    }
  }

  damage(request: DamageRequest): void {
    const { gameId, roomId, playerId, targetId, amount } = request;
    const game = this.games.get(gameId);
    if (game && game.hasRoom(roomId)) {
      game.applyDamage(roomId, playerId, targetId, amount);
    }
  }

  spawnThing(request: SpawnThingRequest): void {
    const { gameId, roomId, thingType, transform, tags } = request;
    const game = this.games.get(gameId);
    if (game && game.hasRoom(roomId)) {
      const thing = getThing(`${thingType}_${Date.now()}`, thingType, thingType, tags);
      if (thing) {
        thing.transform = transform;
        game.addThing(roomId, thing);
      }
    }
  }

  changeRoom(request: ChangeRoomRequest): void {
    const { gameId, oldRoomId, newRoomId } = request;
    const game = this.games.get(gameId);
    if (game) {
      game.movePlayersToRoom(oldRoomId, newRoomId);
    }
  }

  getGameState(gameId: string, roomId: string): GameState | null {
    const game = this.games.get(gameId);
    if (game) {
      return game.getGameState(roomId);
    }
    return null;
  }

  listGameRooms(gameId: string): unknown[] {
    const game = this.games.get(gameId);
    if (!game) {
      return [];
    }
    const rooms = Object.entries(game.gameStates).map(([roomId, state]) => ({
      roomId,
      started: state.started,
      paused: state.paused,
      gameOver: state.gameOver,
      timer: state.timer,
      playerCount: Object.values(state.players).filter((p) => p.userData.isAi !== true).length,
      thingCount: Object.keys(state.things).length,
      players: Object.values(state.players).map((p) => ({
        id: p.id,
        name: p.name,
      })),
    }));
    return rooms;
  }

  getPlayerCount(gameId: string): number {
    const game = this.games.get(gameId);
    if (!game) {
      return 0;
    }
    return game.getPlayerCount();
  }

  getPlayerCountPerRoom(gameId: string): Record<string, number> {
    const game = this.games.get(gameId);
    if (!game) {
      return {};
    }
    return game.getPlayerCountPerRoom();
  }

  clear(): void {
    for (const game of this.games.values()) {
      game.destroy();
    }
    this.games.clear();
  }

  accumulatePlayTime(connection: PlayerSession): void {
    const game = this.games.get(connection.gameId);
    if (game) {
      const account = serverState.accounts.get(connection.socket.id);
      if (account) {
        const accountAgeSeconds = (Date.now() - new Date(account.createdAt).getTime()) / 1000;
        game.addPlayTime(accountAgeSeconds);
      }
    }
  }

  private apiListGameRooms(req: Request, res: Response): void {
    const gameId = req.params.gameId as string;
    if (!isSafeKey(gameId)) {
      res.status(400).json({ error: "Invalid gameId" });
      return;
    }
    const game = this.games.get(gameId);
    if (!game) {
      res.status(404).json({ error: "Game not found" });
      return;
    }
    const rooms = Object.entries(game.gameStates).map(([roomId, state]) => ({
      roomId,
      started: state.started,
      paused: state.paused,
      gameOver: state.gameOver,
      timer: state.timer,
      playerCount: Object.values(state.players).length,
      thingCount: Object.keys(state.things).length,
      players: Object.values(state.players),
      things: Object.values(state.things),
    }));
    res.json({ rooms });
  }

  private apiPlayersInGameRequest(req: Request, res: Response): void {
    const gameId = req.params.gameId as string;
    const roomId = req.params.roomId as string;
    const game = this.games.get(gameId);
    if (!game) {
      res.status(404).json({ error: "Game not found" });
      return;
    }
    res.json({ playerCount: game.getPlayerCountInRoom(roomId) });
  }

  private apiPlayersInAllGames(_req: Request, res: Response): void {
    let totalPlayers = 0;
    for (const game of this.games.values()) {
      totalPlayers += game.getPlayerCount();
    }
    res.json({ playerCount: totalPlayers });
  }

  private apiPlayersInPerGames(_req: Request, res: Response): void {
    const counts: Record<string, number> = {};
    for (const [gameId, game] of this.games.entries()) {
      counts[gameId] = game.getPlayerCount();
    }
    res.json({ playerCounts: counts });
  }

  private apiSummary(_req: Request, res: Response): void {
    let totalPlayers = 0;
    let activeGames = 0;
    for (const [gameId, game] of this.games.entries()) {
      const playerCount = game.getPlayerCount();
      if (playerCount > 0) {
        activeGames += 1;
        totalPlayers += playerCount;
      }
    }
    res.json({ totalPlayers, activeGames });
  }

  private apiListGames(req: Request, res: Response): void {
    const gameList = Array.from(this.games.values()).map((g) => ({
      gameId: g.gameId,
      gameType: g.gameType,
      name: g.instance.name,
      playerCount: g.getPlayerCount(),
      playTime: g.getPlayTime(),
    }));
    res.json({ games: gameList, availableTypes: Array.from(this.availableGames.keys()) });
  }

  private apiPlayersInGame(req: Request, res: Response): void {
    const gameId = req.params.gameId as string;
    const roomId = req.params.roomId as string;
    const game = this.games.get(gameId);
    if (!game) {
      res.status(404).json({ error: "Game not found" });
      return;
    }
    res.json({ playerCount: game.getPlayerCountInRoom(roomId) });
  }

  private apiPlayTime(req: Request, res: Response): void {
    const gameId = req.params.gameId as string;
    const game = this.games.get(gameId);
    if (!game) {
      res.status(404).json({ error: "Game not found" });
      return;
    }
    res.json({ playTime: game.getPlayTime() });
  }

  private apiCreateGame(req: Request, res: Response): void {
    const { gameId, gameType } = req.body as { gameId: string; gameType: string };
    if (!gameId || !gameType) {
      res.status(400).json({ error: "Missing gameId or gameType" });
      return;
    }
    if (this.games.has(gameId)) {
      res.status(400).json({ error: "Game ID already exists" });
      return;
    }
    const GameClass = this.availableGames.get(gameType);
    if (!GameClass) {
      res.status(400).json({ error: "Invalid gameType" });
      return;
    }
    this.createGame(gameId, gameType);
    res.json({ success: true });
  }

  private apiPlayerNotify(req: Request, res: Response): void {
    const { gameId, roomId, message, data } = req.body as { gameId: string; roomId: string; message: string; data: unknown };
    const game = this.games.get(gameId);
    if (!game) {
      res.status(404).json({ error: "Game not found" });
      return;
    }
    const roomName = getRoomName(gameId, roomId);
    this.io?.to(roomName).emit("gameNotification", { message, data });
    res.json({ success: true });
  }

  private apiRemoveGameById(req: Request, res: Response): void {
    const gameId = req.params.gameId as string;
    const game = this.games.get(gameId);
    if (!game) {
      res.status(404).json({ error: "Game not found" });
      return;
    }
    game.destroy();
    this.games.delete(gameId);
    res.json({ success: true });
  }

  private apiAddThing(req: Request, res: Response): void {
    const gameId = req.params.gameId as string;
    const roomId = req.params.roomId as string;
    const { thingType, transform, tags } = req.body as { thingType: string; transform: Transform; tags?: string[] };
    const game = this.games.get(gameId);
    if (!game) {
      res.status(404).json({ error: "Game not found" });
      return;
    }
    const thing = getThing(`${thingType}_${Date.now()}`, thingType, thingType, tags);
    if (!thing) {
      res.status(400).json({ error: "Invalid thingType" });
      return;
    }
    thing.transform = transform;
    game.addThing(roomId, thing);
    res.json({ success: true });
  }

  private apiAddPlayerAi(req: Request, res: Response): void {
    const gameId = req.params.gameId as string;
    const roomId = req.params.roomId as string;
    const game = this.games.get(gameId);
    if (!game) {
      res.status(404).json({ error: "Game not found" });
      return;
    }
    const playerId = `AiPlayer_${Date.now()}`;
    const player = getPlayer(playerId, "AI Player", true);
    game.addPlayer(roomId, player);
    res.json({ success: true });
  }
}