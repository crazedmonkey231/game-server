// leaderboard.js
// Leaderboard module for game backend

class LeaderBoard {
  // In-memory leaderboards
  // { [gameId]: [ { name, score, timestamp } ] }
  leaderboard = {};
  constructor(app) {
    /**
     * POST /api/leaderboard/:gameId/submit
     * body: { name: string, score: number }
     */
    app.post("/api/leaderboard/:gameId/submit", this.submit.bind(this));

    /**
     * GET /api/leaderboard/:gameId
     * optional query: ?limit=10
     */
    app.get("/api/leaderboard/:gameId", this.getLeaderboardForGame.bind(this));
  }

  // POST /api/leaderboard/:gameId/submit
  submit(req, res) {
    const { gameId } = req.params;
    const { name, score } = req.body;

    if (typeof name !== "string" || typeof score !== "number") {
      return res.status(400).json({ error: "Invalid name or score" });
    }

    const lb = this.getLeaderboard(gameId);
    lb.push({
      name: name.trim().slice(0, 20), // simple safety
      score,
      timestamp: Date.now(),
    });

    // Sort descending by score
    lb.sort((a, b) => b.score - a.score);

    // Keep only top N (e.g. 10)
    if (lb.length > 10) {
      lb.length = 10;
    }

    res.json({ success: true });
  }

  // GET /api/leaderboard/:gameId
  getLeaderboardForGame(req, res) {
    const { gameId } = req.params;
    const limit = parseInt(req.query.limit, 10) || 10;
    const lb = this.getLeaderboard(gameId);
    res.json(lb.slice(0, limit));
  }

  // Helper to get or create a leaderboard for a game
  getLeaderboard(gameId) {
    if (!this.leaderboard[gameId]) {
      this.leaderboard[gameId] = [];
    }
    return this.leaderboard[gameId];
  }
}

module.exports = LeaderBoard;
