import type { Request, Response } from "express";
import type { GlobalStats, Profile } from "../types/index";
import { GameManager } from "./GameManager";
import { Socket } from "socket.io";

/** Global profiles map */
const profiles = new Map<string, Profile>();

/** Global stats */
const globalStats: GlobalStats = {
  globalCredits: 0,
  globalPlayTime: 0,
};

/** A connection wrapper for managing profile-related events */
class ProfileConnection {
  constructor(socket: Socket, profileManager: ProfileManager) {
    if (!profiles.has(socket.id)) {
      const tempUsername = `Guest_${socket.id.slice(0, 5)}`;
      profileManager.createProfile(socket.id, tempUsername);
      console.log(`Created guest profile for ${tempUsername} with socket id ${socket.id}`);
    }
    // Listen for disconnection to accumulate stats and clean up the profile
    socket.on("disconnect", () => {
      console.log(`Client disconnected: ${socket.id}, accumulating stats and credits.`);
      const profile = profiles.get(socket.id);
      if (profile) {
        globalStats.globalCredits += profile.credits ?? 0;
        globalStats.globalPlayTime +=
          (Date.now() - new Date(profile.createdAt).getTime()) / 1000;
      }
      profiles.delete(socket.id);
      profileManager.removeConnection(socket.id);
    });
    // Listen for requests to get or change credits, and update the profile accordingly
    socket.on("getCredits", () => {
      const profile = profiles.get(socket.id);
      socket.emit("credits", profile?.credits ?? 0);
    });
    // Listen for profile updates from the client and update the profile accordingly
    socket.on("changeCredits", (amount: number) => {
      const profile = profiles.get(socket.id);
      if (profile) {
        profile.credits = Math.max(0, (profile.credits ?? 0) + amount);
        profiles.set(socket.id, profile);
      }
    });
    // Listen for generic stat changes (e.g., gamesPlayed, totalKills) and update the profile accordingly
    socket.on("changeStats", (stats: Record<string, number>) => {
      const profile = profiles.get(socket.id);
      if (profile) {
        for (const key in stats) {
          if (typeof stats[key] === "number" && key in profile.stats) {
            profile.stats[key] = Math.max(0, ((profile.stats[key] ?? 0) as number) + stats[key]);
          }
        }
        profiles.set(socket.id, profile);
      }
    });
  }
}

/** Manages player profiles, including creation, retrieval, and updates */
export class ProfileManager {
  private connections: Map<string, ProfileConnection> = new Map();

  constructor(gameManager: GameManager) {
    const { app, io } = gameManager.getAppAndIO();
    
    // API endpoints for profile management
    app.get("/api/profile/search/:socketId", this.search.bind(this));
    app.get("/api/profile/all", this.all.bind(this));
    app.get("/api/profile/globalStats", this.getGlobalStats.bind(this));
    app.post("/api/profile/createAccount", this.createAccount.bind(this));
    app.post("/api/profile/login", this.login.bind(this));
    app.post("/api/profile/deleteAccount", this.deleteAccount.bind(this));

    // Handle Socket.IO connections for profile management
    io.on("connection", (socket) => {
      const connection = new ProfileConnection(socket, this);
      this.connections.set(socket.id, connection);
    });
  }

  createProfile(id: string, name: string): Profile {
    const profile: Profile = {
      id,
      name: name ?? "Anonymous",
      credits: 0,
      createdAt: new Date(),
      stats: {
        gamesPlayed: 0,
        gamesWon: 0,
        totalKills: 0,
        totalDeaths: 0,
      },
    };
    profiles.set(id, profile);
    return profile;
  }

  getProfile(id: string): Profile | null {
    return profiles.get(id) ?? null;
  }

  removeConnection(id: string): void {
    this.connections.delete(id);
  }

  private search(req: Request, res: Response): void {
    const profile = this.getProfile(req.params.socketId as string);
    if (profile) {
      res.json(profile);
    } else {
      res.status(404).json({ error: "Profile not found" });
    }
  }

  private all(req: Request, res: Response): void {
    res.json(Array.from(profiles.values()));
  }

  private getGlobalStats(req: Request, res: Response): void {
    res.json(globalStats);
  }

  private createAccount(req: Request, res: Response): void {
    const { socketId, username } = req.body as { socketId?: string; username?: string };
    if (!socketId || !username) {
      res.status(400).json({ error: "Missing socketId or username" });
      return;
    }
    if (profiles.has(socketId)) {
      res.status(400).json({ error: "Profile already exists for this socketId" });
      return;
    }
    const profile = this.createProfile(socketId, username);
    res.json({ success: true, profile });
  }

  private login(req: Request, res: Response): void {
    const { socketId, username } = req.body as { socketId?: string; username?: string };
    if (!socketId || !username) {
      res.status(400).json({ success: false, message: "Missing socketId or username" });
      return;
    }
    const profile = this.getProfile(socketId);
    if (profile && profile.name === username) {
      res.json({ success: true, profile });
    } else {
      res.status(401).json({ success: false, message: "Invalid credentials" });
    }
  }

  private deleteAccount(req: Request, res: Response): void {
    const { socketId } = req.body as { socketId?: string };
    if (!socketId) {
      res.status(400).json({ error: "Missing socketId" });
      return;
    }
    if (profiles.has(socketId)) {
      profiles.delete(socketId);
      res.json({ success: true });
    } else {
      res.status(404).json({ error: "Profile not found" });
    }
  }
}
