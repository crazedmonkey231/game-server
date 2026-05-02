import type { Request, Response } from "express";
import type { Server as IOServer, Socket } from "socket.io";
import type { EventEntry } from "../types/index";
import { isSafeKey, isWeekend } from "../utils/index";
import { GameManager } from "./GameManager";

/** In-memory storage for active events, keyed by game ID */
const events: Record<string, EventEntry[]> = {};

/** An automatically managed event that can be triggered based on certain conditions */
class AutoEvent {
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

/** Define auto-managed events that should be triggered based on certain conditions (e.g., time of day, day of week) */
const autoEvents: Record<string, AutoEvent> = {
  "double-xp-weekend": new AutoEvent("double-xp-weekend", "Double XP Weekend", { xpBonus: 2 }, 72 * 60 * 60 * 1000, isWeekend),
};

/** The EventManager class is responsible for managing in-game events, including time-based auto events and manually triggered events via API endpoints */
export class EventManager {
  private io: IOServer;
  private timerHandle: ReturnType<typeof setInterval>;
  private gameManager: GameManager;

  constructor(gameManager: GameManager) {
    this.gameManager = gameManager;
    const { app, io } = gameManager.getAppAndIO();
    this.io = io;
    for (const gameId in gameManager.getGames()) {
      events[gameId] = [];
    }

    // API endpoints for managing events
    app.post("/api/eventManager/triggerEvent", this.triggerEvent.bind(this));
    app.get("/api/eventManager/getEvents/:gameId", this.getEvents.bind(this));
    app.delete("/api/eventManager/removeEvent/:gameId/:type", this.removeEvent.bind(this));

    // Socket.IO listener for clients requesting current events for a game
    io.on("connection", (socket) => this.onConnection(socket));

    // Set up an interval to manage time-based events (e.g., expiring events, triggering weekend events)
    this.timerHandle = setInterval(this.managerInterval.bind(this), 60_000);

    // Run the interval immediately on startup
    this.managerInterval();
  }

  private onConnection(socket: Socket): void {
    // Listen for clients requesting the current active events for a specific game
    socket.on("getManagedEvents", () => {
      const { gameId } = socket.handshake.query as { gameId?: string };
      if (!gameId) return;
      socket.emit("managedEvents", { events: this.getEventsForGame(gameId) });
    });
  }

  private managerInterval(): void {
    // Sync games
    for (const gameId in this.gameManager.getGames()) {
      if (!events[gameId]) {
        events[gameId] = [];
      }
    }
    // Check auto-triggered events and trigger or expire them as needed
    for (const key in autoEvents) {
      const autoEvent = autoEvents[key];
      if (autoEvent.triggerCondition()) {
        for (const gameId in events) {
          if (!events[gameId]?.some((e) => e.type === autoEvent.type)) {
            autoEvent.start(this.io, gameId);
            if (!events[gameId]) {
              events[gameId] = [];
            }
            events[gameId].push(autoEvent.toEventEntry());
          } else {
            autoEvent.tick(this.io, gameId);
          }
        }
      } else {
        for (const gameId in events) {
          if (!isSafeKey(gameId)) continue;
          events[gameId] = events[gameId]?.filter((e) => {
            if (e.type === autoEvent.type) {
              autoEvent.end(this.io, gameId);
              return false;
            }
            return true;
          }) ?? [];
        }
      }
    }
    // Clean up expired events
    if (Object.keys(events).length === 0) return;
    const now = Date.now();
    for (const gameId in events) {
      if (!isSafeKey(gameId)) continue;
      events[gameId] = events[gameId].filter((event) => {
        if (event.length > 0 && now - event.timestamp >= event.length) {
          const autoEvent = autoEvents[event.type];
          if (autoEvent) {
            autoEvent.end(this.io, gameId);
          } else {
            this.io.emit("eventEnded", { gameId, type: event.type });
          }
          return false;
        }
        return true;
      });
    }
  }

  private triggerEvent(req: Request, res: Response): void {
    // Guard against non-object bodies (e.g. arrays or primitives)
    if (typeof req.body !== "object" || req.body === null || Array.isArray(req.body)) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }
    const body = req.body as Record<string, unknown>;
    const gameId = body.gameId;
    const type = body.type;
    const dataRaw = body.data;

    if (typeof gameId !== "string" || typeof type !== "string") {
      res.status(400).json({ error: "Invalid gameId or type" });
      return;
    }
    if (!isSafeKey(gameId) || !isSafeKey(type)) {
      res.status(400).json({ error: "Invalid gameId or type" });
      return;
    }

    const lengthRaw = body.length;
    const length = typeof lengthRaw === "number" && isFinite(lengthRaw) ? lengthRaw : 0;
    const data: Record<string, unknown> =
      typeof dataRaw === "object" && dataRaw !== null && !Array.isArray(dataRaw)
        ? (dataRaw as Record<string, unknown>)
        : {};

    this.makeEvent(gameId, type, length, data);
    res.json({ success: true });
  }

  private getEvents(req: Request, res: Response): void {
    const gameId = req.params.gameId as string;
    res.json({ events: this.getEventsForGame(gameId) });
  }

  private removeEvent(req: Request, res: Response): void {
    const gameId = req.params.gameId as string;
    const type = req.params.type as string;
    if (!isSafeKey(gameId) || !isSafeKey(type)) {
      res.status(400).json({ error: "Invalid gameId or type" });
      return;
    }
    const gameEvents = events[gameId];
    if (!gameEvents) {
      res.status(404).json({ error: "No events for that game" });
      return;
    }
    const idx = gameEvents.findIndex((e) => e.type === type);
    if (idx === -1) {
      res.status(404).json({ error: "Event not found" });
      return;
    }
    gameEvents.splice(idx, 1);
    this.io.emit("eventEnded", { gameId, type });
    res.json({ success: true });
  }

  makeEvent(
    gameId: string,
    type: string,
    length: number,
    data: Record<string, unknown>
  ): void {
    if (!events[gameId]) {
      events[gameId] = [];
    }
    events[gameId].push({
      type,
      data: data ?? {},
      timestamp: Date.now(),
      length: length ?? 0,
    });
    this.io.emit("eventStarted", { gameId, type, data });
  }

  getEventsForGame(gameId: string): EventEntry[] {
    return events[gameId] ?? [];
  }

  destroy(): void {
    clearInterval(this.timerHandle);
  }
}
