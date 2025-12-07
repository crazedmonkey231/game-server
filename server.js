const express = require("express");
const cors = require("cors");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

// Create Express app and HTTP server
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
  },
});
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());              // allow cross-origin requests (e.g., from itch.io)
app.use(express.json());      // parse JSON bodies

// -- Serve static files (client) from /public
app.use(express.static(path.join(__dirname, "./public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "./public/index.html"));
});
// -- Registered Games --

const GAMES = {
  "default-game": require("./games/Default"),
  "creation-game": require("./games/CreationGame"),
}

// -- Modules --

// Leaderboard module
new (require("./LeaderboardManager"))(app, io, GAMES);

// Game Manager module
new (require("./GameManager"))(app, io, GAMES);

// Event Manager module
new (require("./EventManager"))(app, io, GAMES);

// Profile Manager module
new (require("./ProfileManager"))(app, io, GAMES);

// Listen debug
server.listen(PORT, () => {
  console.log(`Game backend listening on http://localhost:${PORT}`);
});
