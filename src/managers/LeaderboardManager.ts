import type { Application, Request, Response } from "express";
import type { Server as IOServer } from "socket.io";
import type { LeaderboardEntry, IGame } from "../types/index.js";

/** Guards against prototype-polluting keys such as __proto__, constructor, prototype */
function isSafeKey(key: string): boolean {
  return key !== "__proto__" && key !== "constructor" && key !== "prototype";
}

export class LeaderboardManager {
  private leaderboard: Record<string, LeaderboardEntry[]> = Object.create(null);

  constructor(app: Application, io: IOServer, games: Record<string, IGame>) {
    for (const gameId in games) {
      this.leaderboard[gameId] = [];
    }

    /**
     * POST /api/leaderboard/:gameId/submit
     * body: { name: string, score: number }
     */
    app.post("/api/leaderboard/:gameId/submit", this.submit.bind(this));

    /**
     * GET /api/leaderboard/:gameId
     * optional query: ?limit=10
     */
    app.get("/api/leaderboard/:gameId", this.getLeaderboardForGame.bind(this));
    
    // Handle socket leaderboard submissions per-connection
    io.on("connection", (socket) => {
      const { gameId } = socket.handshake.query as { gameId?: string };
      if (!gameId) return;
      socket.on("submitLeaderboardEntry", (data: { name: string; score: number }) => {
        const { name, score } = data;
        const result = this.addLeaderboardEntry(gameId, name, score);
        socket.emit("leaderboardEntrySubmitted", result);
      });
    });
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

  addLeaderboardEntry(
    gameId: string,
    name: string,
    score: number
  ): { entry: LeaderboardEntry; isInTop10: boolean } {
    const entry: LeaderboardEntry = { name, score, timestamp: Date.now() };
    const lb = this.getLeaderboard(gameId);
    lb.push(entry);
    lb.sort((a, b) => b.score - a.score);
    const isInTop10 = lb.indexOf(entry) < 10;
    if (lb.length > 10) lb.length = 10;
    return { entry, isInTop10 };
  }

  private getLeaderboardForGame(req: Request, res: Response): void {
    const gameId = req.params.gameId as string;
    const limit = parseInt((req.query.limit as string) ?? "10", 10) || 10;
    const lb = this.getLeaderboard(gameId);
    res.json(lb.slice(0, limit));
  }

  getLeaderboard(gameId: string): LeaderboardEntry[] {
    if (!isSafeKey(gameId)) return [];
    if (!Object.prototype.hasOwnProperty.call(this.leaderboard, gameId)) {
      this.leaderboard[gameId] = [];
    }
    return this.leaderboard[gameId];
  }
}
