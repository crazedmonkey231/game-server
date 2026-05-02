import type { Application, Request, Response } from "express";
import type { Server as IOServer, Socket } from "socket.io";
import { EventEntry, GlobalStats, IGame, LeaderboardEntry, Player, Profile } from "../types";
import { Game } from "./game";
import { BlankGame } from "../games/BlankGame";
import { getPlayer, getRoomName, isSafeKey, isWeekend } from "../utils";
import { AutoEvent } from "./events";

const serverTickRate = 1000 / 30; // 30 ticks per second
const eventTickRate =  10_000; // 1 tick per minute for slow events

// ─── Connection and Profile Management ─────────────────────────────────────────

/** Connection information for a client */
class ConnectionInfo {
  gameId: string;
  roomId: string;
  name: string;
  socket: Socket;
  input: Record<string, unknown> = {};
  player: Player;

  constructor(socket: Socket, name: string = "Anonymous", gameId: string = "blank-game", roomId: string = "lobby") {
    this.socket = socket;
    this.name = name;
    this.gameId = gameId;
    this.roomId = roomId;
    this.player = getPlayer(socket.id, name, false);

    // Listen for disconnection to clean up the connection info and profile
    socket.on("disconnect", () => {
      console.log(`Client disconnected: ${socket.id}`);
      deleteConnection(socket.id);
    });

    // Listen for player input updates and store them in the connection info for the game loop to process
    socket.on("playerInput", (input: Record<string, unknown>) => {
      this.input = input;
    });

    // Listen for room change requests and move the player to the new room
    socket.on("changeRoom", (newRoomId: string) => {
      const oldRoomName = getRoomName(this.gameId, this.roomId);
      const newRoomName = getRoomName(this.gameId, newRoomId);
      socket.leave(oldRoomName);
      socket.join(newRoomName);
      this.roomId = newRoomId;
      const newState = serverState.games.get(this.gameId)?.getGameState(newRoomId);
      socket.emit("roomChanged", { state: newState });
      socket.to(oldRoomName).emit("playerLeft", { playerId: socket.id, roomId: this.roomId });
      socket.to(newRoomName).emit("playerJoined", { player: this.player, roomId: newRoomId });
    });

    // Listen for requests to get active events for the current game
    socket.on("getManagedEvents", () => {
      socket.emit("managedEvents", { events: serverState.events.get(this.gameId) });
    });

    // Listen for requests to submit leaderboard entries
    socket.on("submitLeaderboardEntry", (data: { name: string; score: number }) => {
      const { name, score } = data;
      const result = addLeaderboardEntry(this.gameId, name, score);
      socket.emit("leaderboardEntryResult", result);
    });

    // Listen for requests to get or change credits, and update the profile accordingly
    socket.on("getCredits", () => {
      const profile = serverState.profiles.get(socket.id);
      socket.emit("credits", profile?.stats.credits ?? 0);
    });

    // Listen for profile updates from the client and update the profile accordingly
    socket.on("changeCredits", (amount: number) => {
      const profile = serverState.profiles.get(socket.id);
      if (profile) {
        profile.stats.credits = Math.max(0, (profile.stats.credits ?? 0) + amount);
        serverState.profiles.set(socket.id, profile);
      }
    });

    // Listen for generic stat changes (e.g., gamesPlayed, totalKills) and update the profile accordingly
    socket.on("changeStats", (stats: Record<string, number>) => {
      const profile = serverState.profiles.get(socket.id);
      if (profile) {
        for (const key in stats) {
          if (typeof stats[key] === "number" && key in profile.stats) {
            profile.stats[key] = Math.max(0, ((profile.stats[key] ?? 0) as number) + stats[key]);
          }
        }
        serverState.profiles.set(socket.id, profile);
      }
    });
  }
}

// ─── Server State ────────────────────────────────────────────────────────────────

/** The main server state interface */
interface ServerState {
  globalStats: GlobalStats;
  connections: Map<string, ConnectionInfo>;
  profiles: Map<string, Profile>;
  events: Map<string, EventEntry[]>;
  autoEvents: Record<string, AutoEvent>;
  leaderboard: Map<string, LeaderboardEntry[]>;
  games: Map<string, Game>;
  availableGames: Map<string, new () => IGame>;
}

