import type { Server as IOServer } from "socket.io";
import type { Player, GameState, Thing, GameUpdatePayload } from "../types/index";
import { BaseGame } from "./BaseGame";


export class BlankGame extends BaseGame {
  readonly name = "BlankGame";
  readonly description = "A blank game with no special logic.";
  isPersistent = false;

  create(room: GameState): void {
    // No special creation logic needed
  }

  update(payload: GameUpdatePayload): void {
    // No special update logic needed
    // const currentThings = Object.values(payload.currentRoom.things);
    // payload.updatedThings.push(...currentThings);
  }
}
