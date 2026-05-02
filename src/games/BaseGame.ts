import type { Server as IOServer } from "socket.io";
import type { IGame, Room, Player, Thing } from "../types/index";

/**
 * Abstract base class that all game implementations should extend.
 * Provides default no-op implementations for optional lifecycle methods.
 */
export abstract class BaseGame implements IGame {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract isPersistent: boolean;

  abstract create(room: Room): void | Promise<void>;
  abstract update(io: IOServer, currentRoom: Room, updatedPlayers: Player[], updatedThings: Thing[]): void;

  emit(io: IOServer, currentRoom: Room, message: string, data: unknown): void {
    io.to(currentRoom.roomName).emit(message, data);
  }

  addAiPlayers?(): Player[];
  aiPlayerMax?(): number;
}