/** The main server state, containing all active connections, profiles, events, leaderboards, and games */
const serverState: ServerState = {
  globalStats: {
    globalCredits: 0,
    globalPlayTime: 0,
  },
  connections: new Map<string, ConnectionInfo>(),
  profiles: new Map<string, Profile>(),
  events: new Map<string, EventEntry[]>(),
  autoEvents: {
    "double-xp-weekend": new AutoEvent("double-xp-weekend", "Double XP Weekend", { xpBonus: 2 }, 72 * 60 * 60 * 1000, isWeekend)
  },
  leaderboard: new Map<string, LeaderboardEntry[]>(),
  games: new Map<string, Game>(),
  availableGames: new Map<string, new () => IGame>([["sandbox", BlankGame]]),
};

// ─── Connection Management ─────────────────────────────────────────────────────

/** On client connection */
function onConnection(io: IOServer, socket: Socket): void {
  const query = socket.handshake.query as { gameId?: string; roomId?: string; name?: string };
  let { gameId, roomId, name } = query;
  if (!gameId || !roomId || !serverState.availableGames.has(gameId)) {
    socket.disconnect(true);
    return;
  }
  name = typeof name === "string" ? name.trim().slice(0, 20) : "Anonymous";
  // Create a new connection info and store it in the server state
  const connectionInfo = new ConnectionInfo(socket, name, gameId, roomId);
  serverState.connections.set(socket.id, connectionInfo);
  // Create a profile for this connection if it doesn't exist
  if (!serverState.profiles.has(socket.id)) {
    createProfile(socket.id, name);
  }
  // Add the player to the game and room
  let game = serverState.games.get(gameId);
  if (!game) {
    const GameClass = serverState.availableGames.get(gameId)!;
    game = new Game(socket.id, gameId, new GameClass(), io, serverTickRate);
    serverState.games.set(gameId, game);
  }
  const socketRoomId = getRoomName(gameId, roomId);
  game.addPlayer(roomId, connectionInfo.player);
  socket.join(socketRoomId);
  socket.emit("connected", { gameId, roomId, id: socket.id, name: connectionInfo.player.name, state: game.getGameState(roomId) });
  socket.to(socketRoomId).emit("playerJoined", { player: connectionInfo.player, roomId });
  console.log(`Client connected: ${socket.id}, name: ${name}, game: ${gameId}, room: ${roomId}`);
}

/** Clean up a connection on disconnect */
function deleteConnection(socketId: string): void {
  const connection = serverState.connections.get(socketId);
  if (connection) {
    const credits = connection.player.credits ?? 0;
    const profile = serverState.profiles.get(socketId);
    if (profile) {
      profile.stats.credits = (profile.stats.credits ?? 0) + credits;
      serverState.profiles.set(socketId, profile);
    }
    connection.socket.disconnect(true);
    serverState.connections.delete(socketId);
    deleteProfile(socketId);
  }
}

// ─── Profile Management ─────────────────────────────────────────────────────

function getGlobalStats(req: Request, res: Response): void {
  res.json(serverState.globalStats);
}

/** Create a new profile for a client */
function createProfile(id: string, name?: string): Profile {
  const profile: Profile = {
    id,
    name: name ?? "Anonymous",
    createdAt: new Date(),
    stats: {
      credits: 0,
      gamesPlayed: 0,
      gamesWon: 0,
      totalKills: 0,
      totalDeaths: 0,
    },
  };
  serverState.profiles.set(id, profile);
  return profile;
}

/** Delete a profile from the server state and accumulate its stats into the global stats */
function deleteProfile(id: string): void {
  const profile = serverState.profiles.get(id);
  if (profile) {
    serverState.globalStats.globalCredits += profile.stats.credits ?? 0;
    serverState.globalStats.globalPlayTime +=
      (Date.now() - new Date(profile.createdAt).getTime()) / 1000;
    serverState.profiles.delete(id);
  }
}

/** Search for a profile by socket ID */
function searchProfile(req: Request, res: Response): void {
  const profile = serverState.profiles.get(req.params.socketId as string);
  if (profile) {
    res.json(profile);
  } else {
    res.status(404).json({ error: "Profile not found" });
  } 
}

/** Log in to an existing profile or create a new one if it doesn't exist */
function login(req: Request, res: Response): void {
  const { socketId, username } = req.body as { socketId?: string; username?: string };
  if (!socketId || !username) {
    res.status(400).json({ error: "Missing socketId or username" });
    return;
  }
  if (serverState.profiles.has(socketId)) {
    res.status(400).json({ error: "Profile already exists for this socketId" });
    return;
  }
  const profile = createProfile(socketId, username);
  res.json({ success: true, profile });
}

