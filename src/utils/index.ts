import { readFile, readFileSync, writeFileSync } from "node:fs";
import { promisify } from "node:util";
import path from "node:path";
import type { Player, Thing, ColorData } from "../types/index";

// Utility functions for file operations, ID generation, and game-related helpers

/** Generates a unique room name based on game ID and room ID */
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

/** Validates room ID format */
export function isValidRoomId(roomId: string): boolean {
  return roomId === "sandbox" || roomId === "lobby" || roomId.startsWith("room");
}

/** Checks if the current day is part of the weekend (Friday to Sunday) */
export function isWeekend(): boolean {
  const day = new Date().getDay(); 
  return day === 5 || day === 6 || day === 0;
}

/** Generates a random alphanumeric ID of the specified length, appended with a timestamp for uniqueness */
export function makeId(length: number = 8): string {
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  const charactersLength = characters.length;
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return `${result}-${Date.now()}`;
}

// File operations using promises for async/await and synchronous versions for blocking calls

const readFileAsync = promisify(readFile);
const writeFileAsync = promisify(writeFileSync);

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

export async function saveJson<T = unknown>(
  folder: string,
  level: string,
  data: T
): Promise<void> {
  const filePath = path.join(process.cwd(), folder, `${level}.json`);
  await writeFileAsync(filePath, JSON.stringify(data, null, 2), "utf8");
}

export function saveJsonSync<T = unknown>(
  folder: string,
  level: string,
  data: T
): void {
  const filePath = path.join(process.cwd(), folder, `${level}.json`);
  writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

// Game-related utility functions to create players and things with default properties

/** Creates a new Thing with default properties based on the provided type */
export function getThing(id: string, name: string, type: string, tags?: string[]): Thing {
  return {
    id,
    name: name || `Thing_${id}`,
    speed: 0,
    rotationSpeed: 3,
    type,
    gameplayTags: tags || [],
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { pitch: 0, yaw: 0, roll: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    userData: {},
  };
}

/** Creates a new Player with default properties and a random color */
export function getPlayer(id: string, name: string, isAi = false, tags?: string[]): Player {
  const colorData: ColorData = {
    r: Math.floor(Math.random() * 100) / 100,
    g: Math.floor(Math.random() * 100) / 100,
    b: Math.floor(Math.random() * 100) / 100,
    a: 1,
  };
  return {
    ...getThing(id, name, "player", tags),
    isAi,
    color: colorData,
    health: 100,
    score: 0,
    credits: 0,
    speed: 10,
  };
}
