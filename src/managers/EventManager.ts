import type { Application, Request, Response } from "express";
import type { Server as IOServer } from "socket.io";
import type { EventEntry, IGame } from "../types/index.js";
import { GameManager } from "./GameManager.js";

/** Guards against prototype-polluting keys such as __proto__, constructor, prototype */
function isSafeKey(key: string): boolean {
  return key !== "__proto__" && key !== "constructor" && key !== "prototype";
}

const events: Record<string, EventEntry[]> = {};

export class EventManager {
  private timerHandle: ReturnType<typeof setInterval>;

  constructor(gameManager: GameManager) {
    const { app, io } = gameManager.getAppAndIO();
    for (const gameId in gameManager.getGames()) {
      events[gameId] = [];
    }

    app.post("/api/eventManager/triggerEvent", this.triggerEvent.bind(this, io));

    app.get("/api/eventManager/getEvents/:gameId", (req: Request, res: Response) => {
      const gameId = req.params.gameId as string;
      res.json({ events: this.getEventsForGame(gameId) });
    });

    /**
     * DELETE /api/eventManager/removeEvent/:gameId/:type
     * Removes the first active event matching gameId + type.
     */
    app.delete("/api/eventManager/removeEvent/:gameId/:type", (req: Request, res: Response) => {
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
      io.emit("eventEnded", { gameId, type });
      res.json({ success: true });
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
        for (const gameId of Object.keys(events)) {
          if (events[gameId].some((e) => e.type === "double-xp-weekend")) {
            continue;
          }
          this.makeEvent(io, gameId, "double-xp-weekend", 72 * 60 * 60 * 1000, {
            title: "Double XP Weekend",
            xpBonus: 2,
          });
        }
      } else {
        for (const gameId of Object.keys(events)) {
          events[gameId] = events[gameId].filter((event) => {
            if (event.type === "double-xp-weekend") {
              io.emit("eventEnded", { gameId, type: event.type });
              return false;
            }
            return true;
          });
        }
      }

      if (Object.keys(events).length === 0) return;
      const now = Date.now();
      for (const gameId in events) {
        events[gameId] = events[gameId].filter((event) => {
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

    this.makeEvent(io, gameId, type, length, data);
    res.json({ success: true });
  }

  private isWeekend(): boolean {
    const day = new Date().getUTCDay();
    // Friday (5) through Sunday (0) — "long weekend" window for Double XP events.
    // Remove day === 5 if you only want Saturday–Sunday.
    return day === 5 || day === 6 || day === 0;
  }

  makeEvent(
    io: IOServer,
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
    io.emit("eventStarted", { gameId, type, data });
  }

  getEventsForGame(gameId: string): EventEntry[] {
    return events[gameId] ?? [];
  }

  destroy(): void {
    clearInterval(this.timerHandle);
  }
}