/** Delete a profile from the server state */
function deleteAccount(req: Request, res: Response): void {
  const { socketId } = req.body as { socketId?: string };
  if (!socketId) {
    res.status(400).json({ error: "Missing socketId" });
    return;
  }
  if (serverState.profiles.has(socketId)) {
    deleteProfile(socketId);
    res.json({ success: true });
  } else {
    res.status(404).json({ error: "Profile not found" });
  }
}

/** Create a new profile for a client */
function createAccount(req: Request, res: Response): void {
  const { socketId, username } = req.body as { socketId?: string; username?: string };
  if (!socketId || !username) {
    res.status(400).json({ error: "Missing socketId or username" });
    return;
  }
  if (serverState.profiles.has(socketId)) {
    res.status(400).json({ error: "Profile already exists for this socketId" });
    return;
  }
  const profile = createProfile(socketId, username);
  res.json({ success: true, profile });
}

// ─── Event Management ─────────────────────────────────────────────────────

/** Make a new event for a game */
function makeEvent(gameId: string, type: string, length: number, data: Record<string, unknown>): void {
  if (!serverState.events.has(gameId)) {
    serverState.events.set(gameId, []);
  }
  serverState.events.get(gameId)?.push({
    type,
    data: data ?? {},
    timestamp: Date.now(),
    length: length ?? 0,
  });
  serverState.connections.forEach((connection) => {
    if (connection.gameId === gameId) {
      connection.socket.emit("eventStarted", { gameId, type, data });
    }
  });
}

/** Trigger a new event for a game, with optional length and data */
function triggerEvent(req: Request, res: Response): void {
  if (typeof req.body !== "object" || req.body === null || Array.isArray(req.body)) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const body = req.body as Record<string, unknown>;
  const gameId = body.gameId;
  const type = body.type;
  const dataRaw = body.data;

  if (typeof gameId !== "string" || typeof type !== "string") {
    res.status(400).json({ error: "Invalid gameId or type" });
    return;
  }
  if (!isSafeKey(gameId) || !isSafeKey(type)) {
    res.status(400).json({ error: "Invalid gameId or type" });
    return;
  }

  const lengthRaw = body.length;
  const length = typeof lengthRaw === "number" && isFinite(lengthRaw) ? lengthRaw : 0;
  const data: Record<string, unknown> =
    typeof dataRaw === "object" && dataRaw !== null && !Array.isArray(dataRaw)
      ? (dataRaw as Record<string, unknown>)
      : {};

  makeEvent(gameId, type, length, data);
  res.json({ success: true });
}

/** Get all active events for a game */
function getEvents(req: Request, res: Response): void {
  const gameId = req.params.gameId as string;
  res.json({ events: serverState.events.get(gameId) });
}

/** Remove an event from a game */
function removeEvent(req: Request, res: Response): void {
  const gameId = req.params.gameId as string;
  const type = req.params.type as string;
  if (!isSafeKey(gameId) || !isSafeKey(type)) {
    res.status(400).json({ error: "Invalid gameId or type" });
    return;
  }
  if (serverState.events.has(gameId)) {
    serverState.events.set(gameId, serverState.events.get(gameId)?.filter((e) => e.type !== type) ?? []);
  }
  serverState.connections.forEach((connection) => {
    if (connection.gameId === gameId) {
      connection.socket.emit("eventEnded", { gameId, type });
    }
  });
  res.json({ success: true });
}

// ─── Leaderboard Management ─────────────────────────────────────────────────

/** Add a new entry to a game's leaderboard and return whether it made the top 10 */
function addLeaderboardEntry(gameId: string, name: string, score: number): { entry: LeaderboardEntry; isInTop10: boolean } {
  const entry: LeaderboardEntry = { name, score, timestamp: Date.now() };
  if (!serverState.leaderboard.has(gameId)) {
    serverState.leaderboard.set(gameId, []);
  }
  const lb = serverState.leaderboard.get(gameId)!;
  lb.push(entry);
  lb.sort((a, b) => b.score - a.score);
  const isInTop10 = lb.indexOf(entry) < 10;
  if (lb.length > 10) lb.length = 10;
  return { entry, isInTop10 };
}

