import path from "path"; import { pathToFileURL } from "url";
const G = process.cwd(); const u = (p) => pathToFileURL(path.resolve(G, p)).href;
const COL = await import(u("core/level/colliders.js"));
const [map, x, z, r] = process.argv.slice(2);
const c = COL.buildCollidersFor(map, 1);
for (const b of c.boxes) { if (b.rayOnly) continue; if (b.max[0] < +x - +r || b.min[0] > +x + +r || b.max[2] < +z - +r || b.min[2] > +z + +r) continue; console.log(b.id, b.kind, b.min.map(v=>+v.toFixed(3)), b.max.map(v=>+v.toFixed(3)), b.obb ? "obb" : "", b.moveOnly ? "moveOnly" : ""); }
