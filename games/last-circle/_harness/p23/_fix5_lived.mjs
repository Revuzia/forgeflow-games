// (fix5 scratch, not committed) lived rooms of homes under N substantive pieces, with what stands in them
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf("--" + k); return i >= 0 ? argv[i + 1] : d; };
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(path.join(HERE, "..", ".."));
const { makeEnv } = await import(pathToFileURL(path.join(HERE, "..", "world_env.mjs")).href);
const E = await makeEnv({ root: ROOT });
const { buildMap } = await E.importMaps();
const FILL = /clock|lamp|[pP]lant|trash|art|poster|rug|wallShelf|mirror|whiteboard|runner|coatRack|monitor|carton|box\/box|televisionModern|Microwave/;
const LIVED = new Set(["living", "bedroom", "kitchen", "dining"]);
for (const map of arg("maps", "ashgrid").split(",")) for (const seed of arg("seeds", "1,7,1234,2026").split(",").map(Number)) {
  const M = await buildMap(E.makeW(seed), map);
  for (const H of M.houses) {
    if (!(H.use === "house" && H.theme !== "ruin")) continue;
    for (const r of H.rooms) {
      if (!LIVED.has(r.kind)) continue;
      const ps = H.furniture.filter((p) => p.room === r.id && !p.deco && !FILL.test(p.type));
      if (ps.length < +arg("min", 6)) console.log(map, seed, H.id, r.id, r.kind, r.area, "sub", ps.length, ps.map((p) => p.cat).join(","), "| doors", H.doors.filter((d) => (d.rooms || []).includes(r.id)).length, "notes", (H.notes || []).join(";").slice(0, 200));
    }
  }
}
process.exit(0);