/** Submit a new leaderboard entry for a game */
function submitEntry(req: Request, res: Response): void {
  const gameId = req.params.gameId as string;
  const { name, score } = req.body as { name: unknown; score: unknown };
  if (typeof name !== "string" || typeof score !== "number") {
    res.status(400).json({ error: "Invalid name or score" });
    return;
  }
  if (!isSafeKey(gameId)) {
    res.status(400).json({ error: "Invalid gameId" });
    return;
  }
  const result = addLeaderboardEntry(gameId, name, score);
  res.json({ success: true, ...result });
}

/** Get the leaderboard for a game, with optional limit query parameter */
function getLeaderboardForGame(req: Request, res: Response): void {
  const gameId = req.params.gameId as string;
  const limit = parseInt((req.query.limit as string) ?? "10", 10) || 10;
  const lb = serverState.leaderboard.get(gameId) ?? [];
  res.json(lb.slice(0, limit));
}

// ─── Game Management ─────────────────────────────────────────────────────────

/** List all active games with their player counts */
function listGames(req: Request, res: Response): void {
    const gameList = Array.from(serverState.games.values()).map((g) => ({
      gameId: g.gameId,
      gameType: g.gameType,
      name: g.instance.name,
      playerCount: g.getPlayerCount(),
    }));
    res.json({ games: gameList, availableTypes: Object.keys(serverState.availableGames) });
}

/** Add a new game by type, with a unique ID provided in the request body */
function addGame(req: Request, res: Response, io: IOServer): void {
  const { gameId, gameType } = req.body as { gameId: unknown; gameType: unknown };
  if (typeof gameId !== "string" || typeof gameType !== "string") {
    res.status(400).json({ error: "Invalid gameId or gameType" });
    return;
  }
  if (!isSafeKey(gameId) || !isSafeKey(gameType)) {
    res.status(400).json({ error: "Invalid gameId or gameType" });
    return;
  }
  if (serverState.games.has(gameId)) {
    res.status(400).json({ error: "Game with this ID already exists" });
    return;
  }
  const GameClass = serverState.availableGames.get(gameType);
  if (!GameClass) {
    res.status(400).json({ error: "Invalid gameType" });
    return;
  }
  const game = new Game(gameId, gameType, new GameClass(), io, serverTickRate);
  serverState.games.set(gameId, game);
  res.json({ success: true, gameId, gameType });
}

/** Remove a game by ID, destroying it and cleaning up all associated state */
function removeGameById(req: Request, res: Response): void {
  const gameId = req.params.gameId as string;
  if (!isSafeKey(gameId)) {
    res.status(400).json({ error: "Invalid gameId" });
    return;
  }
  const game = serverState.games.get(gameId);
  if (!game) {
    res.status(404).json({ error: "Game not found" });
    return;
  }
  game.destroy();
  serverState.games.delete(gameId);
  res.json({ success: true });
}

/** Notify all players with a message */
function playerNotify(req: Request, res: Response, io: IOServer): void {
  const { message } = req.body as { message: string };
  console.warn("Player Notify:", message);
  io.emit("playerNotify", { message });
  res.json({ success: true });
}

/** Get the number of players in a specific game and room */
function playersInGame(req: Request, res: Response): void {
  const gameId = req.params.gameId as string;
  const roomId = req.params.roomId as string;
  const game = serverState.games.get(gameId);
  if (!game) {
    res.status(404).json({ error: "Game not found" });
    return;
  }
  res.json({ playerCount: game.getPlayerCountInRoom(roomId) });
}

/** Get the total number of players across all games and rooms */
function playersInAllGames(_req: Request, res: Response): void {
  let totalPlayers = 0;
  for (const game of serverState.games.values()) {
    totalPlayers += game.getPlayerCount();
  }
  res.json({ playerCount: totalPlayers });
}

/** Get the number of players in each game, broken down by room */
function playersInPerGames(_req: Request, res: Response): void {
  const counts: Record<string, number> = {};
  for (const [gameId, game] of serverState.games.entries()) {
    counts[gameId] = game.getPlayerCount();
  }
  res.json({ playerCounts: counts });
}

/** Get a summary of total players and active games across the server */
function summary(_req: Request, res: Response): void {
  let totalPlayers = 0;
  let activeGames = 0;
  for (const [gameId, game] of serverState.games.entries()) {
    const playerCount = game.getPlayerCount();
    if (playerCount > 0) {
      activeGames += 1;
      totalPlayers += playerCount;
    }
  }
  res.json({ totalPlayers, activeGames });
}

// ─── Game Server ─────────────────────────────────────────────────────────────

