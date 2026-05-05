import type { Application, Request, Response } from "express";
import type { Server as IOServer } from "socket.io";
import { LeaderboardEntry, Service } from "../../types";
import { isSafeKey } from "../../utils";

export class LeaderboardService implements Service {
  name = "Leaderboard";
  private leaderboard: Map<string, LeaderboardEntry[]> = new Map<string, LeaderboardEntry[]>();
  private io?: IOServer;

  constructor() {

  }

  submit(gameId: string, name: string, score: number): { place: number; entry: LeaderboardEntry; leaderboard: LeaderboardEntry[] } {
    const entry: LeaderboardEntry = { name, score, timestamp: Date.now() };
    if (!this.leaderboard.has(gameId)) {
      this.leaderboard.set(gameId, []);
    }
    const lb = this.leaderboard.get(gameId)!;
    lb.push(entry);
    lb.sort((a, b) => b.score - a.score);
    if (lb.length > 10) lb.length = 10;
    const place = lb.indexOf(entry) + 1;
    return { place, entry, leaderboard: lb };
  }

  get(gameId: string): LeaderboardEntry[] | null {
    if (!isSafeKey(gameId)) return null;
    return this.leaderboard.get(gameId) ?? null;
  }

  clear(): void {
    this.leaderboard.clear();
  }

  registerRoutes(app: Application, io: IOServer): void {
    this.io = io;
    app.post("/api/leaderboard/:gameId/submit", this.apiSubmitEntry.bind(this));
    app.get("/api/leaderboard/:gameId", this.apiGetLeaderboardForGame.bind(this));
  }

  private apiSubmitEntry(req: Request, res: Response): void {
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
    const result = this.submit(gameId, name, score);
    res.json({ success: true, ...result });
  }

  private apiGetLeaderboardForGame(req: Request, res: Response): void {
    const gameId = req.params.gameId as string;
    const limit = parseInt((req.query.limit as string) ?? "10", 10) || 10;
    const lb = this.leaderboard.get(gameId) ?? [];
    res.json(lb.slice(0, limit));
  }
}