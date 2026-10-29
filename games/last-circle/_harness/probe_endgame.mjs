// probe_endgame.mjs - the O4 ENDGAME AREAS as numbers, measured on the BUILT map in Node (Wave 7b, lane B2; the Node half of endgamecheck.py).  NO browser, NO server, NO file edited.
//
//   node _harness/probe_endgame.mjs [--root <game dir>] [--vendor <three dir>] [--maps isla_viva,deepwood] [--seeds 1-40] [--walk-seeds 1,7,1234,31337,2026]
//                                   [--plant steep-stair|ring-collapse|grid-on-slope|bridge-gap|float-pier|deck-edge] [--out rec.json]
//
// Plan O4 (owner-approved): the final circles always end within ~117 m of the map centre - on Isla Viva that is the bare 41-47 % volcano slope, on Deepwood the river - so those two maps
// get a FITTING endgame area and the storm stays where it is: a ruined crater-rim village on the volcano and a mill-and-bridge compound across the river. Never a grid core on the volcano
// or across the river. Everything here reads the BUILT map (colliders, heightAt, pois, ground.padLog, the towngen layout when `M.city` exists) with the UNMODIFIED maps.js through the world
// gates' Node environment, so it works whatever generator a lane uses to put the village and the bridge there.
//
// ISLA VIVA - the crater-rim village. The volcano axis is (40, -60) (mkHeightFn: cone r 240, +85 m, crater dip r 42; the crest is the ring r = 42). The RING is the annulus 36..130 m from the axis
// (the Volcano Rim POI's own radius). Per seed, in rec.rim: the enterable buildings in the ring (the pinned detector of probe_city.js: a roof, walls, a doorway) by quadrant; the pads (ground.padLog)
// in the ring by quadrant; the static cover pieces (>= 1.2 m, no prop, no ramp) in the ring; every ramp whose middle lies inside the POI circle with its slope in degrees; the towngen layout of
// the volcano_rim POI (kind, theme, grid or not, ruin buildings, stairs) and, over EVERY layout of the map, the steepest block (atan(relief / 46) of the base ground under it) of every GRID layout.
// ISLA VIVA / DEEPWOOD - rec.water: every static collider that overlaps deep water (terrain more than swimDepth 1.1 m under the surface) and stands within a few metres of the surface: is it
// grounded (its underside touches the ground under it, or an earlier supported piece carries it)? `floating` lists the ones nothing carries.
// DEEPWOOD - the mill and its bridge, rec.mill: the structures over the river near the Riverside Mill POI, clustered by contact; a cluster whose axis crosses >= 8 m of deep water is a BRIDGE.
// For each bridge (walk seeds only) the REAL mover (mover_env.mjs: player.js tick) walks it from 6 m before its first slab to 6 m past its last, on FIVE lanes over the full deck width
// (centre, quarter lines, outer lanes 0.7 m inside each deck edge), walking AND sprinting, BOTH ways (20 walks); a walk succeeds when the feet arrive within 0.9 m of the far point without
// swimming or stalling. (Stage C, lane C3: three lanes within +-0.9 m of the centre line could not see an E-W deck whose outer halves end under / inside the banks.)
//
// --plant NAME (never edits a file; the BUILT map is mutated in memory before the measuring - the controls registered in gate.py):
//   steep-stair    the first rim ramp is made 62 degrees                         -> rim-stairs FAILS
//   ring-collapse  every collider in two opposite rim quadrants is removed        -> rim-village FAILS (a one-sided village)
//   grid-on-slope  a grid layout whose block stands on 31 degrees is added (or the first grid layout's block relief is set to 30 m) -> rim-grid-slope FAILS
//   bridge-gap     one deck slab in the middle of the first bridge is removed     -> bridge-walk FAILS (the walkers swim)
//   float-pier     the first near-water support (a pier / stilt) is lifted 1.2 m -> no-float-over-water FAILS
//   deck-edge      the +s side of the first bridge's deck is cut back to halfway between the old centre lanes (+-0.9 m) and the outer lane, along the whole deck -> bridge-walk FAILS
//                  (the walkers on the cut side's outer lanes step off into the river; the lanes within +-0.9 m of the centre line, all the probe walked until stage C, still cross)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeEnv } from "./world_env.mjs";
import { loadPlayer, makeGameW, makeMover, walkLine } from "./mover_env.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith("--")) { const k = a.slice(2); const n = process.argv[i + 1]; if (n === undefined || n.startsWith("--")) args[k] = true; else { args[k] = n; i++; } }
}
const ROOT = path.resolve(args.root || path.join(HERE, ".."));
const MAPS = String(args.maps || "isla_viva,deepwood").split(",").filter(Boolean);
const parseSeeds = (t) => { const out = []; for (const part of String(t).split(",").filter(Boolean)) { const m = part.match(/^(\d+)-(\d+)$/); if (m) for (let i = Number(m[1]); i <= Number(m[2]); i++) out.push(i); else out.push(Number(part)); } return out; };
const WALK_SEEDS = new Set(parseSeeds(args["walk-seeds"] || "1,7,9,15,27,57,1234,2026,31337"));      // 9, 15, 27, 57, 31337: E-W bridges on the stage-B tree
const SEEDS = [...new Set([...parseSeeds(args.seeds || "1-40"), ...WALK_SEEDS])].sort((a, b) => a - b);          // the walk seeds are always built (the bridge is walked on them)
const PLANT = args.plant || null;
const OUT = args.out || null;
const SWIM_DEPTH = 1.1;                       // sim PLAYERK.swimDepth
const AX = 40, AZ = -60;                      // the Isla Viva volcano axis (mkHeightFn)
const RING_IN = 36, RING_OUT = 130;           // the crater-rim ring: the crest is r = 42, the Volcano Rim POI is r = 130
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const mid = (c) => [(c.minX + c.maxX) / 2, (c.minZ + c.maxZ) / 2];
const live = (c) => !c.dead && !c.prop;
const isRamp = (c) => c.kind === "ramp";

