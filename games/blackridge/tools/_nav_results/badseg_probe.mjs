#!/usr/bin/env node
// tools/_nav_results/badseg_probe.mjs — classify nav_probe's badSeg (why a
// findPath leg is not capsule-walkable): which box blocks, its kind, whether
// the leg is an A* fallback hop, a padded pull or an unpadded end leg, and the
// failure kind (wall vs support step). Same pair sampling as nav_probe.
import path from "path";
import { pathToFileURL, fileURLToPath } from "url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAME_DIR = path.resolve(HERE, "../..");
const u = (p) => pathToFileURL(path.resolve(GAME_DIR, p)).href;
const argv = process.argv.slice(2);
const argOf = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const MAPS = argOf("--maps", "meridian_ward,lanternwalk,switchyard,saltmarket").split(",");
const PAIRS = parseInt(argOf("--pairs", "300"), 10);
const SIM = await import(u("core/sim/sim.js"));
const COL = await import(u("core/level/colliders.js"));
const NAV = await import(u(argOf("--nav", "core/ai/nav.js")));
const WD = await import(u("core/weapons/weapon_data.js"));
const RNG = await import(u("core/rng.js"));

function why(world, a, b) {
  const dist = Math.hypot(b[0] - a[0], b[2] - a[2]);
  const n = Math.max(1, Math.ceil(dist / 0.07));
  let y = a[1];
  for (let r = 0; r < 4; r++) { const s2 = world.supportAt(a[0], a[2], y, 0.35); if (s2 <= y + 1e-6) break; y = s2; }
  const startBox = world.capsuleBlocked(a[0], y, a[2], 0.33, 1.7);
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const x = a[0] + (b[0] - a[0]) * t, z = a[2] + (b[2] - a[2]) * t;
    const bx = world.capsuleBlocked(x, y, z, 0.33, 1.7);
    if (bx && !(bx === startBox && dist * t < 0.35)) return { k: "wall", box: bx, t, x, y, z };
    const sup = world.supportAt(x, z, y, 0.35);
    if (sup > y + 0.36) return { k: "sup", t, x, y, z, sup };
    y = Math.max(sup, y - 0.4);
    if (y < sup) y = sup;
  }
  return null;
}
for (const mapId of MAPS) {
  const colliders = COL.buildCollidersFor(mapId, 1);
  const nav = NAV.bakeNav(colliders, { cell: 0.75 });
  const sim = SIM.createSim({ colliders, nav, weapons: WD.WEAPONS, seed: 1 });
  const rng = RNG.mulberry32(1 * 7919 + mapId.length);
  const b = colliders.bounds;
  const center = [(b.min[0] + b.max[0]) / 2, 0, (b.min[2] + b.max[2]) / 2];
  const R = Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2]);
  const pairs = [];
  let guard = 0;
  while (pairs.length < PAIRS && guard++ < PAIRS * 40) {
    const s = nav.randomPoint(center, R, rng), g = nav.randomPoint(center, R, rng);
    if (Math.hypot(s[0] - g[0], s[2] - g[2]) < 8) continue;
    if (!nav.reachable(s, g)) continue;
    pairs.push([s, g]);
  }
  const G = nav._graph();
  const isNode = (p) => { const id = G.nodeAt(p, 0.05); return id >= 0 && Math.abs(G.nodeX[id] - p[0]) < 1e-9 && Math.abs(G.nodeZ[id] - p[2]) < 1e-9; };
  const cat = {}; const kinds = {}; const ex = [];
  let bad = 0;
  for (const [s, g] of pairs) {
    const p = nav.findPath(s, g);
    if (!p) continue;
    for (let i = 1; i < p.length; i++) {
      const w = why(sim.world, p[i - 1], p[i]);
      if (!w) continue;
      bad++;
      const len = Math.hypot(p[i][0] - p[i - 1][0], p[i][2] - p[i - 1][2]);
      const role = i === 1 ? "start" : (i === p.length - 1 ? "goal" : (isNode(p[i - 1]) && isNode(p[i]) && len < 1.2 ? "hop" : "pull"));
      const dy = Math.abs(p[i][1] - p[i - 1][1]);
      const key = `${role}/${w.k}/${dy > 0.05 ? "climb" : "flat"}`;
      cat[key] = (cat[key] || 0) + 1;
      const bk = w.box ? `${w.box.kind || "?"}${w.box.obb ? "(obb)" : ""} top-y=${(w.box.max[1] - w.y).toFixed(2)}` : `sup+${(w.sup - w.y).toFixed(2)}`;
      kinds[bk.replace(/top-y=[0-9.-]+/, (m) => "top-y~" + (Math.round(parseFloat(m.slice(6)) * 10) / 10))] = (kinds[bk.replace(/top-y=[0-9.-]+/, (m) => "top-y~" + (Math.round(parseFloat(m.slice(6)) * 10) / 10))] || 0) + 1;
      if (ex.length < 8) ex.push({ key, len: +len.toFixed(2), a: p[i - 1].map((v) => +v.toFixed(2)), b: p[i].map((v) => +v.toFixed(2)), at: [w.x, w.y, w.z].map((v) => +v.toFixed(2)), box: w.box ? { id: w.box.id, kind: w.box.kind, min: w.box.min, max: w.box.max, obb: !!w.box.obb } : null, sup: w.sup });
    }
  }
  console.log(`${mapId} bad=${bad}`);
  console.log("  by role/kind:", JSON.stringify(cat));
  console.log("  by box:", JSON.stringify(Object.entries(kinds).sort((a, c) => c[1] - a[1]).slice(0, 12)));
  if (argv.includes("--ex")) for (const e of ex) console.log("   ", JSON.stringify(e));
}
