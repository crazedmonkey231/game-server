import "dotenv/config";
import express from "express";
import cors from "cors";
import http from "http";
import path from "path";
import { Server as IOServer } from "socket.io";
import { LeaderboardManager } from "./managers/LeaderboardManager";
import { GameManager } from "./managers/GameManager";
import { EventManager } from "./managers/EventManager";
import { ProfileManager } from "./managers/ProfileManager";

const app = express();
const server = http.createServer(app);
const io = new IOServer(server, { cors: { origin: "*" } });
const PORT = process.env.PORT ?? 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Serve dashboard from /public directory
app.use(express.static(path.join(__dirname, "../public")));
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

// Modules
const gameManager = new GameManager(app, io);
new LeaderboardManager(gameManager);
new EventManager(gameManager);
new ProfileManager(gameManager);

// Start the server
server.listen(PORT, () => {
  console.log(`Game backend listening on http://localhost:${PORT}`);
});
