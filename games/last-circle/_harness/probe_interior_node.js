// probe_interior_node.js - the Node half of interiorcheck.py (Wave 8 stage A, lane H3). NO browser, NO server, NO file edited.
//
//   node _harness/probe_interior_node.js [--root <game dir>] [--source fixture|housegen] [--seeds 1,7,1234] [--plant furniture-in-door|window-solid|no-ceiling]
//                                        [--max-houses N] [--no-walk] [--out result.json]
//
// Builds houses as pure data + three meshes (the reference fixture, or runtime/3d/royale/housegen.js when it exists), stands them on a FLAT
// synthetic map (terrain y 0, drawn as a terrain-tagged plane so a missing floor shows the terrain), and judges them with probe_interior.js:
// the static rows (floor, ceiling, openings / kit-agree / doors / windows / walls, furniture in view, furniture clear of doors and stairs) on the
// drawn triangles and the colliders, then the REAL mover: player.js tick() -> stepActor (mover_env.mjs) walks street -> room -> street and
// street -> loot -> street along the planner's waypoints. Prints one JSON document (or writes --out).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { makeEnv } from "./world_env.mjs";
import { loadPlayer, makeGameW, makeMover } from "./mover_env.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith("--")) { const k = a.slice(2); const n = process.argv[i + 1]; if (n === undefined || n.startsWith("--")) args[k] = true; else { args[k] = n; i++; } }
}
const ROOT = path.resolve(args.root || path.join(HERE, ".."));
const SOURCE = args.source || "fixture";
const PLANT = args.plant || null;
const SEEDS = String(args.seeds || "1,7,1234").split(",").filter(Boolean).map(Number);
const MAXH = Number(args["max-houses"] || 1e9);
const WALK = !args["no-walk"];
const OUT = args.out || null;

const E = await makeEnv({ root: ROOT, vendor: args.vendor });
const THREE = E.THREE;
await import(pathToFileURL(path.join(HERE, "probe_interior.js")).href);
await import(pathToFileURL(path.join(HERE, "probe_interior_fixture.js")).href);
const I = globalThis.__LCINT__;
const Pmod = await loadPlayer(ROOT);
const warn = console.warn, log = console.log;
const quiet = () => { console.warn = () => {}; console.log = () => {}; };
const loud = () => { console.warn = warn; console.log = log; };

// tag of a drawn mesh: userData.lcPart up the parent chain (housegen / fixture), then names / materials (a real map)
function classify(o, m) {
  for (let q = o; q; q = q.parent) {
    const p = q.userData && q.userData.lcPart;
    if (p) return p === "furniture" ? I.T_FURN : p === "glass" ? I.T_GLASS : p === "terrain" ? I.T_TERRAIN : p === "soft" || p === "decal" ? I.T_SOFT : I.T_STRUCT;
    if (q.userData && q.userData.lcFurniture) return I.T_FURN;
  }
  if (m && m.transparent && (m.opacity == null || m.opacity < 0.6)) return I.T_GLASS;
  return I.T_STRUCT;
}

// a flat synthetic map the real player.js can run on
function flatMap(colliders, y0) {
  const cols = colliders;
  return {
    id: "interior-flat", half: 1000, waterY: -50, water: false, sky: null, portals: [], pois: [], fogSurface: null, colliders: cols, lootPoints: [],
    heightAt: () => y0,
    queryColliders(x, z, r, out) {
      const o = out || [];
      o.length = 0;
      for (const c of cols) if (!c.dead && c.maxX >= x - r && c.minX <= x + r && c.maxZ >= z - r && c.minZ <= z + r) o.push(c);
      return o;
    },
    losBlocked: () => false, randomGroundPos: () => ({ x: 0, y: y0, z: 0 }),
  };
}

function terrainPlane(bb, y0) {
  const g = new THREE.PlaneGeometry(bb.maxX - bb.minX + 20, bb.maxZ - bb.minZ + 20);
  g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial());
  m.position.set((bb.minX + bb.maxX) / 2, y0, (bb.minZ + bb.maxZ) / 2);
  m.userData.lcPart = "terrain"; m.updateMatrixWorld(true);
  return m;
}

