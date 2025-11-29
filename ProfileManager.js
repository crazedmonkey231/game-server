// ProfileManager.js
class ProfileManager {
  constructor(app, io, games) {
    this.profiles = {};

    // Example endpoint to get a profile by ID
    app.get("/profile/:id", (req, res) => {
      const id = req.params.id;
      const profile = this.getProfile(id);
      if (profile) {
        res.json(profile);
      } else {
        res.status(404).json({ error: "Profile not found" });
      }
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
    const currentProfile = this.profiles[id] || {};
    this.profiles[id] = { ...currentProfile, ...profile };
  }

  getProfile(id) {
    return this.profiles[id] || null;
  }

  createProfile(id, name) {
    this.profiles[id] = {
      id: id,
      name: name || "Anonymous",
      credits: 0,
      createdAt: new Date(),
      stats: {},
    };
  }
}