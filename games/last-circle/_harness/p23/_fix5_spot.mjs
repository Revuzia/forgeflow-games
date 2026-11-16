import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const { makeEnv } = await import(pathToFileURL(path.join(HERE, "..", "world_env.mjs")).href);
const E = await makeEnv({ root: path.resolve(HERE, "..", "..") });
const { buildMap } = await E.importMaps();
const [map, seed, x, z, r] = process.argv.slice(2); const X = +x, Z = +z, R = +(r || 4);
const M = await buildMap(E.makeW(+seed), map);
console.log("height", M.heightAt(X, Z).toFixed(2), "water", M.waterY);
const H = M.houseAt ? M.houseAt(X, Z) : null;
console.log("houseAt", H ? JSON.stringify({ id: H.id, use: H.use, theme: H.theme, y: H.y, W: H.W, D: H.D, storeys: H.storeys }) : null);
for (const h of M.houses) { const d = Math.hypot((h.x ?? h.cx ?? 0) - X, (h.z ?? h.cz ?? 0) - Z); if (d < 30) console.log("house near", h.id, h.use, h.theme, "c", h.x ?? h.cx, h.z ?? h.cz, "WxD", h.W, h.D, "st", h.storeys, "rot", h.rot ?? h.yaw); }
const cs = M.queryColliders(X, Z, R, []);
for (const c of cs) if (!c.dead) console.log(c.kind, c.prop || "", [c.minX, c.maxX, c.minY, c.maxY, c.minZ, c.maxZ].map((v) => v.toFixed(2)).join(" "));