const E = await makeEnv({ root: ROOT, vendor: args.vendor });
const { buildMap } = await E.importMaps();
const CITY = (0, eval)("(" + fs.readFileSync(path.join(HERE, "probe_city.js"), "utf8") + ")()");
const warn = console.warn, log = console.log;
let Pmod = null;
const needWalk = MAPS.includes("deepwood");
if (needWalk) Pmod = await loadPlayer(ROOT);
console.warn = () => {}; console.log = () => {};

// ───────────────────────── Isla Viva: the crater-rim village ─────────────────────────
function quadOf(x, z) { const a = Math.atan2(z - AZ, x - AX); return ((Math.floor((a + Math.PI) / (Math.PI / 2)) % 4) + 4) % 4; }
const rampDeg = (c) => { const run = c.dir < 2 ? c.maxX - c.minX : c.maxZ - c.minZ; return Math.atan2(c.maxY - c.minY, run) * 180 / Math.PI; };

function rimRecord(M, plant) {
  const cols = M.colliders;
  const d0 = (c) => { const [x, z] = mid(c); return Math.hypot(x - AX, z - AZ); };
  const ramps0 = cols.filter((c) => !c.dead && isRamp(c) && d0(c) <= RING_OUT);
  if (plant === "steep-stair" && ramps0.length) { const c = ramps0[0]; const run = c.dir < 2 ? c.maxX - c.minX : c.maxZ - c.minZ; c.maxY = c.minY + run * Math.tan(62 * Math.PI / 180); }
  if (plant === "ring-collapse") for (const c of cols) { const [x, z] = mid(c); const d = Math.hypot(x - AX, z - AZ); if (d >= RING_IN - 6 && d <= RING_OUT + 40 && (quadOf(x, z) === 0 || quadOf(x, z) === 2)) c.dead = true; }
  const det = CITY.detect(cols, M.heightAt, M.waterY);
  const ent = det.buildings.filter((b) => b.door);
  const ringRaw = ent.map((b) => ({ x: b.x, z: b.z, d: Math.hypot(b.x - AX, b.z - AZ), q: quadOf(b.x, b.z), floors: b.floors, area: b.area })).filter((b) => b.d >= RING_IN && b.d <= RING_OUT);
  // one house is often TWO detector buildings (its rooms sit > 1.5 m apart across a partition): merge the ones whose centres are within 8 m, so a village of 3 houses never reads as 6 buildings
  const ring = [];
  for (const b of ringRaw.slice().sort((p, q) => p.x - q.x || p.z - q.z)) {
    const site = ring.find((t) => Math.hypot(t.x - b.x, t.z - b.z) <= 8);
    if (site) { site.floors = Math.max(site.floors, b.floors); site.area += b.area; site.parts++; }
    else ring.push(Object.assign({ parts: 1 }, b));
  }
  const quadCount = [0, 0, 0, 0]; for (const b of ring) quadCount[b.q]++;
  const padLog = (M.ground && M.ground.padLog) || [];
  const pads = padLog.map((p) => ({ gen: p.gen, x: p.x, z: p.z, d: Math.hypot(p.x - AX, p.z - AZ), q: quadOf(p.x, p.z) })).filter((p) => p.d >= RING_IN && p.d <= RING_OUT);
  const padQuad = [0, 0, 0, 0]; for (const p of pads) padQuad[p.q]++;
  const padGens = {}; for (const p of pads) padGens[p.gen] = (padGens[p.gen] || 0) + 1;
  let pieces = 0; const pieceQuad = [0, 0, 0, 0];
  for (const c of cols) { if (!live(c) || isRamp(c) || c.maxY - c.minY < 1.2) continue; const [x, z] = mid(c); const d = Math.hypot(x - AX, z - AZ); if (d >= RING_IN && d <= RING_OUT) { pieces++; pieceQuad[quadOf(x, z)]++; } }
  const stairs = cols.filter((c) => !c.dead && isRamp(c) && d0(c) <= RING_OUT).map((c) => { const [x, z] = mid(c); return { x: r1(x), z: r1(z), rise: r2(c.maxY - c.minY), deg: r1(rampDeg(c)) }; });
  // the towngen layout (null on a build whose Isla Viva has none)
  if (plant === "grid-on-slope") {
    if (!M.city) M.city = { version: 0, layout: { towns: [], compounds: [], links: [] }, planted: true };
    const L = M.city.layout;
    const g = (L.towns || []).find((T) => T.grid && T.blocks && T.blocks.length);
    if (g) g.blocks[0].ground = Object.assign({}, g.blocks[0].ground, { relief: 30 });
    else L.towns.push({ id: "planted_grid", kind: "town", theme: "resort", grid: { cols: 2, rows: 2 }, blocks: [{ id: 0, ground: { min: 40, max: 71, relief: 31 } }], parcels: [], stairs: [], bridges: [], pads: [], roads: { nodes: [], edges: [] } });
  }
  const info = CITY.cityInfo(M, ent);
  const rimTown = info && info.towns.find((t) => t.id === "volcano_rim") || null;
  const grids = info ? info.towns.filter((t) => t.grid).map((t) => ({ id: t.id, kind: t.kind, blocks: t.blocks, maxBlockSlopeDeg: t.maxBlockSlopeDeg, reliefM: t.maxBlockReliefM })) : [];
  return { axis: [AX, AZ], ringIn: RING_IN, ringOut: RING_OUT, enterableTotal: ent.length, sealedTotal: det.buildings.length - ent.length, ring, ringDetector: ringRaw.length, quadCount, quadsCovered: quadCount.filter((n) => n > 0).length,
    pads: pads.length, padQuad, padQuadsCovered: padQuad.filter((n) => n > 0).length, padGens, cover: pieces, coverQuad: pieceQuad, stairs, stairsMaxDeg: stairs.length ? Math.max(...stairs.map((s) => s.deg)) : null,
    layout: !!info, rimTown, grids, gridMaxSlopeDeg: grids.length ? Math.max(...grids.map((g2) => g2.maxBlockSlopeDeg)) : null, ruinBuildings: rimTown ? rimTown.ruin : null };
}

