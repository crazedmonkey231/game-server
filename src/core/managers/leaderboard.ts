import type { Application, Request, Response } from "express";
import type { Server as IOServer, Socket } from "socket.io";
import { LeaderboardEntry } from "../../types";
import { isSafeKey } from "../../utils";
import { serverState } from "../serverstate";

// ─── Leaderboard Management ─────────────────────────────────────────────────

/** Add a new entry to a game's leaderboard and return whether it made the top 10 */
export function addLeaderboardEntry(gameId: string, name: string, score: number): { entry: LeaderboardEntry; isInTop10: boolean } {
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
export function submitEntry(req: Request, res: Response): void {
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
export function getLeaderboardForGame(req: Request, res: Response): void {
  const gameId = req.params.gameId as string;
  const limit = parseInt((req.query.limit as string) ?? "10", 10) || 10;
  const lb = serverState.leaderboard.get(gameId) ?? [];
  res.json(lb.slice(0, limit));
}