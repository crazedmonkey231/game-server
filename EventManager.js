// EventManager.js
// EventManager module for game backend, handling in-game events like double XP weekends, special challenges, etc.

class EventManager {
  constructor(app, io, games) {
    if (!io) {
      throw new Error("EventManager requires Socket.IO instance");
    }

    // In-memory events
    // { [gameId]: [ { type, data, timestamp } ] }
    this.events = {};
    for (const gameId in games) {
      this.events[gameId] = [];
    }

    // Expose trigger event endpoint
    app.post("/api/eventManager/triggerEvent", this.triggerEvent.bind(this, io));

    // Expose get events endpoint
    app.get("/api/eventManager/getEvents/:gameId", (req, res) => {
      const { gameId } = req.params;
      const gameEvents = this.getEventsForGame(gameId);
      res.json({ events: gameEvents });
    });

    // Handle socket connections for event notifications
    io.on("getManagedEvents", (socket) => {
      const { gameId } = socket.handshake.query;
      if (!gameId) return;
      const gameEvents = this.getEventsForGame(gameId);
      socket.emit("managedEvents", { events: gameEvents });
    });

    this.timerHandle = setInterval(() => {
      if (this.isWeekend()) {
        // Double XP weekend event
        for (const gameId of Object.keys(this.events)) {
          if (this.events[gameId].some(event => event.type === "double-xp-weekend")) {
            continue; // already active
          }
          this.makeEvent(io, gameId, "double-xp-weekend", 72 * 60 * 60 * 1000, { title: "Double XP Weekend", xpBonus: 2 }); // 3 days, double xp weekends
        }
      } else {
        // Remove double XP weekend events if not weekend
        for (const gameId of Object.keys(this.events)) {
          this.events[gameId] = this.events[gameId].filter(event => {
            if (event.type === "double-xp-weekend") {
              io.emit("eventEnded", { gameId, type: event.type });
              return false; // remove
            }
            return true; // keep
          });
        }
      }
      if (Object.keys(this.events).length === 0) return;
      const now = Date.now();
      for (const gameId in this.events) {
        this.events[gameId] = this.events[gameId].filter(event => {
          if (event.length > 0 && now - event.timestamp >= event.length) {
            // Event expired
            io.emit("eventEnded", { gameId, type: event.type });
            return false; // remove from list
          }
          return true; // keep in list
        });
      }
    }, 60000); // check every minute
  }

  // POST /api/eventManager/triggerEvent
  triggerEvent(io, req, res) {
    const { gameId, type, length, data } = req.body;
    if (typeof gameId !== "string" || typeof type !== "string") {
      return res.status(400).json({ error: "Invalid gameId or type" });
    }
    this.makeEvent(io, gameId, type, length, data);
    res.json({ success: true });
  }

  isWeekend() {
    const now = new Date();
    const day = now.getUTCDay();
    return day === 5 || day === 6 || day === 0; // Friday, Saturday or Sunday
  }

  makeEvent(io, gameId, type, length, data) {
    if (!this.events[gameId]) {
      this.events[gameId] = [];
    }
    this.events[gameId].push({
      type,
      data: data || {},
      timestamp: Date.now(),
      length: length || 0,
    });

    // Notify all connected clients about the new event
    io.emit("eventStarted", { gameId, type, data });
  }

  getEventsForGame(gameId) {
    return this.events[gameId] || [];
  }
}

module.exports = EventManager;
