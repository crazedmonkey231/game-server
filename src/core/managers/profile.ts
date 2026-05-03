import type { Application, Request, Response } from "express";
import type { Server as IOServer, Socket } from "socket.io";
import { Profile } from "../../types";
import { serverState } from "../serverstate";

// ─── Profile Management ─────────────────────────────────────────────────────

export function getGlobalStats(req: Request, res: Response): void {
  res.json(serverState.globalStats);
}

/** Create a new profile for a client */
export function createProfile(id: string, name?: string): Profile {
  const profile: Profile = {
    id,
    name: name ?? "Anonymous",
    createdAt: new Date(),
    stats: {
      credits: 0,
      gamesPlayed: 0,
      gamesWon: 0,
      totalKills: 0,
      totalDeaths: 0,
    },
  };
  serverState.profiles.set(id, profile);
  return profile;
}

/** Delete a profile from the server state and accumulate its stats into the global stats */
export function deleteProfile(id: string): void {
  const profile = serverState.profiles.get(id);
  if (profile) {
    serverState.globalStats.globalCredits += profile.stats.credits ?? 0;
    serverState.globalStats.globalPlayTime +=
      (Date.now() - new Date(profile.createdAt).getTime()) / 1000;
    serverState.profiles.delete(id);
  }
}

/** Search for a profile by socket ID */
export function searchProfile(req: Request, res: Response): void {
  const profile = serverState.profiles.get(req.params.socketId as string);
  if (profile) {
    res.json(profile);
  } else {
    res.status(404).json({ error: "Profile not found" });
  } 
}

/** Log in to an existing profile or create a new one if it doesn't exist */
export function login(req: Request, res: Response): void {
  const { socketId, username } = req.body as { socketId?: string; username?: string };
  if (!socketId || !username) {
    res.status(400).json({ error: "Missing socketId or username" });
    return;
  }
  if (serverState.profiles.has(socketId)) {
    res.status(400).json({ error: "Profile already exists for this socketId" });
    return;
  }
  const profile = createProfile(socketId, username);
  res.json({ success: true, profile });
}

/** Delete a profile from the server state */
export function deleteAccount(req: Request, res: Response): void {
  const { socketId } = req.body as { socketId?: string };
  if (!socketId) {
    res.status(400).json({ error: "Missing socketId" });
    return;
  }
  if (serverState.profiles.has(socketId)) {
    deleteProfile(socketId);
    res.json({ success: true });
  } else {
    res.status(404).json({ error: "Profile not found" });
  }
}

/** Create a new profile for a client */
export function createAccount(req: Request, res: Response): void {
  const { socketId, username } = req.body as { socketId?: string; username?: string };
  if (!socketId || !username) {
    res.status(400).json({ error: "Missing socketId or username" });
    return;
  }
  if (serverState.profiles.has(socketId)) {
    res.status(400).json({ error: "Profile already exists for this socketId" });
    return;
  }
  const profile = createProfile(socketId, username);
  res.json({ success: true, profile });
}