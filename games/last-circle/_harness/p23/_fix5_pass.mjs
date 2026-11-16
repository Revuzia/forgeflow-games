import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const { makeEnv } = await import(pathToFileURL(path.join(HERE, "..", "world_env.mjs")).href);
const E = await makeEnv({ root: path.resolve(HERE, "..", "..") });
const { buildMap } = await E.importMaps();
const [maps, seeds] = process.argv.slice(2);
let homes = 0, passBath = 0, stairBed = 0, prog = 0, eg = [];
for (const map of maps.split(",")) for (const seed of seeds.split(",").map(Number)) {
  const M = await buildMap(E.makeW(seed), map);
  for (const H of M.houses) {
    if (!(H.use === "house" && H.theme !== "ruin")) continue;
    homes++;
    const ks = new Set(H.rooms.map((r) => r.kind)); if (!["living", "kitchen", "bedroom", "bath"].every((k) => ks.has(k))) prog++;
    for (const r of H.rooms) if (r.kind === "bath" && H.doors.filter((d) => d.kind === "interior" && (d.rooms || []).includes(r.id)).length >= 2) { passBath++; if (eg.length < 400) eg.push(map + " " + seed + " " + r.id + " " + r.area + " st" + H.storeys + " " + H.W + "x" + H.D + " rooms " + H.rooms.map((q) => q.kind[0] + q.area).join(",")); }
    for (const st of H.stairs || []) { const r = H.rooms.find((q) => q.id === st.exitRoom); if (r && r.kind === "bedroom") stairBed++; }
  }
}
console.log("homes", homes, "pass-through baths", passBath, "stairs landing in a bedroom", stairBed, "programme misses", prog);
console.log(eg.join(String.fromCharCode(10)));
process.exit(0);
