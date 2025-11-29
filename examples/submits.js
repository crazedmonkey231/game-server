// examples/submitScore.js
// Example of how to submit a score to the backend leaderboard API

const BACKEND_URL = "https://game-server-ancmexh6bdbkd5ad.eastus-01.azurewebsites.net"; // change later
const GAME_ID = "cloud-jumper" // or whatever name for each game

// Submit a score to the leaderboard
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

// Example of how to notify players via the game manager API
async function submitNotify(message) {
  try {
    const res = await fetch(`${BACKEND_URL}/api/gameManager/playerNotify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message }),
    });
    const data = await res.json();
    console.log("submitNotify response:", data);
  } catch (err) {
    console.error("submitNotify error:", err);
  }
}

// Example of how to trigger an event via the event manager API
async function submitEvent(gameId, type, length, data) {
  try {
    const res = await fetch(`${BACKEND_URL}/api/eventManager/triggerEvent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ gameId, type, length, data }),
    });
    const resData = await res.json();
    console.log("submitEvent response:", resData);
  } catch (err) {
    console.error("submitEvent error:", err);
  }
}

// Example usage
// submitScore("PlayerOne", 1500);
// submitNotify("Double XP weekend is live!");
// submitEvent("cloud-jumper", "double-xp", 86400000, { multiplier: 2 }); // 1 day