// ---- house sources: each returns [{ group, colliders, record }] ----
async function housesFor(seed) {
  if (SOURCE === "fixture") return [globalThis.__LCINT_FIXTURE__(THREE, { x: 0, y: 0, z: 0, plant: PLANT })];
  if (SOURCE === "housegen") {
    const f = path.join(ROOT, "runtime", "3d", "royale", "housegen.js");
    if (!fs.existsSync(f)) return { error: "no runtime/3d/royale/housegen.js yet" };
    const mod = await import(pathToFileURL(f).href);
    const A = globalThis.__LCINT_HOUSEGEN_ADAPTER__;
    if (!A) return { error: "no housegen adapter installed (probe_interior_housegen.js)" };
    return A.build(mod, THREE, seed, { plant: PLANT, max: MAXH });
  }
  return { error: "unknown --source " + SOURCE };
}
if (SOURCE === "housegen" && fs.existsSync(path.join(HERE, "probe_interior_housegen.js"))) await import(pathToFileURL(path.join(HERE, "probe_interior_housegen.js")).href);

function normalize(rec) {
  return { id: rec.id, source: "records", bbox: rec.bbox, rooms: rec.rooms, furniture: rec.furniture || [], loot: rec.loot || [], doors: rec.doors || null };
}

const out = { source: SOURCE, plant: PLANT, seeds: [], walk: WALK, t0: Date.now() };
const seeds = SOURCE === "fixture" ? [0] : SEEDS;
for (const seed of seeds) {
  const S = { seed, houses: [] };
  out.seeds.push(S);
  let hs;
  try { hs = await housesFor(seed); } catch (e) { S.error = String(e && (e.stack || e)).slice(0, 1500); continue; }
  if (!Array.isArray(hs)) { S.error = hs.error; continue; }
  let n = 0;
  for (const h of hs.slice(0, MAXH)) {
    n++;
    const H = normalize(h.record);
    const y0 = h.record.y != null ? h.record.y : H.bbox.minY;
    // the plant on data from housegen is applied by the adapter (it knows the parts); the fixture builds the planted house itself
    const M = flatMap(h.colliders, y0);
    const plane = terrainPlane(H.bbox, y0);
    const tris = I.makeTris([h.group, plane], H.bbox, classify);
    const world = {
      heightAt: M.heightAt, waterY: M.waterY, tris,
      query: (x, z, r) => M.queryColliders(x, z, r, []),
      segment: (ax, ay, az, bx, by, bz, cols) => E.SIM.segmentColliders(ax, ay, az, bx, by, bz, cols),
      rampBlocks: (c, x, z, y, h, r, su) => E.SIM.rampBlocks(c, x, z, y, h, r, su),
    };
    const t0 = Date.now();
    const st = I.judgeStatic(world, H);
    let reach = null;
    if (WALK) {
      quiet();
      try {
        const GW = await makeGameW(E, Pmod, M, seed || 1);
        const mv = makeMover(GW, THREE);
        const mover = { a: mv.a, place: mv.place, step: (dt) => { Pmod.tick(GW, dt); GW.t += dt; } };
        reach = I.judgeReach(world, H, st, mover);
      } catch (e) { reach = { error: String(e && (e.stack || e)).slice(0, 1500) }; }
      loud();
    }
    delete st._ops;
    // cost: draw calls (meshes x material groups) and triangles of the house object
    let calls = 0, trisN = 0;
    h.group.traverse((o) => { if ((o.isMesh || o.isInstancedMesh) && o.visible !== false) { const g = o.geometry; const nm = Array.isArray(o.material) ? (g.groups.length || 1) : 1; calls += nm; const t = (g.index ? g.index.count : g.attributes.position.count) / 3; trisN += t * (o.isInstancedMesh ? o.count : 1); } });
    S.houses.push(Object.assign(st, { reach, cost: { calls, tris: Math.round(trisN), storeys: st.floors }, ms: Date.now() - t0, meta: h.meta || null }));
  }
}
out.ms = Date.now() - out.t0;
const txt = JSON.stringify(out, null, 1);
if (OUT) fs.writeFileSync(OUT, txt); else process.stdout.write(txt + "\n");
process.exit(0);
