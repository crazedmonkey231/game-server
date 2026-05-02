import "dotenv/config";
import express from "express";
import cors from "cors";
import http from "http";
import path from "path";
import { Server as IOServer } from "socket.io";

import type { IGame } from "./types/index.js";
import { LeaderboardManager } from "./managers/LeaderboardManager.js";
import { GameManager } from "./managers/GameManager.js";
import { EventManager } from "./managers/EventManager.js";
import { ProfileManager } from "./managers/ProfileManager.js";
import { DefaultGame } from "./games/DefaultGame.js";
import { CreationGame } from "./games/CreationGame.js";

const app = express();
const server = http.createServer(app);
const io = new IOServer(server, { cors: { origin: "*" } });
const PORT = process.env.PORT ?? 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Serve dashboard from /public
// Note: static file serving intentionally has no rate limit; only public, read-only assets are served here.
// __dirname is the compiled output dir (dist/) at runtime; ../public resolves to project root's public/
app.use(express.static(path.join(__dirname, "../public")));
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

// Registered games
const GAMES: Record<string, new () => IGame> = {
  "default-game": DefaultGame,
  "creation-game": CreationGame,
};

// Modules
new LeaderboardManager(app, io, {} as Record<string, IGame>);
new GameManager(app, io, GAMES);
new EventManager(app, io, {} as Record<string, IGame>);
new ProfileManager(app, io, {} as Record<string, IGame>);

server.listen(PORT, () => {
  console.log(`Game backend listening on http://localhost:${PORT}`);
});
