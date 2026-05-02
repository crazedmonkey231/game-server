import { readFile, readFileSync } from "node:fs";
import { promisify } from "node:util";
import path from "node:path";
import type { Player, Thing, ColorData } from "../types/index";

export function getRoomName(gameId: string, roomId: string): string {
  return `${gameId}:${roomId}`;
}
 
/** Guards against prototype-polluting keys such as __proto__, constructor, prototype */
export function isSafeKey(key: string): boolean {
  return key !== "__proto__" && key !== "constructor" && key !== "prototype";
}

/** Guards against prototype-polluting keys and enforces safe game ID format */
export function isSafeGameId(key: string): boolean {
  return (
    /^[a-z0-9][a-z0-9-]*$/.test(key) &&
    key !== "__proto__" &&
    key !== "constructor" &&
    key !== "prototype"
  );
}

export function isValidRoomId(roomId: string): boolean {
  return roomId === "sandbox" || roomId === "lobby" || roomId.startsWith("room");
}

export function isWeekend(): boolean {
  const day = new Date().getUTCDay();
  // Friday (5) through Sunday (0) — "long weekend" window for Double XP events.
  // Remove day === 5 if you only want Saturday–Sunday.
  return day === 5 || day === 6 || day === 0;
}

const readFileAsync = promisify(readFile);

export async function fetchJson<T = unknown>(
  folder: string,
  level: string,
  callback: (data: T) => void
): Promise<void> {
  const filePath = path.join(process.cwd(), folder, `${level}.json`);
  const json = JSON.parse(await readFileAsync(filePath, "utf8")) as T;
  callback(json);
}

export function fetchJsonSync<T = unknown>(
  folder: string,
  level: string,
  callback: (data: T) => void
): void {
  const filePath = path.join(process.cwd(), folder, `${level}.json`);
  const json = JSON.parse(readFileSync(filePath, "utf8")) as T;
  callback(json);
}

export function getThing(id: string, name: string, type: string): Thing {
  return {
    id,
    name: name || `Thing_${id}`,
    speed: 0,
    type,
    gameplayTags: [],
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { pitch: 0, yaw: 0, roll: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    userData: {},
  };
}

export function getPlayer(id: string, name: string, isAi = false): Player {
  const colorData: ColorData = {
    r: Math.floor(Math.random() * 100) / 100,
    g: Math.floor(Math.random() * 100) / 100,
    b: Math.floor(Math.random() * 100) / 100,
    a: 1,
  };
  return {
    ...getThing(id, name, "player"),
    isAi,
    color: colorData,
    health: 100,
    score: 0,
    credits: 0,
  };
}
