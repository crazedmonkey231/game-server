import type { Application, Request, Response } from "express";
import type { Server as IOServer } from "socket.io";
import type { EventEntry, IGame } from "../types/index.js";

export class EventManager {
  private static events: Record<string, EventEntry[]> = {};
  private timerHandle: ReturnType<typeof setInterval>;

  constructor(app: Application, io: IOServer, _games: Record<string, IGame>) {
    if (!io) {
      throw new Error("EventManager requires Socket.IO instance");
    }

    app.post("/api/eventManager/triggerEvent", this.triggerEvent.bind(this, io));

    app.get("/api/eventManager/getEvents/:gameId", (req: Request, res: Response) => {
      const gameId = req.params.gameId as string;
      res.json({ events: this.getEventsForGame(gameId) });
    });

    // Per-connection event subscription
    io.on("connection", (socket) => {
      socket.on("getManagedEvents", () => {
        const { gameId } = socket.handshake.query as { gameId?: string };
        if (!gameId) return;
        socket.emit("managedEvents", { events: this.getEventsForGame(gameId) });
      });
    });

    this.timerHandle = setInterval(() => {
      if (this.isWeekend()) {
        for (const gameId of Object.keys(EventManager.events)) {
          if (EventManager.events[gameId].some((e) => e.type === "double-xp-weekend")) {
            continue;
          }
          this.makeEvent(io, gameId, "double-xp-weekend", 72 * 60 * 60 * 1000, {
            title: "Double XP Weekend",
            xpBonus: 2,
          });
        }
      } else {
        for (const gameId of Object.keys(EventManager.events)) {
          EventManager.events[gameId] = EventManager.events[gameId].filter((event) => {
            if (event.type === "double-xp-weekend") {
              io.emit("eventEnded", { gameId, type: event.type });
              return false;
            }
            return true;
          });
        }
      }

      if (Object.keys(EventManager.events).length === 0) return;
      const now = Date.now();
      for (const gameId in EventManager.events) {
        EventManager.events[gameId] = EventManager.events[gameId].filter((event) => {
          if (event.length > 0 && now - event.timestamp >= event.length) {
            io.emit("eventEnded", { gameId, type: event.type });
            return false;
          }
          return true;
        });
      }
    }, 60_000);
  }

  private triggerEvent(io: IOServer, req: Request, res: Response): void {
    const { gameId, type, length, data } = req.body as {
      gameId: unknown;
      type: unknown;
      length: unknown;
      data: unknown;
    };
    if (typeof gameId !== "string" || typeof type !== "string") {
      res.status(400).json({ error: "Invalid gameId or type" });
      return;
    }
    this.makeEvent(
      io,
      gameId,
      type,
      typeof length === "number" ? length : 0,
      (data as Record<string, unknown>) ?? {}
    );
    res.json({ success: true });
  }

  private isWeekend(): boolean {
    const day = new Date().getUTCDay();
    return day === 5 || day === 6 || day === 0;
  }

  makeEvent(
    io: IOServer,
    gameId: string,
    type: string,
    length: number,
    data: Record<string, unknown>
  ): void {
    if (!EventManager.events[gameId]) {
      EventManager.events[gameId] = [];
    }
    EventManager.events[gameId].push({
      type,
      data: data ?? {},
      timestamp: Date.now(),
      length: length ?? 0,
    });
    io.emit("eventStarted", { gameId, type, data });
  }

  getEventsForGame(gameId: string): EventEntry[] {
    return EventManager.events[gameId] ?? [];
  }

  destroy(): void {
    clearInterval(this.timerHandle);
  }
}
