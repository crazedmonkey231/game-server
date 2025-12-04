// ProfileManager.js
class ProfileManager {
  static profiles = {};
  static globalCredits = 0;
  static globalPlayTime = 0;
  constructor(app, io, games) {
    // Example endpoint to get a profile by ID
    app.get("/api/profile/search/:socketId", (req, res) => {
      const id = req.params.socketId;
      const profile = this.getProfile(id);
      if (profile) {
        res.json(profile);
      } else {
        res.status(404).json({ error: "Profile not found" });
      }
    });

    app.get("/api/profile/all", (req, res) => {
      res.json(ProfileManager.profiles);
    });

    app.get("/api/profile/globalStats", (req, res) => {
      res.json({
        globalCredits: ProfileManager.globalCredits,
        globalPlayTime: ProfileManager.globalPlayTime,
      });
    });

    // Example endpoint to create a profile
    app.post("/api/profile/createAccount", (req, res) => {
      const { socketId, username } = req.body;
      if (!socketId || !username) {
        return res.status(400).json({ error: "Missing socketId or username" });
      }
      if (ProfileManagerprofiles[socketId]) {
        return res
          .status(400)
          .json({ error: "Profile already exists for this socketId" });
      }
      ProfileManager.profiles[socketId] = this.createProfile(
        socketId,
        username
      );
      res.json({ success: true, profile: ProfileManager.profiles[socketId] });
    });

    // Example endpoint to login to a profile
    app.post("/api/profile/login", (req, res) => {
      const { socketId, username } = req.body;
      if (!socketId || !username) {
        return res
          .status(400)
          .json({ success: false, message: "Missing socketId or username" });
      }
      const profile = this.getProfile(socketId);
      if (profile && profile.name === username) {
        return res.json({ success: true, profile });
      } else {
        return res
          .status(401)
          .json({ success: false, message: "Invalid credentials" });
      }
    });

    io.on("connection", (socket) => {
      if (!ProfileManager.profiles[socket.id]) {
        const tempUsername = `Guest_${socket.id.slice(0, 5)}`;
        this.createProfile(socket.id, tempUsername);
        console.log(
          `Created guest profile for ${tempUsername} with socket id ${socket.id}`
        );
      }
      socket.on("disconnect", () => {
        console.log(
          `Client disconnected: ${socket.id}, accumulating stats and credits.`
        );
        const profile = this.getProfile(socket.id);
        if (profile) {
          ProfileManager.globalCredits += profile.credits || 0;
          ProfileManager.globalPlayTime +=
            (Date.now() - new Date(profile.createdAt).getTime()) / 1000; // in seconds
        }
        delete ProfileManager.profiles[socket.id];
      });
    });

    // Socket.io event to create a profile
    io.on("createProfile", (id, name) => {
      this.createProfile(id, name);
    });

    // Socket.io event to get a profile
    io.on("getProfile", (id, callback) => {
      const profile = this.getProfile(id);
      callback(profile);
    });

    // Socket.io event to set/update a profile
    io.on("setProfile", (id, profileData) => {
      this.setProfile(id, profileData);
    });

    // Update stats
    io.on("updateStats", (id, stats) => {
      const profile = this.getProfile(id);
      if (profile) {
        profile.stats = { ...profile.stats, ...stats };
        this.setProfile(id, profile);
      }
    });

    // Increment stat
    io.on("incrementStat", (id, statKey, amount) => {
      const profile = this.getProfile(id);
      if (profile) {
        profile.stats = profile.stats || {};
        profile.stats[statKey] = (profile.stats[statKey] || 0) + amount;
        this.setProfile(id, profile);
      }
    });

    // Decrement stat
    io.on("decrementStat", (id, statKey, amount) => {
      const profile = this.getProfile(id);
      if (profile) {
        profile.stats = profile.stats || {};
        profile.stats[statKey] = (profile.stats[statKey] || 0) - amount;
        this.setProfile(id, profile);
      }
    });

    // Set credits
    io.on("setCredits", (id, amount) => {
      const profile = this.getProfile(id);
      if (profile) {
        profile.credits = amount;
        this.setProfile(id, profile);
      }
    });

    // Get credits
    io.on("getCredits", (id, callback) => {
      const profile = this.getProfile(id);
      if (profile) {
        callback(profile.credits || 0);
      }
    });

    // Add credits
    io.on("addCredits", (id, amount) => {
      const profile = this.getProfile(id);
      if (profile) {
        profile.credits = (profile.credits || 0) + amount;
        this.setProfile(id, profile);
      }
    });

    // Subtract credits
    io.on("subtractCredits", (id, amount) => {
      const profile = this.getProfile(id);
      if (profile) {
        profile.credits = (profile.credits || 0) - amount;
        this.setProfile(id, profile);
      }
    });
  }

  setProfile(id, profile) {
    const currentProfile = ProfileManager.profiles[id] || {};
    ProfileManager.profiles[id] = { ...currentProfile, ...profile };
  }

  getProfile(id) {
    return ProfileManager.profiles[id] || null;
  }

  createProfile(id, name) {
    ProfileManager.profiles[id] = {
      id: id,
      name: name || "Anonymous",
      credits: 0,
      createdAt: new Date(),
      stats: {},
    };
  }
}

module.exports = ProfileManager;
