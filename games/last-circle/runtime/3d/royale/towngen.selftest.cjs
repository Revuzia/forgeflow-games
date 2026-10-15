/**
 * Node self-test for royale/towngen.js (Wave 6, lane 6B) - the town layout generator (contract C-LAYOUT).
 * Run: node games/last-circle/runtime/3d/royale/towngen.selftest.cjs      (gate.py picks it up with the other *.selftest.cjs)
 * Exit 0 = every row passed, 1 = a failure.  THREE-free: towngen.js has no imports and this file never loads view code.
 *
 * What it asserts (200 seeds x 3 maps x every POI of the plan x the compound fill):
 *   every kept block on dry land (waterY + 0.8) | parcels quarter-turned, building inside its parcel | same seed -> byte-identical layout
 *   (twice in this process, and in a fresh process) | no overlapping parcels or buildings | every town parcel touches a street | the road
 *   graph is connected and never runs through a block | every enterable parcel has a front door reachable from a street node along a clear
 *   walk | compounds >= 60 m from every town | >= 80 % of buildings enterable, shells <= 20 %, <= 3 floors | 0 road vertices below waterY |
 *   no straight street longer than 150 m | rooms tile each floor, doors sit on walls, stairs climb <= 45 deg, every room reachable from the
 *   front door | the shell kit sizes equal the manifest's | mulberry32 equals the sim's | the height function it uses equals the real map's
 *   (a real buildMap in a child process) | the citycheck coverage targets of PLAN section 4 on the real height functions.
 * Planted faults (negative controls) prove each checker bites.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const { pathToFileURL } = require("url");

const ROOT = path.resolve(__dirname, "..", "..", "..");                 // games/last-circle
const MAPS_JS = path.join(ROOT, "runtime", "3d", "royale", "maps.js");
const TG_JS = path.join(__dirname, "towngen.js");
const SEEDS = Number(process.env.TG_SEEDS || 200);
const MAPS = ["ashgrid", "isla_viva", "deepwood"];
const T_START = Date.now();

let passed = 0, failed = 0;
function ok(cond, msg, detail) {
  if (cond) { passed++; console.log("  PASS  " + msg); }
  else { failed++; console.error("  FAIL  " + msg + (detail ? "   -> " + detail : "")); }
}
function info(msg) { console.log("  info  " + msg); }
const pct = (a, p) => { if (!a.length) return NaN; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
const fix = (v, n) => (Number.isFinite(v) ? v.toFixed(n == null ? 1 : n) : "n/a");
const EPS = 1e-6;
function fnv(str) { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16); }

// ── the height function: the REAL one, sliced out of maps.js (and an embedded copy as a loud fallback) ───────────────────────────────────
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));
}
function grab(src, clean, re) {
  const m = re.exec(clean);
  if (!m) throw new Error("marker not found in maps.js: " + re);
  const i = clean.indexOf("{", m.index);
  let depth = 0, j = i;
  for (; j < clean.length; j++) { const c = clean[j]; if (c === "{") depth++; else if (c === "}") { depth--; if (depth === 0) break; } }
  return src.slice(m.index, j + 1);
}
const EMBEDDED = [
  "const SIZE = 1600; const HALF = SIZE / 2;",
  "function hash2(ix, iz, seed) { let h = (ix * 374761393 + iz * 668265263 + seed * 1442695041) | 0; h = (h ^ (h >> 13)) | 0; h = Math.imul(h, 1274126177); return ((h ^ (h >> 16)) >>> 0) / 4294967296; }",
  "function smooth(t) { return t * t * (3 - 2 * t); }",
  "function vnoise(x, z, seed) { const ix = Math.floor(x), iz = Math.floor(z); const fx = smooth(x - ix), fz = smooth(z - iz); const a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed); const c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed); return (a + (b - a) * fx) * (1 - fz) + (c + (d - c) * fx) * fz; }",
  "function fbm(x, z, seed, octaves, lac, gain) { let amp = 1, freq = 1, sum = 0, norm = 0; for (let i = 0; i < octaves; i++) { sum += vnoise(x * freq, z * freq, seed + i * 101) * amp; norm += amp; amp *= gain; freq *= lac; } return sum / norm; }",
  `function mkHeightFn(mapId, seed) {
  if (mapId === "isla_viva") { return (x, z) => { const d = Math.sqrt(x * x + z * z) / HALF; const islandMask = Math.max(0, 1 - Math.pow(d * 1.12, 2.6)); let h = fbm(x / 220, z / 220, seed, 4, 2.1, 0.5) * 46 * islandMask; const dv = Math.sqrt((x - 40) * (x - 40) + (z + 60) * (z + 60)); if (dv < 240) { const cone = (1 - dv / 240); h += cone * cone * 85; if (dv < 42) h -= (1 - dv / 42) * 34; } h -= 7; return h; }; }
  if (mapId === "ashgrid") { return (x, z) => { let h = fbm(x / 340, z / 340, seed, 3, 2.0, 0.5) * 9 + 2; h += fbm(x / 40, z / 40, seed + 7, 2, 2.0, 0.5) * 1.6; const rg = 0.5 - Math.abs(fbm(x / 28, z / 28, seed + 9, 2, 2, 0.5) - 0.5); h += (rg - 0.25) * 10; const d = Math.sqrt(x * x + z * z) / HALF; h += d * d * 14; return h; }; }
  if (mapId === "deepwood") { return (x, z) => { let h = fbm(x / 260, z / 260, seed, 5, 2.05, 0.52) * 58 + 4; const rz = Math.sin(x / 210) * 130 + 40; const dr = Math.abs(z - rz); if (dr < 46) h -= (1 - dr / 46) * (h + 3.5); const dl = Math.sqrt((x + 260) * (x + 260) + (z - 430) * (z - 430)); if (dl < 150) h -= (1 - dl / 150) * (h + 4); return h; }; }
  return (x, z) => 1 + fbm(x / 200, z / 200, seed, 2, 2, 0.5) * 2;
}`,
].join("\n");
let HEIGHT_SOURCE = "maps.js (sliced)";
function loadMkHeightFn() {
  try {
    const src = fs.readFileSync(MAPS_JS, "utf8"), clean = stripComments(src);
    const size = /const SIZE = (\d+);/.exec(clean);
    if (!size) throw new Error("SIZE not found");
    const parts = ["const SIZE = " + size[1] + "; const HALF = SIZE / 2;"];
    for (const name of ["hash2", "smooth", "vnoise", "fbm", "mkHeightFn"]) parts.push(grab(src, clean, new RegExp("function " + name + "\\s*\\(")));
    return new Function(parts.join("\n") + "\nreturn mkHeightFn;")();
  } catch (e) {
    HEIGHT_SOURCE = "EMBEDDED COPY (maps.js slice failed: " + e.message + ")";
    return new Function(EMBEDDED + "\nreturn mkHeightFn;")();
  }
}
/** maps.js snapPoiToLand for the five inland isla_viva POIs (a replica, verified below against a real buildMap) */
function snapIsla(pois, h, wy) {
  const dryFrac = (cx, cz, R, minH) => {
    let k = 0, n = 0;
    for (let ring = 1; ring <= 3; ring++) for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2 + ring * 0.4, rr = R * ring / 3; if (h(cx + Math.cos(a) * rr, cz + Math.sin(a) * rr) > minH) k++; n++; }
    if (h(cx, cz) > minH) k++; n++;
    return k / n;
  };
  for (const id of ["palm_bay", "coco_village", "cliff_temples", "jungle_market", "banana_farm"]) {
    const p = pois.find((q) => q.id === id);
    if (!p) continue;
    const R = p.r * 0.6;
    if (dryFrac(p.x, p.z, R, wy + 0.8) >= 0.6) continue;
    let moved = false;
    for (let ring = 20; ring <= 260 && !moved; ring += 20) for (let i = 0; i < 16 && !moved; i++) {
      const a = i / 16 * Math.PI * 2 + ring * 0.11, cx = p.x + Math.cos(a) * ring, cz = p.z + Math.sin(a) * ring;
      if (dryFrac(cx, cz, R, wy + 0.8) >= 0.6) { p.x = cx; p.z = cz; moved = true; }
    }
  }
  return pois;
}
const waterOf = (map) => (map === "ashgrid" ? -999 : 0);

// ── geometry helpers ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const overlapArea = (a, b) => { const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]), d = Math.min(a[3], b[3]) - Math.max(a[1], b[1]); return w > EPS && d > EPS ? w * d : 0; };
const rectDist = (x, z, r) => { const dx = Math.max(r[0] - x, 0, x - r[2]), dz = Math.max(r[1] - z, 0, z - r[3]); return Math.sqrt(dx * dx + dz * dz); };
function segHitsRect(ax, az, bx, bz, r) {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dz = bz - az;
  for (const [p, q] of [[-dx, ax - r[0]], [dx, r[2] - ax], [-dz, az - r[1]], [dz, r[3] - az]]) {
    if (p === 0) { if (q <= 0) return false; }
    else { const t = q / p; if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; } }
  }
  return t1 - t0 > 1e-9;
}
function edgeContains(roads, x, z, axis) {
  for (const e of roads.edges) {
    if (e.axis !== axis) continue;
    const A = roads.nodes[e.a], B = roads.nodes[e.b];
    if (axis === "x" ? (Math.abs(A.z - z) < EPS && x >= Math.min(A.x, B.x) - EPS && x <= Math.max(A.x, B.x) + EPS) : (Math.abs(A.x - x) < EPS && z >= Math.min(A.z, B.z) - EPS && z <= Math.max(A.z, B.z) + EPS)) return e;
  }
  return null;
}
class BoxIndex {
  constructor(cell) { this.cell = cell || 64; this.m = new Map(); this.all = []; this.stamp = 0; }
  add(box, tag) {
    const e = { box, tag, seen: 0 }; this.all.push(e);
    const c = this.cell;
    for (let i = Math.floor(box[0] / c); i <= Math.floor(box[2] / c); i++) for (let j = Math.floor(box[1] / c); j <= Math.floor(box[3] / c); j++) { const k = i * 100003 + j; let l = this.m.get(k); if (!l) this.m.set(k, l = []); l.push(e); }
  }
  query(box, fn) {
    const c = this.cell, st = ++this.stamp;
    for (let i = Math.floor(box[0] / c); i <= Math.floor(box[2] / c); i++) for (let j = Math.floor(box[1] / c); j <= Math.floor(box[3] / c); j++) {
      const l = this.m.get(i * 100003 + j);
      if (l) for (const e of l) if (e.seen !== st) { e.seen = st; fn(e); }
    }
  }
}