// ───────────────────────── structures over water (Isla Viva + Deepwood) ─────────────────────────
/** every BoxGeometry maps.js made, as a world AABB (the recorder in three_hooks.mjs; collide:false stilts and pier legs are in it, the colliders are not) */
function visualBoxes() {
  const out = [];
  for (const b of globalThis.__LC_BOXES || []) {
    const p = b.geo.attributes.position; const bb = { minX: 1e9, maxX: -1e9, minY: 1e9, maxY: -1e9, minZ: 1e9, maxZ: -1e9, visual: true };
    for (let k = 0; k < p.count; k++) { const x = p.getX(k), y = p.getY(k), z = p.getZ(k); if (x < bb.minX) bb.minX = x; if (x > bb.maxX) bb.maxX = x; if (y < bb.minY) bb.minY = y; if (y > bb.maxY) bb.maxY = y; if (z < bb.minZ) bb.minZ = z; if (z > bb.maxZ) bb.maxZ = z; }
    out.push(bb);
  }
  return out;
}

function waterRecord(M, plant, region) {
  const wy = M.waterY;
  if (!(wy > -100)) return null;
  const H = M.heightAt;
  const cols = M.colliders.filter((c) => !c.dead && !c.prop);
  globalThis.__PLANT_LIFT__ = null;
  const deep = (x, z) => H(x, z) < wy - SWIM_DEPTH;
  const samples = (c, step) => {
    const out = []; const nx = Math.max(1, Math.ceil((c.maxX - c.minX) / step)), nz = Math.max(1, Math.ceil((c.maxZ - c.minZ) / step));
    for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) out.push([c.minX + (c.maxX - c.minX) * i / nx, c.minZ + (c.maxZ - c.minZ) * j / nz]);
    return out;
  };
  const near = cols.filter((c) => c.minY <= wy + 10 && c.maxY >= wy - 3);
  const cand = near.filter((c) => samples(c, 1).some(([x, z]) => deep(x, z)));
  // what can CARRY a piece is anything drawn or solid: the colliders AND the drawn boxes (a pier leg or a dock stilt is often collide:false)
  const vis = visualBoxes().filter((c) => c.minY <= wy + 10 && c.maxY >= wy - 3.5);
  const maxGround = (c) => { let m = -1e9; for (const [x, z] of samples(c, 0.5)) m = Math.max(m, H(x, z)); return m; };
  if (plant === "float-pier" && cand.length) {
    // the whole structure over the water near the region rises 1.2 m (a hut, a bridge: deck, piers, rails, and the abutments / posts that touch them, three contact hops out), colliders AND their drawn
    // twins: a real floating bridge floats in both. (Lifting ONE pier would not be a fault the scan can see: a lintel carried by a neighbouring post is carried, a pier beside other piers touches them.)
    const poolAll = near.concat(vis);
    const touch = (a2, b2) => a2.minX - 0.15 <= b2.maxX && b2.minX - 0.15 <= a2.maxX && a2.minZ - 0.15 <= b2.maxZ && b2.minZ - 0.15 <= a2.maxZ && a2.minY - 0.15 <= b2.maxY && b2.minY - 0.15 <= a2.maxY;
    const lifted = new Set();
    for (const c of cand) { const [x, z] = mid(c); if (!region || Math.hypot(x - region.x, z - region.z) <= region.r) lifted.add(c); }
    // every drawn twin of a lifted collider is lifted; then three rounds of contact
    for (let hop = 0; hop < 3; hop++) for (const c of poolAll) { if (lifted.has(c)) continue; for (const t of lifted) if (touch(c, t)) { lifted.add(c); break; } }
    for (const c of vis) { if (lifted.has(c)) continue; for (const t of lifted) if (Math.abs(c.minX - t.minX) < 0.03 && Math.abs(c.maxX - t.maxX) < 0.03 && Math.abs(c.minZ - t.minZ) < 0.03 && Math.abs(c.maxZ - t.maxZ) < 0.03 && Math.abs(c.minY - t.minY) < 0.03 && Math.abs(c.maxY - t.maxY) < 0.03) { lifted.add(c); break; } }
    // ONE lift for the whole set, so the lifted pieces keep touching each other: 1.2 m over the highest ground under any of them. (A flat 1.2 m was the first draft; the Wave-7b
    // Riverside Mill deck is one 19-24 m slab whose bank end sits up to 1.6 m into the rising bank, so +1.2 m still touched the ground there and the plant faulted nothing.)
    let need = 0; for (const t of lifted) need = Math.max(need, maxGround(t) - t.minY);
    const lift = 1.2 + Math.max(0, need);
    for (const t of lifted) { t.minY += lift; t.maxY += lift; }
    globalThis.__PLANT_LIFT__ = { pieces: lifted.size, lift: r2(lift) };
  }
  const supported = new Set();
  for (const c of cols) if (c.minY <= maxGround(c) + 0.15) supported.add(c);              // its underside touches the ground (or a bank) somewhere under it
  for (const c of vis) if (c.minY <= maxGround(c) + 0.15) supported.add(c);
  const overlapXZ = (a, b) => a.minX < b.maxX + 0.15 && b.minX < a.maxX + 0.15 && a.minZ < b.maxZ + 0.15 && b.minZ < a.maxZ + 0.15;      // touching counts (the stepped walls of a lighthouse meet edge to edge)
  // carried: a supported piece below reaches its underside (within 0.15 m) and starts under it
  let grew = true, rounds = 0;
  const pool = near.concat(vis);
  while (grew && rounds++ < 12) {
    grew = false;
    for (const c of pool) {
      if (supported.has(c)) continue;
      for (const d of pool) { if (d === c || !supported.has(d)) continue; if (d.minY < c.minY + 0.05 && d.maxY >= c.minY - 0.15 && overlapXZ(c, d)) { supported.add(c); grew = true; break; } }
    }
  }
  const floating = cand.filter((c) => !supported.has(c)).map((c) => { const [x, z] = mid(c); return { x: r1(x), z: r1(z), y0: r2(c.minY), y1: r2(c.maxY), w: r1(c.maxX - c.minX), d: r1(c.maxZ - c.minZ), ground: r2(H(x, z)) }; });
  const inRegion = (f) => !!region && Math.hypot(f.x - region.x, f.z - region.z) <= region.r;
  const floatNear = region ? floating.filter(inRegion) : [];
  return { plantLift: globalThis.__PLANT_LIFT__ || null, waterY: wy, candidates: cand.length, nearSurface: near.length, visualBoxes: vis.length, floating: floating.length, floatList: floating.slice(0, 6),
    region: region || null, candidatesNear: region ? cand.filter((c) => { const [x, z] = mid(c); return Math.hypot(x - region.x, z - region.z) <= region.r; }).length : null, floatNear: floatNear.length, floatNearList: floatNear.slice(0, 6) };
}

