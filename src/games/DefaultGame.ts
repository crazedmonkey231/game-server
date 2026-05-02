import type { Server as IOServer } from "socket.io";
import type { Room, Thing } from "../types/index.js";
import { BaseGame } from "./BaseGame.js";

function roundToTwo(num: number): number {
  return Math.round(num * 100) / 100;
}

interface ThingWithVelocity extends Thing {
  velocity: { x: number; y: number; z: number };
}

export class DefaultGame extends BaseGame {
  readonly name = "DefaultGame";
  readonly description = "A default game with basic physics and movement.";
  isPersistent = false;

  create(_room: Room): void {
    // No special creation logic needed
  }

  update(_io: IOServer, game: Room, outState: unknown[]): void {
    for (const thingId in game.things) {
      const thing = game.things[thingId] as ThingWithVelocity;
      const position = thing.transform.position;
      let speed = thing.speed ?? 0;
      const velocity = thing.velocity ?? { x: 0, y: 0, z: 0 };
      const data = thing.data ?? {};
      const onGround = (data.onGround as boolean) ?? false;
      const bodyType = (data.bodyType as string) ?? "dynamic";
      const dirty = (data.dirty as boolean) ?? false;

      if (bodyType !== "dynamic") {
        continue;
      }

      if (onGround || position.y <= 0) {
        velocity.y = 0;
      } else {
        velocity.y -= 0.03;
        if (velocity.y < -2) velocity.y = -2;
        speed += 0.01;
        if (speed > 0.2) speed = 0.2;
      }

      if (position.y < 0) {
        position.y = 0;
        velocity.y = 0;
      }

      if ((velocity.x === 0 && velocity.y === 0 && velocity.z === 0) || dirty) {
        continue;
      }

      speed = roundToTwo(speed);
      velocity.x = roundToTwo(velocity.x);
      velocity.y = roundToTwo(velocity.y);
      velocity.z = roundToTwo(velocity.z);

      thing.velocity = velocity;
      thing.speed = speed;

      position.x += velocity.x * speed;
      position.y += velocity.y * speed;
      position.z += velocity.z * speed;

      position.x = roundToTwo(position.x);
      position.y = roundToTwo(position.y);
      position.z = roundToTwo(position.z);

      const outThing: Record<string, unknown> = {
        id: thingId,
        position: { ...position },
        velocity: { ...velocity },
        speed,
      };

      if (dirty) {
        outThing.data = { ...data, dirty: false };
      }

      outState.push(outThing);
    }
  }
}
