import type { Application, Request, Response } from "express";
import type { Server as IOServer } from "socket.io";
import type { Profile, IGame } from "../types/index.js";

export class ProfileManager {
  private static profiles: Record<string, Profile> = {};
  private static globalCredits = 0;
  private static globalPlayTime = 0;

  constructor(app: Application, io: IOServer, _games: Record<string, IGame>) {
    app.get("/api/profile/search/:socketId", (req: Request, res: Response) => {
      const profile = this.getProfile(req.params.socketId as string);
      if (profile) {
        res.json(profile);
      } else {
        res.status(404).json({ error: "Profile not found" });
      }
    });

    app.get("/api/profile/all", (_req: Request, res: Response) => {
      res.json(ProfileManager.profiles);
    });

    app.get("/api/profile/globalStats", (_req: Request, res: Response) => {
      res.json({
        globalCredits: ProfileManager.globalCredits,
        globalPlayTime: ProfileManager.globalPlayTime,
      });
    });

    app.post("/api/profile/createAccount", (req: Request, res: Response) => {
      const { socketId, username } = req.body as { socketId?: string; username?: string };
      if (!socketId || !username) {
        res.status(400).json({ error: "Missing socketId or username" });
        return;
      }
      if (ProfileManager.profiles[socketId]) {
        res.status(400).json({ error: "Profile already exists for this socketId" });
        return;
      }
      const profile = this.createProfile(socketId, username);
      res.json({ success: true, profile });
    });

    app.post("/api/profile/login", (req: Request, res: Response) => {
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
    });

    io.on("connection", (socket) => {
      if (!ProfileManager.profiles[socket.id]) {
        const tempUsername = `Guest_${socket.id.slice(0, 5)}`;
        this.createProfile(socket.id, tempUsername);
        console.log(`Created guest profile for ${tempUsername} with socket id ${socket.id}`);
      }

      socket.on("disconnect", () => {
        console.log(`Client disconnected: ${socket.id}, accumulating stats and credits.`);
        const profile = this.getProfile(socket.id);
        if (profile) {
          ProfileManager.globalCredits += profile.credits ?? 0;
          ProfileManager.globalPlayTime +=
            (Date.now() - new Date(profile.createdAt).getTime()) / 1000;
        }
        delete ProfileManager.profiles[socket.id];
      });

      socket.on("createProfile", (id: string, name: string) => {
        this.createProfile(id, name);
      });

      socket.on("getProfile", (id: string, callback: (p: Profile | null) => void) => {
        callback(this.getProfile(id));
      });

      socket.on("setProfile", (id: string, profileData: Partial<Profile>) => {
        this.setProfile(id, profileData);
      });

      socket.on("updateStats", (id: string, stats: Record<string, number>) => {
        const profile = this.getProfile(id);
        if (profile) {
          profile.stats = { ...profile.stats, ...stats };
          this.setProfile(id, profile);
        }
      });

      socket.on("incrementStat", (id: string, statKey: string, amount: number) => {
        const profile = this.getProfile(id);
        if (profile) {
          profile.stats[statKey] = (profile.stats[statKey] ?? 0) + amount;
          this.setProfile(id, profile);
        }
      });

      socket.on("decrementStat", (id: string, statKey: string, amount: number) => {
        const profile = this.getProfile(id);
        if (profile) {
          profile.stats[statKey] = (profile.stats[statKey] ?? 0) - amount;
          this.setProfile(id, profile);
        }
      });

      socket.on("setCredits", (id: string, amount: number) => {
        const profile = this.getProfile(id);
        if (profile) {
          profile.credits = amount;
          this.setProfile(id, profile);
        }
      });

      socket.on("getCredits", (id: string, callback: (credits: number) => void) => {
        const profile = this.getProfile(id);
        if (profile) callback(profile.credits ?? 0);
      });

      socket.on("addCredits", (id: string, amount: number) => {
        const profile = this.getProfile(id);
        if (profile) {
          profile.credits = (profile.credits ?? 0) + amount;
          this.setProfile(id, profile);
        }
      });

      socket.on("subtractCredits", (id: string, amount: number) => {
        const profile = this.getProfile(id);
        if (profile) {
          profile.credits = (profile.credits ?? 0) - amount;
          this.setProfile(id, profile);
        }
      });
    });
  }

  setProfile(id: string, profile: Partial<Profile>): void {
    const current = ProfileManager.profiles[id] ?? ({} as Profile);
    ProfileManager.profiles[id] = { ...current, ...profile } as Profile;
  }

  getProfile(id: string): Profile | null {
    return ProfileManager.profiles[id] ?? null;
  }

  createProfile(id: string, name: string): Profile {
    const profile: Profile = {
      id,
      name: name ?? "Anonymous",
      credits: 0,
      createdAt: new Date(),
      stats: {},
    };
    ProfileManager.profiles[id] = profile;
    return profile;
  }
}
