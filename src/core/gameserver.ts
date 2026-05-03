import type { Application, Request, Response } from "express";
import type { Server as IOServer, Socket } from "socket.io";
import { RoomController } from "./roomcontroller";
import { isSafeKey } from "../utils";
import { playerNotify, playersInGame, playersInAllGames, playersInPerGames, summary, listGames, addGame, removeGameById, getPlayTime } from "./managers/game";
import { submitEntry, getLeaderboardForGame } from "./managers/leaderboard";
import { getGlobalStats, searchProfile, createAccount, login, deleteAccount } from "./managers/profile";
import { onConnection } from "./managers/connection";
import { triggerEvent, getEvents, removeEvent } from "./managers/event";
import { serverState } from "./serverstate";

export const serverTickRate = 1000 / 30; // 30 ticks per second
export const eventTickRate =  60_000; // 1 tick per minute for slow events

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
      const game = new RoomController(gameId, gameId, new GameClass(), io, serverTickRate);
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

    app.get("/api/gameManager/:gameId/:roomId/players", playersInGame);
    app.get("/api/gameManager/playersInAllGames", playersInAllGames);
    app.get("/api/gameManager/playersInPerGames", playersInPerGames);
    app.get("/api/gameManager/summary", summary);
    app.get("/api/gameManager/games", listGames);
    app.get("/api/gameManager/:gameId/players", playersInGame);
    app.get("/api/gameManager/:gameId/playTime", getPlayTime);
    app.post("/api/gameManager/games", (req, res) => addGame(req, res, io));
    app.post("/api/gameManager/playerNotify", (req, res) => playerNotify(req, res, io));
    app.delete("/api/gameManager/:gameId", removeGameById);

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