/** The main game server configuration interface */
export interface GameServerConfig {
  app:Application; 
  io: IOServer;
} 

/** The main game server class, responsible for initializing the server and managing connections */
export class GameServer {
  private app: Application;
  private io: IOServer;
  private eventsTimerHandle: ReturnType<typeof setInterval>;

  constructor(config: GameServerConfig) {
    this.app = config.app;
    this.io = config.io;
    this.eventsTimerHandle = setInterval(this.eventUpdate.bind(this), eventTickRate);
  }

  start(): void {
    console.log("Starting game server...");
    const app = this.app;
    const io = this.io;

    for (const [gameId, GameClass] of serverState.availableGames.entries()) {
      const game = new Game(gameId, gameId, new GameClass(), io, serverTickRate);
      serverState.games.set(gameId, game);
    }
    this.eventUpdate();

    // Set up API routes
    app.get("/api/globalStats", getGlobalStats);

    app.post("/api/eventManager/triggerEvent", triggerEvent);
    app.get("/api/eventManager/getEvents/:gameId", getEvents);
    app.delete("/api/eventManager/removeEvent/:gameId/:type", removeEvent);

    app.get("/api/profile/search/:socketId", searchProfile);
    app.post("/api/profile/createAccount", createAccount);
    app.post("/api/profile/login", login);
    app.post("/api/profile/deleteAccount", deleteAccount);

    app.post("/api/leaderboard/:gameId/submit", submitEntry);
    app.get("/api/leaderboard/:gameId", getLeaderboardForGame);

    app.post("/api/gameManager/playerNotify", (req, res) => playerNotify(req, res, io));
    app.get("/api/gameManager/playersInGame/:gameId/:roomId", playersInGame);
    app.get("/api/gameManager/playersInAllGames", playersInAllGames);
    app.get("/api/gameManager/playersInPerGames", playersInPerGames);
    app.get("/api/gameManager/summary", summary);
    app.get("/api/gameManager/games", listGames);
    app.post("/api/gameManager/games", (req, res) => addGame(req, res, io));
    app.delete("/api/gameManager/games/:gameId", removeGameById);

    // Handle Socket.IO connections
    io.on("connection", (socket) => onConnection(io, socket));
  }

  stop(): void {
    console.log("Stopping game server...");
    clearInterval(this.eventsTimerHandle);
    for (const game of serverState.games.values()) {
      game.destroy();
    }
    serverState.games.clear();
    serverState.connections.forEach((connection) => connection.socket.disconnect(true));
    serverState.connections.clear();
    serverState.profiles.clear();
    serverState.events.clear();
    serverState.leaderboard.clear();
  }

  private eventUpdate(): void {
    // Sync games
    for (const gameId of serverState.games.keys()) {
      if (!serverState.events.has(gameId)) {
        serverState.events.set(gameId, []);
      }
    }
    // Check auto-triggered events and trigger or expire them as needed
    for (const key in serverState.autoEvents) {
      const autoEvent = serverState.autoEvents[key];
      if (autoEvent.triggerCondition()) {
        for (const gameId of serverState.events.keys()) {
          if (!serverState.events.get(gameId)?.some((e) => e.type === autoEvent.type)) {
            autoEvent.start(this.io, gameId);
            if (!serverState.events.get(gameId)) {
              serverState.events.set(gameId, []);
            }
            serverState.events.get(gameId)?.push(autoEvent.toEventEntry());
          } else {
            autoEvent.tick(this.io, gameId);
          }
        }
      } else {
        for (const gameId of serverState.events.keys()) {
          if (!isSafeKey(gameId)) continue;
          serverState.events.set(gameId, serverState.events.get(gameId)?.filter((e) => {
            if (e.type === autoEvent.type) {
              autoEvent.end(this.io, gameId);
              return false;
            }
            return true;
          }) ?? []);
        }
      }
    }
    // Clean up expired events
    if (serverState.events.size === 0) return;
    const now = Date.now();
    for (const gameId in serverState.events) {
      if (!isSafeKey(gameId)) continue;
      serverState.events.set(gameId, serverState.events.get(gameId)?.filter((event) => {
        if (event.length > 0 && now - event.timestamp >= event.length) {
          const autoEvent = serverState.autoEvents[event.type];
          if (autoEvent) {
            autoEvent.end(this.io, gameId);
          } else {
            this.io.emit("eventEnded", { gameId, type: event.type });
          }
          return false;
        }
        return true;
      }) ?? []);
    }
  }
}

