import type { Application, Request, Response } from "express";
import type { Server as IOServer, Socket } from "socket.io";
import { isSafeKey } from "../../utils";
import { serverState } from "../serverstate";

// ─── Event Management ─────────────────────────────────────────────────────

/** Make a new event for a game */
export function makeEvent(gameId: string, type: string, length: number, data: Record<string, unknown>): void {
  if (!serverState.events.has(gameId)) {
    serverState.events.set(gameId, []);
  }
  serverState.events.get(gameId)?.push({
    type,
    data: data ?? {},
    timestamp: Date.now(),
    length: length ?? 0,
  });
  serverState.connections.forEach((connection) => {
    if (connection.gameId === gameId) {
      connection.socket.emit("eventStarted", { gameId, type, data });
    }
  });
}

/** Trigger a new event for a game, with optional length and data */
export function triggerEvent(req: Request, res: Response): void {
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

  makeEvent(gameId, type, length, data);
  res.json({ success: true });
}

/** Get all active events for a game */
export function getEvents(req: Request, res: Response): void {
  const gameId = req.params.gameId as string;
  res.json({ events: serverState.events.get(gameId) });
}

/** Remove an event from a game */
export function removeEvent(req: Request, res: Response): void {
  const gameId = req.params.gameId as string;
  const type = req.params.type as string;
  if (!isSafeKey(gameId) || !isSafeKey(type)) {
    res.status(400).json({ error: "Invalid gameId or type" });
    return;
  }
  if (serverState.events.has(gameId)) {
    serverState.events.set(gameId, serverState.events.get(gameId)?.filter((e) => e.type !== type) ?? []);
  }
  serverState.connections.forEach((connection) => {
    if (connection.gameId === gameId) {
      connection.socket.emit("eventEnded", { gameId, type });
    }
  });
  res.json({ success: true });
}