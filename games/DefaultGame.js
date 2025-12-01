
function roundToTwo(num) {
  return Math.round(num * 100) / 100;
}

class DefaultGame {
  constructor() {
    this.name = "DefaultGame";
    this.description = "A default game with basic physics and movement.";
    this.isPersistent = false; // game state is not persistent
  }

  playerInput(player, input) {
    // Default game has no special input handling
    const speed = player.speed;
    const playerPos = player.transform.position;
    if (input.left) playerPos.x -= speed;
    if (input.right) playerPos.x += speed;
    if (input.forward) playerPos.z -= speed;
    if (input.backward) playerPos.z += speed;
    if (input.up) playerPos.y += speed;
    if (input.down) playerPos.y -= speed;
  }

  update(game, outState) {
    for (const thingId in game.things) {
      const thing = game.things[thingId];
      const position = thing.transform.position;
      let speed = thing.speed || 0;
      const velocity = thing.velocity || { x: 0, y: 0, z: 0 };
      const data = thing.data || {};
      const onGround = data?.onGround || false;
      const bodyType = data?.bodyType || "dynamic";

      if (bodyType !== "dynamic") {
        continue; // only update dynamic bodies
      }

      // Simple gravity effect
      if (onGround || position.y <= 0) {
        velocity.y = 0;
      } else {
        velocity.y -= 0.03; // gravity effect
        if (velocity.y < -2) {
          velocity.y = -2; // terminal velocity
        }
        speed += 0.01; // increase speed when falling
        if (speed > 0.2) {
          speed = 0.2; // max speed
        }
      }
      thing.velocity = velocity;

      // Prevent falling below ground
      if (position.y < 0) {
        position.y = 0;
        velocity.y = 0;
      }

      if (velocity.x === 0 && velocity.y === 0 && velocity.z === 0) {
        continue; // no movement
      }

      speed = roundToTwo(speed); // round speed to 2 decimal places
      velocity.x = roundToTwo(velocity.x);
      velocity.y = roundToTwo(velocity.y);
      velocity.z = roundToTwo(velocity.z);

      // Simple movement update
      position.x += velocity.x * speed;
      position.y += velocity.y * speed;
      position.z += velocity.z * speed;

      position.x = roundToTwo(position.x);
      position.y = roundToTwo(position.y);
      position.z = roundToTwo(position.z);

      outState.push({
        id: thingId,
        position: { ...position },
        velocity: { ...velocity },
        speed: speed,
      });
    }
  }
}

module.exports = DefaultGame;
