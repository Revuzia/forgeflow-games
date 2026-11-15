// probe_genversion.mjs - the SQUAD WORLD CONTRACT of a build, as hashes (Wave-7 completion round, lane D5; the Node half of genversion.py). NO browser, NO server, NO file edited.
//
//   node _harness/probe_genversion.mjs [--root <game dir>] [--vendor <three vendor dir>] [--maps isla_viva,ashgrid,deepwood] [--seeds 1,7,1234] --out fp.json
//
// Squad rooms ride on "every client rebuilds the same world from W.seed" (net.js guard: MAP_GEN_VERSION in the handshake). A change to what a peer must AGREE on that does not
// move MAP_GEN_VERSION puts two clients with the same version on different worlds, which the guard cannot see. This prints, per (map, seed), a hash of each thing that is part of that
// agreement, built with the UNMODIFIED <root>/runtime/3d/royale/maps.js and loot.js (the three resolve hook of world_env.mjs), plus the version the file exports:
//   col      every collider (kind, extents, owner prop kind / index, hp, flags - numbers, strings and booleans, in build order)
//   heights  the ground height on a 7.3 m grid over the whole island (the lattice the movers stand on)
//   pois     the named places (id, x, z)
//   props    the prop anchors (kind, x, z, scale, yaw)
//   points   the map's loot points (kind, x, y, z, poi)
//   items    what loot.js populate() spawned from them (the settled floor items and chests: id / kind / weapon / x / y / z)
// The meshes are NOT in it: a mesh a peer sees differently moves no body. The build's own `map.genVersion` is printed next to the file's export (a fallback build reports less).
import fs from "node:fs";
import crypto from "node:crypto";
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
const MAPS = (args.maps || "isla_viva,ashgrid,deepwood").split(",").filter(Boolean);
const SEEDS = (args.seeds || "1,7,1234").split(",").filter(Boolean).map(Number);
const OUT = args.out || null;
const H = (s) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 12);
const num = (v) => (typeof v === "number" ? (Number.isFinite(v) ? Math.round(v * 1e4) / 1e4 : String(v)) : v);

const mapsSrc = fs.readFileSync(path.join(ROOT, "runtime", "3d", "royale", "maps.js"), "utf8");
const m = mapsSrc.match(/export const MAP_GEN_VERSION = (\d+);/);
const exportVersion = m ? Number(m[1]) : 1;       // a build without the export counts as 1 (net.js)

const E = await makeEnv({ root: ROOT, vendor: args.vendor });
const { buildMap } = await E.importMaps();
const lootMod = await import(pathToFileURL(path.join(ROOT, "runtime", "3d", "royale", "loot.js")).href);
const w = console.warn;
console.warn = () => {};
const log = console.log;
console.log = () => {};
const builds = [];
for (const mapId of MAPS) {
  for (const seed of SEEDS) {
    globalThis.__LC_BOXES = null;
    const W = E.makeW(seed);
    const M = await buildMap(W, mapId);
    W.map = M;
    W.mapId = mapId;
    const col = H(JSON.stringify(M.colliders.map((c) => { const o = {}; for (const k of Object.keys(c).sort()) { const v = c[k]; if (typeof v === "number" || typeof v === "string" || typeof v === "boolean" || v === null) o[k] = num(v); } return o; })));
    const hs = [];
    for (let x = -M.half; x <= M.half; x += 7.3) for (let z = -M.half; z <= M.half; z += 7.3) hs.push(num(M.heightAt(x, z)));
    const heights = H(hs.join(","));
    const pois = H(JSON.stringify((M.pois || []).map((p) => [p.id, num(p.x), num(p.z)])));
    const props = H(JSON.stringify(M.propInstances || {}, (k, v) => (typeof v === "function" ? undefined : typeof v === "number" ? num(v) : v)));
    const points = H(JSON.stringify((M.lootPoints || []).map((l) => [l.kind, num(l.x), num(l.y), num(l.z), l.poi == null ? null : l.poi])));
    let items = "-", nItems = 0;
    try {
      if (!W.__lootInit) { lootMod.init(W); W.__lootInit = true; }
      lootMod.populate(W);
      const it = lootMod.debugItems();
      nItems = it.length;
      items = H(JSON.stringify(it.map((i) => [i.id, JSON.stringify(i.data || null, (k, v) => (typeof v === "function" ? undefined : typeof v === "number" ? num(v) : v)), num(i.pos.x), num(i.pos.y), num(i.pos.z)])));
    } catch (e) { items = "error: " + String(e && e.message || e).slice(0, 80); }
    builds.push({ map: mapId, seed, n: M.colliders.length, col, heights, pois, props, points, nPoints: (M.lootPoints || []).length, items, nItems, genVersion: M.genVersion == null ? null : M.genVersion });
    process.stderr.write("probe_genversion " + mapId + " " + seed + ": " + M.colliders.length + " colliders, " + nItems + " items\n");
    try { if (typeof M.dispose === "function") M.dispose(); } catch (e) { /* ignore */ }
  }
}
console.warn = w;
console.log = log;
const doc = { tool: "probe_genversion.mjs", root: ROOT, exportVersion, hasExport: !!m, maps: MAPS, seeds: SEEDS, builds };
if (OUT) { fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true }); fs.writeFileSync(OUT, JSON.stringify(doc)); process.stderr.write("probe_genversion: wrote " + OUT + "\n"); }
else process.stdout.write(JSON.stringify(doc));
process.exit(0);
