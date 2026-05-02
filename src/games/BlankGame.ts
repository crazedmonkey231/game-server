import type { Server as IOServer } from "socket.io";
import type { Room, Thing } from "../types/index.js";
import { BaseGame } from "./BaseGame.js";


export class BlankGame extends BaseGame {
  readonly name = "BlankGame";
  readonly description = "A blank game with no special logic.";
  isPersistent = false;

  create(room: Room): void {
    // No special creation logic needed
  }

  update(io: IOServer, currentRoom: Room, updatedThings: Thing[]): void {
    // No special update logic needed
    // const currentThings = Object.values(currentRoom.things);
    // updatedThings.push(...currentThings);
  }
}
