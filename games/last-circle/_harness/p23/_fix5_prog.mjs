import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
const [maps, seeds] = process.argv.slice(2);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const { makeEnv } = await import(pathToFileURL(path.join(HERE, "..", "world_env.mjs")).href);
const E = await makeEnv({ root: path.resolve(HERE, "..", "..") });
const { buildMap } = await E.importMaps();
for (const map of maps.split(",")) for (const seed of seeds.split(",").map(Number)) {
  const M = await buildMap(E.makeW(seed), map);
  for (const H of M.houses) {
    if (!(H.use === "house" && H.theme !== "ruin")) continue;
    const ks = new Set(H.rooms.map((r) => r.kind));
    if (!["living", "kitchen", "bedroom", "bath"].every((k) => ks.has(k))) { console.log(map, seed, H.id, H.W, H.D, H.storeys, [...ks].join("+")); for (const r of H.rooms) console.log("   ", r.id, r.kind, r.area, JSON.stringify(r.cells)); for (const d of H.doors) console.log("   ", d.id, d.kind, (d.rooms || []).join("|")); }
  }
}
process.exit(0);
