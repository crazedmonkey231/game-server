// Leaderboard.js
// Leaderboard module for game backend

class LeaderBoard {
  constructor(app, io, games) {
    // In-memory leaderboards
    // { [gameId]: [ { name, score, timestamp } ] }
    this.leaderboard = {};
    for (const gameId in games) {
      this.leaderboard[gameId] = [];
    }

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

    // Handle socket connections for leaderboard submissions
    io.on("submitLeaderboardEntry", (socket) => {
      const { gameId } = socket.handshake.query;
      if (!gameId) return;
      socket.on("submitLeaderboardEntry", (data) => {
        const { name, score } = data;
        const { entry, isInTop10 } = this.addLeaderboardEntry(gameId, name, score);
        socket.emit("leaderboardEntrySubmitted", { entry, isInTop10 });
      });
    });
  }

  // POST /api/leaderboard/:gameId/submit
  submit(req, res) {
    const { gameId } = req.params;
    if (!this.leaderboard[gameId]) {
      return res.status(400).json({ error: "Invalid gameId" });
    }
    const { name, score } = req.body;

    if (typeof name !== "string" || typeof score !== "number") {
      return res.status(400).json({ error: "Invalid name or score" });
    }

    const { entry, isInTop10 } = this.addLeaderboardEntry(gameId, name, score);
    res.json({ success: true, entry, isInTop10 });
  }

  addLeaderboardEntry(gameId, name, score) {
    const entry = { name, score, timestamp: Date.now() };
    let isInTop10 = false;
    const lb = this.getLeaderboard(gameId);
    lb.push(entry);
    lb.sort((a, b) => b.score - a.score);
    if (lb.indexOf(entry) < 10) {
      isInTop10 = true;
    }
    if (lb.length > 10) {
      lb.length = 10;
    }
    return entry, isInTop10;
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
