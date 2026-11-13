// world_node.mjs - the Node half of worldcheck.py (lane F1, 2026-10-13). NO browser, NO server, NO file edited.
// Promoted from lane 5A's scratch probes census/lootdiff.mjs (what the shared RNG decided) and census/failpaths.mjs (a client whose prop GLBs
// or baked collider table fail to load must still build the same world), on the shared environment of world_env.mjs.
//
//   node world_node.mjs --mode fingerprint --root <game dir> [--maps isla_viva,ashgrid,deepwood] [--seeds 1,7,1234,31337,2026] --out fp.json
//       per (map, seed): the POIs, every loot point (wild loot = the LAST consumer of the shared RNG in buildMap), every prop anchor
//       (x, z, s, ry) per kind, and the collider count. worldcheck.py runs it on the working copy and on a frozen revision and compares.
//   node world_node.mjs --mode determinism --root <game dir> --out det.json
//       three (map, seed) builds: two builds in one process = identical colliders; every prop GLB failing to load = the IDENTICAL colliders
//       (a squad client must derive the same cover whether or not its GLB request failed); the baked table failing to fetch = the build
//       still completes (legacy colliders, warns once) and by how many colliders it then differs.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeEnv } from "./world_env.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith("--")) { const k = a.slice(2); const n = process.argv[i + 1]; if (n === undefined || n.startsWith("--")) args[k] = true; else { args[k] = n; i++; } }
}
const ROOT = path.resolve(args.root || path.join(HERE, ".."));
const MODE = args.mode || "fingerprint";
const MAPS = (args.maps || "isla_viva,ashgrid,deepwood").split(",").filter(Boolean);
const SEEDS = (args.seeds || "1,7,1234,31337,2026").split(",").filter(Boolean).map(Number);
const OUT = args.out || null;
const r3 = (v) => Math.round(v * 1000) / 1000;

const E = await makeEnv({ root: ROOT, vendor: args.vendor });
const quiet = async (fn) => { const w = console.warn; const warns = []; console.warn = (...a) => warns.push(a.map(String).join(" ")); try { return { v: await fn(), warns }; } finally { console.warn = w; } };
// a stable signature of the collider list (order, kinds, extents, owner kind / index, hp)
const sig = (M) => M.colliders.map((c) => [c.kind, r3(c.minX), r3(c.maxX), r3(c.minY), r3(c.maxY), r3(c.minZ), r3(c.maxZ), c.dir, c.prop, c.idx, c.hp].join(",")).join("|");

async function fingerprint() {
  const { buildMap } = await E.importMaps();
  const out = [];
  for (const mapId of MAPS) for (const seed of SEEDS) {
    const t0 = Date.now();
    globalThis.__LC_BOXES = null;
    const M = await buildMap(E.makeW(seed), mapId);
    const key = (l) => l.kind + ":" + r3(l.x) + "," + r3(l.z) + ":" + (l.poi || "-");
    const loot = M.lootPoints.map(key);
    const props = {};
    for (const kind of Object.keys(M.propInstances || {})) props[kind] = M.propInstances[kind].filter((it) => !it.dead).map((it) => [r3(it.x), r3(it.z), r3(it.s), r3(it.ry || 0)]);
    // the collider-derived anchors: a build from before M.propInstances existed (Wave 4) centres each prop's legacy collider on its seeded spot
    const ca = {};
    for (const c of M.colliders) if (c.prop && !c.dead) { const q = ((ca[c.prop] = ca[c.prop] || {})[c.idx] = ca[c.prop][c.idx] || { x0: 1e9, x1: -1e9, z0: 1e9, z1: -1e9 }); q.x0 = Math.min(q.x0, c.minX); q.x1 = Math.max(q.x1, c.maxX); q.z0 = Math.min(q.z0, c.minZ); q.z1 = Math.max(q.z1, c.maxZ); }
    const colAnchors = {};
    for (const kind of Object.keys(ca)) colAnchors[kind] = Object.keys(ca[kind]).map(Number).sort((a, b) => a - b).map((i) => [r3((ca[kind][i].x0 + ca[kind][i].x1) / 2), r3((ca[kind][i].z0 + ca[kind][i].z1) / 2)]);
    out.push({ map: mapId, seed, colAnchors, pois: M.pois.map((p) => p.id + ":" + r3(p.x) + "," + r3(p.z)), loot, wild: loot.filter((k) => k.endsWith(":-")), props, colliders: M.colliders.length, ms: Date.now() - t0 });
    try { if (typeof M.dispose === "function") M.dispose(); } catch (e) { /* ignore */ }
    process.stderr.write(`world_node fingerprint ${mapId} seed ${seed}: ${Date.now() - t0} ms, ${M.colliders.length} colliders\n`);
  }
  return { mode: "fingerprint", root: ROOT, builds: out };
}

async function determinism() {
  const rows = [];
  for (const [mapId, seed] of [["isla_viva", 7], ["ashgrid", 7], ["deepwood", 1234]]) {
    const row = { map: mapId, seed };
    const { buildMap } = await E.importMaps();
    E.fail.glb = null; E.fail.fetch = null;
    const a = (await quiet(() => buildMap(E.makeW(seed), mapId))).v;
    const a2 = (await quiet(() => buildMap(E.makeW(seed), mapId))).v;
    row.colliders = a.colliders.length;
    row.twice = sig(a) === sig(a2);
    // every prop GLB fails to load (a squad client whose CDN request died): the colliders must still be the same
    E.fail.glb = /assets\/props\//;
    const rb = await quiet(() => buildMap(E.makeW(seed), mapId));
    E.fail.glb = null;
    row.glbFailColliders = rb.v.colliders.length;
    row.glbFailSame = sig(a) === sig(rb.v);
    row.glbFailWarns = rb.warns.filter((w) => /prop load failed/.test(w)).length;
    // the baked table fails to fetch: a fresh module instance (the table is cached per module), the build must still complete
    const { buildMap: build2 } = await E.importMaps(true);
    E.fail.fetch = /prop_colliders/;
    E.fetchLog.length = 0;
    let c = null, err = null, warns = [];
    try { const q = await quiet(() => build2(E.makeW(seed), mapId)); c = q.v; warns = q.warns; } catch (e) { err = String(e && e.stack || e).split("\n").slice(0, 3).join(" | "); }
    E.fail.fetch = null;
    row.table404Built = !err; row.table404Error = err;
    row.table404Colliders = c ? c.colliders.length : null;
    row.table404Attempts = E.fetchLog.filter((u) => /prop_colliders/.test(u)).length;
    row.table404Warns = warns.filter((w) => /prop collider table/.test(w)).map((w) => w.slice(0, 110));
    rows.push(row);
    process.stderr.write(`world_node determinism ${mapId} seed ${seed}: twice ${row.twice}, glb-fail same ${row.glbFailSame} (${row.glbFailColliders} vs ${row.colliders}), table-404 built ${row.table404Built} (${row.table404Colliders})\n`);
  }
  return { mode: "determinism", root: ROOT, rows };
}

const doc = MODE === "determinism" ? await determinism() : await fingerprint();
const text = JSON.stringify(doc);
if (OUT) { fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true }); fs.writeFileSync(OUT, text); process.stderr.write("world_node: wrote " + OUT + " (" + text.length + " bytes)\n"); }
else process.stdout.write(text);
process.exit(0);
