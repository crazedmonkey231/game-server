import type { Application, Request, Response } from "express";
import type { Server as IOServer, Socket } from "socket.io";
import { Input, Player, Transform } from "../types";
import { getPlayer, getRoomName, getThing, makeId } from "../utils";
import { serverState } from "./serverstate";
import { PortfolioItem } from "./services/bank";

// ─── Connection and Profile Management ─────────────────────────────────────────

/** Connection information for a client and socket api */
export class PlayerSession {
  gameId: string;
  roomId: string;
  socket: Socket;
  player?: Player;

  constructor(socket: Socket, gameId: string, roomId: string) {
    this.socket = socket;
    this.gameId = gameId;
    this.roomId = roomId;

    // Listen for player input updates and store them in the connection info for the game loop to process
    socket.on("playerInput", (input: Input) => {
      if (this.player) {
        this.player.input = input;
      }
    });

    // Listen for requests to change score and update the player's score accordingly
    socket.on("changeScore", (amount: number) => {
      if (this.player) {
        this.player.score = Math.max(0, this.player.score + amount);
      }
    });

    // Listen for damage events from the client and apply damage to the target player in the game
    socket.on("damage", (data: { amount: number; targetId: string }) => {
      const { amount, targetId } = data;
      serverState.game.damage({ gameId: this.gameId, roomId: this.roomId, playerId: this.player?.id ?? "", targetId, amount });
    });

    // Listen for spawn requests from the client
    socket.on("spawnThing", (data: { thingType: string, transform: Transform, tags?: string[] }) => {
      const { thingType, transform, tags } = data;
      serverState.game.spawnThing({ gameId: this.gameId, roomId: this.roomId, thingType, transform, tags });
    });

    // Listen for room change requests and move the player to the new room
    socket.on("changeRoom", (newRoomId: string) => {
      if (!this.player) return;
      serverState.game.relocatePlayer({ gameId: this.gameId, playerSession: this, newRoomId });
    });

    // Listen for requests to get active events for the current game
    socket.on("getManagedEvents", () => {
      socket.emit("managedEvents", { events: serverState.event.get(this.gameId) });
    });

    // Listen for requests to submit leaderboard entries
    socket.on("submitLeaderboardEntry", (data: { name: string; score: number }) => {
      const { name, score } = data;
      const result = serverState.leaderboard.submit(this.gameId, name, score);
      socket.emit("leaderboardEntryResult", result);
    });

    // Listen for requests to get the leaderboard for the current game
    socket.on("getLeaderboard", (data: { limit?: number }) => {
      const limit = data?.limit ?? 10;
      const lb = serverState.leaderboard.get(this.gameId) ?? [];
      socket.emit("leaderboardData", { leaderboard: lb.slice(0, limit) });
    });

    // Listen for requests to get or change credits, and update the profile accordingly
    socket.on("getCurrency", (data: { currency: string }) => {
      const profile = serverState.accounts.get(socket.id);
      if (profile) {
        const accountId = profile.bankAccountId;
        if (accountId) {
          const account = serverState.bank.getAccount(accountId);
          if (account) {
            const entry = account.portfolio.entries[data.currency];
            socket.emit("currencyData", { currency: data.currency, amount: entry ? entry.quantity : 0 });
            return;
          }
        }
      }
      socket.emit("currencyData", { currency: data.currency, amount: 0 });
    });

    // Listen for requests to make bank transactions and process them through the bank service
    socket.on("makeBankTransaction", (data: { fromAccountId: string, toAccountId: string, item: PortfolioItem, quantity: number }) => {
      const { fromAccountId, toAccountId, item, quantity } = data;
      const result = serverState.bank.createTransaction(fromAccountId, toAccountId, item, quantity);
      socket.emit("bankTransactionResult", result);
    });

    // Listen for requests to get the current game state for the player's room
    socket.on("getGameState", () => {
      const state = serverState.game.getGameState(this.gameId, this.roomId);
      socket.emit("gameState", state);
    });

    // Listen for requests to list all rooms in the current game
    socket.on("listGameRooms", () => {
        const rooms = serverState.game.listGameRooms(this.gameId);
        socket.emit("gameRoomsList", rooms);
    });

    // Listen for request for total players in the current game
    socket.on("getPlayerCount", () => {
      const totalPlayers = serverState.game.getPlayerCount(this.gameId);
      socket.emit("playerCount", totalPlayers);
    });

    // Listen for request for player counts per room in the current game
    socket.on("getPlayerCountPerRoom", () => {
      const counts = serverState.game.getPlayerCountPerRoom(this.gameId);
      socket.emit("playerCountPerRoom", counts);
    });
  }
}