// ── checkers: each returns a list of failure strings (empty = pass) ───────────────────────────────────────────────────────────────────────
function checkBlocksDry(TG, L, h, wy, dense) {
  const out = [], step = dense ? 3 : 11.5;
  for (const b of L.blocks) {
    let lo = Infinity;
    for (let x = b.x0; x <= b.x1 + 1e-9; x += step) for (let z = b.z0; z <= b.z1 + 1e-9; z += step) lo = Math.min(lo, h(x, z));
    lo = Math.min(lo, h(b.x1, b.z1), h(b.x0, b.z1), h(b.x1, b.z0), h(b.cx, b.cz));
    if (!(lo >= wy + TG.WET_MARGIN)) out.push(L.id + " block " + b.id + " lowest ground " + lo.toFixed(2) + " < waterY + " + TG.WET_MARGIN);
  }
  return out;
}
function checkQuarter(TG, L) {
  const out = [];
  for (const p of L.parcels) {
    const b = p.building;
    if (!b) continue;
    if (![0, 1, 2, 3].includes(b.turn) || b.rot !== TG.ROT[b.turn]) { out.push(L.id + " " + p.id + " not a quarter turn: turn " + b.turn + " rot " + b.rot); continue; }
    const F = [[0, 1], [1, 0], [0, -1], [-1, 0]][b.turn];
    if (b.facing[0] !== F[0] || b.facing[1] !== F[1]) out.push(L.id + " " + p.id + " facing " + b.facing + " != (sin rot, cos rot) " + F);
    const hx = b.turn % 2 ? b.d / 2 : b.w / 2, hz = b.turn % 2 ? b.w / 2 : b.d / 2;
    const bb = b.aabb;
    if (Math.abs(bb[2] - bb[0] - 2 * hx) > 2e-3 || Math.abs(bb[3] - bb[1] - 2 * hz) > 2e-3 || Math.abs((bb[0] + bb[2]) / 2 - b.cx) > 2e-3 || Math.abs((bb[1] + bb[3]) / 2 - b.cz) > 2e-3) out.push(L.id + " " + p.id + " aabb is not the exact box of its quarter-turned footprint");
    if (bb[0] < p.rect[0] - 2e-3 || bb[1] < p.rect[1] - 2e-3 || bb[2] > p.rect[2] + 2e-3 || bb[3] > p.rect[3] + 2e-3) out.push(L.id + " " + p.id + " building leaves its parcel");
    if (p.facing && L.kind && L.blocks.length && (p.facing[0] !== b.facing[0] || p.facing[1] !== b.facing[1])) out.push(L.id + " " + p.id + " parcel facing != door facing");
  }
  return out;
}
function checkOverlap(layouts) {
  const out = [], idx = new BoxIndex(64);
  for (const L of layouts) for (const p of L.parcels) {
    idx.query(p.rect, (e) => { if (overlapArea(e.box, p.rect) > 0) out.push(L.id + "/" + p.id + " parcel overlaps " + e.tag); });
    idx.add(p.rect, L.id + "/" + p.id);
  }
  const bidx = new BoxIndex(64);
  for (const L of layouts) for (const p of L.parcels) {
    if (!p.building) continue;
    bidx.query(p.building.aabb, (e) => { if (overlapArea(e.box, p.building.aabb) > 0) out.push(L.id + "/" + p.id + " building overlaps " + e.tag); });
    bidx.add(p.building.aabb, L.id + "/" + p.id);
  }
  // blocks of different towns must not overlap either
  const blk = new BoxIndex(128);
  for (const L of layouts) for (const b of L.blocks) {
    blk.query([b.cx - 28, b.cz - 28, b.cx + 28, b.cz + 28], (e) => { if (e.tag.split("/")[0] !== L.id && overlapArea(e.box, [b.cx - 28, b.cz - 28, b.cx + 28, b.cz + 28]) > 0) out.push(L.id + " block ring overlaps " + e.tag); });
    blk.add([b.cx - 28, b.cz - 28, b.cx + 28, b.cz + 28], L.id + "/b" + b.id);
  }
  return out;
}
function checkStreets(TG, L) {
  const out = [];
  if (!L.blocks.length) return out;
  const byBlock = new Map(L.blocks.map((b) => [b.id, b]));
  for (const p of L.parcels) {
    const b = byBlock.get(p.block);
    if (!b) { out.push(L.id + " " + p.id + " has no block"); continue; }
    const r = p.rect, E = 20;
    const sides = [];
    if (Math.abs(r[1] - (b.cz - E)) < EPS) sides.push(["x", (r[0] + r[2]) / 2, b.cz - 28]);
    if (Math.abs(r[3] - (b.cz + E)) < EPS) sides.push(["x", (r[0] + r[2]) / 2, b.cz + 28]);
    if (Math.abs(r[0] - (b.cx - E)) < EPS) sides.push(["z", b.cx - 28, (r[1] + r[3]) / 2]);
    if (Math.abs(r[2] - (b.cx + E)) < EPS) sides.push(["z", b.cx + 28, (r[1] + r[3]) / 2]);
    if (!sides.length) { out.push(L.id + " " + p.id + " touches no block edge"); continue; }
    if (!sides.some((s) => (s[0] === "x" ? edgeContains(L.roads, s[1], s[2], "x") : edgeContains(L.roads, s[1], s[2], "z")))) out.push(L.id + " " + p.id + " touches a block edge with no road edge beside it");
  }
  return out;
}
function checkRoads(TG, L, allBlocks, h, wy) {
  const out = [];
  const R = L.roads;
  if (!R.nodes.length) return out;
  // connected
  const adj = R.nodes.map(() => []);
  for (const e of R.edges) { adj[e.a].push(e.b); adj[e.b].push(e.a); }
  const seen = new Set([0]), st = [0];
  while (st.length) { const c = st.pop(); for (const n of adj[c]) if (!seen.has(n)) { seen.add(n); st.push(n); } }
  if (seen.size !== R.nodes.length) out.push(L.id + " road graph not connected: " + seen.size + "/" + R.nodes.length + " nodes reachable");
  // never through a block: the centreline keeps 5 m (half a road) from every block square, own or foreign
  for (const e of R.edges) {
    const A = R.nodes[e.a], B = R.nodes[e.b];
    const n = Math.max(2, Math.ceil(e.len / 4));
    for (let k = 0; k <= n; k++) {
      const x = A.x + (B.x - A.x) * k / n, z = A.z + (B.z - A.z) * k / n;
      for (const b of allBlocks) {
        const d = Math.max(Math.abs(x - b.cx) - 23, Math.abs(z - b.cz) - 23);
        if (d < 5 - 1e-6) { out.push(L.id + " road edge " + e.id + " passes " + d.toFixed(2) + " m from a block square (< 5)"); k = n + 1; break; }
      }
    }
    if (Math.abs(A.x - B.x) > EPS && Math.abs(A.z - B.z) > EPS) out.push(L.id + " road edge " + e.id + " is diagonal");
  }
  // a straight street longer than ~150 m must jog or end
  for (const s of R.streets) if (s.len > TG.LONG_STREET + 1e-6) out.push(L.id + " straight street " + s.len + " m > " + TG.LONG_STREET);
  return out;
}
function roadVertices(L, h, wy, margin) {
  // the vertices maps.js's road() would lay: 4 m stations x [-1, -0.5, 0, 0.5, 1] x 5 m half-width
  let n = 0, low = 0, min = Infinity;
  for (const e of L.roads.edges) {
    const A = L.roads.nodes[e.a], B = L.roads.nodes[e.b];
    const cnt = Math.max(1, Math.ceil(e.len / 4));
    for (let k = 0; k <= cnt; k++) {
      const cx = A.x + (B.x - A.x) * k / cnt, cz = A.z + (B.z - A.z) * k / cnt;
      for (const o of [-1, -0.5, 0, 0.5, 1]) {
        const x = e.axis === "x" ? cx : cx + o * 5, z = e.axis === "x" ? cz + o * 5 : cz;
        const v = h(x, z);
        n++; if (v < min) min = v;
        if (v < wy + margin) low++;
      }
    }
  }
  return { n, low, min };
}
function checkDoors(TG, L, index, h) {
  const out = [];
  const roads = L.roads, byParcel = new Map(L.parcels.map((p) => [p.id, p]));
  const doorsOf = new Map();
  for (const d of L.doors) { if (d.kind === "front") (doorsOf.get(d.parcel) || doorsOf.set(d.parcel, []).get(d.parcel)).push(d); }
  const grid = L.blocks.length > 0;
  for (const p of L.parcels) {
    if (!p.building || !p.building.enterable) continue;
    const ds = doorsOf.get(p.id);
    if (!ds || !ds.length) { out.push(L.id + " " + p.id + " enterable but has no front door"); continue; }
    const d = ds[0], b = p.building;
    // the door is ON the front wall, facing the building's facing
    const bb = b.aabb;
    const onWall = b.facing[0] > 0 ? Math.abs(d.x - bb[2]) < 1e-3 : b.facing[0] < 0 ? Math.abs(d.x - bb[0]) < 1e-3 : b.facing[1] > 0 ? Math.abs(d.z - bb[3]) < 1e-3 : Math.abs(d.z - bb[1]) < 1e-3;
    if (!onWall) out.push(L.id + " " + p.id + " front door is not on the front wall");
    if (d.nx !== b.facing[0] || d.nz !== b.facing[1]) out.push(L.id + " " + p.id + " door normal != building facing");
    if (grid) {
      const s = d.street;
      if (!s || !roads.edges[s.edge] || !roads.nodes[s.node]) { out.push(L.id + " " + p.id + " front door has no street edge/node"); continue; }
      // the straight walk door.out -> street centreline crosses no building
      const seg = [d.out[0], d.out[1], s.x, s.z];
      if (Math.abs(seg[0] - seg[2]) > 1e-3 && Math.abs(seg[1] - seg[3]) > 1e-3) out.push(L.id + " " + p.id + " door walk is not axis-aligned");
      index.query([Math.min(seg[0], seg[2]) - 1, Math.min(seg[1], seg[3]) - 1, Math.max(seg[0], seg[2]) + 1, Math.max(seg[1], seg[3]) + 1], (e) => { if (segHitsRect(seg[0], seg[1], seg[2], seg[3], e.box)) out.push(L.id + " " + p.id + " door walk crosses building " + e.tag); });
      // the walk starts outside every building and the street point lies on the named edge
      const E = roads.edges[s.edge], A = roads.nodes[E.a], B = roads.nodes[E.b];
      const onEdge = E.axis === "x" ? Math.abs(A.z - s.z) < 1e-3 && s.x >= Math.min(A.x, B.x) - 1e-3 && s.x <= Math.max(A.x, B.x) + 1e-3 : Math.abs(A.x - s.x) < 1e-3 && s.z >= Math.min(A.z, B.z) - 1e-3 && s.z <= Math.max(A.z, B.z) + 1e-3;
      if (!onEdge) out.push(L.id + " " + p.id + " door street point is not on its road edge");
    } else {
      // compound / village: the door opens onto the yard (door.out within 2 m of the yard rectangle) and the first 3 m along the facing are clear
      const y = L.compound.yard;
      if (rectDist(d.out[0], d.out[1], y) > 2.01) out.push(L.id + " " + p.id + " front door does not open onto the yard");
      const seg = [d.x, d.z, d.x + d.nx * 3, d.z + d.nz * 3];
      index.query([Math.min(seg[0], seg[2]) - 1, Math.min(seg[1], seg[3]) - 1, Math.max(seg[0], seg[2]) + 1, Math.max(seg[1], seg[3]) + 1], (e) => { if (e.tag !== L.id + "/" + p.id && segHitsRect(seg[0], seg[1], seg[2], seg[3], e.box)) out.push(L.id + " " + p.id + " door blocked by " + e.tag); });
    }
  }
  return out;
}
function checkShares(TG, L) {
  const out = [];
  const bl = L.parcels.filter((p) => p.building);
  if (!bl.length) return out;
  const ent = bl.filter((p) => p.building.enterable);
  if (ent.length / bl.length < 0.8 - 1e-9) out.push(L.id + " enterable share " + (100 * ent.length / bl.length).toFixed(1) + "% < 80%");
  if ((bl.length - ent.length) > Math.floor(bl.length * TG.MAX_SHELL_SHARE)) out.push(L.id + " shells " + (bl.length - ent.length) + " of " + bl.length + " > 20%");
  for (const p of ent) if (p.building.floors < 1 || p.building.floors > TG.MAX_FLOORS) out.push(L.id + " " + p.id + " floors " + p.building.floors);
  for (const b of L.blocks) { const n = ent.filter((p) => p.block === b.id).length; if (n < 1) out.push(L.id + " block " + b.id + " has no enterable building"); }
  return out;
}
function checkInterior(TG, L) {
  const out = [];
  const byRoom = new Map(L.rooms.map((r) => [r.id, r]));
  const byDoor = new Map(L.doors.map((d) => [d.id, d]));
  const roomsOf = new Map(), stairsOf = new Map(), doorsOf = new Map();
  for (const r of L.rooms) (roomsOf.get(r.parcel) || roomsOf.set(r.parcel, []).get(r.parcel)).push(r);
  for (const s of L.stairs) (stairsOf.get(s.parcel) || stairsOf.set(s.parcel, []).get(s.parcel)).push(s);
  for (const d of L.doors) (doorsOf.get(d.parcel) || doorsOf.set(d.parcel, []).get(d.parcel)).push(d);
  const inBox = (x, z, bb, e) => x >= bb[0] - e && x <= bb[2] + e && z >= bb[1] - e && z <= bb[3] + e;
  for (const p of L.parcels) {
    const b = p.building;
    if (!b) continue;
    const rooms = roomsOf.get(p.id) || [], stairs = stairsOf.get(p.id) || [], doors = doorsOf.get(p.id) || [];
    if (!b.enterable) { if (rooms.length || doors.length || stairs.length) out.push(L.id + " " + p.id + " shell has interior records"); continue; }
    if (!rooms.length) { out.push(L.id + " " + p.id + " enterable with no rooms"); continue; }
    const nx = Math.round(b.w / 2.5), nz = Math.round(b.d / 2.5);
    if (Math.abs(nx * 2.5 - b.w) > 1e-9 || Math.abs(nz * 2.5 - b.d) > 1e-9) out.push(L.id + " " + p.id + " footprint " + b.w + "x" + b.d + " is not on the 2.5 m module");
    for (let f = 0; f < b.floors; f++) {
      const fr = rooms.filter((r) => r.floor === f);
      const cells = new Set();
      let area = 0;
      for (const r of fr) {
        area += r.area;
        for (let i = r.cells[0]; i < r.cells[2]; i++) for (let j = r.cells[1]; j < r.cells[3]; j++) { const k = i * 64 + j; if (cells.has(k)) out.push(L.id + " " + p.id + " floor " + f + " rooms overlap at cell " + i + "," + j); cells.add(k); }
        if (!inBox((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2, b.aabb, 1e-3) || r.x0 < b.aabb[0] - 1e-3 || r.x1 > b.aabb[2] + 1e-3 || r.z0 < b.aabb[1] - 1e-3 || r.z1 > b.aabb[3] + 1e-3) out.push(L.id + " " + p.id + " room " + r.id + " outside the footprint");
      }
      if (cells.size !== nx * nz || Math.abs(area - b.w * b.d) > 1e-3) out.push(L.id + " " + p.id + " floor " + f + " rooms cover " + cells.size + "/" + nx * nz + " cells");
    }
    // doors: exterior on the wall, interior between its two rooms; 2.26 m wide
    for (const d of doors) {
      if (d.width !== TG.DOOR_W) out.push(L.id + " " + d.id + " width " + d.width);
      if (d.kind === "interior") {
        const A = byRoom.get(d.rooms[0]), B = byRoom.get(d.rooms[1]);
        if (!A || !B || A.floor !== B.floor || A.floor !== d.floor) { out.push(L.id + " " + d.id + " interior door rooms invalid"); continue; }
        const touch = (r) => d.x >= r.x0 - 1e-3 && d.x <= r.x1 + 1e-3 && d.z >= r.z0 - 1e-3 && d.z <= r.z1 + 1e-3;
        if (!touch(A) || !touch(B)) out.push(L.id + " " + d.id + " interior door is not on the wall between its rooms");
      } else {
        const bb = b.aabb;
        const onB = Math.abs(d.x - bb[0]) < 1e-3 || Math.abs(d.x - bb[2]) < 1e-3 || Math.abs(d.z - bb[1]) < 1e-3 || Math.abs(d.z - bb[3]) < 1e-3;
        if (!onB || d.floor !== 0) out.push(L.id + " " + d.id + " exterior door is off the ground-floor wall");
      }
    }
    // stairs: inside the footprint, <= 45 degrees, approach on `from`, exit on `to`
    for (const s of stairs) {
      if (s.x0 < b.aabb[0] - 1e-3 || s.x1 > b.aabb[2] + 1e-3 || s.z0 < b.aabb[1] - 1e-3 || s.z1 > b.aabb[3] + 1e-3) out.push(L.id + " " + s.id + " stair leaves the footprint");
      if (s.slopeDeg > 45 || Math.abs(Math.atan(s.rise / s.run) * 180 / Math.PI - s.slopeDeg) > 0.02) out.push(L.id + " " + s.id + " slope " + s.slopeDeg);
      const a = byRoom.get(s.approach), e = byRoom.get(s.exit);
      if (!a || !e || a.floor !== s.from || e.floor !== s.to) out.push(L.id + " " + s.id + " approach/exit rooms invalid");
    }
    // every room reachable from the front door (interior doors + stairs)
    const front = doors.find((d) => d.kind === "front");
    if (!front) continue;
    const adj = new Map(rooms.map((r) => [r.id, []]));
    for (const d of doors) if (d.kind === "interior") { adj.get(d.rooms[0]).push(d.rooms[1]); adj.get(d.rooms[1]).push(d.rooms[0]); }
    for (const s of stairs) { adj.get(s.approach).push(s.exit); adj.get(s.exit).push(s.approach); }
    const seen = new Set([front.rooms[0]]), st = [front.rooms[0]];
    while (st.length) { const c = st.pop(); for (const n of adj.get(c)) if (!seen.has(n)) { seen.add(n); st.push(n); } }
    if (seen.size !== rooms.length) out.push(L.id + " " + p.id + " only " + seen.size + "/" + rooms.length + " rooms reachable from the front door");
    void byDoor;
  }
  return out;
}
function checkPads(TG, L) {
  const out = [];
  const fin = (v) => Number.isFinite(v);
  const bld = new Map(L.parcels.filter((p) => p.building).map((p) => [p.id, p.building]));
  if (L.pads.length !== bld.size) out.push(L.id + " " + L.pads.length + " pads for " + bld.size + " buildings");
  for (const p of L.pads) {
    const sh = p.shape, b = bld.get(p.id);
    if (!sh || ![sh.x0, sh.x1, sh.z0, sh.z1, p.height, p.falloff].every(fin) || !(sh.x0 < sh.x1 && sh.z0 < sh.z1)) { out.push(L.id + " pad " + p.id + " is not a finite rectangle"); continue; }
    if (p.falloff < 3 || p.falloff > 6.5) out.push(L.id + " pad " + p.id + " falloff " + p.falloff + " outside the C-PAD working range 3-6.5");
    if (!b || sh.x0 > b.aabb[0] + 1e-3 || sh.x1 < b.aabb[2] - 1e-3 || sh.z0 > b.aabb[1] + 1e-3 || sh.z1 < b.aabb[3] - 1e-3) out.push(L.id + " pad " + p.id + " does not cover its building");
  }
  if (L.roads) {
    if (L.corridors.length !== L.roads.streets.length) out.push(L.id + " " + L.corridors.length + " corridors for " + L.roads.streets.length + " streets");
    for (const c of L.corridors) {
      const a = c.points[0], b = c.points[c.points.length - 1];
      if (c.points.length < 2 || c.width !== 10 || (Math.abs(a[0] - b[0]) > EPS && Math.abs(a[1] - b[1]) > EPS) || !c.points.every((q) => fin(q[0]) && fin(q[1]))) out.push(L.id + " corridor is not a straight 10 m polyline");
    }
  }
  return out;
}
function checkLinks(TG, M) {
  const out = [];
  const ids = new Set(M.towns.map((t) => t.id));
  for (const k of M.links) {
    if (k.blocked !== 0) out.push("link " + k.a + "->" + k.b + " crosses " + k.blocked + " block(s)");
    if (!ids.has(k.a) || !ids.has(k.b) || !(k.len > 0)) out.push("link " + k.a + "->" + k.b + " malformed");
    const A = M.towns.find((t) => t.id === k.a), B = M.towns.find((t) => t.id === k.b);
    const onEnd = (T, x, z) => (T.blocks.length ? T.roads.portals.some((p) => Math.abs(T.roads.nodes[p.node].x - x) < 1e-3 && Math.abs(T.roads.nodes[p.node].z - z) < 1e-3) : T.compound && Math.abs(T.compound.entry.x - x) < 1e-3 && Math.abs(T.compound.entry.z - z) < 1e-3);
    if (!onEnd(A, k.ax, k.az) || !onEnd(B, k.bx, k.bz)) out.push("link " + k.a + "->" + k.b + " does not leave by an edge node / the yard entry");
  }
  return out;
}
function checkCompounds(TG, M) {
  const out = [];
  const townRects = [];
  for (const T of M.towns) { for (const b of T.blocks) { townRects.push([b.cx - 28, b.cz - 28, b.cx + 28, b.cz + 28]); for (const p of []) void p; } for (const p of T.parcels) townRects.push(p.rect); }
  for (const C of M.compounds) {
    let min = Infinity;
    for (const r of townRects) min = Math.min(min, rectDist(C.poi.x, C.poi.z, r));
    if (min < 60 - 1e-6) out.push(C.id + " compound centre " + min.toFixed(1) + " m from a town (< 60)");
    if (Math.max(Math.abs(C.poi.x), Math.abs(C.poi.z)) > 720 + 1e-6) out.push(C.id + " compound outside +-720 m");
  }
  return out;
}

// street props (Wave 7): each entry is a known manifest type, a quarter turn, clear of every building, off the road (cars: inside the curb lane and clear of every
// junction), not on top of another prop; and the whole list is a pure function of (seed, layout)
function checkStreetProps(TG, CK, man, L, props) {
  const out = [], ROAD_HALF = TG.ROAD_W / 2;
  const roadRects = [], nodeSq = [];
  for (const e of L.roads.edges) {
    const A = L.roads.nodes[e.a], B = L.roads.nodes[e.b];
    roadRects.push([Math.min(A.x, B.x) - (e.axis === "x" ? 0 : ROAD_HALF), Math.min(A.z, B.z) - (e.axis === "z" ? 0 : ROAD_HALF), Math.max(A.x, B.x) + (e.axis === "x" ? 0 : ROAD_HALF), Math.max(A.z, B.z) + (e.axis === "z" ? 0 : ROAD_HALF)]);
  }
  for (const n of L.roads.nodes) nodeSq.push([n.x - ROAD_HALF, n.z - ROAD_HALF, n.x + ROAD_HALF, n.z + ROAD_HALF]);
  const blds = L.parcels.filter((p) => p.building).map((p) => p.building.aabb);
  const fps = [];
  for (const q of props) {
    if (!man.types[q.type] || !CK.hasType(q.type)) { out.push(L.id + " unknown kit type " + q.type); continue; }
    if (![0, 1, 2, 3].includes(q.rot)) { out.push(L.id + " " + q.type + " rot " + q.rot + " is not a quarter turn"); continue; }
    const fp = CK.footprintFor(q.type, q.x, q.z, q.rot), box = [fp.minX, fp.minZ, fp.maxX, fp.maxZ];
    fps.push([box, q]);
    for (const b of blds) if (overlapArea(box, b) > 0) { out.push(L.id + " " + q.type + " at " + q.x + "," + q.z + " stands inside a building"); break; }
    if (q.kind === "car") {
      for (const n of nodeSq) if (overlapArea(box, n) > 0) { out.push(L.id + " car at " + q.x + "," + q.z + " is in a junction"); break; }
      if (!roadRects.some((r) => box[0] >= r[0] - 1e-3 && box[2] <= r[2] + 1e-3 && box[1] >= r[1] - 1e-3 && box[3] <= r[3] + 1e-3) && !L.parcels.some((p) => p.use === "lot" && box[0] >= p.rect[0] && box[2] <= p.rect[2] && box[1] >= p.rect[1] && box[3] <= p.rect[3])) out.push(L.id + " car at " + q.x + "," + q.z + " is neither in a street nor in a lot");
    } else if (q.kind === "light" || q.kind === "hydrant" || q.kind === "bench") {
      for (const r of roadRects) if (overlapArea(box, r) > 0.02) { out.push(L.id + " " + q.kind + " at " + q.x + "," + q.z + " stands on the road"); break; }
    }
  }
  for (let i = 0; i < fps.length; i++) for (let j = i + 1; j < fps.length; j++) if (overlapArea(fps[i][0], fps[j][0]) > 0.0004) { out.push(L.id + " " + fps[i][1].type + " overlaps " + fps[j][1].type + " at " + fps[i][1].x + "," + fps[i][1].z); break; }
  return out;
}

// ── main ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
function realChild() {
  return new Promise((resolve) => {
    const child = cp.spawn(process.execPath, [__filename, "--real"], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    child.on("close", (code) => resolve({ code, out, err }));
    child.on("error", (e) => resolve({ code: -1, out, err: String(e) }));
  });
}
async function realMode() {
  // runs in a child: the REAL maps.js buildMap (world_env.mjs, the way placement_census / world_node build it) for seed 7 of each map
  const env = await import(pathToFileURL(path.join(ROOT, "_harness", "world_env.mjs")).href);
  const E = await env.makeEnv({ root: ROOT });
  const { buildMap } = await E.importMaps();
  const res = {};
  const rnd = (() => { let a = 12345; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
  for (const map of MAPS) {
    globalThis.__LC_BOXES = null;
    const M = await buildMap(E.makeW(7), map);
    const pts = [];
    // Savanna (Wave 7) builds its towns as plateaus (every block one pad, a compound's yard one pad, the falloff up to 12 m beyond): the ground there is the
    // plateau's, on purpose, not the analytic function the selftest slices. Points inside a town / compound footprint (+ 18 m) are left out of the sample.
    const foot = M.city ? M.city.layout.towns.flatMap((T) => T.blocks.map((b) => [b.cx - 51, b.cz - 51, b.cx + 51, b.cz + 51])).concat(M.city.layout.compounds.concat(M.city.layout.towns.filter((T) => !T.blocks.length && T.compound)).map((T) => [T.compound.bounds[0] - 18, T.compound.bounds[1] - 18, T.compound.bounds[2] + 18, T.compound.bounds[3] + 18])) : [];
    while (pts.length < 400) { const x = (rnd() * 2 - 1) * 780, z = (rnd() * 2 - 1) * 780; if (foot.some((r) => x > r[0] && x < r[2] && z > r[1] && z < r[3])) continue; pts.push([x, z, M.heightAt(x, z), M.groundAt(x, z)]); }
    res[map] = { waterY: M.waterY, pois: M.pois.map((p) => [p.id, p.x, p.z, p.r]), pts };
  }
  process.stdout.write("REAL_JSON " + JSON.stringify(res) + "\n");
  process.exit(0);
}
async function hashMode() {
  // fresh-process half of the determinism row: layoutMap for the listed (map, seed) pairs -> FNV of the JSON
  const TG = await import(pathToFileURL(TG_JS).href);
  const mk = loadMkHeightFn();
  const lines = [];
  for (const spec of process.argv.slice(3)) {
    const [map, seedS] = spec.split(":");
    const seed = Number(seedS), wy = waterOf(map), h = mk(map, seed);
    let pois = TG.defaultPois(map);
    if (map === "isla_viva") snapIsla(pois, h, wy);
    const s = JSON.stringify(TG.layoutMap(seed, map, pois, h, wy));
    lines.push(spec + " " + s.length + " " + fnv(s));
  }
  process.stdout.write("HASHES " + lines.join(" ; ") + "\n");
  process.exit(0);
}

async function main() {
  const TG = await import(pathToFileURL(TG_JS).href);
  const mk = loadMkHeightFn();
  const realPromise = realChild();                                      // the real-map build runs beside the sweep
  const hashSpecs = [];
  for (const m of MAPS) for (const sd of [7, 1234, 31337]) hashSpecs.push(m + ":" + sd);
  const hashPromise = new Promise((resolve) => {                         // ... and so does the fresh-process half of the determinism row
    const child = cp.spawn(process.execPath, [__filename, "--hash", ...hashSpecs], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    child.on("close", (code) => resolve({ code, out, err }));
    child.on("error", (e) => resolve({ code: -1, out, err: String(e) }));
  });
  console.log("towngen.selftest: seeds " + SEEDS + ", maps " + MAPS.join(","));

  // ── 1. rng + tables ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  console.log("\n[1] rng, hash, tables");
  {
    const sim = (() => { const m = require(path.join(ROOT, "runtime", "sim", "royale.js")); return m && m.mulberry32 ? m : (globalThis.FFG && globalThis.FFG.sim && globalThis.FFG.sim.Royale); })();
    let same = !!(sim && sim.mulberry32);
    if (same) for (const s of [0, 1, 7, 1234, 31337, 2026, 0xdeadbeef, 2147483653, 4294967295]) { const a = sim.mulberry32(s), b = TG.mulberry32(s); for (let i = 0; i < 64; i++) if (a() !== b()) same = false; }
    ok(same, "mulberry32 (local, no imports) draws exactly what the sim's mulberry32 draws, 9 seeds x 64");
    ok(TG.hash32("") === 0x811c9dc5 && TG.hash32("a") === 0xe40c292c, "hash32 is FNV-1a 32 (known vectors)");
    const a = TG.subRng(7, "downtown"), b = TG.mulberry32((7 ^ TG.hash32("downtown")) >>> 0);
    ok(a() === b() && a() === b(), "layout stream = mulberry32(seed ^ hash32(poi.id))");
    const man = JSON.parse(fs.readFileSync(path.join(ROOT, "assets", "props", "city", "manifest.json"), "utf8"));
    const drift = [];
    for (const grp of Object.values(TG.SHELL_KITS)) for (const k of grp) { const t = man.types[k[0]]; if (!t || Math.abs(t.bbox_m.x - k[1]) > 1e-6 || Math.abs(t.bbox_m.z - k[2]) > 1e-6 || Math.abs(t.bbox_m.y - k[3]) > 1e-6) drift.push(k[0]); }
    ok(drift.length === 0, "shell kit sizes equal assets/props/city/manifest.json bbox_m (" + Object.values(TG.SHELL_KITS).reduce((a2, g) => a2 + g.length, 0) + " types)", drift.join(","));
    const palKeys = Object.keys(man.palettes), badPal = [];
    for (const th of Object.values(TG.THEMES)) for (const e of [th.house, th.big]) { if (!palKeys.includes(e[0])) badPal.push(e[0]); for (const v of e[1]) if (v && !(man.palettes[e[0]].variants || {})[v]) badPal.push(e[0] + ":" + v); }
    ok(badPal.length === 0, "every theme palette key / variant exists in the manifest", badPal.join(","));
    const bad = [];
    for (const [mid, plan] of Object.entries(TG.PLANS)) for (const id of Object.keys(plan.pois)) if (!TG.defaultPois(mid).some((p) => p.id === id)) bad.push(mid + ":" + id);
    for (const mid of MAPS) for (const p of TG.defaultPois(mid)) if (!TG.PLANS[mid].pois[p.id]) bad.push("unplanned " + mid + ":" + p.id);
    ok(bad.length === 0, "PLANS cover exactly the " + MAPS.reduce((a2, m) => a2 + TG.defaultPois(m).length, 0) + " POIs of the three maps", bad.join(","));
    info("height function: " + HEIGHT_SOURCE);
  }

  // ── 2. the sweep ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  console.log("\n[2] sweep: " + SEEDS + " seeds x 3 maps x every POI + compounds");
  const tSweep = Date.now();
  const fails = {};
  const addFail = (key, list) => { if (list.length) { (fails[key] = fails[key] || []).push(...list); } };
  const poiStats = {}, shifts = {}, msTown = [], msCompound = [], msMap = {};
  const roadAgg = { n: 0, low0: 0, low8: 0, min: Infinity, edges: 0 };
  const agg = { towns: 0, compounds: 0, buildings: 0, enterable: 0, shells: 0, rooms: 0, doors: 0, stairs: 0, blocks: 0, parcels: 0, quarterTurned: 0, doorsReach: 0, enterableTown: 0, lanes: 0, bridges: 0, hardStage: 0, fallbackLane: 0, jogged: 0, millBridges: 0, relief: [], reliefLevel: [0, 0, 0] };
  const keep = {};                                                     // one layoutMap per map kept for the coverage / plots
  const denseEvery = 4;
  for (const map of MAPS) {
    const wy = waterOf(map);
    msMap[map] = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const h = mk(map, seed);
      let pois = TG.defaultPois(map);
      if (map === "isla_viva") snapIsla(pois, h, wy);
      const t0 = process.hrtime.bigint();
      const M = TG.layoutMap(seed, map, pois, h, wy);
      msMap[map] += Number(process.hrtime.bigint() - t0) / 1e6;
      if (seed === 7) keep[map] = { M, h, wy };
      const all = M.towns.concat(M.compounds);
      const index = new BoxIndex(64), blocks = [];
      for (const L of all) { for (const p of L.parcels) if (p.building) index.add(p.building.aabb, L.id + "/" + p.id); for (const b of L.blocks) blocks.push(b); }
      const dense = seed % denseEvery === 0;
      for (const L of all) {
        const tag = map + "#" + seed;
        const f = (arr) => arr.map((s) => tag + " " + s);
        if (wy > -100) addFail("blocks dry", f(checkBlocksDry(TG, L, h, wy, dense)));                 // Savanna has no water: the row is vacuous there
        addFail("quarter turns", f(checkQuarter(TG, L)));
        addFail("every parcel touches a street", f(checkStreets(TG, L)));
        addFail("road graph connected / clear of blocks / no street > 150 m", f(checkRoads(TG, L, blocks, h, wy)));
        addFail("enterable share / shells / floors", f(checkShares(TG, L)));
        addFail("front door reachable from a street node", f(checkDoors(TG, L, index, h)));
        addFail("rooms / doors / stairs consistent", f(checkInterior(TG, L)));
        addFail("pads and corridors are valid C-PAD arguments", f(checkPads(TG, L)));
        if (wy > -100 && L.roads && L.roads.edges.length) {
          const rv = roadVertices(L, h, wy, 0);
          const rv8 = roadVertices(L, h, wy, TG.WET_MARGIN);
          roadAgg.n += rv.n; roadAgg.low0 += rv.low; roadAgg.low8 += rv8.low; roadAgg.min = Math.min(roadAgg.min, rv.min - wy); roadAgg.edges += L.roads.edges.length;
          if (rv.low) addFail("0 road vertices below waterY", [tag + " " + L.id + " " + rv.low + " road vertices below waterY"]);
        }
        const s = L.stats;
        agg.buildings += s.buildings; agg.enterable += s.enterable; agg.shells += s.shells; agg.rooms += s.rooms; agg.doors += s.doors; agg.stairs += s.stairs; agg.blocks += s.blocks; agg.parcels += s.parcels;
        for (const p of L.parcels) if (p.building) agg.quarterTurned++;
        if (L.kind === "compound") agg.compounds++; else agg.towns++;
        if (L.stage && L.stage.hard) agg.hardStage++;
        if (L.stage && L.stage.fallback) agg.fallbackLane++;
        if (L.grid && (L.grid.cols >= 3 || L.grid.rows >= 3)) agg.jogged++;
        if (L.bridges) agg.bridges += L.bridges.length;
        for (const b of L.blocks) agg.relief.push(b.ground.relief);
        if (L.anchor && L.anchor.level != null && L.blocks.length) agg.reliefLevel[Math.min(2, L.anchor.level)]++;
        if (L.kind !== "compound") {
          (poiStats[map + ":" + L.id] = poiStats[map + ":" + L.id] || []).push(s.enterable);
          const sh = L.anchor && L.anchor.shift ? Math.abs(L.anchor.shift[0]) + Math.abs(L.anchor.shift[1]) : 0;
          const dist = Math.hypot((L.centre ? L.centre[0] : L.poi.x) - L.poi.x, (L.centre ? L.centre[1] : L.poi.z) - L.poi.z);
          (shifts[map + ":" + L.id] = shifts[map + ":" + L.id] || []).push(dist);
        }
      }
      addFail("no overlapping parcels / buildings", checkOverlap(all).map((s) => map + "#" + seed + " " + s));
      addFail("compounds >= 60 m from every town", checkCompounds(TG, M).map((s) => map + "#" + seed + " " + s));
      addFail("links leave by an edge node and never cross a block", checkLinks(TG, M).map((s) => map + "#" + seed + " " + s));
      if (map === "deepwood") { const mill = M.towns.find((t) => t.id === "mill"); if (mill.bridges.length) agg.millBridges++; }
      // town parcels enterable counts for the share row
      for (const L of M.towns) agg.enterableTown += L.stats.enterable;
    }
  }
  const sweepMs = Date.now() - tSweep;
  info("sweep wall " + sweepMs + " ms; layoutMap ms per map-seed: " + MAPS.map((m) => m + " " + (msMap[m] / SEEDS).toFixed(1)).join(", "));

  const ROWS = ["blocks dry", "quarter turns", "no overlapping parcels / buildings", "every parcel touches a street", "road graph connected / clear of blocks / no street > 150 m",
    "0 road vertices below waterY", "front door reachable from a street node", "enterable share / shells / floors", "compounds >= 60 m from every town", "rooms / doors / stairs consistent",
    "pads and corridors are valid C-PAD arguments", "links leave by an edge node and never cross a block"];
  for (const r of ROWS) {
    const f = fails[r] || [];
    ok(f.length === 0, r + " (" + SEEDS + " seeds x " + ((r === "blocks dry" || r === "0 road vertices below waterY") ? "the 2 water maps" : "3 maps") + ")", f.length ? f.length + " failures, first: " + f.slice(0, 3).join(" | ") : "");
  }
  info("road vertices checked " + roadAgg.n + " over " + roadAgg.edges + " edges; below waterY: " + roadAgg.low0 + "; below waterY+0.8: " + roadAgg.low8 + "; lowest margin " + fix(roadAgg.min, 2) + " m");
  info("totals: " + agg.towns + " town layouts + " + agg.compounds + " compounds, " + agg.blocks + " blocks, " + agg.parcels + " parcels, " + agg.buildings + " buildings (" + agg.enterable + " enterable, " + agg.shells + " shells = " + fix(100 * agg.shells / Math.max(1, agg.buildings), 1) + "%), " + agg.rooms + " rooms, " + agg.doors + " doors, " + agg.stairs + " stairs, " + agg.bridges + " bridges");
  ok(agg.millBridges >= Math.floor(SEEDS * 0.95), "Riverside Mill straddles its river with a bridge on " + agg.millBridges + " of " + SEEDS + " seeds (O4: a mill-and-bridge compound across the Deepwood river)");
  ok(agg.quarterTurned === agg.buildings && agg.buildings > 0, "every building (" + agg.buildings + ") is quarter-turned");
  info("block relief over 56 m cells: p50 " + fix(pct(agg.relief, 0.5), 2) + " m, p90 " + fix(pct(agg.relief, 0.9), 2) + " m, max " + fix(Math.max(...agg.relief), 2) + " m; relief ladder level 0/1/2: " + agg.reliefLevel.join("/"));
  info("towns on the hard stage (moved up to 260 m): " + agg.hardStage + "; last-resort lane villages: " + agg.fallbackLane);

  // per-POI table: every named town >= 6 enterable over all seeds
  console.log("\n[3] every named town >= 6 enterable buildings over " + SEEDS + " seeds");
  const poiFail = [];
  for (const key of Object.keys(poiStats)) {
    const a = poiStats[key], lo = Math.min(...a), n6 = a.filter((v) => v < 6).length, sh = shifts[key];
    console.log("      " + key.padEnd(24) + " enterable min " + String(lo).padStart(2) + "  p5 " + String(pct(a, 0.05)).padStart(2) + "  median " + String(pct(a, 0.5)).padStart(2) + "  max " + String(Math.max(...a)).padStart(3) + "  seeds < 6: " + String(n6).padStart(3) + "   centre moved from the POI: median " + fix(pct(sh, 0.5), 0) + " m, p90 " + fix(pct(sh, 0.9), 0) + " m, max " + fix(Math.max(...sh), 0) + " m");
    if (n6) poiFail.push(key + " " + n6 + "/" + SEEDS);
  }
  ok(poiFail.length === 0, "every named town has >= 6 enterable buildings on all " + SEEDS + " seeds", poiFail.join("; "));

  // ── 3b. street props + the reserve option (Wave 7, lane 7A) ───────────────────────────────────────────────────────────────────────────
  console.log("\n[3b] street props (streetProps) and layoutMap's reserve rectangles");
  const CKmod = await import(pathToFileURL(path.join(__dirname, "citykit.js")).href);
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "assets", "props", "city", "manifest.json"), "utf8"));
  {
    const PS = Math.min(SEEDS, 80), bad = [];
    let nProps = 0, nTowns = 0, nondet = 0;
    const kinds = {};
    for (let seed = 1; seed <= PS; seed++) {
      const h = mk("ashgrid", seed), M = TG.layoutMap(seed, "ashgrid", TG.defaultPois("ashgrid"), h, -999);
      for (const L of M.towns) {
        if (!L.blocks.length) continue;
        const a = TG.streetProps(L, seed);
        if (JSON.stringify(a) !== JSON.stringify(TG.streetProps(L, seed))) nondet++;
        bad.push(...checkStreetProps(TG, CKmod, manifest, L, a).map((e) => "ashgrid#" + seed + " " + e));
        nProps += a.length; nTowns++;
        for (const q of a) kinds[q.kind] = (kinds[q.kind] || 0) + 1;
      }
    }
    ok(bad.length === 0, "every street prop is a manifest type, a quarter turn, clear of buildings and junctions, off the road (cars in the lane), clear of its neighbours (" + PS + " seeds, " + nTowns + " grid towns, " + nProps + " props)", bad.length + " failures, first: " + bad.slice(0, 3).join(" | "));
    ok(nondet === 0, "streetProps is a pure function of (seed, layout): two calls give the same list");
    info("props by kind over " + PS + " seeds: " + Object.keys(kinds).sort().map((k) => k + " " + kinds[k]).join(", ") + "; per town " + fix(nProps / Math.max(1, nTowns), 0));
    const usedTypes = new Set(TG.STREET_TYPES.concat(TG.KIT_CARS.map((c) => c[0])));
    for (const grp of Object.values(TG.SHELL_KITS)) for (const k of grp) usedTypes.add(k[0]);
    const missing = [...usedTypes].filter((t) => !manifest.types[t] || !CKmod.hasType(t));
    ok(missing.length === 0, "every type towngen can ask citykit for (" + usedTypes.size + ") is in the manifest and in citykit's collider table", missing.join(","));
    // downtown in the core density bar: at least 24 lights and 12 cars on every seed (a core with no dressing reads as a plan, not a place)
    let thin = 0;
    for (let seed = 1; seed <= PS; seed++) { const M = TG.layoutMap(seed, "ashgrid", TG.defaultPois("ashgrid"), mk("ashgrid", seed), -999), d = M.towns.find((t) => t.id === "downtown"), a = TG.streetProps(d, seed); if (a.filter((q) => q.kind === "light").length < 24 || a.filter((q) => q.kind === "car").length < 8) thin++; }
    ok(thin === 0, "Downtown Core carries >= 24 street lights and >= 8 parked cars on every one of " + PS + " seeds", thin + " thin seeds");
  }
  {
    // layoutMap({ reserve }): the landmark rectangles the caller keeps (Savanna's overpass strip and crane) are never built over
    const R = [[324, 72, 538, 88], [-386, -450, -370, -406]], bad = [];
    for (let seed = 1; seed <= 40; seed++) {
      const M = TG.layoutMap(seed, "ashgrid", TG.defaultPois("ashgrid"), mk("ashgrid", seed), -999, { reserve: R });
      for (const L of M.towns.concat(M.compounds)) {
        for (const b of L.blocks) for (const r of R) if (overlapArea([b.cx - 28, b.cz - 28, b.cx + 28, b.cz + 28], r) > 0) bad.push("ashgrid#" + seed + " " + L.id + " block ring on a reserved rectangle");
        for (const p of L.parcels) if (p.building) for (const r of R) if (overlapArea(p.building.aabb, r) > 0) bad.push("ashgrid#" + seed + " " + L.id + "/" + p.id + " building on a reserved rectangle");
        if (L.kind === "compound") for (const r of R) if (rectDist(L.compound.entry.x, L.compound.entry.z, r) < 59.9) bad.push("ashgrid#" + seed + " " + L.id + " compound within 60 m of a reserved rectangle");
      }
    }
    ok(bad.length === 0, "layoutMap({ reserve }) never builds a block, a building or a compound on / within 60 m of a reserved rectangle (40 seeds, 2 rectangles)", bad.length + " failures, first: " + bad.slice(0, 3).join(" | "));
    const free = TG.layoutMap(7, "ashgrid", TG.defaultPois("ashgrid"), mk("ashgrid", 7), -999), held = TG.layoutMap(7, "ashgrid", TG.defaultPois("ashgrid"), mk("ashgrid", 7), -999, { reserve: R });
    const same = TG.layoutMap(7, "ashgrid", TG.defaultPois("ashgrid"), mk("ashgrid", 7), -999, { reserve: [] });
    ok(JSON.stringify(free) === JSON.stringify(same), "an empty reserve changes nothing (the Wave-6 layout is byte-identical without one)");
    info("seed 7: " + free.stats.enterable + " enterable buildings free, " + held.stats.enterable + " with the two reserved rectangles");
  }

  // ── 3c. the city polish (Wave 7, lane 7A2): density, skyline, compounds, car paints, kit colormaps, a NaN ground ────────────────────────────
  console.log("\n[3c] Savanna city polish: block density, skyline, compound kinds, car paints, shell colormaps, a non-finite ground");
  const polish = {};
  {
    const PS = Math.min(SEEDS, 60);
    const share = (L) => { const per = new Map(); for (const p of L.parcels) if (p.building) { const a = p.building.aabb; per.set(p.block, (per.get(p.block) || 0) + (a[2] - a[0]) * (a[3] - a[1])); } return L.blocks.map((b) => (per.get(b.id) || 0) / ((b.x1 - b.x0) * (b.z1 - b.z0))); };
    const lmBad = [], lmCore = [], lmTown = [], sky60 = [], syBad = [], lmKinds = {};
    const townWho = [], coreShare = [], townShare = [], coreBlocks = [], skyN = [], skyMax = [], variantsPerTown = [], cmpKinds = {}, cmpProps = {};
    const badCmp = [], tintBad = [], tintSeen = new Set(), nonCity = { tint: 0, towns: 0 };
    let nTint = 0, nCars = 0, nonTintable = 0;
    for (let seed = 1; seed <= PS; seed++) {
      const h = mk("ashgrid", seed), M = TG.layoutMap(seed, "ashgrid", TG.defaultPois("ashgrid"), h, -999);
      for (const L of M.towns) {
        if (!L.blocks.length) continue;
        const s = share(L);
        { // Wave 7 completion: landmark lots (gas / market / plaza / court) and the stretched skyline
          const lm = L.parcels.filter((p) => p.use === "lot" && TG.LANDMARK_LOTS.indexOf(p.lot) >= 0);
          for (const p of lm) { lmKinds[p.lot] = (lmKinds[p.lot] || 0) + 1; }
          for (const p of L.parcels) if (p.use === "lot" && TG.LANDMARK_LOTS.indexOf(p.lot) < 0 && ["parking", "park", "yard"].indexOf(p.lot) < 0) lmBad.push("ashgrid#" + seed + " " + L.id + " lot kind " + p.lot);
          for (const p of L.parcels) if (p.building && p.building.sy !== undefined) { const kit = p.building.kit, R = (TG.STRETCH_RANGES || {})[kit]; if (!R || p.building.sy < R[0] - 1e-9 || p.building.sy > R[1] + 1e-9 || Math.abs(p.building.height - Math.round(TG.SHELL_KITS.skyline.concat(TG.SHELL_KITS.mid).find((k) => k[0] === kit)[3] * p.building.sy * 100) / 100) > 0.011) syBad.push("ashgrid#" + seed + " " + L.id + " " + kit + " sy " + p.building.sy + " height " + p.building.height); }
          if (L.kind === "core") { lmCore.push(lm.length); sky60.push(L.parcels.filter((p) => p.building && p.building.gen === "shell" && p.building.height >= 60).length); }
          else if (L.kind === "town") lmTown.push(lm.length);
        }
        if (L.kind === "core") { coreShare.push(pct(s, 0.5)); coreBlocks.push(L.blocks.length); skyN.push(L.parcels.filter((p) => p.building && p.building.gen === "shell" && p.building.height >= 30).length); skyMax.push(Math.max(...L.parcels.filter((p) => p.building).map((p) => p.building.height))); }
        else if (L.kind === "town") { townShare.push(pct(s, 0.5)); townWho.push(L.id + "#" + seed); if (process.env.TG_DEBUG && pct(s, 0.5) < 0.34) info("low-density town " + L.id + "#" + seed + ": block shares " + s.map((v) => v.toFixed(2)).join(" ") + " | parcels " + L.blocks.map((b) => L.parcels.filter((p) => p.block === b.id).map((p) => (p.building ? p.arch || p.use : "LOT:" + p.lot) + ":" + Math.round((p.rect[2] - p.rect[0]) * (p.rect[3] - p.rect[1]))).join(",")).join(" / ")); }
        const vs = new Set(L.parcels.filter((p) => p.building && p.building.gen === "shell").map((p) => p.building.palette.variant || "base"));
        variantsPerTown.push(vs.size);
        for (const e of TG.streetProps(L, seed)) {
          if (e.kind !== "car") { if (e.tint !== undefined) tintBad.push("ashgrid#" + seed + " " + L.id + " a " + e.kind + " carries a tint"); continue; }
          nCars++;
          if ((TG.TINTABLE_CARS || []).indexOf(e.type) < 0) { nonTintable++; if (e.tint !== undefined) tintBad.push("ashgrid#" + seed + " " + L.id + " " + e.type + " carries a tint"); }
          else if (e.tint === undefined || !(TG.CAR_TINTS || []).some((q) => q[0] === e.tint)) tintBad.push("ashgrid#" + seed + " " + L.id + " " + e.type + " tint " + e.tint + " is not a CAR_TINTS colour");
          else { nTint++; tintSeen.add(e.tint); }
        }
      }
      for (const C of M.compounds) {
        const v = C.compound.variant;
        cmpKinds[v] = (cmpKinds[v] || 0) + 1;
        for (const q of C.compound.props) cmpProps[q.kind] = (cmpProps[q.kind] || 0) + 1;
        const nb = C.parcels.length;
        if (v === "farmstead" && nb >= 3 && !C.parcels.some((p) => p.building.arch === "barn")) badCmp.push("ashgrid#" + seed + " " + C.id + " farmstead without a barn");
        if (v === "farmstead" && C.parcels.some((p) => p.building.arch === "barn") && !C.compound.props.some((q) => q.kind === "silo")) badCmp.push("ashgrid#" + seed + " " + C.id + " farmstead with a barn but no silo");
        if (v === "depot" && C.compound.props.filter((q) => q.kind === "container").length !== 3) badCmp.push("ashgrid#" + seed + " " + C.id + " depot without its 3 containers");
        if (v === "tower") {
          const t = C.compound.props.find((q) => q.kind === "watertower"), bd = C.compound.bounds;
          if (!t) badCmp.push("ashgrid#" + seed + " " + C.id + " 'tower' compound without a water tower");
          else {
            if (!(t.x > bd[0] && t.x < bd[2] && t.z > bd[1] && t.z < bd[3])) badCmp.push("ashgrid#" + seed + " " + C.id + " water tower outside the compound bounds");
            for (const p of C.parcels) if (overlapArea([t.x - 4.6, t.z - 4.6, t.x + 4.6, t.z + 4.6], p.building.aabb) > 0) badCmp.push("ashgrid#" + seed + " " + C.id + " water tower on a building");
            for (const car of C.compound.cars) if (Math.hypot(car.x - t.x, car.z - t.z) < 5) badCmp.push("ashgrid#" + seed + " " + C.id + " a car under the water tower");
          }
        }
      }
    }
    // another theme gets no paints and no polish dressing (its street props are the stage-A output)
    for (let seed = 1; seed <= 10; seed++) {
      const h = mk("deepwood", seed), M = TG.layoutMap(seed, "deepwood", TG.defaultPois("deepwood"), h, waterOf("deepwood"));
      for (const L of M.towns) if (L.blocks.length) { nonCity.towns++; for (const e of TG.streetProps(L, seed)) { if (e.tint !== undefined || /light-square|trashcan|construction-barrier|shipping-container/.test(e.type)) nonCity.tint++; } }
    }
    polish.coreShare = pct(coreShare, 0.5); polish.townShare = pct(townShare, 0.5);
    ok(coreBlocks.every((n) => n === 16), "Downtown Core is a 4 x 4 block grid on every one of " + PS + " seeds", "block counts " + [...new Set(coreBlocks)].join("/"));
    ok(Math.min(...coreShare) >= 0.40, "the core's built footprint covers >= 40 % of a block (median block, every seed; stage A: 0.25-0.30)", "worst seed " + fix(Math.min(...coreShare), 3) + ", median " + fix(polish.coreShare, 3));
    ok(Math.min(...townShare) >= 0.33, "a town's built footprint covers >= 33 % of a block (median block of every town of every seed; stage A: 0.20-0.28)", "worst " + fix(Math.min(...townShare), 3) + " (" + townWho[townShare.indexOf(Math.min(...townShare))] + "), median " + fix(polish.townShare, 3));
    ok(Math.min(...lmCore) >= 2 && pct(lmCore, 0.5) >= 3, "Downtown holds >= 2 landmark lots (gas / market / plaza / court) on every one of " + PS + " seeds and >= 3 at the median (a lot too small for its landmark is a yard in maps.js)", "worst " + Math.min(...lmCore) + ", median " + pct(lmCore, 0.5) + ", kinds " + Object.keys(lmKinds).sort().map((k) => k + " " + lmKinds[k]).join(", "));
    ok(lmBad.length === 0, "every lot of a city town is a parking lot, a pocket park, a yard or a landmark lot (no unknown kind)", lmBad.slice(0, 3).join(" | "));
    ok(sky60.filter((n) => n >= 3).length >= Math.floor(PS * 0.9) && Math.max(...skyMax) >= 80, "the skyline is stretched: >= 3 kit towers of 60 m or more on 90 % of seeds, the tallest >= 80 m (the kit was modelled to 54 m)", "seeds with >= 3: " + sky60.filter((n) => n >= 3).length + " of " + PS + ", median count " + pct(sky60, 0.5) + ", tallest " + fix(Math.max(...skyMax), 1) + " m");
    ok(syBad.length === 0, "every stretched shell carries a factor inside its type's STRETCH range and a height of kit height x factor", syBad.length + ", first: " + syBad.slice(0, 2).join(" | "));
    ok(Math.min(...skyN) >= 6, "the downtown skyline holds >= 6 kit towers of 30 m or more on every seed (stage A: 4-5, in a 3 x 3 core)", "worst " + Math.min(...skyN) + ", median " + pct(skyN, 0.5) + ", tallest " + fix(Math.max(...skyMax), 1) + " m");
    ok(Math.max(...variantsPerTown) <= 2, "a town's kit shells wear at most two colormaps (every (type, colormap) pair is a draw call per district)", "worst " + Math.max(...variantsPerTown));
    ok(["homestead", "farmstead", "depot", "hamlet", "tower"].every((k) => (cmpKinds[k] || 0) >= 20), "all five compound kinds occur (" + Object.keys(cmpKinds).sort().map((k) => k + " " + cmpKinds[k]).join(", ") + " over " + PS + " seeds)");
    ok(badCmp.length === 0, "compound props are where they belong: a farmstead's silo, a depot's three containers, a water tower inside its yard and clear of cars and walls", badCmp.length + " failures, first: " + badCmp.slice(0, 3).join(" | "));
    ok(tintBad.length === 0 && nTint > 0 && nonTintable > 0, "car paints: every tintable car carries one CAR_TINTS colour, taxis and police cars none (" + nTint + " tinted, " + nonTintable + " liveried, " + tintSeen.size + " distinct paints)", tintBad.slice(0, 3).join(" | "));
    ok(tintSeen.size >= 10, "at least 10 of the " + (TG.CAR_TINTS || []).length + " car paints are used (no one-colour street)", tintSeen.size + " used");
    ok(nonCity.tint === 0 && nonCity.towns > 0, "a non-city theme (Deepwood, " + nonCity.towns + " towns) gets no car paint and none of the polish props", nonCity.tint + " found");
    // the number of kinds in the paint table and the deterministic order: two calls, the same tints
    { const L = TG.layoutMap(7, "ashgrid", TG.defaultPois("ashgrid"), mk("ashgrid", 7), -999).towns[0]; ok(JSON.stringify(TG.streetProps(L, 7)) === JSON.stringify(TG.streetProps(L, 7)), "the paints are part of the pure street-prop list (two calls, identical)"); }
    // tower() climbs to its roof chest by a 2.2 m ramp along its local +X wall (up to 2.3 m out): that flank must be free of every other building, and a three-storey tower must be
    // >= 15 m wide (a 12.5 m one climbs at 44.4 degrees and a sprint down it mantles: worldlive ramps-walk-fine, 7A2)
    {
      const CS = [1, 0, -1, 0], SN = [0, 1, 0, -1], blockedList = [], steepList = [];
      let towers = 0;
      for (let seed = 1; seed <= PS; seed++) {
        const M = TG.layoutMap(seed, "ashgrid", TG.defaultPois("ashgrid"), mk("ashgrid", seed), -999);
        for (const L of M.towns) {
          const bs = L.parcels.filter((p) => p.building).map((p) => p.building);
          for (const b of bs) {
            if (b.gen !== "tower") continue;
            towers++;
            if (b.floors >= 3 && b.w < 15) steepList.push("ashgrid#" + seed + " " + L.id + " a " + b.w + " m tower of " + b.floors + " storeys");
            const c = CS[b.turn], s = SN[b.turn], W2 = b.w / 2, P = [[W2, -b.w / 2], [W2 + 2.3, b.w / 2]].map(([u, v]) => [b.cx + u * c + v * s, b.cz - u * s + v * c]);
            const r = [Math.min(P[0][0], P[1][0]), Math.min(P[0][1], P[1][1]), Math.max(P[0][0], P[1][0]), Math.max(P[0][1], P[1][1])];
            for (const o of bs) if (o !== b && overlapArea(r, o.aabb) > 0) { blockedList.push("ashgrid#" + seed + " " + L.id + " tower at " + b.cx + "," + b.cz + " has a building on its ramp flank"); break; }
          }
        }
      }
      ok(blockedList.length === 0 && towers > 100, "every tower() building (" + towers + " over " + PS + " seeds) has its +X roof-ramp flank free of other buildings", blockedList.length + " blocked, first: " + blockedList.slice(0, 2).join(" | "));
      ok(steepList.length === 0, "no three-storey tower() building is narrower than 15 m (its roof ramp would climb at more than 43 degrees)", steepList.length + ", first: " + steepList.slice(0, 2).join(" | "));
    }
    // a NaN ground: the sampler reads a non-finite node as deep water, so the layout is finite and keeps off the patch
    {
      const h = mk("ashgrid", 7), nan = (x, z) => (x > 56 && x < 120 && z > -10 && z < 50 ? NaN : h(x, z));
      const M = TG.layoutMap(7, "ashgrid", TG.defaultPois("ashgrid"), nan, -999);
      const nums = [];
      const scan = (o) => { if (typeof o === "number") nums.push(o); else if (o && typeof o === "object") for (const k in o) scan(o[k]); };
      scan(M.towns.map((t) => ({ b: t.blocks, p: t.parcels.map((q) => q.building && q.building.aabb), n: t.roads.nodes })));
      ok(nums.every(Number.isFinite), "a height function that returns NaN on a patch still gives a finite layout (" + nums.length + " numbers scanned)", nums.filter((v) => !Number.isFinite(v)).length + " non-finite");
    }
  }

  // ── 4. determinism ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  console.log("\n[4] determinism");
  {
    const specs = hashSpecs;
    const mine = [];
    let twice = true, firstDiff = "";
    for (const sp of specs) {
      const [map, seedS] = sp.split(":"), seed = Number(seedS), wy = waterOf(map);
      const run = () => { const h = mk(map, seed); const pois = TG.defaultPois(map); if (map === "isla_viva") snapIsla(pois, h, wy); return JSON.stringify(TG.layoutMap(seed, map, pois, h, wy)); };
      const a = run(), b = run();
      if (a !== b) { twice = false; firstDiff = firstDiff || sp; }
      mine.push(sp + " " + a.length + " " + fnv(a));
    }
    ok(twice, "same seed -> byte-identical layout, two runs in this process (" + specs.length + " map-seeds, " + mine.map((s2) => s2.split(" ")[1]).reduce((x, y) => x + Number(y), 0) + " JSON bytes)", firstDiff);
    const kid = await hashPromise;
    const line = (kid.out || "").split(/\r?\n/).find((l) => l.startsWith("HASHES "));
    const theirs = line ? line.slice(7).split(" ; ") : [];
    ok(line && theirs.length === mine.length && theirs.every((t, i) => t === mine[i]), "same seed -> identical layout in a fresh process (JSON length + FNV hash of " + specs.length + " map-seeds)", line ? theirs.filter((t, i) => t !== mine[i]).join(" | ") : "child failed: " + (kid.err || "").slice(0, 200));
    ok(fnv(JSON.stringify(TG.layoutMap(8, "ashgrid", TG.defaultPois("ashgrid"), mk("ashgrid", 8), -999))) !== fnv(JSON.stringify(TG.layoutMap(9, "ashgrid", TG.defaultPois("ashgrid"), mk("ashgrid", 9), -999))), "different seeds give different layouts");
    // the town streams are independent of each other: a POI's layout does not depend on which other POIs were laid out first
    const h7 = mk("ashgrid", 7), pois = TG.defaultPois("ashgrid");
    const solo = TG.layout(7, pois[3], h7, -999, "city", TG.planFor("ashgrid", pois[3]));
    const inMap = TG.layoutMap(7, "ashgrid", pois, mk("ashgrid", 7), -999).towns[3];
    ok(JSON.stringify(solo) === JSON.stringify(inMap), "a POI's layout is the same alone and inside layoutMap (own sub-RNG, no shared stream)");
  }

  // ── 5. coverage vs the citycheck targets (PLAN section 4) ──────────────────────────────────────────────────────────────────────────
  console.log("\n[5] coverage vs the citycheck targets (real height functions)");
  const COV_SEEDS = Math.min(SEEDS, 24);
  const covRows = {};
  for (const map of MAPS) {
    const wy = waterOf(map);
    const med = [], p90 = [], gt150 = [], in25 = [], nEnt = [];
    for (let seed = 1; seed <= COV_SEEDS; seed++) {
      const h = mk(map, seed);
      let pois = TG.defaultPois(map);
      if (map === "isla_viva") snapIsla(pois, h, wy);
      const M = TG.layoutMap(seed, map, pois, h, wy);
      const boxes = TG.enterableBoxes(M.towns.concat(M.compounds));
      nEnt.push(boxes.length);
      const idx = new BoxIndex(48);
      for (const b of boxes) idx.add(b, "b");
      const ds = [];
      for (let x = -790; x <= 790; x += 20) for (let z = -790; z <= 790; z += 20) {
        if (h(x, z) <= wy + 0.6) continue;                              // land only (analyze.py: ground > waterY + 0.6)
        let best = Infinity;
        for (let r = 0; r <= 12 && best > r * 48; r++) {
          idx.query([x - (r + 1) * 48, z - (r + 1) * 48, x + (r + 1) * 48, z + (r + 1) * 48], (e) => { const d = rectDist(x, z, e.box); if (d < best) best = d; });
          if (best < r * 48) break;
        }
        ds.push(best);
      }
      ds.sort((a, b) => a - b);
      med.push(ds[ds.length >> 1]); p90.push(ds[Math.floor(ds.length * 0.9)]);
      gt150.push(100 * ds.filter((d) => d > 150).length / ds.length); in25.push(100 * ds.filter((d) => d <= 25).length / ds.length);
    }
    covRows[map] = { med: pct(med, 0.5), medMax: Math.max(...med), p90: pct(p90, 0.5), p90Max: Math.max(...p90), gt150: pct(gt150, 0.5), gt150Max: Math.max(...gt150), in25: pct(in25, 0.5), in25Min: Math.min(...in25), ent: pct(nEnt, 0.5) };
    const c = covRows[map];
    console.log("      " + map.padEnd(10) + " (" + COV_SEEDS + " seeds) enterable buildings median " + c.ent + " | land within 25 m of one: median " + fix(c.in25) + "% (worst " + fix(c.in25Min) + "%) | distance to nearest: median " + fix(c.med) + " m (worst seed " + fix(c.medMax) + "), p90 " + fix(c.p90) + " m (worst " + fix(c.p90Max) + ") | land > 150 m away " + fix(c.gt150) + "% (worst " + fix(c.gt150Max) + "%)");
    ok(c.in25Min >= 10, map + ": land within 25 m of an enterable building >= 10 % on every seed", "worst " + fix(c.in25Min) + "%");
    ok(c.medMax <= 90, map + ": median distance to an enterable building <= 90 m on every seed", "worst " + fix(c.medMax) + " m");
    ok(c.p90Max <= 150, map + ": p90 distance <= 150 m on every seed", "worst " + fix(c.p90Max) + " m");
    ok(c.gt150Max <= 10, map + ": land more than 150 m from an enterable building <= 10 % on every seed", "worst " + fix(c.gt150Max) + "%");
  }

  // ── 6. negative controls ──────────────────────────────────────────────────────────────────────────────────────────────────────────
  console.log("\n[6] negative controls (each planted fault must be caught)");
  {
    const { M, h, wy } = keep.ashgrid;
    const clone = (o) => JSON.parse(JSON.stringify(o));
    const town = clone(M.towns.find((t) => t.id === "downtown"));
    const h0 = (x, z) => h(x, z);
    ok(checkBlocksDry(TG, town, h0, wy, true).length === 0 && checkQuarter(TG, town).length === 0 && checkOverlap([town]).length === 0 && checkStreets(TG, town).length === 0, "control: the unplanted downtown passes the block / quarter / overlap / street checkers");
    // 1. a wet block
    ok(checkBlocksDry(TG, town, (x, z) => (Math.abs(x - town.blocks[0].cx) < 20 && Math.abs(z - town.blocks[0].cz) < 20 ? -1 : 5), 0, true).length > 0, "planted: a block over water is caught");
    // 2. an off-axis building
    { const t = clone(town); const p = t.parcels.find((q) => q.building); p.building.rot = 0.3; ok(checkQuarter(TG, t).length > 0, "planted: a 0.3 rad building is caught"); }
    { const t = clone(town); const p = t.parcels.find((q) => q.building); p.building.w += 3; ok(checkQuarter(TG, t).length > 0, "planted: a building that no longer matches its box is caught"); }
    // 3. overlapping parcels
    { const t = clone(town); t.parcels[1].rect = t.parcels[0].rect.slice(); ok(checkOverlap([t]).length > 0, "planted: two parcels on top of each other are caught"); }
    // 4. a parcel that touches no street
    { const t = clone(town); const p = t.parcels.find((q) => q.building); const b = t.blocks.find((q) => q.id === p.block); p.rect = [b.cx - 5, b.cz - 5, b.cx + 5, b.cz + 5]; ok(checkStreets(TG, t).length > 0, "planted: an interior parcel is caught"); }
    // 5. a disconnected road graph + a road through a block
    { const t = clone(town); t.roads.edges = t.roads.edges.filter((e) => e.id % 3 !== 0); ok(checkRoads(TG, t, t.blocks, h0, wy).length > 0, "planted: a road graph with missing edges is caught"); }
    { const t = clone(town); const b = t.blocks[0]; t.roads.nodes[0].x = b.cx; t.roads.nodes[0].z = b.cz; ok(checkRoads(TG, t, t.blocks, h0, wy).length > 0, "planted: a road node inside a block is caught"); }
    { const t = clone(town); t.roads.streets[0].len = 200; ok(checkRoads(TG, t, t.blocks, h0, wy).length > 0, "planted: a 200 m straight street is caught"); }
    // 6. a missing front door
    { const t = clone(town); const idxs = new BoxIndex(64); for (const p of t.parcels) if (p.building) idxs.add(p.building.aabb, p.id); const p = t.parcels.find((q) => q.building && q.building.enterable); t.doors = t.doors.filter((d) => !(d.parcel === p.id && d.kind === "front")); ok(checkDoors(TG, t, idxs, h0).length > 0, "planted: an enterable building without a front door is caught"); }
    { const t = clone(town); const idxs = new BoxIndex(64); for (const p of t.parcels) if (p.building) idxs.add(p.building.aabb, p.id); const p = t.parcels.find((q) => q.building && q.building.enterable); const d = t.doors.find((q) => q.parcel === p.id && q.kind === "front"); d.street.x += 40; ok(checkDoors(TG, t, idxs, h0).length > 0, "planted: a door whose street point is off its road edge is caught"); }
    // 7. a closed shell share
    { const t = clone(town); for (const p of t.parcels) if (p.building) p.building.enterable = false; ok(checkShares(TG, t).length > 0, "planted: a town of closed shells is caught"); }
    // 8. interior: an overlapping room, a missing interior door
    { const t = clone(town); const r = t.rooms.find((q) => q.floor === 0); r.cells = [r.cells[0], r.cells[1], r.cells[2] + 1, r.cells[3]]; ok(checkInterior(TG, t).length > 0, "planted: a room that overlaps its neighbour is caught"); }
    { const t = clone(town); const d = t.doors.find((q) => q.kind === "interior"); t.doors = t.doors.filter((q) => q !== d); ok(checkInterior(TG, t).length > 0, "planted: a room with no interior door is caught"); }
    { const t = clone(town); const s = t.stairs[0]; s.rise = 6; s.slopeDeg = 50; ok(checkInterior(TG, t).length > 0, "planted: a 50 degree stair is caught"); }
    // 9. a compound inside a town
    { const mm = clone(M); mm.compounds[0].poi.x = mm.towns[0].blocks[0].cx; mm.compounds[0].poi.z = mm.towns[0].blocks[0].cz; ok(checkCompounds(TG, mm).length > 0, "planted: a compound on top of a town is caught"); }
    // 11. street props (Wave 7)
    {
      const tp = TG.streetProps(town, 7), manC = JSON.parse(fs.readFileSync(path.join(ROOT, "assets", "props", "city", "manifest.json"), "utf8"));
      ok(checkStreetProps(TG, await import(pathToFileURL(path.join(__dirname, "citykit.js")).href), manC, town, tp).length === 0, "control: the unplanted downtown's street props pass the prop checker");
      const CK = await import(pathToFileURL(path.join(__dirname, "citykit.js")).href);
      { const b = town.parcels.find((q) => q.building && q.building.enterable).building; const q = tp.slice(); q.push({ type: "props/hydrant", x: b.cx, z: b.cz, rot: 0, kind: "hydrant" }); ok(checkStreetProps(TG, CK, manC, town, q).length > 0, "planted: a hydrant inside a building is caught"); }
      { const n = town.roads.nodes.find((q) => q.deg >= 4); const q = tp.slice(); q.push({ type: "cars/sedan", x: n.x, z: n.z, rot: 1, kind: "car" }); ok(checkStreetProps(TG, CK, manC, town, q).length > 0, "planted: a car in a junction is caught"); }
      { const q = tp.slice(); q.push({ type: "cars/spaceship", x: 0, z: 0, rot: 0, kind: "car" }); ok(checkStreetProps(TG, CK, manC, town, q).length > 0, "planted: an unknown kit type is caught"); }
      { const q = tp.slice(); const c = q.find((e) => e.kind === "car"); q.push(Object.assign({}, c)); ok(checkStreetProps(TG, CK, manC, town, q).length > 0, "planted: two cars on the same spot are caught"); }
      { const q = tp.map((e) => Object.assign({}, e)); const c = q.find((e) => e.kind === "car"); c.rot = 0.5; ok(checkStreetProps(TG, CK, manC, town, q).length > 0, "planted: a car off the quarter turns is caught"); }
    }
    // 12. the city polish checkers (Wave 7, 7A2): each must bite on a planted fault
    {
      const cars = TG.streetProps(town, 7).filter((e) => e.kind === "car" && (TG.TINTABLE_CARS || []).indexOf(e.type) >= 0);
      const offPalette = (list) => list.filter((e) => e.kind === "car" && (TG.TINTABLE_CARS || []).indexOf(e.type) >= 0 && !(TG.CAR_TINTS || []).some((q) => q[0] === e.tint)).length;
      ok(cars.length > 0 && offPalette(cars) === 0, "control: every tintable car of the unplanted downtown wears a CAR_TINTS paint (" + cars.length + " cars)");
      { const q = cars.map((e) => Object.assign({}, e)); q[0].tint = 0x00ff00; ok(offPalette(q) > 0, "planted: a toy-green car off the paint table is caught"); }
      { const q = cars.map((e) => Object.assign({}, e)); delete q[0].tint; ok(offPalette(q) > 0, "planted: a tintable car with no paint is caught"); }
      const small = clone(town); for (const p of small.parcels) if (p.building && p.building.enterable) { p.building.w = 5; p.building.d = 5; p.building.aabb = [p.building.cx - 2.5, p.building.cz - 2.5, p.building.cx + 2.5, p.building.cz + 2.5]; }
      const per = (L) => { const m2 = new Map(); for (const p of L.parcels) if (p.building) { const a = p.building.aabb; m2.set(p.block, (m2.get(p.block) || 0) + (a[2] - a[0]) * (a[3] - a[1])); } return L.blocks.map((b) => (m2.get(b.id) || 0) / ((b.x1 - b.x0) * (b.z1 - b.z0))); };
      ok(pct(per(town), 0.5) >= 0.40 && pct(per(small), 0.5) < 0.40, "planted: a core of 5 x 5 m boxes fails the footprint-share bar (the unplanted one passes: " + fix(pct(per(town), 0.5), 3) + " vs " + fix(pct(per(small), 0.5), 3) + ")");
    }
    // 10. nondeterminism: a layout built from a perturbed height function differs
    const hp = (x, z) => h(x, z) + (Math.abs(x) < 400 ? 1.7 * Math.sin(x * 0.05 + z * 0.03) : 0);
    ok(JSON.stringify(TG.layoutMap(7, "ashgrid", TG.defaultPois("ashgrid"), hp, -999)) !== JSON.stringify(M), "planted: a different ground changes the layout (the generator reads the height function)");
  }

  // ── 7. the height function vs the real map ────────────────────────────────────────────────────────────────────────────────────────
  console.log("\n[7] the height function and POI snap vs a REAL buildMap (child process, seed 7)");
  {
    const r = await realPromise;
    const line = (r.out || "").split("\n").find((l) => l.startsWith("REAL_JSON "));
    if (!line) ok(false, "real buildMap child produced its data", "exit " + r.code + ": " + (r.err || r.out || "").slice(-400));
    else {
      const real = JSON.parse(line.slice(10));
      for (const map of MAPS) {
        const R = real[map], h = mk(map, 7);
        const d = R.pts.map((p) => Math.abs(h(p[0], p[1]) - p[2])), dg = R.pts.map((p) => Math.abs(h(p[0], p[1]) - p[3]));
        const within = d.filter((v) => v <= 0.15).length / d.length;
        ok(within >= 0.85 && pct(d, 0.5) <= 0.06, map + ": the sliced height function equals the real map's heightAt (" + fix(100 * within, 1) + "% of 400 points within 0.15 m, median " + fix(pct(d, 0.5), 3) + " m, max " + fix(Math.max(...d), 2) + " m; groundAt max " + fix(Math.max(...dg), 2) + " m)", "pads / lattice interpolation allow a small share; a changed function does not");
        ok(R.waterY === waterOf(map), map + ": real waterY " + R.waterY + " = the selftest's");
        const pois = TG.defaultPois(map);
        if (map === "isla_viva") snapIsla(pois, h, waterOf(map));
        const worst = Math.max(...R.pois.map((rp) => { const p = pois.find((q) => q.id === rp[0]); return p ? Math.hypot(p.x - rp[1], p.z - rp[2]) + Math.abs(p.r - rp[3]) : 1e9; }));
        ok(worst < 1e-6 && R.pois.length === pois.length, map + ": the POI table (after the land snap) equals the real map's pois (" + R.pois.length + " POIs, worst difference " + (worst < 1e9 ? worst.toExponential(1) : "missing") + ")");
      }
    }
  }

  // ── 8. cost (build time only; nothing runs per frame) ──────────────────────────────────────────────────────────────────────────────
  console.log("\n[8] cost: build time per layout (information) and layout data size");
  {
    const REP = 8;
    const tTown = [], tComp = [], tMapMs = [], sizes = [];
    for (const map of MAPS) {
      const wy = waterOf(map);
      const townMs = [];
      for (let seed = 1; seed <= REP; seed++) {
        const h = mk(map, seed);
        let pois = TG.defaultPois(map);
        if (map === "isla_viva") snapIsla(pois, h, wy);
        const S = TG.makeSampler(h);
        const towns = [];
        const avoid = [];
        for (const p of pois) {
          const plan = TG.planFor(map, p);
          const t0 = process.hrtime.bigint();
          const L = TG.layout(seed, p, S, wy, plan.theme, Object.assign({}, plan, { avoid: avoid.slice() }));
          townMs.push(Number(process.hrtime.bigint() - t0) / 1e6);
          for (const b of L.blocks) avoid.push([b.cx - 28, b.cz - 28, b.cx + 28, b.cz + 28]);
          if (L.compound && L.parcels.length) avoid.push(L.compound.bounds);
          towns.push(L);
        }
        const t1 = process.hrtime.bigint();
        const comp = TG.placeCompounds(seed, map, towns, S, wy, {});
        const dt = Number(process.hrtime.bigint() - t1) / 1e6;
        tComp.push(dt / Math.max(1, comp.sites.length));
        const t2 = process.hrtime.bigint();
        const M = TG.layoutMap(seed, map, pois, mk(map, seed), wy);
        tMapMs.push(Number(process.hrtime.bigint() - t2) / 1e6);
        sizes.push(JSON.stringify(M).length / 1024);
      }
      tTown.push(...townMs);
    }
    console.log("      town / cluster layout: median " + fix(pct(tTown, 0.5), 2) + " ms, p90 " + fix(pct(tTown, 0.9), 2) + " ms, worst " + fix(Math.max(...tTown), 1) + " ms");
    console.log("      compound fill: " + fix(pct(tComp, 0.5), 2) + " ms per compound (farthest-point grid included)");
    console.log("      whole map (every POI + compounds + links), cold sampler: median " + fix(pct(tMapMs, 0.5), 1) + " ms, worst " + fix(Math.max(...tMapMs), 1) + " ms");
    console.log("      layout data: median " + fix(pct(sizes, 0.5), 0) + " KB of JSON per map (max " + fix(Math.max(...sizes), 0) + " KB), rooms / doors / stairs included");
    ok(pct(tMapMs, 0.5) < 600, "a whole map's layout takes < 600 ms at the median (guards a quadratic blow-up; the live match builds it once)", "median " + fix(pct(tMapMs, 0.5), 1) + " ms");
  }

  const wall = Date.now() - T_START;
  console.log("\ntowngen.selftest: " + passed + " passed, " + failed + " failed, wall " + (wall / 1000).toFixed(1) + " s (sweep " + (sweepMs / 1000).toFixed(1) + " s)");
  process.exit(failed ? 1 : 0);
}

if (process.argv.includes("--real")) realMode().catch((e) => { console.error(e && e.stack || e); process.exit(2); });
else if (process.argv.includes("--hash")) hashMode().catch((e) => { console.error(e && e.stack || e); process.exit(2); });
else main().catch((e) => { console.error("FAIL: selftest crashed: " + (e && e.stack || e)); process.exit(1); });
