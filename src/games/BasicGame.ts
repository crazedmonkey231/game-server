import type { Server as IOServer } from "socket.io";
import type { Player, GameState, Thing, GameUpdatePayload } from "../types/index";
import { BaseGame } from "./BaseGame";


export class BasicGame extends BaseGame {
  readonly name = "BasicGame";
  readonly description = "A basic game with simple movement.";
  isPersistent = false;

  create(room: GameState): void {
    // No special creation logic needed
  }

  update(payload: GameUpdatePayload): void {
    // const currentThings = Object.values(payload.currentRoom.things);
    // payload.updatedThings.push(...currentThings);

    // Update player positions based on their input
    for (const playerId in payload.currentRoom.players) {
      const player = payload.currentRoom.players[playerId];
      player.speed = player.speed || 10; // Default speed if not set
      const position = player.transform.position as { x: number; y: number };
      if (player.input) {
        const speed = player.speed || 10;
        if (player.input.keyboard["up"]) {
          position.y -= speed;
        }
        if (player.input.keyboard["down"]) {
          position.y += speed;
        }
        if (player.input.keyboard["left"]) {
          position.x -= speed;
        }
        if (player.input.keyboard["right"]) {
          position.x += speed;
        }
      }

      payload.updatedPlayers.push(player);
    }
  }
}
