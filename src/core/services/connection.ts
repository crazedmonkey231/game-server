import type { Application, Request, Response } from "express";
import type { Server as IOServer, Socket } from "socket.io";
import { Service } from "../../types";
import { PlayerSession } from "../playersession";
import { isSafeGameId } from "../../utils";
import { serverState } from "../serverstate";

/** This file defines the ConnectionService which manages client connections and their associated player sessions. */
export class ConnectionService implements Service {
  name = "ConnectionManager";
  private connections: Map<string, PlayerSession> = new Map<string, PlayerSession>();
  private io?: IOServer;

  constructor() { }

  registerRoutes(app: Application, io: IOServer): void {
    this.io = io;
  }
  
  addConnection(io: IOServer, socket: Socket): void {
    const query = socket.handshake.query as { gameId?: string; name?: string; isAi?: boolean };
    let { gameId, name, isAi } = query;
    if (!gameId || !serverState.game.hasGame(gameId) || !isSafeGameId(gameId) || typeof name !== "string" || name.trim() === "") {
      socket.disconnect(true);
      return;
    }
    name = typeof name === "string" ? name.trim().slice(0, 20) : "Anonymous";
    // Create a new connection info and store it in the server state
    const roomId = "lobby";
    const connectionInfo = new PlayerSession(socket, gameId, roomId);
    this.connections.set(socket.id, connectionInfo);
    // Create a profile for this connection and a bank account for the profile
    const account = serverState.accounts.createAccount(socket.id, name);
    socket.emit("connected", { account });
    console.log(`Client connected: ${socket.id}, name: ${name}, game: ${gameId}, room: ${roomId}`);
    // Listen for disconnection to clean up the connection info and profile
    socket.on("disconnect", () => {
      console.log(`Client disconnected: ${socket.id}`);
      this.deleteConnection(socket.id);
    });
    // Join the player to the game room
    serverState.game.join(gameId, roomId, connectionInfo, isAi || false);
  }
  
  deleteConnection(socketId: string): void {
    const connection = this.connections.get(socketId);
    if (connection) {
      serverState.game.removePlayerFromGame(connection);
      connection.socket.disconnect(true);
      this.connections.delete(socketId);
      serverState.accounts.deleteAccount(socketId);
    }
  }

  getConnection(socketId: string): PlayerSession | null {
    return this.connections.get(socketId) || null;
  }

  clear(): void {
    this.connections.forEach((connection) => connection.socket.disconnect(true));
    this.connections.clear();
  }
}