// ─── Server State ────────────────────────────────────────────────────────────────

import { BasicGame } from "../games/BasicGame";
import { BlankGame } from "../games/BlankGame";
import { GlobalStats, Profile, EventEntry, LeaderboardEntry, IGame } from "../types";
import { isWeekend } from "../utils";
import { AutoEvent } from "./autoevent";
import { ConnectionInfo } from "./connectioninfo";
import { RoomController } from "./roomcontroller";

/** The main server state interface */
export interface ServerState {
  globalStats: GlobalStats;
  connections: Map<string, ConnectionInfo>;
  profiles: Map<string, Profile>;
  events: Map<string, EventEntry[]>;
  autoEvents: Record<string, AutoEvent>;
  leaderboard: Map<string, LeaderboardEntry[]>;
  games: Map<string, RoomController>;
  availableGames: Map<string, new () => IGame>;
}

/** The main server state, containing all active connections, profiles, events, leaderboards, and games */
export const serverState: ServerState = {
  globalStats: {
    globalCredits: 0,
    globalPlayTime: 0,
  },
  connections: new Map<string, ConnectionInfo>(),
  profiles: new Map<string, Profile>(),
  events: new Map<string, EventEntry[]>(),
  autoEvents: {
    "double-xp-weekend": new AutoEvent("double-xp-weekend", "Double XP Weekend", { xpBonus: 2 }, 72 * 60 * 60 * 1000, isWeekend)
  },
  leaderboard: new Map<string, LeaderboardEntry[]>(),
  games: new Map<string, RoomController>(),
  availableGames: new Map<string, new () => IGame>([["sandbox", BlankGame], ["basic-game", BasicGame]]),
};