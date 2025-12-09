const readFile = require("node:fs").promises.readFile;
const path = require("node:path");

async function fetchJson(folder, level, callback) {
  const filePath = path.join(process.cwd(), folder, `${level}.json`);
  const json = JSON.parse(await readFile(filePath, "utf8"));
  // console.log(json);
  callback(json);
}

// non-async version for small files
function fetchJsonSync(folder, level, callback) {
  const filePath = path.join(process.cwd(), folder, `${level}.json`);
  const json = JSON.parse(require("node:fs").readFileSync(filePath, "utf8"));
  // console.log(json);
  callback(json);
}

function getThing(id, name, type) {
  return {
    id: id,
    name: name || `Thing_${id}`,
    speed: 0,
    type: type,
    gameplayTags: [],
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { isEuler: true, _x: 0, _y: 0, _z: 0, _order: "XYZ" },
      scale: { x: 1, y: 1, z: 1 },
    },
    data: {
    },
  };
}

function getPlayer(id, name, isAi=false) {
  colorData = {
    r: Math.floor(Math.random() * 100) / 100,
    g: Math.floor(Math.random() * 100) / 100,
    b: Math.floor(Math.random() * 100) / 100,
    a: 1,
  };
  return {
    id: id,
    name: name || `${id}`,
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
      isAi: isAi,
      health: 3,
      credits: 0,
      dice: 0,
      colorData: colorData,
    },
  };
}

module.exports = {
  fetchJson,
  fetchJsonSync,
  getThing,
  getPlayer,
};
