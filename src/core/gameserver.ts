import type { Application, Request, Response } from "express";
import type { Server as IOServer, Socket } from "socket.io";
import { getGlobalStats, serverState } from "./serverstate";

export const serverTickRate = 1000 / 30; // 30 ticks per second

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

  constructor(config: GameServerConfig) {
    this.app = config.app;
    this.io = config.io;
  }

  start(): void {
    console.log("Starting game server...");
    const app = this.app;
    const io = this.io;

    // Set up API routes
    app.get("/api/globalStats", getGlobalStats);

    // Register service routes
    serverState.connection.registerRoutes(app, io);
    serverState.accounts.registerRoutes(app, io);
    serverState.bank.registerRoutes(app, io);
    serverState.leaderboard.registerRoutes(app, io);
    serverState.event.registerRoutes(app, io);
    serverState.game.registerRoutes(app, io);

    // Handle Socket.IO connections
    io.on("connection", (socket) => serverState.connection.addConnection(io, socket));
  }

  stop(): void {
    console.log("Stopping game server...");
    serverState.connection.clear();
    serverState.game.clear();
    serverState.accounts.clear();
    serverState.event.clear();
    serverState.leaderboard.clear();
  }
}