// ───────────────────────── Deepwood: the mill and its bridge ─────────────────────────
function millRecord(M, plant) {
  const mill = M.pois.find((p) => p.id === "mill");
  const wy = M.waterY, H = M.heightAt;
  if (!mill || !(wy > -100)) return { rec: { mill: false }, bridgesRaw: [] };
  const R = mill.r + 60;
  const cols = M.colliders.filter((c) => !c.dead && !c.prop && Math.hypot(mid(c)[0] - mill.x, mid(c)[1] - mill.z) <= R + 30);
  const deep = (x, z) => H(x, z) < wy - SWIM_DEPTH;
  // the share of a collider's footprint (1 m samples) over deep water: a bank house with one wet corner is not a river structure, a deck over the channel is
  const wetShare = (c) => { let n = 0, t = 0; const nx = Math.max(1, Math.ceil((c.maxX - c.minX) / 1)), nz = Math.max(1, Math.ceil((c.maxZ - c.minZ) / 1)); for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) { t++; if (deep(c.minX + (c.maxX - c.minX) * i / nx, c.minZ + (c.maxZ - c.minZ) * j / nz)) n++; } return n / t; };
  const over = cols.filter((c) => c.maxY >= wy + 0.3 && c.minY <= wy + 10 && wetShare(c) >= 0.2 && Math.hypot(mid(c)[0] - mill.x, mid(c)[1] - mill.z) <= R);
  // clusters by contact (gap <= 0.2 m on every axis)
  const par = over.map((_, i) => i); const find = (a) => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
  for (let i = 0; i < over.length; i++) for (let j = i + 1; j < over.length; j++) {
    const a = over[i], b = over[j];
    if (a.minX - 0.2 <= b.maxX && b.minX - 0.2 <= a.maxX && a.minZ - 0.2 <= b.maxZ && b.minZ - 0.2 <= a.maxZ && a.minY - 0.2 <= b.maxY && b.minY - 0.2 <= a.maxY) { const x = find(i), y = find(j); if (x !== y) par[y] = x; }
  }
  const groups = new Map(); over.forEach((c, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(c); });
  const bridges = [], others = [];
  for (const members of groups.values()) {
    const slabs = members.filter((c) => (c.maxY - c.minY <= 1.6 || isRamp(c)) && (c.maxX - c.minX) * (c.maxZ - c.minZ) >= 2.0);
    if (!slabs.length) { others.push({ n: members.length, slabs: 0 }); continue; }
    // axis: PCA of the slab middles weighted by area; one slab = its longer side
    let sw = 0, mx = 0, mz = 0; for (const c of slabs) { const a = (c.maxX - c.minX) * (c.maxZ - c.minZ); const [x, z] = mid(c); sw += a; mx += a * x; mz += a * z; }
    mx /= sw; mz /= sw;
    let cxx = 0, czz = 0, cxz = 0; for (const c of slabs) { const a = (c.maxX - c.minX) * (c.maxZ - c.minZ); const [x, z] = mid(c); cxx += a * (x - mx) * (x - mx); czz += a * (z - mz) * (z - mz); cxz += a * (x - mx) * (z - mz); }
    let ux, uz;
    // (R2) the axis is the MAIN DECK's own long extent (the cluster's largest walkable slab, ramps excepted): an area-weighted PCA of slab MIDDLES let a few
    // small wet run-out strips set it (R1 endgame lane, deepwood s18 before the deck fix: 3 strips of 2.3-2.9 m2 tilted it 14.5 deg and read a width of 13.6 m
    // for an 8.5 m deck). The PCA is kept only for a main deck that is square within 5 % (no long side to read).
    const decks = slabs.filter((c) => !isRamp(c));
    const main = (decks.length ? decks : slabs).reduce((best, c) => ((c.maxX - c.minX) * (c.maxZ - c.minZ) > (best.maxX - best.minX) * (best.maxZ - best.minZ) ? c : best));
    const lx = main.maxX - main.minX, lz = main.maxZ - main.minZ;
    if (Math.abs(lx - lz) > 0.05 * Math.max(lx, lz) || slabs.length === 1 || cxx + czz < 1e-6) { if (lx >= lz) { ux = 1; uz = 0; } else { ux = 0; uz = 1; } }
    else { const th = 0.5 * Math.atan2(2 * cxz, cxx - czz); ux = Math.cos(th); uz = Math.sin(th); }
    // the bridge is walked on its slabs: if the PCA is ambiguous (a square cluster) prefer the slab layout's longer bbox side
    let tmin = 1e9, tmax = -1e9, smin = 1e9, smax = -1e9;
    for (const c of slabs) for (const [x, z] of [[c.minX, c.minZ], [c.minX, c.maxZ], [c.maxX, c.minZ], [c.maxX, c.maxZ]]) {
      const t = (x - mx) * ux + (z - mz) * uz, s = -(x - mx) * uz + (z - mz) * ux;
      if (t < tmin) tmin = t; if (t > tmax) tmax = t; if (s < smin) smin = s; if (s > smax) smax = s;
    }
    let wetLen = 0; for (let t = tmin; t <= tmax; t += 0.5) if (deep(mx + ux * t, mz + uz * t)) wetLen += 0.5;                       // the deep water the structure itself covers along its axis
    const dryBeyond = (t0, sgn) => { for (let d = 0.5; d <= 10; d += 0.5) { const x = mx + ux * (t0 + sgn * d), z = mz + uz * (t0 + sgn * d); if (H(x, z) > wy + 0.3) return true; } return false; };
    const topAt = (t) => { let best = -1e9; for (const c of slabs) { const x = mx + ux * t, z = mz + uz * t; if (x >= c.minX - 0.3 && x <= c.maxX + 0.3 && z >= c.minZ - 0.3 && z <= c.maxZ + 0.3) best = Math.max(best, c.maxY); } return best; };
    const b = { n: members.length, slabs: slabs.length, mid: [r1(mx), r1(mz)], axis: [r2(ux), r2(uz)], len: r1(tmax - tmin), width: r1(smax - smin), wetLen: r1(wetLen), tmin, tmax, smin, smax, deckTopMin: null, endStep: null };
    const isBridge = wetLen >= 8 && dryBeyond(tmin, -1) && dryBeyond(tmax, 1);                                                  // it spans >= 8 m of deep water and both ends reach dry ground within 10 m
    // the deck ends against the banks: the slab top at each end vs the ground a metre beyond it
    const e0 = topAt(tmin + 0.4), e1 = topAt(tmax - 0.4);
    b.endStep = [e0 > -1e8 ? r2(e0 - H(mx + ux * (tmin - 1), mz + uz * (tmin - 1))) : null, e1 > -1e8 ? r2(e1 - H(mx + ux * (tmax + 1), mz + uz * (tmax + 1))) : null];
    b.members = members; b.slabList = slabs; b.u = [ux, uz]; b.c = [mx, mz];
    (isBridge ? bridges : others).push(b);
  }
  bridges.sort((a, b) => Math.hypot(a.mid[0] - mill.x, a.mid[1] - mill.z) - Math.hypot(b.mid[0] - mill.x, b.mid[1] - mill.z));
  if (plant === "bridge-gap" && bridges.length) {
    const b = bridges[0]; const mids = b.slabList.filter((c) => !isRamp(c)).sort((p, q) => ((mid(p)[0] - b.c[0]) * b.u[0] + (mid(p)[1] - b.c[1]) * b.u[1]) - ((mid(q)[0] - b.c[0]) * b.u[0] + (mid(q)[1] - b.c[1]) * b.u[1]));
    const t = mids[Math.floor(mids.length / 2)]; if (t) t.dead = true;
  }
  if (plant === "deck-edge" && bridges.length) {
    // the stage-B fault in miniature: the +s side of the first bridge's walkable slabs ends halfway between the old centre lanes (+-min(0.9, width/6)) and the outer lane (0.7 m inside the
    // deck edge), along the WHOLE deck - the centre lanes keep >= 0.3 m of deck past the capsule, the outer lane on that side walks off into the river. The lanes are fixed from the
    // detected width BEFORE this cut (the detector saw the real deck), so only the walks change. Shrinking a box never leaves its spatial-hash cells.
    const b = bridges[0], [ux, uz] = b.u, [cx, cz] = b.c, oldOff = Math.min(0.9, Math.max(0.3, b.width / 6)), outer = Math.max(0, b.width / 2 - 0.7);
    const sEdge = b.smin + b.width / 2 + (oldOff + outer) / 2;                                   // the s of the new +s edge (the detected deck spans smin..smax)
    for (const c of b.slabList) {
      if (Math.abs(ux) >= Math.abs(uz)) { const lim = cz + ux * sEdge; if (ux > 0) c.maxZ = Math.min(c.maxZ, lim); else c.minZ = Math.max(c.minZ, lim); }     // axis ~x: s = (z - cz) * ux
      else { const lim = cx - uz * sEdge; if (uz > 0) c.minX = Math.max(c.minX, lim); else c.maxX = Math.min(c.maxX, lim); }                                // axis ~z: s = -(x - cx) * uz
    }
    globalThis.__PLANT_DECK_EDGE__ = { sEdge: r2(sEdge), oldOff: r2(oldOff), outer: r2(outer) };
  }
  const rec = { mill: true, millAt: [mill.x, mill.z], radius: R, overWater: over.length, clusters: groups.size, bridges: bridges.length, others: others.length,
    bridge: bridges.length ? { len: bridges[0].len, width: bridges[0].width, wetLen: bridges[0].wetLen, slabs: bridges[0].slabs, members: bridges[0].n, axis: bridges[0].axis, mid: bridges[0].mid, endStep: bridges[0].endStep, distFromMill: r1(Math.hypot(bridges[0].mid[0] - mill.x, bridges[0].mid[1] - mill.z)) } : null,
    walks: null };
  return { rec, bridgesRaw: bridges };
}

