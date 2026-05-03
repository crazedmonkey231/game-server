import type { Application, Request, Response } from "express";
import type { Server as IOServer, Socket } from "socket.io";
import { getRoomName, isSafeKey } from "../../utils";
import { RoomController } from "../roomcontroller";
import { serverTickRate } from "../gameserver";
import { serverState } from "../serverstate";
import { ConnectionInfo } from "../connectioninfo";

// ─── Game Management ─────────────────────────────────────────────────────────

export function accumulatePlayTime(connectionInfo: ConnectionInfo): void {
  const game = serverState.games.get(connectionInfo.gameId);
  if (game) {
    game.addPlayTime(Date.now() - connectionInfo.connectedAt);
  }
}

export function removePlayerFromGame(connectionInfo: ConnectionInfo): void {
  const game = serverState.games.get(connectionInfo.gameId);
  if (game) {
    const { roomId, player } = connectionInfo;
    game.removePlayer(roomId, player.id);
  }
}

/** List all active games with stats */
export function listGames(req: Request, res: Response): void {
    const gameList = Array.from(serverState.games.values()).map((g) => ({
      gameId: g.gameId,
      gameType: g.gameType,
      name: g.instance.name,
      playerCount: g.getPlayerCount(),
      playTime: g.getPlayTime(),
    }));
    res.json({ games: gameList, availableTypes: Array.from(serverState.availableGames.keys()) });
}

/** Add a new game by type, with a unique ID provided in the request body */
export function addGame(req: Request, res: Response, io: IOServer): void {
  const { gameId, gameType } = req.body as { gameId: unknown; gameType: unknown };
  if (typeof gameId !== "string" || typeof gameType !== "string") {
    res.status(400).json({ error: "Invalid gameId or gameType" });
    return;
  }
  if (!isSafeKey(gameId) || !isSafeKey(gameType)) {
    res.status(400).json({ error: "Invalid gameId or gameType" });
    return;
  }
  if (serverState.games.has(gameId)) {
    res.status(400).json({ error: "Game with this ID already exists" });
    return;
  }
  const GameClass = serverState.availableGames.get(gameType);
  if (!GameClass) {
    res.status(400).json({ error: "Invalid gameType" });
    return;
  }
  const game = new RoomController(gameId, gameType, new GameClass(), io, serverTickRate);
  serverState.games.set(gameId, game);
  res.json({ success: true, gameId, gameType });
}

/** Remove a game by ID, destroying it and cleaning up all associated state */
export function removeGameById(req: Request, res: Response): void {
  const gameId = req.params.gameId as string;
  if (!isSafeKey(gameId)) {
    res.status(400).json({ error: "Invalid gameId" });
    return;
  }
  const game = serverState.games.get(gameId);
  if (!game) {
    res.status(404).json({ error: "Game not found" });
    return;
  }
  game.destroy();
  serverState.games.delete(gameId);
  res.json({ success: true });
}

/** Notify all players with a message */
export function playerNotify(req: Request, res: Response, io: IOServer): void {
  const { message } = req.body as { message: string };
  console.warn("Player Notify:", message);
  io.emit("playerNotify", { message });
  res.json({ success: true });
}

/** Get the number of players in a specific game and room */
export function playersInGame(req: Request, res: Response): void {
  const gameId = req.params.gameId as string;
  const roomId = req.params.roomId as string;
  const game = serverState.games.get(gameId);
  if (!game) {
    res.status(404).json({ error: "Game not found" });
    return;
  }
  res.json({ playerCount: game.getPlayerCountInRoom(roomId) });
}

/** Get the total number of players across all games and rooms */
export function playersInAllGames(_req: Request, res: Response): void {
  let totalPlayers = 0;
  for (const game of serverState.games.values()) {
    totalPlayers += game.getPlayerCount();
  }
  res.json({ playerCount: totalPlayers });
}

/** Get the number of players in each game, broken down by room */
export function playersInPerGames(_req: Request, res: Response): void {
  const counts: Record<string, number> = {};
  for (const [gameId, game] of serverState.games.entries()) {
    counts[gameId] = game.getPlayerCount();
  }
  res.json({ playerCounts: counts });
}

/** Get a summary of total players and active games across the server */
export function summary(_req: Request, res: Response): void {
  let totalPlayers = 0;
  let activeGames = 0;
  for (const [gameId, game] of serverState.games.entries()) {
    const playerCount = game.getPlayerCount();
    if (playerCount > 0) {
      activeGames += 1;
      totalPlayers += playerCount;
    }
  }
  res.json({ totalPlayers, activeGames });
}

/** Get the total play time for a specific game */
export function getPlayTime(req: Request, res: Response): void {
  const gameId = req.params.gameId as string;
  const game = serverState.games.get(gameId);
  if (!game) {
    res.status(404).json({ error: "Game not found" });
    return;
  }
  res.json({ playTime: game.getPlayTime() });
}

/** List all rooms in a game with their players and things */
export function listGameRooms(req: Request, res: Response): void {
  const gameId = req.params.gameId as string;
  if (!isSafeKey(gameId)) {
    res.status(400).json({ error: "Invalid gameId" });
    return;
  }
  const game = serverState.games.get(gameId);
  if (!game) {
    res.status(404).json({ error: "Game not found" });
    return;
  }
  const rooms = Object.entries(game.gameStates).map(([roomId, state]) => ({
    roomId,
    started: state.started,
    paused: state.paused,
    gameOver: state.gameOver,
    timer: state.timer,
    playerCount: Object.values(state.players).filter((p) => p.userData.isAi !== true).length,
    thingCount: Object.keys(state.things).length,
    players: Object.values(state.players).map((p) => ({
      id: p.id,
      name: p.name,
      score: p.score,
      health: p.health ?? 100,
      isAi: p.userData.isAi === true,
    })),
    things: Object.values(state.things).map((t) => ({
      id: t.id,
      name: t.name,
      type: t.type,
      health: t.health,
    })),
  }));
  res.json({ gameId, rooms });
}