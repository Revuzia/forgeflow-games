// lip_find.mjs - p23/fall.py bots-lip setup helper (Node): terrain lips on a BUILT map where the ground falls >= --drop m within 4 m
// horizontally, with a flat, collider-free plateau 8 m behind the lip and a dry foot. Deterministic (seeded world).
//   node lip_find.mjs --root <game dir> --map ashgrid --seed 77 --drop 9 --out res.json
import fs from "node:fs";
import path from "node:path";
import { makeEnv } from "../../world_env.mjs";

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith("--")) { const k = a.slice(2); const n = process.argv[i + 1]; if (n === undefined || n.startsWith("--")) args[k] = true; else { args[k] = n; i++; } }
}
const ROOT = path.resolve(args.root);
const E = await makeEnv({ root: ROOT });
const { buildMap } = await E.importMaps();
const quiet = async (fn) => { const w = console.warn, l = console.log; console.warn = () => {}; console.log = () => {}; try { return await fn(); } finally { console.warn = w; console.log = l; } };
const M = await quiet(() => buildMap(E.makeW(+args.seed || 77), args.map || "ashgrid"));
const DROP = +args.drop || 9, wy = M.waterY;
const free = (x, z, r, h) => { for (const c of M.queryColliders(x, z, r + 1, [])) { if (c.dead) continue; if (c.maxY > h + 0.3 && c.minX < x + r && c.maxX > x - r && c.minZ < z + r && c.maxZ > z - r) return false; } return true; };
const lips = [];
const span = (M.half || 800) * 0.85;
for (let x = -span; x <= span; x += 6) for (let z = -span; z <= span; z += 6) {
  const h0 = M.heightAt(x, z);
  if (!(h0 > wy + 2)) continue;
  for (let k = 0; k < 16; k++) {
    const a = k / 16 * Math.PI * 2, dx = Math.cos(a), dz = Math.sin(a);
    let fall = 0;
    for (let d = 1; d <= 4; d += 0.5) fall = Math.max(fall, h0 - M.heightAt(x + dx * d, z + dz * d));
    if (fall < DROP) continue;
    // plateau behind: within 0.6 m of h0 out to 8 m back; foot: dry
    let flat = true;
    for (let d = 1; d <= 8; d += 1) if (Math.abs(M.heightAt(x - dx * d, z - dz * d) - h0) > (+args.flat || 0.6)) { flat = false; break; }
    if (!flat) continue;
    const fx = x + dx * 6, fz = z + dz * 6, hf = M.heightAt(fx, fz);
    if (!(hf > wy + 0.5) || h0 - hf < DROP) continue;
    if (!free(x - dx * 4, z - dz * 4, 4.5, h0)) continue;
    lips.push({ x, z, dir: [+dx.toFixed(3), +dz.toFixed(3)], h0: +h0.toFixed(2), foot: +hf.toFixed(2), drop: +(h0 - hf).toFixed(2) });
    break;
  }
}
// spread: keep lips >= 40 m apart, biggest drop first
lips.sort((p, q) => q.drop - p.drop);
const pick = [];
for (const l of lips) if (pick.every((p) => Math.hypot(p.x - l.x, p.z - l.z) >= 40)) pick.push(l);
const res = { map: args.map, seed: +args.seed, drop: DROP, n: lips.length, lips: pick.slice(0, 12) };
if (args.out) fs.writeFileSync(args.out, JSON.stringify(res));
console.log(JSON.stringify({ map: res.map, n: res.n, top: res.lips.slice(0, 4) }));