async function doWalks(M, seed, st) {
  const { rec, bridgesRaw } = st, b = bridgesRaw[0];
  const wy = M.waterY, H = M.heightAt;
  const [ux, uz] = b.u, nx = -uz, nz = ux, [mx, mz] = b.c;
  // the FULL deck width (Wave 7b stage C, lane C3): five lanes = the centre line, the quarter lines and the two OUTER lanes 0.7 m inside the deck edge (a 0.45 m capsule
  // plus 0.25 m), each walked AND sprinted, both ways = 20 walks. (Until stage C the lanes were +-min(0.9, width/6): only the centre 1.8 m of the 8.5 m stage-B deck was ever
  // walked, and the E-W decks whose outer halves end below / inside the banks read 30/30.) A narrow deck (< 3 m) folds the duplicate lanes away.
  const hw = b.width / 2, outer = Math.max(0, hw - 0.7);
  const lo = r2(outer), lh = r2(outer / 2), lanes = [...new Set([-lo, -lh, 0, lh, lo])];
  const off = r2(outer);
  // a free dry bank point 6-22 m past a deck end: not inside a wall / tree / rock footprint
  const free = (x, z) => { const o = []; M.queryColliders(x, z, 1.0, o); for (const c of o) { if (c.dead || isRamp(c)) continue; if (x > c.minX - 0.6 && x < c.maxX + 0.6 && z > c.minZ - 0.6 && z < c.maxZ + 0.6 && c.maxY > H(x, z) + 0.3 && c.minY < H(x, z) + 1.8) return false; } return true; };
  const portals = M.portals || [];
  const segNear = (ax, az, bx, bz, px, pz) => { const vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz || 1; const t = Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / L2)); return Math.hypot(ax + vx * t - px, az + vz * t - pz); };
  // a bank point 6-22 m past a deck end: dry, not inside a wall / tree / rock footprint, and no launch portal within 4 m of the straight lane from it to the deck end (a ring flings the walker: not a bridge defect)
  const bank = (t0, sgn, lat) => { for (const d of [6, 8, 10, 12, 15, 18, 22]) { const t = t0 + sgn * d, x = mx + ux * t + nx * lat, z = mz + uz * t + nz * lat; const ex = mx + ux * t0 + nx * lat, ez = mz + uz * t0 + nz * lat; if (H(x, z) > wy + 0.5 && free(x, z) && !portals.some((p) => segNear(x, z, ex, ez, p.x, p.z) < 4)) return { x, y: H(x, z), z, d }; } return null; };
  const GW = await makeGameW(E, Pmod, M, seed), mover = makeMover(GW, E.THREE);
  rec.walks = { n: 0, ok: 0, offset: off, lanes, width: b.width, axisEW: Math.abs(ux) > Math.abs(uz), sprintOk: 0, walkOk: 0, list: [] };
  for (const sprint of [false, true]) for (const lat of lanes) {
    const A = bank(b.tmin, -1, lat), B = bank(b.tmax, 1, lat);
    for (const [from, to, dir] of [[A, B, "A>B"], [B, A, "B>A"]]) {
      rec.walks.n++;
      if (!from || !to) { rec.walks.list.push({ dir, lat: r2(lat), sprint, ok: false, why: "no free dry bank point (no wall, tree, rock or launch portal in the way) 6-22 m past the deck end" }); continue; }
      const w = walkLine(Pmod, mover, GW, { x: from.x, y: from.y, z: from.z }, { x: to.x, z: to.z }, { sprint });
      if (w.ok) { rec.walks.ok++; if (sprint) rec.walks.sprintOk++; else rec.walks.walkOk++; }
      rec.walks.list.push({ dir, lat: r2(lat), sprint, ok: w.ok, why: w.ok ? null : w.why, at: w.at && w.at.map(r1), left: w.left != null ? r1(w.left) : null, maxY: r1(w.maxY), minY: r1(w.minY), from: [r1(from.x), r1(from.z)], to: [r1(to.x), r1(to.z)], ticks: w.ticks });
    }
  }
}

