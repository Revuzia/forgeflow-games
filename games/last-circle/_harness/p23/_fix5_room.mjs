import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const { makeEnv } = await import(pathToFileURL(path.join(HERE, "..", "world_env.mjs")).href);
const E = await makeEnv({ root: path.resolve(HERE, "..", "..") });
const { buildMap } = await E.importMaps();
const [map, seed, hid, x, z] = process.argv.slice(2);
const M = await buildMap(E.makeW(+seed), map);
const H = M.houses.find((h) => h.id === hid);
console.log(Object.keys(H).join(","));
for (const r of H.rooms) { const inR = r.walk && r.walk.some((q) => +x >= q[0] && +x <= q[2] && +z >= q[1] && +z <= q[3]);
  console.log(r.id, r.kind, r.floor, "rect", JSON.stringify(r.rect || r.box || null), "walk", JSON.stringify((r.walk || []).map((q) => q.map((v) => +v.toFixed(2)))), inR ? "<== IN WALK" : ""); }
console.log("doors", JSON.stringify((H.doors || []).map((d) => [d.kind, d.x, d.z, d.rooms])));
