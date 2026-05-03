import type { Server as IOServer, Socket } from "socket.io";
import { EventEntry } from "../types";

/** An automatically managed event that can be triggered based on certain conditions */
export class AutoEvent {
  type: string
  data: Record<string, unknown>
  length: number
  triggerCondition: () => boolean

  constructor(type: string, title: string, data: Record<string, unknown>, length: number, triggerCondition: () => boolean) {
    this.type = type;
    this.data = { ...data, title };
    this.length = length;
    this.triggerCondition = triggerCondition;
  }

  isActive(): boolean {
    return this.runningTime() < this.length;
  }

  toEventEntry(): EventEntry {
    return {
      type: this.type,
      data: this.data,
      timestamp: Date.now(),
      length: this.length,
    };
  }

  start(io: IOServer, gameId: string): void {
    io.emit("eventStarted", { gameId, type: this.type, data: this.data });
  }

  tick(io: IOServer, gameId: string): void {
    if (!this.isActive()) {
      this.end(io, gameId);
    } else {
      io.emit("eventUpdated", { gameId, type: this.type, data: this.data, remainingTime: this.remainingTime() });
    }
  }

  end(io: IOServer, gameId: string): void {
    io.emit("eventEnded", { gameId, type: this.type });
  }

  runningTime(): number {
    return Date.now() - this.toEventEntry().timestamp;
  }

  remainingTime(): number {
    return this.length - this.runningTime();
  }

  updateData(newData: Record<string, unknown>): void {
    this.data = { ...this.data, ...newData };
  }
}