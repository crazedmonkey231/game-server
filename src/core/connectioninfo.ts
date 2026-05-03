import type { Application, Request, Response } from "express";
import type { Server as IOServer, Socket } from "socket.io";
import { Input, Player } from "../types";
import { getPlayer, getRoomName } from "../utils";
import { addLeaderboardEntry } from "./managers/leaderboard";
import { deleteConnection } from "./managers/connection";
import { serverState } from "./serverstate";

// ─── Connection and Profile Management ─────────────────────────────────────────

/** Connection information for a client and socket api */
export class ConnectionInfo {
  gameId: string;
  roomId: string;
  name: string;
  socket: Socket;
  player: Player;
  connectedAt: number = Date.now();

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
    socket.on("playerInput", (input: Input) => {
      this.player.input = input;
    });

    socket.on("damage", (data: { amount: number; targetId: string }) => {
      const { amount, targetId } = data;
      const game = serverState.games.get(this.gameId);
      if (game) {
        game.applyDamage(this.roomId, this.player.id, targetId, amount);
      }
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

    // Listen for requests to get the leaderboard for the current game
    socket.on("getLeaderboard", (data: { limit?: number }) => {
      const limit = data?.limit ?? 10;
      const lb = serverState.leaderboard.get(this.gameId) ?? [];
      socket.emit("leaderboardData", { leaderboard: lb.slice(0, limit) });
    });

    // Listen for requests to get or change credits, and update the profile accordingly
    socket.on("getProfileCredits", () => {
      const profile = serverState.profiles.get(socket.id);
      socket.emit("profileCredits", profile?.stats.credits ?? 0);
    });

    // Listen for profile updates from the client and update the profile accordingly
    socket.on("changeProfileCredits", (amount: number) => {
      const profile = serverState.profiles.get(socket.id);
      if (profile) {
        profile.stats.credits = Math.max(0, (profile.stats.credits ?? 0) + amount);
        serverState.profiles.set(socket.id, profile);
      }
    });

    // Listen for generic stat changes (e.g., gamesPlayed, totalKills) and update the profile accordingly
    socket.on("changeProfileStats", (stats: Record<string, number>) => {
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