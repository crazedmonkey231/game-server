import { readFile, readFileSync } from "node:fs";
import { promisify } from "node:util";
import path from "node:path";
import type { Player, Thing, ColorData } from "../types/index.js";

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
      rotation: { isEuler: true, _x: 0, _y: 0, _z: 0, _order: "XYZ" },
      scale: { x: 1, y: 1, z: 1 },
    },
    data: {},
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
    id,
    name: name || id,
    score: 0,
    speed: 0.3,
    type: "BasicCapsuleThing",
    gameplayTags: ["player"],
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { isEuler: true, _x: 0, _y: 0, _z: 0, _order: "XYZ" },
      scale: { x: 1, y: 1, z: 1 },
    },
    data: {
      isAi,
      health: 3,
      credits: 0,
      dice: 0,
      colorData,
    },
  };
}
