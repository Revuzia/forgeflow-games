// probe_nan.mjs - is the GROUND finite?  Node probe (Wave 7, lane 7D; promoted from the stage-A check's nanscan.mjs). NO browser, NO server, NO file edited.
//
//   node _harness/probe_nan.mjs [--root <game dir>] [--vendor <three vendor dir>] [--maps ashgrid] [--seeds 1-200] [--step 11] [--out result.json]
//
// It imports the UNMODIFIED <root>/runtime/3d/royale/maps.js through the world gates' resolve hook (world_env.mjs), builds every (map, seed) and looks for a
// non-finite ground two ways: (1) the baked lattice M.ground.lattice (a Float32 height per node: one NaN node poisons every heightAt() in the four cells around it);
// (2) heightAt() itself, on an x,z grid every --step metres over the whole map. A bot or a player standing there gets y = NaN: the physics floor, loot, the nav
// grid (which refuses NaN ground) and the camera all break at that spot.
//
// The defect it was written for (CHECK_A, 2026-10-14): TerrainField.live did `h += (swh / sw - h) * mw` and sw (a sum of w^32) underflowed to 0 while mw > 0 -> 0/0 = NaN.
// The live build 60b854d0 reads it on 1 of its first 60 Savanna seeds (14) and on Isla Viva seed 17; the Wave-7 city's extra pads raised the Savanna rate to 7 of 200 seeds
// until the `&& sw > 0` guard. Output: one JSON object, { maps: { <map>: { seeds, bad: [{ seed, latticeNodes, heightAtSamples, first: { x, z, nearPoi } }] } } }.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { makeEnv } from "./world_env.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith("--")) { const k = a.slice(2); const n = process.argv[i + 1]; if (n === undefined || n.startsWith("--")) args[k] = true; else { args[k] = n; i++; } }
}
const ROOT = path.resolve(args.root || path.join(HERE, ".."));
const MAPS = (args.maps || "ashgrid").split(",").filter(Boolean);
const [S0, S1] = String(args.seeds || "1-200").split("-").map(Number);
const STEP = Number(args.step || 11);
const OUT = args.out || null;

const E = await makeEnv({ root: ROOT, vendor: args.vendor });
const { buildMap } = await E.importMaps();
const warn = console.warn, log = console.log;
console.warn = () => {}; console.log = () => {};          // the map builder is chatty

const res = { root: ROOT, seeds: [S0, S1 || S0], step: STEP, maps: {} };
for (const mapId of MAPS) {
  const rec = { seeds: 0, bad: [] };
  for (let s = S0; s <= (S1 || S0); s++) {
    let M;
    try { M = await buildMap(E.makeW(s), mapId); } catch (e) { rec.bad.push({ seed: s, error: String(e && e.message || e).slice(0, 200) }); continue; }
    rec.seeds++;
    const L = M.ground.lattice, N = M.ground.latN, P = M.ground.pitch;
    let nodes = 0, first = null;
    for (let i = 0; i < L.length; i++) if (!Number.isFinite(L[i])) {
      nodes++;
      if (!first) {
        const ix = i % N, iz = Math.floor(i / N), x = (ix - (N - 1) / 2) * P, z = (iz - (N - 1) / 2) * P;
        const poi = (M.pois || []).map((q) => [q.id, Math.hypot(q.x - x, q.z - z)]).sort((a, b) => a[1] - b[1])[0];
        first = { x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10, nearPoi: poi ? poi[0] + " " + Math.round(poi[1]) + " m" : null };
      }
    }
    let samples = 0;
    for (let x = -M.half; x <= M.half; x += STEP) for (let z = -M.half; z <= M.half; z += STEP) if (!Number.isFinite(M.heightAt(x, z))) samples++;
    if (nodes || samples) rec.bad.push({ seed: s, latticeNodes: nodes, heightAtSamples: samples, first });
    try { M.dispose && M.dispose(); } catch (e) { /* the Node stub has nothing to free */ }
  }
  res.maps[mapId] = rec;
}
console.warn = warn; console.log = log;
if (OUT) fs.writeFileSync(OUT, JSON.stringify(res));
else process.stdout.write(JSON.stringify(res) + "\n");
process.exit(0);
