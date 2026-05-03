import type { Server as IOServer } from "socket.io";

// ─── Geometry ────────────────────────────────────────────────────────────────

/** Simple 2D vector */
export interface Vector2 {
  x: number;
  y: number;
}

/** Simple 3D vector */
export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

/** Rotation can be represented as either Euler angles or a quaternion (for more complex 3D games) */
export interface Rotation {
  pitch: number;
  yaw: number;
  roll: number;
}

/** Transform, which includes position, rotation, and scale */
export interface Transform {
  position: Vector3 | Vector2;
  rotation: Rotation | number;
  scale: Vector3 | number;
}

// ─── Game Objects ─────────────────────────────────────────────────────────────

export interface Thing {
  id: string;
  name: string;
  type: string;
  speed: number;
  health?: number;
  transform: Transform;
  velocity?: Vector3 | Vector2;
  gameplayTags: string[];
  userData: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ColorData {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface Input {
  keyboard: Record<string, boolean>;
  mouse: {
    x: number;
    y: number;
    buttons: Record<string, boolean>;
  };
  [key: string]: unknown;
}

export interface Player extends Thing {
  isAi: boolean;
  score: number;
  color?: ColorData;
  input?: Input;
}

// ─── Global Stats ─────────────────────────────────────────────────────────────

export interface GlobalStats {
  globalCredits: number;
  globalPlayTime: number;
  [key: string]: unknown;
}

// ─── Room / Game State ────────────────────────────────────────────────────────

export interface GameState {
  roomId: string;
  roomName: string;
  started: boolean;
  timer: number;
  paused: boolean;
  gameOver: boolean;
  players: Record<string, Player>;
  things: Record<string, Thing>;
}

// ─── Game Interface ───────────────────────────────────────────────────────────

export interface GameUpdatePayload {
  delta: number;
  time: number;
  io: IOServer;
  currentRoom: GameState;
  updatedPlayers: Player[];
  updatedThings: Thing[];
}

export interface IGame {
  readonly name: string;
  readonly description: string;
  isPersistent: boolean;

  create(room: GameState): void | Promise<void>;
  update(payload: GameUpdatePayload): void;

  /** Optional: override to supply custom AI players */
  addAiPlayers?(): Player[];
  /** Optional: maximum number of AI players allowed per room */
  aiPlayerMax?(): number;
}

// ─── Leaderboard ──────────────────────────────────────────────────────────────

export interface LeaderboardEntry {
  name: string;
  score: number;
  timestamp: number;
}

// ─── Events ───────────────────────────────────────────────────────────────────

export interface EventEntry {
  type: string;
  data: Record<string, unknown>;
  timestamp: number;
  length: number;
}

// ─── Profiles ─────────────────────────────────────────────────────────────────

export const profileStandings: Record<string, string> = {
  GREEN: "Rookie",
  BLUE: "Veteran",
  PURPLE: "Elite",
  ORANGE: "Legend",
  RED: "Mythic",
};
export type Standing = keyof typeof profileStandings;

export interface ProfileStats {
  credits: number;
  gamesPlayed: number;
  gamesWon: number;
  totalKills: number;
  totalDeaths: number;
  standing?: Standing;
  [key: string]: unknown;
}

export interface Profile {
  id: string;
  name: string;
  createdAt: Date;
  stats: ProfileStats;
}

