// ─── Server State ────────────────────────────────────────────────────────────────
import type { Request, Response } from "express";
import { BasicGame } from "../games/BasicGame";
import { BlankGame } from "../games/BlankGame";
import { GlobalStats, Account, EventEntry, LeaderboardEntry, IGame } from "../types";
import { isWeekend } from "../utils";
import { PlayerSession } from "./playersession";
import { RoomController } from "./roomcontroller";
import { BankingService } from "./services/bank";
import { AccountsService } from "./services/accounts";
import { LeaderboardService } from "./services/leaderboard";
import { EventService } from "./services/event";
import { ConnectionService } from "./services/connection";
import { GameService } from "./services/game";

/** The main server state interface */
export interface ServerState {
  globalStats: GlobalStats;
  connection: ConnectionService;
  accounts: AccountsService;
  bank: BankingService;
  leaderboard: LeaderboardService;
  event: EventService;
  game: GameService;
}

/** The main server state, containing all active connections, profiles, events, leaderboards, and games */
export const serverState: ServerState = {
  globalStats: {
    globalPlayTime: 0,
  },
  connection: new ConnectionService(),
  accounts: new AccountsService(),
  bank: new BankingService(),
  leaderboard: new LeaderboardService(),
  event: new EventService(),
  game: new GameService(),
};

export function getGlobalStats(req: Request, res: Response): void {
  res.json({
    globalCredits: serverState.bank.getAccount("Bank")?.portfolio.entries.credits.quantity ?? 0,
    globalPlayTime: serverState.globalStats.globalPlayTime,
  });
}