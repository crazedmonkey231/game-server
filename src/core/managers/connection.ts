import type { Application, Request, Response } from "express";
import type { Server as IOServer, Socket } from "socket.io";
import { ConnectionInfo } from "../connectioninfo";
import { getRoomName } from "../../utils";
import { serverTickRate } from "../gameserver";
import { createProfile, deleteProfile } from "./profile";
import { RoomController } from "../roomcontroller";
import { serverState } from "../serverstate";
import { accumulatePlayTime, removePlayerFromGame } from "./game";

// ─── Connection Management ─────────────────────────────────────────────────────

/** On client connection */
export function onConnection(io: IOServer, socket: Socket): void {
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
    const GameClass = serverState.availableGames.get(gameId);
    if (!GameClass) {
      socket.disconnect(true);
      return;
    }
    game = new RoomController(gameId, gameId, new GameClass(), io, serverTickRate);
    serverState.games.set(gameId, game);
  }
  const socketRoomId = getRoomName(gameId, roomId);
  socket.join(socketRoomId);
  socket.emit("connected", { gameId, roomId, id: socket.id, name: connectionInfo.player.name, state: game.getGameState(roomId) });
  game.addPlayer(roomId, connectionInfo.player);
  console.log(`Client connected: ${socket.id}, name: ${name}, game: ${gameId}, room: ${roomId}`);
}

/** Clean up a connection on disconnect */
export function deleteConnection(socketId: string): void {
  const connection = serverState.connections.get(socketId);
  if (connection) {
    accumulatePlayTime(connection);
    removePlayerFromGame(connection);
    connection.socket.disconnect(true);
    serverState.connections.delete(socketId);
    deleteProfile(socketId);
  }
}