// ───────────────────────── main ─────────────────────────
const res = { root: ROOT, maps: MAPS, plant: PLANT, ringIn: RING_IN, ringOut: RING_OUT, walkSeeds: [...WALK_SEEDS], records: [] };
const t0 = Date.now();
for (const mapId of MAPS) for (const seed of SEEDS) {
  const t1 = Date.now();
  globalThis.__LC_BOXES = [];                      // (three_hooks.mjs records every BoxGeometry the build makes: the drawn structure, collide:false pieces included)
  const M = await buildMap(E.makeW(seed), mapId);
  const rec = { map: mapId, seed, genVersion: M.genVersion, colliders: M.colliders.length, hasCity: !!M.city, waterY: M.waterY };
  if (mapId === "isla_viva") rec.rim = rimRecord(M, PLANT);
  const millPoi = mapId === "deepwood" ? M.pois.find((p) => p.id === "mill") : null;
  rec.water = waterRecord(M, PLANT, millPoi ? { x: millPoi.x, z: millPoi.z, r: millPoi.r + 60 } : null);
  if (mapId === "deepwood") {
    const st = millRecord(M, PLANT);
    rec.mill = st.rec;
    if (globalThis.__PLANT_DECK_EDGE__) { rec.mill.plantDeckEdge = globalThis.__PLANT_DECK_EDGE__; globalThis.__PLANT_DECK_EDGE__ = null; }
    if (WALK_SEEDS.has(seed) && st.bridgesRaw.length) await doWalks(M, seed, st);
  }
  rec.ms = Date.now() - t1;
  res.records.push(rec);
  globalThis.__LC_BOXES = null;
  try { if (typeof M.dispose === "function") M.dispose(); } catch (e) { /* the Node stub has nothing to free */ }
  process.stderr.write(`endgame ${mapId} seed ${seed}: ${rec.ms} ms${rec.rim ? `, rim ring ${rec.rim.ring.length} buildings in ${rec.rim.quadsCovered} quadrants, ${rec.rim.pads} pads` : ""}${rec.mill && rec.mill.mill ? `, ${rec.mill.bridges} bridge(s)${rec.mill.walks ? `, walks ${rec.mill.walks.ok}/${rec.mill.walks.n}` : ""}` : ""}${rec.water ? `, floating over water ${rec.water.floating}` : ""}\n`);
}
console.warn = warn; console.log = log;
res.wallS = +((Date.now() - t0) / 1000).toFixed(1);
const text = JSON.stringify(res);
if (OUT) { fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true }); fs.writeFileSync(OUT, text); process.stderr.write("probe_endgame: wrote " + OUT + " (" + text.length + " bytes)\n"); }
else process.stdout.write(text);
process.exit(0);
