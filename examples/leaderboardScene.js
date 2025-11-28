// examples/leaderboardScene.js
// Example of how to fetch and display the leaderboard in a Phaser scene

async function fetchLeaderboard(limit = 10) {
  const res = await fetch(
    `${BACKEND_URL}/api/leaderboard/${GAME_ID}?limit=${limit}`
  );
  return await res.json(); // [{ name, score, timestamp }, ...]
}

// Example in a Phaser Scene:
class LeaderboardScene extends Phaser.Scene {
  constructor() {
    super("LeaderboardScene");
  }

  async create() {
    const scores = await fetchLeaderboard(10);

    this.add.text(50, 40, "Top Scores", { fontSize: "24px", color: "#ffffff" });

    scores.forEach((entry, index) => {
      const line = `${index + 1}. ${entry.name} - ${entry.score}`;
      this.add.text(50, 80 + index * 24, line, {
        fontSize: "18px",
        color: "#ffffff",
      });
    });
  }
}