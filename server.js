const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());              // allow cross-origin requests (e.g., from itch.io)
app.use(express.json());      // parse JSON bodies

// In-memory leaderboards
// { [gameId]: [ { name, score, timestamp } ] }
const leaderboards = {};

// Helper to get or create a leaderboard for a game
function getLeaderboard(gameId) {
  if (!leaderboards[gameId]) {
    leaderboards[gameId] = [];
  }
  return leaderboards[gameId];
}

/**
 * POST /api/leaderboard/:gameId/submit
 * body: { name: string, score: number }
 */
app.post("/api/leaderboard/:gameId/submit", (req, res) => {
  const { gameId } = req.params;
  const { name, score } = req.body;

  if (typeof name !== "string" || typeof score !== "number") {
    return res.status(400).json({ error: "Invalid name or score" });
  }

  const lb = getLeaderboard(gameId);
  lb.push({
    name: name.trim().slice(0, 20), // simple safety
    score,
    timestamp: Date.now(),
  });

  // Sort descending by score
  lb.sort((a, b) => b.score - a.score);

  // Keep only top N (e.g. 50)
  if (lb.length > 50) {
    lb.length = 50;
  }

  res.json({ success: true });
});

/**
 * GET /api/leaderboard/:gameId
 * optional query: ?limit=10
 */
app.get("/api/leaderboard/:gameId", (req, res) => {
  const { gameId } = req.params;
  const limit = parseInt(req.query.limit, 10) || 10;
  const lb = getLeaderboard(gameId);

  res.json(lb.slice(0, limit));
});

app.listen(PORT, () => {
  console.log(`Game backend listening on http://localhost:${PORT}`);
});
