import type { Application, Request, Response } from "express";
import type { Server as IOServer } from "socket.io";
import { EventEntry, Service } from "../../types";
import { serverState } from "../serverstate";
import { isSafeKey } from "../../utils";
import { millisecondsToDays, isWeekend } from "../../utils/day";

const eventTickRate =  60_000; // 1 tick per minute for slow events

interface AutoEventConfig {
  type: string
  data: Record<string, unknown>
  length: number
  triggerCondition: () => boolean
}

/** The EventService class manages in-game events, allowing for manual triggering and automatic events based on conditions like time or player actions. */
export class EventService implements Service {
  name = "EventManager";
  private events: Map<string, EventEntry[]> = new Map<string, EventEntry[]>();
  private autoEvents: Record<string, AutoEventConfig> = {
    "double-xp-weekend": { type: "double-xp-weekend", data: { xpBonus: 2 }, length: millisecondsToDays(2), triggerCondition: isWeekend }
  };

  private eventsTimerHandle: ReturnType<typeof setInterval>;
  private io?: IOServer;

  constructor() {
    this.eventsTimerHandle = setInterval(this.eventUpdate.bind(this), eventTickRate);
  }

  registerRoutes(app: Application, io: IOServer): void {
    this.io = io;
    app.get("/api/eventManager/getEvents/:gameId", this.apiGetEvents.bind(this));
    app.post("/api/eventManager/triggerEvent", this.apiTriggerEvent.bind(this));
    app.delete("/api/eventManager/removeEvent/:gameId/:type", this.apiRemoveEvent.bind(this));
  }

  get(gameId: string): EventEntry[] {
    return this.events.get(gameId) ?? [];
  }

  set(gameId: string, events: EventEntry[]): void {
    this.events.set(gameId, events);
  }

  keys(): IterableIterator<string> {
    return this.events.keys();
  }

  clear(): void {
    clearInterval(this.eventsTimerHandle);
    this.events.clear();
    this.autoEvents = {};
  }

  triggerEvent(gameId: string, type: string, length: number, data: Record<string, unknown>): void {
    const entry: EventEntry = { type, data, length, timestamp: Date.now() };
    if (!this.events.has(gameId)) {
      this.events.set(gameId, []);
    }
    this.events.get(gameId)?.push(entry);
    serverState.game.notifyPlayers({ gameId, message: `Event triggered: ${type}`, data });
  }

  removeEvent(gameId: string, type: string): void {
    if (!this.events.has(gameId)) return;
    this.events.set(gameId, this.events.get(gameId)?.filter((e) => e.type !== type) ?? []);
    serverState.game.notifyPlayers({ gameId, message: `Event ended: ${type}`, data: {} });
  }

  addAutoEvent(autoEvent: AutoEventConfig): void {
    this.autoEvents[autoEvent.type] = autoEvent;
  }

  removeGame(gameId: string): void {
    this.events.delete(gameId);
  }

  private eventUpdate(): void {
    if (!this.io) return;
    // Check auto-triggered events and trigger or expire them as needed
    for (const key in this.autoEvents) {
      const autoEvent = this.autoEvents[key];
      if (autoEvent.triggerCondition()) {
        for (const gameId of this.keys()) {
          if (!this.get(gameId)?.some((e) => e.type === autoEvent.type)) {
            serverState.game.notifyPlayers({ gameId, message: `Event started: ${autoEvent.type}`, data: autoEvent.data });
            this.get(gameId)?.push({ type: autoEvent.type, data: autoEvent.data, length: autoEvent.length, timestamp: Date.now() });
          }
        }
      } else {
        for (const gameId of this.keys()) {
          if (!isSafeKey(gameId)) continue;
          this.set(gameId, this.get(gameId)?.filter((e) => {
            if (e.type === autoEvent.type) {
              serverState.game.notifyPlayers({ gameId, message: `Event ended: ${autoEvent.type}`, data: {} });
              return false;
            }
            return true;
          }) ?? []);
        }
      }
    }
    // Clean up expired events
    if (this.keys().next().done) return;
    const now = Date.now();
    for (const gameId of this.keys()) {
      if (!isSafeKey(gameId)) continue;
      this.set(gameId, this.get(gameId)?.filter((event) => {
        if (event.length > 0 && now - event.timestamp >= event.length) {
          const autoEvent = this.autoEvents[event.type];
          if (autoEvent) {
            serverState.game.notifyPlayers({ gameId, message: `Event ended: ${autoEvent.type}`, data: {} });
          }
          return false;
        }
        return true;
      }) ?? []);
    }
  }

  private apiGetEvents(req: Request, res: Response): void {
    const gameId = req.params.gameId as string;
    if (!isSafeKey(gameId)) {
      res.status(400).json({ error: "Invalid gameId" });
      return;
    }
    res.json({ events: this.get(gameId) });
  }

  private apiTriggerEvent(req: Request, res: Response): void {
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

    this.triggerEvent(gameId, type, length, data);
    res.json({ success: true });
  }

  private apiRemoveEvent(req: Request, res: Response): void {
    const gameId = req.params.gameId as string;
    const type = req.params.type as string;
    if (!isSafeKey(gameId) || !isSafeKey(type)) {
      res.status(400).json({ error: "Invalid gameId or type" });
      return;
    }
    this.removeEvent(gameId, type);
    res.json({ success: true });
  }
}