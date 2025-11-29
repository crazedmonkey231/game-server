const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

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

// -- Modules --

// Leaderboard module
new (require("./leaderboard"))(app);

// Game Manager module
new (require("./GameManager"))(io);

// Listen debug
server.listen(PORT, () => {
  console.log(`Game backend listening on http://localhost:${PORT}`);
});
