import type { Application, Request, Response } from "express";
import type { Server as IOServer } from "socket.io";
import type { LeaderboardEntry, IGame } from "../types/index.js";
import { GameManager } from "./GameManager.js";
import { isSafeKey } from "../utils/index.js";

/** Manager for handling leaderboards for different games */
export class LeaderboardManager {
  private leaderboard: Record<string, LeaderboardEntry[]> = Object.create(null);

  constructor(gameManager: GameManager) {
    const { app, io } = gameManager.getAppAndIO();
    for (const gameId in gameManager.getGames()) {
      this.leaderboard[gameId] = [];
    }

    // API endpoints for submitting scores and retrieving leaderboards
    app.post("/api/leaderboard/:gameId/submit", this.submit.bind(this));
    app.get("/api/leaderboard/:gameId", this.getLeaderboardForGame.bind(this));

    // Socket.IO listener for clients submitting leaderboard entries in real-time
    io.on("connection", this.onConnection.bind(this));
  }

  addLeaderboardEntry(
    gameId: string,
    name: string,
    score: number,
  ): { entry: LeaderboardEntry; isInTop10: boolean } {
    const entry: LeaderboardEntry = { name, score, timestamp: Date.now() };
    const lb = this.getLeaderboard(gameId);
    lb.push(entry);
    lb.sort((a, b) => b.score - a.score);
    const isInTop10 = lb.indexOf(entry) < 10;
    if (lb.length > 10) lb.length = 10;
    return { entry, isInTop10 };
  }

  getLeaderboard(gameId: string): LeaderboardEntry[] {
    if (!isSafeKey(gameId)) return [];
    if (!Object.prototype.hasOwnProperty.call(this.leaderboard, gameId)) {
      this.leaderboard[gameId] = [];
    }
    return this.leaderboard[gameId];
  }

  private onConnection(socket: any): void {
    const { gameId } = socket.handshake.query as { gameId?: string };
    if (!gameId) return;
    socket.on(
      "submitLeaderboardEntry",
      (data: { name: string; score: number }) => {
        const { name, score } = data;
        const result = this.addLeaderboardEntry(gameId, name, score);
        socket.emit("leaderboardEntrySubmitted", result);
      },
    );
  }

  private submit(req: Request, res: Response): void {
    const gameId = req.params.gameId as string;
    if (!isSafeKey(gameId) || !this.leaderboard[gameId]) {
      res.status(400).json({ error: "Invalid gameId" });
      return;
    }
    const { name, score } = req.body as { name: unknown; score: unknown };
    if (typeof name !== "string" || typeof score !== "number") {
      res.status(400).json({ error: "Invalid name or score" });
      return;
    }
    const result = this.addLeaderboardEntry(gameId, name, score);
    res.json({ success: true, ...result });
  }

  private getLeaderboardForGame(req: Request, res: Response): void {
    const gameId = req.params.gameId as string;
    const limit = parseInt((req.query.limit as string) ?? "10", 10) || 10;
    const lb = this.getLeaderboard(gameId);
    res.json(lb.slice(0, limit));
  }
}
