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

module.exports = {
  fetchJson,
  fetchJsonSync,
  getThing,
};
