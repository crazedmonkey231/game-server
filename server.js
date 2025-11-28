const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());              // allow cross-origin requests (e.g., from itch.io)
app.use(express.json());      // parse JSON bodies

// -- Modules --

// Leaderboard module
new (require("./leaderboard"))(app);

// Listen debug
app.listen(PORT, () => {
  console.log(`Game backend listening on http://localhost:${PORT}`);
});
