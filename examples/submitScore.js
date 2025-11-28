// examples/submitScore.js
// Example of how to submit a score to the backend leaderboard API

const BACKEND_URL = "https://mygame-backend.azurewebsites.net"; // change later
const GAME_ID = "cloud-jumper" // or whatever name for each game

async function submitScore(playerName, score) {
  try {
    const res = await fetch(`${BACKEND_URL}/api/leaderboard/${GAME_ID}/submit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: playerName, score }),
    });

    const data = await res.json();
    console.log("submitScore response:", data);
  } catch (err) {
    console.error("submitScore error:", err);
  }
}