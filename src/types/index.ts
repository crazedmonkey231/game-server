// ─── Geometry ────────────────────────────────────────────────────────────────

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface Rotation {
  isEuler: boolean;
  _x: number;
  _y: number;
  _z: number;
  _order: string;
}

export interface Transform {
  position: Vector3;
  rotation: Rotation;
  scale: Vector3;
}

// ─── Game Objects ─────────────────────────────────────────────────────────────

export interface Thing {
  id: string;
  name: string;
  speed: number;
  type: string;
  gameplayTags: string[];
  transform: Transform;
  data: Record<string, unknown>;
  velocity?: Vector3;
  position?: Vector3;
  [key: string]: unknown;
}

export interface ColorData {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface PlayerData {
  isAi: boolean;
  health: number;
  credits: number;
  dice: number;
  colorData: ColorData;
  [key: string]: unknown;
}

export interface Player extends Thing {
  score: number;
  data: PlayerData;
  input?: Record<string, unknown>;
}

// ─── Room / Game State ────────────────────────────────────────────────────────

export interface Room {
  roomId: string;
  roomName: string;
  currentPlayerIndex: number;
  started: boolean;
  paused: boolean;
  gameOver: boolean;
  timer: number;
  cache: Record<string, unknown>;
  players: Record<string, Player>;
  things: Record<string, Thing>;
  weather: Record<string, unknown>;
  camera: Record<string, unknown>;
}

// ─── Game Interface ───────────────────────────────────────────────────────────

import type { Server as IOServer } from "socket.io";

export interface IGame {
  readonly name: string;
  readonly description: string;
  isPersistent: boolean;

  create(room: Room): void | Promise<void>;
  update(io: IOServer, game: Room, outState: unknown[]): void;

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

export interface Profile {
  id: string;
  name: string;
  credits: number;
  createdAt: Date;
  stats: Record<string, number>;
}
