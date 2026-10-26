/**
 * Node self-test for royale/housegen.js (Wave 8 stage A, lane H1: the house grammar).
 * Run: node games/last-circle/runtime/3d/royale/housegen.selftest.cjs        (gate.py picks it up with the other *.selftest.cjs)
 * Exit 0 = every row passed, 1 = a failure. Budget < 15 s (the 4,500 houses are split over worker threads; round 3 lane H6: was < 20 s).
 *
 * 500 parcels (random sizes 5-21 m incl. off-grid values, every quarter turn, every street side, random pads, uses and plans) x 3 of the 6 themes x 1-3 storeys
 * = 4,500 houses. Every house is checked by an INDEPENDENT world-space checker that reads only the house data, its colliders and manifest.json:
 *   determinism     the same parcel -> byte-identical JSON twice in one thread, across threads, and in a fresh process
 *   reach           a capsule (r 0.45, headroom 1.8, step 0.55) on a 0.25 m grid from the street point outside the front door reaches every room, both
 *                   sides of every door, every stair end, every loot point and chest (within 1.5 m, <= 2.2 m above the floor); stairs are walked along
 *                   the ramp colliders at the ramp height (the sim's rampBlocks rule for ramps), floors exist only where a slab top is
 *   nav             every room has a node and the door / stair / exit links join every room to the street
 *   furniture       no two pieces overlap, none overlaps a wall / slab / ramp collider, a door zone (opening +- 0.1 m, 1.0 m deep each side) or a stair zone
 *                   (lower floor: the ramp + 1 m before its foot; upper floor: the hole + 1 m past its top)
 *   doorways        clear height >= 2.0 m and clear width >= 2.0 m (measured by scanning the colliders), the stated width 2.26
 *   windows         the aperture holds no collider; sill top == floor + 1.20 and header bottom == floor + 2.30 (+-1 cm); a standing-eye shot (1.62) through it
 *                   is clear, a crouched-eye shot (0.97) is blocked (cover); no furniture taller than the sill within 0.8 m inside it
 *   visual==collider  every drawn structure box IS a collider box and vice versa; kit furniture colliders == the manifest bbox placed by the kit entry
 *                   (2 cm); authored furniture: its parts' AABB == its colliders' AABB (2 cm) and every part inside a collider; stair steps inside the ramp
 *                   footprint and each tread within riser/2 + 1 cm of the ramp surface; rugs <= 2 cm
 *   stairs          <= 45 degrees, foot lip 0 (ramp minY == floor), top == the next floor's surface, no slab within stairHeadroomRun of the top end
 *   budget / O3     <= 4,000 triangles per storey (recounted from boxes + manifest tris), <= 3 floors
 *   builder         buildHouse with the vendored three r172 in Node: 24 vertices per box whose bounds equal that box exactly, mesh bounds == house bounds
 *   roof (round 3) every pitched roof plank is its ramp (<= 45 deg), drawn underneath only outside the walls; the attic SEALED by 'gable' layers that never
 *                   rise above the plank; every end-wall polygon flat on the layers' faces
 *   loot (round 3)  floor loot never inside / under a piece's collider
 *   themes / roofs / relief / kit download (round 3): city resort lodge farm ruin mill each in its own look; flat, gable, gambrel, lean-to and hip roofs
 *                   built; exterior relief on every house; the kit GLBs the interior profile can place <= 300,000 B
 * The 500 parcels are built in three themes each, rotating over all six (city resort lodge farm ruin mill). Workers: one per physical core, claiming
 * chunks of jobs from a shared counter; the fixed rows (storey heights, sheds, towers, the builder) run on the main thread meanwhile.
 * Planted faults (negative controls) prove each checker bites.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const cp = require("child_process");
const { pathToFileURL } = require("url");
const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const HG = path.join(__dirname, "housegen.js");
const TG = path.join(__dirname, "towngen.js");
const MANIFEST = path.join(ROOT, "assets", "props", "city", "manifest.json");
const MANIFEST_INT = path.join(ROOT, "assets", "props", "city", "manifest_interior.json");     // lane H2 (Wave 8 stage A); merged into manifest.json in stage B
function loadManifest() {
  const man = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  const types = Object.assign({}, man.types);
  if (fs.existsSync(MANIFEST_INT)) { const mi = JSON.parse(fs.readFileSync(MANIFEST_INT, "utf8")); for (const k of Object.keys(mi.types || {})) if (!types[k]) types[k] = mi.types[k]; }
  return { types };
}
const THREE_JS = path.join(ROOT, "assets", "vendor", "three", "build", "three.module.js");
const N_PARCELS = Number(process.env.HG_PARCELS || 500);
const THEMES = ["city", "resort", "lodge"];                        // the town themes (the fixed rows below)
const ALL_THEMES = ["city", "resort", "lodge", "farm", "ruin", "mill"];   // + towngen's compound themes (round 3)
/** the three themes parcel k is built in: rotating over all six (every theme gets 250 of the 500 parcels) */
const themesOf = (k) => [ALL_THEMES[k % 6], ALL_THEMES[(k + 2) % 6], ALL_THEMES[(k + 4) % 6]];
const T0 = Date.now();

// ── constants the checker uses (its own copies: a change in housegen must be a change here too) ─────────────────────────────────────────
const R = 0.45, HGT = 1.8, STEP = 0.55, GRID = 0.25, RING = 1.5, REACH_XZ = 1.5, REACH_DY = 2.2, TOL = 0.02, TRI_BUDGET = 4000;
const SILL = 1.2, HEAD = 2.3, EYE = 1.62, CROUCH_EYE = 0.97, RAMP_THICK = 0.3;
function headroomRun(rise, run) { const m = Math.max(0.05, rise / run), mv = m * 8, arc = mv * mv / 44; return (1.8 + arc + 0.1) / m + 0.45; }   // maps.js:1684
function fnv(str) { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16); }

function mulberry(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
// every use maps.js hands over in stage B (towngen ARCH): house / shop / hall / shed / barn / midrise / tower, or none (the theme's mix)
const useOf = (x) => (x < 0.15 ? "shop" : x < 0.25 ? "house" : x < 0.31 ? "hall" : x < 0.37 ? "shed" : x < 0.42 ? "barn" : x < 0.48 ? "midrise" : x < 0.53 ? "tower" : undefined);
/** storeys asked of a job: 1-3, and for a tower / mid-rise up to 9 (the storeys over 3 are closed shell storeys) */
const storeysOf = (parcel, k, st) => (parcel.use === "tower" || parcel.use === "midrise" ? st + 3 * (k % 3) : st);
/** the 500 parcels: a pure function of the index */
function parcels(n) {
  const r = mulberry(0x5eed);
  const out = [];
  const sides = ["front", "right", "back", "left", undefined];
  for (let k = 0; k < n; k++) {
    const grid = r() < 0.7;
    const w = grid ? 2.5 * (2 + Math.floor(r() * 7)) : 5 + r() * 16, d = grid ? 2.5 * (2 + Math.floor(r() * 7)) : 5 + r() * 16;
    out.push({ id: "pc" + k, cx: Math.round((r() - 0.5) * 3000) / 2, cz: Math.round((r() - 0.5) * 3000) / 2, y: Math.round((r() * 43 - 3) * 100) / 100, w, d,
      turn: Math.floor(r() * 4), street: sides[Math.floor(r() * sides.length)], seed: Math.floor(r() * 4294967296), use: useOf(r()),
      plan: r() < 0.15 ? "L" : r() < 0.1 ? "rect" : undefined, fh: r() < 0.2 ? Math.round((3 + r() * 3) * 10) / 10 : undefined });
  }
  return out;
}

// ── the sim's ramp rule (runtime/sim/royale.js rampBlocksA, transliterated) ───────────────────────────────────────────────────────────
function rampBlocks(c, x, z, yd, h, r, stepUp) {
  const nx = x < c.minX ? c.minX : x > c.maxX ? c.maxX : x, nz = z < c.minZ ? c.minZ : z > c.maxZ ? c.maxZ : z;
  const ex = x - nx, ez = z - nz;
  if (ex * ex + ez * ez >= r * r) return false;
  let along, uc, ev;
  if (c.dir === 0) { along = c.maxX - c.minX; uc = x - c.minX; ev = ez; } else if (c.dir === 1) { along = c.maxX - c.minX; uc = c.maxX - x; ev = ez; }
  else if (c.dir === 2) { along = c.maxZ - c.minZ; uc = z - c.minZ; ev = ex; } else { along = c.maxZ - c.minZ; uc = c.maxZ - z; ev = ex; }
  const al = along > 0.01 ? along : 0.01, k = (c.maxY - c.minY) / al;
  const uN = uc < 0 ? 0 : uc > al ? al : uc;
  if (c.minY + k * uN <= yd + stepUp) return false;
  let reach = r * r - ev * ev; reach = reach > 0 ? Math.sqrt(reach) : 0;
  let uLow = uc - reach; if (uLow < 0) uLow = 0; else if (uLow > al) uLow = al;
  return c.minY + k * uLow - RAMP_THICK * 0.5 * Math.sqrt(1 + k * k) < yd + h;
}
const rampTop = (c, x, z) => {
  let f;
  if (c.dir === 0) f = (x - c.minX) / (c.maxX - c.minX); else if (c.dir === 1) f = (c.maxX - x) / (c.maxX - c.minX);
  else if (c.dir === 2) f = (z - c.minZ) / (c.maxZ - c.minZ); else f = (c.maxZ - z) / (c.maxZ - c.minZ);
  return c.minY + (c.maxY - c.minY) * (f < 0 ? 0 : f > 1 ? 1 : f);
};
const d2box = (x, z, c) => { const ex = x < c.minX ? c.minX - x : x > c.maxX ? x - c.maxX : 0, ez = z < c.minZ ? c.minZ - z : z > c.maxZ ? z - c.maxZ : 0; return ex * ex + ez * ez; };
const ovl3 = (a, b, g) => a.minX < b.maxX - g && b.minX < a.maxX - g && a.minY < b.maxY - g && b.minY < a.maxY - g && a.minZ < b.maxZ - g && b.minZ < a.maxZ - g;
const ovl2 = (a, b, g) => a.minX < b.maxX - g && b.minX < a.maxX - g && a.minZ < b.maxZ - g && b.minZ < a.maxZ - g;
const B = (min, max) => ({ minX: min[0], minY: min[1], minZ: min[2], maxX: max[0], maxY: max[1], maxZ: max[2] });
/** segment vs AABB (slab method): true if the open segment a -> b passes through the box */
function segHits(a, b, c) {
  let t0 = 0, t1 = 1;
  const lo = [c.minX, c.minY, c.minZ], hi = [c.maxX, c.maxY, c.maxZ];
  for (let k = 0; k < 3; k++) {
    const d = b[k] - a[k];
    if (Math.abs(d) < 1e-12) { if (a[k] <= lo[k] || a[k] >= hi[k]) return false; continue; }
    let ta = (lo[k] - a[k]) / d, tb = (hi[k] - a[k]) / d;
    if (ta > tb) { const t = ta; ta = tb; tb = t; }
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 >= t1) return false;
  }
  return true;
}

// ── the independent checker: house data + colliders + manifest -> list of errors (codes) ────────────────────────────────────────────────
function checkHouse(H, HGmod, MAN) {
  const err = [];
  const E = (code, msg) => { err.push(code + ": " + msg); };
  const cols = HGmod.collidersOf(H);
  const boxes = cols.filter((c) => c.kind === "box"), ramps = cols.filter((c) => c.kind === "ramp");
  // a 2 m grid over the colliders (box colliders only): near(x0, z0, x1, z1) -> every box whose footprint may meet that rectangle (each once)
  const GI = new Map(), GS = 2;
  boxes.forEach((c, i) => { for (let gx = Math.floor(c.minX / GS); gx <= Math.floor(c.maxX / GS); gx++) for (let gz = Math.floor(c.minZ / GS); gz <= Math.floor(c.maxZ / GS); gz++) { const k = gx * 65536 + gz; let l = GI.get(k); if (!l) { l = []; GI.set(k, l); } l.push(i); } });
  let nearStamp = 0; const nearMark = new Int32Array(boxes.length);
  const near = (x0, z0, x1, z1) => {
    const out = []; nearStamp++;
    for (let gx = Math.floor(x0 / GS); gx <= Math.floor(x1 / GS); gx++) for (let gz = Math.floor(z0 / GS); gz <= Math.floor(z1 / GS); gz++) {
      const l = GI.get(gx * 65536 + gz); if (!l) continue;
      for (const i of l) if (nearMark[i] !== nearStamp) { nearMark[i] = nearStamp; out.push(boxes[i]); }
    }
    return out;
  };
  const S = H.floors.length;
  // O3 + floors
  if (S < 1 || S > 3 || H.storeys !== S) E("floors", "storeys " + H.storeys + " floors " + S);
  const fy = H.floors.map((f) => f.y);
  const floorOfY = (y) => { for (let f = 0; f < S; f++) if (Math.abs(fy[f] - y) < 0.011) return f; return -1; };
  // ---- visual == collider (structure)
  const structCols = boxes.slice(0, H.boxes.filter((b) => b.c).length);
  for (const c of structCols) c.__s = 1;                  // (a structure collider: the furniture-overlap rows test only these)
  // (in order: the k-th structure collider IS the k-th collider box of the house, to the millimetre - stricter than an unordered match)
  { let k = 0, bad = null;
    for (const b of H.boxes) {
      if (!b.c) continue;
      const c = structCols[k++];
      if (!c || Math.abs(c.minX - b.min[0]) > 5e-4 || Math.abs(c.minY - b.min[1]) > 5e-4 || Math.abs(c.minZ - b.min[2]) > 5e-4 || Math.abs(c.maxX - b.max[0]) > 5e-4 || Math.abs(c.maxY - b.max[1]) > 5e-4 || Math.abs(c.maxZ - b.max[2]) > 5e-4) { bad = b.p; break; }
    }
    if (bad || k !== structCols.length) E("vis-col", "a collider with no drawn box (or a box drawn without its collider): " + bad); }
  for (const b of H.boxes) if (!b.c && (b.p === "wall" || b.p === "slab" || b.p === "roof" || b.p === "rail" || b.p === "shell" || b.p === "leaf")) { E("vis-col", "drawn " + b.p + " box with no collider"); break; }
  (() => {                                       // (a section of its own function: smaller units for the optimizing compiler)
  // dressing. A SKIN (trim, shutter, blind window) is drawn only: <= 1.5 cm thick and lying flat on ONE collider face that covers it. A door LEAF is a
  // collider <= 4 cm thick lying flat on a wall collider face (no slot behind it). A GLASS pane is drawn only, <= 2 cm, exactly in a window's aperture.
  // collider faces by plane (millimetres): key (side * 2 + axis) * 1e9 + plane, side 1 = a max face (facing +), 0 = a min face
  let FI = null;
  const BX = new Map();                            // collider -> [minX, minY, minZ, maxX, maxY, maxZ]
  const bxOf = (c) => { let a = BX.get(c); if (!a) { a = [c.minX, c.minY, c.minZ, c.maxX, c.maxY, c.maxZ]; BX.set(c, a); } return a; };
  const faceIdx = () => {
    if (FI) return FI;
    FI = new Map();
    const add = (k, c) => { let l = FI.get(k); if (!l) { l = []; FI.set(k, l); } l.push(c); };
    // key: (side * 3 + axis) * 1e9 + plane in mm (side 1 = a max face, facing +)
    for (const c of structCols) { const q = bxOf(c); for (let a = 0; a < 3; a++) { add((3 + a) * 1e9 + Math.round(q[3 + a] * 1000), q); add(a * 1e9 + Math.round(q[a] * 1000), q); } }
    return FI;
  };
  const flatOn = (b, thick) => {
    const ext = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
    const ax = ext[0] <= thick + 1e-6 ? 0 : ext[2] <= thick + 1e-6 ? 2 : ext[1] <= thick + 1e-6 ? 1 : -1;
    if (ax < 0) return false;
    const [oa, ob] = [0, 1, 2].filter((q) => q !== ax), lo = b.min[ax], hi = b.max[ax];
    // the collider faces it can lie on: coplanar with one of its two thin faces (2 mm), facing it, overlapping it; its whole face must be on them
    // (a wall run can be two boxes: a door's jamb and the next stretch): exact, by testing the middle of every patch the faces' edges cut it into
    const b0 = b.min[oa], b1 = b.max[oa], y0 = b.min[ob], y1 = b.max[ob];
    for (const plane of [lo, hi]) {
      const faces = [], side = plane === lo ? 1 : 0, pk = Math.round(plane * 1000);
      for (let d = -2; d <= 2; d++) for (const c of faceIdx().get((side * 3 + ax) * 1e9 + pk + d) || []) {
        if (Math.abs((side ? c[3 + ax] : c[ax]) - plane) >= 0.002) continue;
        const c0 = c[oa], c1 = c[3 + oa], e0 = c[ob], e1 = c[3 + ob];
        if (c1 <= b0 + 1e-6 || c0 >= b1 - 1e-6 || e1 <= y0 + 1e-6 || e0 >= y1 - 1e-6) continue;
        if (c[0] === b.min[0] && c[3] === b.max[0] && c[2] === b.min[2] && c[5] === b.max[2] && c[1] === b.min[1]) continue;      // (itself)
        faces.push([c0, c1, e0, e1]);
      }
      if (!faces.length) continue;
      if (faces.some((q) => q[0] <= b0 + 0.002 && q[1] >= b1 - 0.002 && q[2] <= y0 + 0.002 && q[3] >= y1 - 0.002)) return true;
      const ts = [b0, b1], ys = [y0, y1];
      for (const q of faces) { if (q[0] > b0 && q[0] < b1) ts.push(q[0]); if (q[1] > b0 && q[1] < b1) ts.push(q[1]); if (q[2] > y0 && q[2] < y1) ys.push(q[2]); if (q[3] > y0 && q[3] < y1) ys.push(q[3]); }
      ts.sort((x, y) => x - y); ys.sort((x, y) => x - y);
      let all = true;
      for (let i = 0; i + 1 < ts.length && all; i++) {
        if (ts[i + 1] - ts[i] < 0.004) continue;
        const t = (ts[i] + ts[i + 1]) / 2;
        for (let j = 0; j + 1 < ys.length; j++) {
          if (ys[j + 1] - ys[j] < 0.004) continue;
          const y = (ys[j] + ys[j + 1]) / 2;
          if (!faces.some((q) => t >= q[0] && t <= q[1] && y >= q[2] && y <= q[3])) { all = false; break; }
        }
      }
      if (all) return true;
    }
    return false;
  };
  for (const b of H.boxes) {
    if (b.p === "skin" && (b.c || !flatOn(b, 0.015))) { E("vis-col", "a skin (trim / shutter / blind window) not <= 1.5 cm flat on one collider face"); break; }
    if (b.p === "leaf" && (!b.c || !flatOn(b, 0.04) || b.max[1] - b.min[1] > 2.4)) { E("vis-col", "a door leaf not a <= 4 cm collider flat on a wall"); break; }
  }
  const panes = H.boxes.filter((b) => b.p === "glass");
  // (Wave 8 fix round, lane K1: a RUIN's panes are mostly broken out - housegen keeps one in ~25 % of its windows. Every other theme: one pane per window,
  //  exactly as before; a ruin: never more panes than windows, and every pane it keeps still fills its window's aperture - the loop below)
  if (H.theme === "ruin" ? panes.length > H.windows.length : panes.length !== H.windows.length) E("windows", panes.length + " glass panes for " + H.windows.length + " windows");
  for (const g of panes) {
    const cx = (g.min[0] + g.max[0]) / 2, cz = (g.min[2] + g.max[2]) / 2, th = Math.min(g.max[0] - g.min[0], g.max[2] - g.min[2]), len = Math.max(g.max[0] - g.min[0], g.max[2] - g.min[2]);
    const w = H.windows.find((q) => Math.abs(q.x - cx) < 0.02 && Math.abs(q.z - cz) < 0.02 && Math.abs(q.sill - g.min[1]) < 0.5);
    if (g.c || !w || th > 0.021 || Math.abs(len - w.width) > 0.011 || Math.abs(g.min[1] - w.sill) > 0.011 || Math.abs(g.max[1] - w.head) > 0.011) { E("windows", "a glass pane that is not a drawn-only 2 cm pane filling its window's aperture"); break; }
  }
  })();
  (() => {                                       // (a section of its own function: smaller units for the optimizing compiler)
  // a piece standing on another: its bottom ON the host's top, its footprint inside the host's (1 cm)
  for (const p of H.furniture) {
    if (p.mount !== "top") continue;
    const h = H.furniture.find((q) => q.id === p.on);
    if (!h || Math.abs(p.min[1] - h.max[1]) > 0.011 || p.min[0] < h.min[0] - 0.011 || p.max[0] > h.max[0] + 0.011 || p.min[2] < h.min[2] - 0.011 || p.max[2] > h.max[2] + 0.011) { E("vis-col", p.cat + " not standing on its host's top"); break; }
  }
  })();
  (() => {                                       // (a section of its own function: smaller units for the optimizing compiler)
  // drawn-only dressing is THIN (<= 2 cm: inside the visual tolerance): a rug lies on its floor, a picture / mirror hangs on a wall collider face
  for (const p of H.furniture) {
    if (!p.deco) continue;
    const ext = [p.max[0] - p.min[0], p.max[1] - fy[p.floor], p.max[2] - p.min[2]];          // (a rug: what shows ABOVE its floor)
    const thin = ext.findIndex((e) => e <= TOL + 1e-6);
    if (thin < 0) { E("vis-col", "drawn-only " + p.cat + " thicker than 2 cm on every axis"); break; }
    if (thin === 1) { if (p.min[1] > fy[p.floor] + 1e-6 || p.min[1] < fy[p.floor] - 0.011) { E("vis-col", "rug not lying on its floor"); break; } continue; }
    // a wall piece: one of its two thin faces lies on a structure collider's face, and that collider covers the piece
    const ax = thin === 0 ? 0 : 2, lo = p.min[ax], hi = p.max[ax];
    const onWall = structCols.some((c) => {
      const cl = ax === 0 ? [c.minX, c.maxX] : [c.minZ, c.maxZ], ol = ax === 0 ? [c.minZ, c.maxZ] : [c.minX, c.maxX], pl = ax === 0 ? [p.min[2], p.max[2]] : [p.min[0], p.max[0]];
      return (Math.abs(cl[1] - lo) < 0.002 || Math.abs(cl[0] - hi) < 0.002) && ol[0] <= pl[0] + 0.002 && ol[1] >= pl[1] - 0.002 && c.minY <= p.min[1] + 0.002 && c.maxY >= p.max[1] - 0.002;
    });
    if (!onWall) { E("vis-col", "wall " + p.cat + " not hung flat on a wall collider face"); break; }
  }
  })();
  (() => {                                       // (a section of its own function: smaller units for the optimizing compiler)
  // culled faces: every face a box does not draw is covered from outside by ONE other drawn box (or lies at / under the pad)
  {
    const sb = H.boxes.filter((b) => b.p !== "furn" && b.p !== "deco");
    const BK = 2.5, bk = new Map();
    // (what may cover a face: a box, never a skin or a pane - a 1.5 cm trim or a see-through pane hides nothing behind it)
    for (const o of sb) { if (o.p === "skin" || o.p === "glass") continue; for (let i = Math.floor(o.min[0] / BK); i <= Math.floor(o.max[0] / BK); i++) for (let j = Math.floor(o.min[2] / BK); j <= Math.floor(o.max[2] / BK); j++) { const k = i * 100003 + j; let l = bk.get(k); if (!l) { l = []; bk.set(k, l); } l.push(o); } }
    let bad = 0;
    for (const b of sb) {
      if (!b.h) continue;
      if (b.p === "gable") continue;                // an attic layer: never drawn (the roof rows prove the planks + end walls draw it)
      if (b.p === "skin") {                        // a skin is a plate: its back face lies on its wall, its 1.5 cm edges are not drawn; its front IS drawn
        const thinY = b.max[1] - b.min[1] <= 0.0151, thinX = b.max[0] - b.min[0] <= 0.0151, faces = thinY ? [2, 3] : thinX ? [0, 1] : [4, 5];
        if ((b.h & (1 << faces[0])) && (b.h & (1 << faces[1]))) bad++;
        continue;
      }
      for (let fi = 0; fi < 6 && !bad; fi++) {
        if (!(b.h & (1 << fi))) continue;
        const ax = fi >> 1, out = fi & 1 ? -1 : 1, pl = fi & 1 ? b.min[ax] : b.max[ax];
        if (fi === 3 && pl <= H.y0 + 1e-4) continue;
        const lo = b.min.slice(), hi = b.max.slice();
        lo[ax] = out > 0 ? pl : pl - 0.01; hi[ax] = out > 0 ? pl + 0.01 : pl;
        const cand = bk.get(Math.floor(((lo[0] + hi[0]) / 2) / BK) * 100003 + Math.floor(((lo[2] + hi[2]) / 2) / BK)) || [];
        const cov = cand.some((o) => o !== b && o.min[0] <= lo[0] + 1e-4 && o.min[1] <= lo[1] + 1e-4 && o.min[2] <= lo[2] + 1e-4 && o.max[0] >= hi[0] - 1e-4 && o.max[1] >= hi[1] - 1e-4 && o.max[2] >= hi[2] - 1e-4);
        if (!cov) bad++;
      }
    }
    if (bad) E("vis-col", bad + " culled face(s) with nothing covering them (a hole in the drawn house)");
  }
  })();
  (() => {                                       // (a section of its own function: smaller units for the optimizing compiler)
  // stair steps vs ramps (the stairs' ramps: a pitched roof's planks are drawn as planks, checked by the roof rows)
  const stairRamps = ramps.filter((c, i) => !(H.ramps[i] && H.ramps[i].roof));
  const steps = H.boxes.filter((b) => b.p === "step");
  for (const st of steps) {
    const rp = stairRamps.find((c) => st.min[0] >= c.minX - TOL && st.max[0] <= c.maxX + TOL && st.min[2] >= c.minZ - TOL && st.max[2] <= c.maxZ + TOL && Math.abs(st.min[1] - c.minY) < TOL);
    if (!rp) { E("vis-col", "a stair step outside every ramp footprint"); break; }
    const cx = (st.min[0] + st.max[0]) / 2, cz = (st.min[2] + st.max[2]) / 2, surf = rampTop(rp, cx, cz);
    const N = H.stairs.find((s) => Math.abs(s.foot[1] - rp.minY) < 0.011 && s.x0 === rp.minX && s.z0 === rp.minZ);
    const riser = N ? N.riser : 0.2;
    if (Math.abs(st.max[1] - surf) > riser / 2 + 0.01) { E("vis-col", "step top " + st.max[1].toFixed(3) + " vs ramp " + surf.toFixed(3)); break; }
  }
  for (const rp of stairRamps) {
    const mine = steps.filter((st) => st.min[0] >= rp.minX - TOL && st.max[0] <= rp.maxX + TOL && st.min[2] >= rp.minZ - TOL && st.max[2] <= rp.maxZ + TOL && Math.abs(st.min[1] - rp.minY) < TOL);
    if (!mine.length) { E("vis-col", "a ramp with no drawn steps"); continue; }
    const u = { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity };
    for (const st of mine) { u.minX = Math.min(u.minX, st.min[0]); u.minZ = Math.min(u.minZ, st.min[2]); u.maxX = Math.max(u.maxX, st.max[0]); u.maxZ = Math.max(u.maxZ, st.max[2]); }
    if (Math.abs(u.minX - rp.minX) > TOL || Math.abs(u.maxX - rp.maxX) > TOL || Math.abs(u.minZ - rp.minZ) > TOL || Math.abs(u.maxZ - rp.maxZ) > TOL) E("vis-col", "steps' footprint != ramp footprint");
  }
  })();
  (() => {                                       // (a section of its own function: smaller units for the optimizing compiler)
  // furniture: kit colliders == manifest bbox placed by the kit entry; authored: parts AABB == collider AABB, parts inside colliders
  for (const p of H.furniture) {
    if (p.src === "kit") {
      const t = MAN.types[p.kit.type];
      if (!t) { E("vis-col", "unknown kit type " + p.kit.type); continue; }
      const q = p.kit.rot, c = [1, 0, -1, 0][q], s = [0, 1, 0, -1][q];
      let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      for (const X of [t.bbox_min_m[0], t.bbox_max_m[0]]) for (const Y of [t.bbox_min_m[1], t.bbox_max_m[1]]) for (const Z of [t.bbox_min_m[2], t.bbox_max_m[2]]) {
        const w = [p.kit.x + X * c + Z * s, p.kit.y + Y, p.kit.z - X * s + Z * c];
        for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], w[a]); mx[a] = Math.max(mx[a], w[a]); }
      }
      for (let a = 0; a < 3; a++) if (Math.abs(mn[a] - p.min[a]) > TOL || Math.abs(mx[a] - p.max[a]) > TOL) { E("vis-col", "kit " + p.kit.type + " collider != drawn bbox (axis " + a + ")"); break; }
    } else if (!p.deco) {
      let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      for (const bi of p.parts) { const b = H.boxes[bi]; for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], b.min[a]); mx[a] = Math.max(mx[a], b.max[a]); } }
      let cn = [Infinity, Infinity, Infinity], cx = [-Infinity, -Infinity, -Infinity];
      for (const g of p.cols) for (let a = 0; a < 3; a++) { cn[a] = Math.min(cn[a], g.min[a]); cx[a] = Math.max(cx[a], g.max[a]); }
      for (let a = 0; a < 3; a++) if (Math.abs(mn[a] - cn[a]) > TOL || Math.abs(mx[a] - cx[a]) > TOL) { E("vis-col", p.cat + " parts AABB != collider AABB"); break; }
      for (const bi of p.parts) {
        const b = H.boxes[bi];
        if (!p.cols.some((g) => b.min[0] >= g.min[0] - TOL && b.min[1] >= g.min[1] - TOL && b.min[2] >= g.min[2] - TOL && b.max[0] <= g.max[0] + TOL && b.max[1] <= g.max[1] + TOL && b.max[2] <= g.max[2] + TOL)) { E("vis-col", p.cat + " part outside its colliders"); break; }
      }
    }
  }
  })();
  (() => {                                       // (a section of its own function: smaller units for the optimizing compiler)
  // ---- pitched roofs: every plank IS its ramp (a roof ramp <= 45 deg, its drawn underside only outside the walls); the attic under the planks is
  // SEALED by 'gable' layer boxes that never rise above the plank's top; every end-wall polygon is a flat axis-aligned face lying on those layers
  if ((H.roofs && H.roofs.length) || H.boxes.some((b) => b.p === "gable")) {
    const hvOf = (c) => { const al = c.dir < 2 ? c.maxX - c.minX : c.maxZ - c.minZ, k = (c.maxY - c.minY) / Math.max(0.01, al); return 0.15 * Math.sqrt(1 + k * k); };
    const planks = (H.roofs || []).map((rf) => ({ rf, c: ramps[rf.ramp], meta: H.ramps[rf.ramp] }));
    const onPlank = (p, x, z) => x >= p.c.minX - 1e-6 && x <= p.c.maxX + 1e-6 && z >= p.c.minZ - 1e-6 && z <= p.c.maxZ + 1e-6;
    const topAt = (x, z) => { let y = -Infinity; for (const p of planks) if (onPlank(p, x, z)) y = Math.max(y, rampTop(p.c, x, z) + hvOf(p.c)); return y; };
    const botAt = (x, z) => { let y = Infinity; for (const p of planks) if (onPlank(p, x, z)) y = Math.min(y, rampTop(p.c, x, z) - hvOf(p.c)); return y; };
    // the walls' outline (world): the house's W x D plus the walls' outer half
    const c4 = [1, 0, -1, 0][H.turn], s4 = [0, 1, 0, -1][H.turn], hw = H.W / 2 + 0.12, hd = H.D / 2 + 0.12;
    const ex = Math.abs(hw * c4) + Math.abs(hd * s4), ez = Math.abs(hw * s4) + Math.abs(hd * c4);
    const OL = { minX: H.cx - ex, maxX: H.cx + ex, minZ: H.cz - ez, maxZ: H.cz + ez };
    for (const p of planks) {
      if (!p.c || !p.meta || !p.meta.roof) { E("roof", "a roof plank without its roof ramp"); break; }
      const run = p.c.dir < 2 ? p.c.maxX - p.c.minX : p.c.maxZ - p.c.minZ;
      if (p.c.maxY - p.c.minY > run + 1e-6) E("roof", "a roof plank steeper than 45 degrees");
      for (const q of p.rf.soffit) {
        if (q[0] < p.c.minX - 0.002 || q[2] > p.c.maxX + 0.002 || q[1] < p.c.minZ - 0.002 || q[3] > p.c.maxZ + 0.002) { E("roof", "a soffit outside its plank"); break; }
        if (Math.min(q[2], OL.maxX) - Math.max(q[0], OL.minX) > 0.002 && Math.min(q[3], OL.maxZ) - Math.max(q[1], OL.minZ) > 0.002) { E("roof", "a plank underside drawn over the house (it belongs to the sealed attic)"); break; }
      }
    }
    const layers = H.boxes.filter((b) => b.p === "gable");
    for (const b of layers) {
      if (!b.c) { E("roof", "an attic layer that is not a collider"); break; }
      let bad = false;
      for (const [x, z] of [[b.min[0], b.min[2]], [b.max[0], b.min[2]], [b.min[0], b.max[2]], [b.max[0], b.max[2]]]) if (b.max[1] > topAt(x, z) + 0.001) bad = true;
      if (bad) { E("roof", "an attic layer above its roof plank's top (a collider where nothing is drawn)"); break; }
    }
    const inLayer = (x, y, z, e) => layers.some((b) => x >= b.min[0] - e && x <= b.max[0] + e && y >= b.min[1] - e && y <= b.max[1] + e && z >= b.min[2] - e && z <= b.max[2] + e);
    for (const g of H.gables || []) {
      const ax = g.n[0] ? 0 : 2, pl = g.pts[0][ax];
      if (Math.abs(g.n[0]) + Math.abs(g.n[2]) !== 1 || g.n[1] !== 0 || g.pts.some((q) => Math.abs(q[ax] - pl) > 1e-6)) { E("roof", "an end-wall polygon that is not a flat axis-aligned face"); break; }
      const cx = g.pts.reduce((a, q) => a + q[0], 0) / g.pts.length, cy = g.pts.reduce((a, q) => a + q[1], 0) / g.pts.length, cz = g.pts.reduce((a, q) => a + q[2], 0) / g.pts.length;
      const samp = [[cx, cy, cz]];
      for (let i = 0; i < g.pts.length; i++) {
        const A = g.pts[i], Bq = g.pts[(i + 1) % g.pts.length];
        for (const t of [0, 0.5]) { const P0 = [A[0] + (Bq[0] - A[0]) * t, A[1] + (Bq[1] - A[1]) * t, A[2] + (Bq[2] - A[2]) * t]; samp.push([P0[0] + (cx - P0[0]) * 0.02, P0[1] + (cy - P0[1]) * 0.02, P0[2] + (cz - P0[2]) * 0.02]); }
      }
      // a sample counts when it lies on a layer's end face (in the polygon's plane, on the layer's outer side)
      const onFace = (q) => layers.some((b) => Math.abs((g.n[ax] > 0 ? b.max[ax] : b.min[ax]) - pl) < 0.002 && q[1] >= b.min[1] - 0.002 && q[1] <= b.max[1] + 0.002 &&
        (ax === 0 ? q[2] >= b.min[2] - 0.002 && q[2] <= b.max[2] + 0.002 : q[0] >= b.min[0] - 0.002 && q[0] <= b.max[0] + 0.002));
      if (samp.some((q) => !onFace(q))) { E("roof", "an end-wall polygon not lying on the attic layers (drawn where nothing collides)"); break; }
    }
    // sealed: points of the attic (inside the outline, from the roof slab's top to 3 cm under the plank) are inside a layer
    if (layers.length) {
      const y0a = Math.min(...layers.map((b) => b.min[1]));
      let holes = 0;
      for (let qx = 0.05; qx < 1; qx += 0.15) for (let qz = 0.05; qz < 1; qz += 0.15) {
        const x = OL.minX + (OL.maxX - OL.minX) * qx, z = OL.minZ + (OL.maxZ - OL.minZ) * qz, yb = botAt(x, z) - 0.03;
        for (let y = y0a + 0.02; y < yb; y += 0.25) if (!inLayer(x, y, z, 0.001)) holes++;
      }
      if (holes) E("roof", holes + " point(s) of the attic outside every layer (an open attic a player or a bullet could get into)");
    }
  }
  })();
  (() => {                                       // (a section of its own function: smaller units for the optimizing compiler)
  // ---- stairs
  for (const st of H.stairs) {
    const rp = ramps.find((c) => c.minX === st.x0 && c.minZ === st.z0);
    if (!rp) { E("stairs", "stair without its ramp"); continue; }
    const run = rp.dir < 2 ? rp.maxX - rp.minX : rp.maxZ - rp.minZ, rise = rp.maxY - rp.minY;
    if (rise > run + 1e-6) E("stairs", "steeper than 45 degrees");
    const f = floorOfY(rp.minY), g = floorOfY(rp.maxY);
    if (f < 0 || g !== f + 1) E("stairs", "ramp ends not on two consecutive floors (lip / top)");
    const need = headroomRun(rise, run);
    // the hole: no slab-top box at the upper floor over the ramp footprint within `need` of the top end
    const topEnd = (x, z) => (rp.dir === 0 ? rp.maxX - x : rp.dir === 1 ? x - rp.minX : rp.dir === 2 ? rp.maxZ - z : z - rp.minZ);
    for (const c of boxes) {
      if (g < 0 || Math.abs(c.maxY - fy[g]) > 0.011) continue;
      const ix0 = Math.max(c.minX, rp.minX), ix1 = Math.min(c.maxX, rp.maxX), iz0 = Math.max(c.minZ, rp.minZ), iz1 = Math.min(c.maxZ, rp.maxZ);
      if (ix1 - ix0 < 0.05 || iz1 - iz0 < 0.05) continue;
      const nearest = Math.min(topEnd(ix0, iz0), topEnd(ix1, iz1), topEnd(ix0, iz1), topEnd(ix1, iz0));
      if (nearest < need - 0.01) { E("stairs", "slab within " + nearest.toFixed(2) + " m of the top end (needs " + need.toFixed(2) + ")"); break; }
    }
  }
  })();
  (() => {                                       // (a section of its own function: smaller units for the optimizing compiler)
  // ---- doorways: clear height and width, measured on the colliders
  for (const d of H.doors) {
    const ax = Math.abs(d.nz) > 0.5 ? [1, 0] : [0, 1];
    // the clear width: every collider in the opening band (floor + 0.05 .. floor + 2.0) that reaches the doorway's line (+- 0.1 m across it) cuts
    // the line; the gap round the door's centre is the clear width (exact, from the boxes)
    let wl = 1.6, wr = 1.6;
    for (const c of boxes) {
      if (!(c.minY < d.y + 2.0 - 1e-6 && c.maxY > d.y + 0.05)) continue;
      const acrossLo = ax[0] ? c.minZ - d.z : c.minX - d.x, acrossHi = ax[0] ? c.maxZ - d.z : c.maxX - d.x;
      if (acrossHi <= -0.1 || acrossLo >= 0.1) continue;
      const a0 = ax[0] ? c.minX - d.x : c.minZ - d.z, a1 = ax[0] ? c.maxX - d.x : c.maxZ - d.z;
      if (a0 < 0 && a1 > 0) { wl = 0; wr = 0; break; }
      if (a1 <= 0) wl = Math.min(wl, -a1); else wr = Math.min(wr, a0);
    }
    if (wl + wr < 2.0) E("doors", d.kind + " door clear width " + (wl + wr).toFixed(2));
    if (d.height < 2.0 || d.width < 2.0) E("doors", "stated door size under 2.0 m");
  }
  })();
  (() => {                                       // (a section of its own function: smaller units for the optimizing compiler)
  // ---- windows
  for (const w of H.windows) {
    const f = w.floor, fl = fy[f];
    const boxesW = near(w.x - 1.5, w.z - 1.5, w.x + 1.5, w.z + 1.5).filter((c) => d2box(w.x, w.z, c) < 2.25), colsW = boxesW;
    if (Math.abs(w.sill - (fl + SILL)) > 0.011 || Math.abs(w.head - (fl + HEAD)) > 0.011) E("windows", "stated sill / head off the cover rule");
    const ax = Math.abs(w.nz) > 0.5 ? [1, 0] : [0, 1], hw = w.width / 2 - 0.01;
    const ap = { minX: w.x - ax[0] * hw - Math.abs(w.nx) * 0.12, maxX: w.x + ax[0] * hw + Math.abs(w.nx) * 0.12, minZ: w.z - ax[1] * hw - Math.abs(w.nz) * 0.12, maxZ: w.z + ax[1] * hw + Math.abs(w.nz) * 0.12, minY: fl + SILL + 0.01, maxY: fl + HEAD - 0.01 };
    if (boxesW.some((c) => ovl3(ap, c, 0))) E("windows", "a collider in the aperture");
    const sillBox = boxesW.find((c) => Math.abs(c.maxY - (fl + SILL)) < 0.011 && w.x >= c.minX && w.x <= c.maxX && w.z >= c.minZ && w.z <= c.maxZ);
    const headBox = boxesW.find((c) => Math.abs(c.minY - (fl + HEAD)) < 0.011 && w.x >= c.minX && w.x <= c.maxX && w.z >= c.minZ && w.z <= c.maxZ);
    if (!sillBox || !headBox) E("windows", "sill top / header bottom not at floor + 1.20 / 2.30");
    const shot = (eye) => { const a = [w.x - w.nx * 1.0, fl + eye, w.z - w.nz * 1.0], b = [w.x + w.nx * 1.0, fl + eye, w.z + w.nz * 1.0]; return !colsW.some((c) => segHits(a, b, c)); };
    if (!shot(EYE)) E("windows", "a standing-eye shot through the window is blocked");
    if (shot(CROUCH_EYE)) E("windows", "a crouched-eye shot passes (no cover)");
    const inside = { minX: Math.min(w.x, w.x - w.nx * 0.8) - ax[0] * hw, maxX: Math.max(w.x, w.x - w.nx * 0.8) + ax[0] * hw, minZ: Math.min(w.z, w.z - w.nz * 0.8) - ax[1] * hw, maxZ: Math.max(w.z, w.z - w.nz * 0.8) + ax[1] * hw };
    for (const p of H.furniture) if (!p.deco && p.floor === f && p.max[1] > fl + SILL + 0.01 && ovl2(inside, B(p.min, p.max), 1e-6)) { E("windows", p.cat + " taller than the sill in front of a window"); break; }
  }
  })();
  (() => {                                       // (a section of its own function: smaller units for the optimizing compiler)
  // ---- furniture overlaps
  const fb = H.furniture.filter((p) => !p.deco).map((p) => ({ p, b: B(p.min, p.max) }));
  for (let i = 0; i < fb.length; i++) for (let j = i + 1; j < fb.length; j++) if (fb[i].p.floor === fb[j].p.floor && ovl3(fb[i].b, fb[j].b, 0.001)) { E("furniture", fb[i].p.cat + " overlaps " + fb[j].p.cat); i = fb.length; break; }
  for (const { p, b } of fb) {
    // (the structure colliders near it: the furniture colliders follow the structure ones in collidersOf, a piece never meets itself here)
    if (near(b.minX, b.minZ, b.maxX, b.maxZ).some((c) => c.__s && ovl3(b, c, 0.001)) || ramps.some((c) => ovl3(b, c, 0.001))) { E("furniture", p.cat + " overlaps a wall / slab / stair collider"); break; }
  }
  for (const d of H.doors) {
    const ax = Math.abs(d.nz) > 0.5 ? [1, 0] : [0, 1], hw = d.width / 2 + 0.1, dep = 0.12 + 1.0;
    const z = { minX: d.x - ax[0] * hw - Math.abs(d.nx) * dep, maxX: d.x + ax[0] * hw + Math.abs(d.nx) * dep, minZ: d.z - ax[1] * hw - Math.abs(d.nz) * dep, maxZ: d.z + ax[1] * hw + Math.abs(d.nz) * dep };
    for (const { p, b } of fb) if (p.floor === d.floor && ovl2(z, b, 0.001)) { E("furniture", p.cat + " in a door zone"); break; }
  }
  for (const st of H.stairs) {
    const rp = ramps.find((c) => c.minX === st.x0 && c.minZ === st.z0);
    if (!rp) continue;
    // the stair's runouts: on its lower floor the ramp + 1 m before the foot, on its upper floor the hole + 1 m past the top (rp.dir = rising direction)
    const dx = rp.dir === 0 ? 1 : rp.dir === 1 ? -1 : 0, dz = rp.dir === 2 ? 1 : rp.dir === 3 ? -1 : 0;
    const lowZ = { minX: rp.minX - (dx > 0 ? 1 : 0), maxX: rp.maxX + (dx < 0 ? 1 : 0), minZ: rp.minZ - (dz > 0 ? 1 : 0), maxZ: rp.maxZ + (dz < 0 ? 1 : 0) };
    const highZ = { minX: rp.minX - (dx < 0 ? 1 : 0), maxX: rp.maxX + (dx > 0 ? 1 : 0), minZ: rp.minZ - (dz < 0 ? 1 : 0), maxZ: rp.maxZ + (dz > 0 ? 1 : 0) };
    for (const { p, b } of fb) if ((p.floor === st.from && ovl2(lowZ, b, 0.001)) || (p.floor === st.to && ovl2(highZ, b, 0.001))) { E("furniture", p.cat + " in a stair zone"); break; }
  }
  })();
  (() => {                                       // (a section of its own function: smaller units for the optimizing compiler)
  // ---- budget (recounted)
  const triF = new Array(S).fill(0);
  const pop = (h) => { let n = 0; for (let k = 0; k < 6; k++) if (h & (1 << k)) n++; return n; };
  for (const b of H.boxes) if (b.p !== "furn" && b.p !== "deco") triF[b.fl] += 12 - 2 * pop(b.h || 0);
  for (const p of H.furniture) triF[p.floor] += p.src === "kit" ? MAN.types[p.kit.type].tris : p.parts.reduce((a, bi) => a + 12 - 2 * pop(H.boxes[bi].h || 0), 0);
  for (const rf of H.roofs || []) triF[S - 1] += 2 + 4 + (rf.freeLow ? 2 : 0) + (rf.freeHigh ? 2 : 0) + 2 * rf.soffit.length;
  for (const g of H.gables || []) triF[S - 1] += g.pts.length - 2;
  for (let f = 0; f < S; f++) if (triF[f] > TRI_BUDGET) E("budget", "floor " + f + " has " + triF[f] + " triangles");
  })();
  // ---- reach: capsule walk on the colliders
  const x0 = H.aabb.min[0] - RING, z0 = H.aabb.min[2] - RING, NX = Math.ceil((H.aabb.max[0] + RING - x0) / GRID), NZ = Math.ceil((H.aabb.max[2] + RING - z0) / GRID);
  const sx = (a) => x0 + (a + 0.5) * GRID, sz = (b) => z0 + (b + 0.5) * GRID, NS = NX * NZ;
  const free = [], seen = [];
  for (let f = 0; f < S; f++) {
    const y = fy[f], fr = new Uint8Array(NS);
    if (f === 0) fr.fill(1);
    else for (const c of boxes) {                // a floor exists where a box top equals this floor's surface
      if (Math.abs(c.maxY - y) > 0.011) continue;
      const a0 = Math.max(0, Math.ceil((c.minX - x0) / GRID - 0.5)), a1 = Math.min(NX - 1, Math.floor((c.maxX - x0) / GRID - 0.5));
      const b0 = Math.max(0, Math.ceil((c.minZ - z0) / GRID - 0.5)), b1 = Math.min(NZ - 1, Math.floor((c.maxZ - z0) / GRID - 0.5));
      for (let b = b0; b <= b1; b++) for (let a = a0; a <= a1; a++) fr[b * NX + a] = 1;
    }
    for (const c of boxes) {
      if (!(c.maxY > y + STEP && c.minY < y + HGT)) continue;
      const a0 = Math.max(0, Math.floor((c.minX - R - x0) / GRID - 0.5)), a1 = Math.min(NX - 1, Math.ceil((c.maxX + R - x0) / GRID - 0.5));
      const b0 = Math.max(0, Math.floor((c.minZ - R - z0) / GRID - 0.5)), b1 = Math.min(NZ - 1, Math.ceil((c.maxZ + R - z0) / GRID - 0.5));
      for (let b = b0; b <= b1; b++) {
        const z = z0 + (b + 0.5) * GRID, ez = z < c.minZ ? c.minZ - z : z > c.maxZ ? z - c.maxZ : 0, ez2 = ez * ez;
        if (ez2 >= R * R) continue;
        for (let a = a0; a <= a1; a++) { const x = x0 + (a + 0.5) * GRID, ex = x < c.minX ? c.minX - x : x > c.maxX ? x - c.maxX : 0; if (ex * ex + ez2 < R * R) fr[b * NX + a] = 0; }
      }
    }
    for (const c of ramps) {
      const a0 = Math.max(0, Math.floor((c.minX - R - x0) / GRID)), a1 = Math.min(NX - 1, Math.ceil((c.maxX + R - x0) / GRID));
      const b0 = Math.max(0, Math.floor((c.minZ - R - z0) / GRID)), b1 = Math.min(NZ - 1, Math.ceil((c.maxZ + R - z0) / GRID));
      for (let b = b0; b <= b1; b++) for (let a = a0; a <= a1; a++) if (rampBlocks(c, sx(a), sz(b), y, HGT, R, STEP)) fr[b * NX + a] = 0;
    }
    free.push(fr); seen.push(new Uint8Array(NS));
  }
  const idx = (x, z) => { const a = Math.floor((x - x0) / GRID), b = Math.floor((z - z0) / GRID); return a < 0 || b < 0 || a >= NX || b >= NZ ? -1 : b * NX + a; };
  const nearSeen = (f, x, z, rad) => {
    const a0 = Math.max(0, Math.floor((x - rad - x0) / GRID)), a1 = Math.min(NX - 1, Math.ceil((x + rad - x0) / GRID));
    const b0 = Math.max(0, Math.floor((z - rad - z0) / GRID)), b1 = Math.min(NZ - 1, Math.ceil((z + rad - z0) / GRID));
    for (let b = b0; b <= b1; b++) for (let a = a0; a <= a1; a++) if (seen[f][b * NX + a]) { const dx = sx(a) - x, dz = sz(b) - z; if (dx * dx + dz * dz <= rad * rad) return true; }
    return false;
  };
  // stair links: walk each ramp's centreline at the ramp height (feet on the ramp), every collider box tested in the walk band
  const links = [];
  for (const c of ramps) {
    const f = floorOfY(c.minY), g = floorOfY(c.maxY);
    if (f < 0 || g < 0) continue;
    const alongX = c.dir < 2, sgn = c.dir === 0 || c.dir === 2 ? 1 : -1;
    const mid = alongX ? (c.minZ + c.maxZ) / 2 : (c.minX + c.maxX) / 2;
    const footT = sgn > 0 ? (alongX ? c.minX : c.minZ) : (alongX ? c.maxX : c.maxZ), run = alongX ? c.maxX - c.minX : c.maxZ - c.minZ;
    let ok = true;
    const nearB = boxes.filter((q) => q.maxX > c.minX - 1.2 && q.minX < c.maxX + 1.2 && q.maxZ > c.minZ - 1.2 && q.minZ < c.maxZ + 1.2 && q.maxY > fy[f] + STEP && q.minY < fy[g] + HGT);
    for (let d = -0.6; d <= run + 0.6 + 1e-9 && ok; d += 0.05) {
      const t = footT + sgn * d, x = alongX ? t : mid, z = alongX ? mid : t;
      const h = d < 0 ? fy[f] : d > run ? fy[g] : rampTop(c, x, z);
      for (const q of nearB) if (q.maxY > h + STEP && q.minY < h + HGT && d2box(x, z, q) < R * R) { ok = false; break; }
    }
    const pf = alongX ? [footT - sgn * 0.6, mid] : [mid, footT - sgn * 0.6], pt = alongX ? [footT + sgn * (run + 0.6), mid] : [mid, footT + sgn * (run + 0.6)];
    links.push({ ok, f, g, a: idx(pf[0], pf[1]), b: idx(pt[0], pt[1]) });
  }
  const fd = H.doors.find((d) => d.kind === "front");
  if (!fd || !fd.out) E("reach", "no front door / street point");
  else {
    const q = new Int32Array(NS * S + 4);
    let qn = 0;
    const lmark = []; for (let f = 0; f < S; f++) lmark.push(new Map());
    links.forEach((L, li) => { if (!L.ok) return; if (L.a >= 0) lmark[L.f].set(L.a, [L.g, L.b]); if (L.b >= 0) lmark[L.g].set(L.b, [L.f, L.a]); });
    const push = (f, k) => { if (k >= 0 && free[f][k] && !seen[f][k]) { seen[f][k] = 1; q[qn++] = f * NS + k; } };
    push(0, idx(fd.out[0], fd.out[1]));
    if (!qn) E("reach", "the street point outside the front door is blocked");
    while (qn) {
      const n = q[--qn], f = (n / NS) | 0, k = n - f * NS, a = k % NX, b = (k - a) / NX;
      if (a > 0) push(f, k - 1); if (a < NX - 1) push(f, k + 1); if (b > 0) push(f, k - NX); if (b < NZ - 1) push(f, k + NX);
      const lk = lmark[f].get(k);
      if (lk) push(lk[0], lk[1]);
    }
    for (const L of links) if (!L.ok) E("reach", "a stair cannot be walked (blocked on its centreline)");
    for (const rm of H.rooms) {
      let hit = false;
      for (const rc of rm.rects) {                 // the room's own cells (an L room's bounds cover a neighbour's corner)
        const a0 = Math.max(0, Math.floor((rc[0] - x0) / GRID)), a1 = Math.min(NX - 1, Math.ceil((rc[2] - x0) / GRID));
        const b0 = Math.max(0, Math.floor((rc[1] - z0) / GRID)), b1 = Math.min(NZ - 1, Math.ceil((rc[3] - z0) / GRID));
        for (let b = b0; b <= b1 && !hit; b++) for (let a = a0; a <= a1; a++) if (seen[rm.floor][b * NX + a] && sx(a) > rc[0] && sx(a) < rc[2] && sz(b) > rc[1] && sz(b) < rc[3]) { hit = true; break; }
        if (hit) break;
      }
      if (!hit) { E("reach", rm.kind + " room " + rm.id + " unreachable"); }
    }
    for (const d of H.doors) for (const sd of [-0.6, 0.6]) if (!nearSeen(d.floor, d.x + d.nx * sd, d.z + d.nz * sd, 0.2)) { E("reach", d.kind + " door side unreachable"); break; }
    for (const st of H.stairs) { if (!nearSeen(st.from, st.approach[0], st.approach[1], 1.1) || !nearSeen(st.to, st.exit[0], st.exit[1], 1.1)) E("reach", "stair end unreachable"); }
    for (const l of H.loot.concat(H.chests)) {
      const dy = l.y - fy[l.floor];
      if (dy < -0.01 || dy > REACH_DY) E("reach", "loot " + l.id + " " + dy.toFixed(2) + " m above its floor");
      if (!nearSeen(l.floor, l.x, l.z, REACH_XZ)) { E("reach", "loot " + l.id + " (" + (l.on || "chest") + ") unreachable"); break; }
    }
  }
  // ---- floor loot is on free floor: never inside or under a piece's collider (a coffee table, a pallet: the walk steps over them)
  for (const l of H.loot) {
    if (l.on !== "floor") continue;
    const p = H.furniture.find((q) => !q.deco && q.floor === l.floor && l.x > q.min[0] - 0.05 && l.x < q.max[0] + 0.05 && l.z > q.min[2] - 0.05 && l.z < q.max[2] + 0.05);
    if (p) { E("loot", "floor loot " + l.id + " under / inside " + p.cat); break; }
  }
  // ---- nav graph: every room joined to the street
  const adj = new Map();
  const add = (a, b) => { if (!adj.has(a)) adj.set(a, []); adj.get(a).push(b); };
  for (const L of H.nav.links) { add(L.a, L.b); if (L.bidir) add(L.b, L.a); }
  const st0 = H.id + ".street", vis = new Set([st0]), qq = [st0];
  while (qq.length) { const a = qq.pop(); for (const b of adj.get(a) || []) if (!vis.has(b)) { vis.add(b); qq.push(b); } }
  for (const rm of H.rooms) if (!vis.has(rm.id)) { E("nav", "room " + rm.id + " not linked to the street"); break; }
  // every room's walkable rectangles: inside its own cells, every 0.25 m sample of them reached by THIS checker's capsule walk, the room node in one
  // of them, every door / exit link's room-side point within 0.3 m of one
  if (fd && fd.out) {
    const inRects = (rects, x, z, m) => rects.some((q) => x > q[0] - m && x < q[2] + m && z > q[1] - m && z < q[3] + m);
    const CQ = [1, 0, -1, 0][H.turn], SQ = [0, 1, 0, -1][H.turn];
    let bad = null;
    for (const rm of H.rooms) {
      if (!rm.walk || !rm.walk.length) { bad = rm.id + " has no walkable rectangle"; break; }
      const own = new Uint8Array(64 * 64); for (const c of rm.cells) own[c[0] * 64 + c[1]] = 1;
      for (const q of rm.walk) {
        const sf = seen[rm.floor];
        // every sample: inside one of the room's own cells (the house's cell of the point, by the inverse of its quarter turn) and reached
        for (let x = q[0] + 0.125; x < q[2] && !bad; x += 0.25) for (let z = q[1] + 0.125; z < q[3]; z += 0.25) {
          const dx = x - H.cx, dz = z - H.cz, u = dx * CQ - dz * SQ, v = dx * SQ + dz * CQ;
          const ci = Math.floor((u + H.W / 2) / H.U), cj = Math.floor((v + H.D / 2) / H.U);
          if (ci < 0 || cj < 0 || ci >= 64 || cj >= 64 || !own[ci * 64 + cj]) { bad = rm.id + " walk sample outside its cells"; break; }
          const k0 = idx(x, z);
          if (!(k0 >= 0 && sf[k0]) && !nearSeen(rm.floor, x, z, 0.2)) { bad = rm.id + " walk sample the capsule does not reach"; break; }
        }
        if (bad) break;
      }
      if (bad) break;
      if (!rm.anchor || !inRects(rm.walk, rm.anchor[0], rm.anchor[2], 0.13)) { bad = rm.id + " room node outside its walkable area"; break; }
    }
    if (!bad) for (const L of H.nav.links) {
      if (L.type === "stair") continue;
      const ra = H.rooms.find((q) => q.id === L.a);
      if (ra && !inRects(ra.walk, L.from[0], L.from[2], 0.3)) { bad = "link " + L.door + " room-side point off " + ra.id + "'s walkable area"; break; }
    }
    if (bad) E("nav", bad);
  }
  if (H.nav.nodes.filter((n) => n.kind === "room").length !== H.rooms.length) E("nav", "room node count");
  // (stage B, lane I1) no furniture staircase: a low clutter piece (lowest collider top 0.2 .. 0.55 m over its floor: the game's mover steps onto it in passing) never
  // stands within 0.9 m of a floor piece whose lowest top is one more step up (rubble -> a table -> a chair: a walker brushing the rubble climbed onto the chair)
  {
    const CLUT = new Set(["rubble", "carton", "cartonOpen", "sacks", "hayBale", "boxStack", "palletLoad"]);
    const fl = H.furniture.filter((p) => !p.deco && p.min[1] - p.y < 0.02).map((p) => {
      const gs = p.src === "kit" ? [p] : p.cols, low = Math.min(...gs.map((g) => g.max[1])) - p.y;
      return { p, low, auth: p.src === "kit" ? p.cat : String(p.type).split("/").pop() };
    });
    let bad = null;
    for (const A of fl) {
      if (bad) break;
      if (!CLUT.has(A.auth) || A.low <= 0.2 || A.low > STEP) continue;
      for (const B of fl) {
        if (B === A || B.p.room !== A.p.room || B.low <= STEP || B.low - A.low > STEP) continue;          // (the same room: a wall stands between two rooms' pieces)
        const gx = Math.max(0, A.p.min[0] - B.p.max[0], B.p.min[0] - A.p.max[0]), gz = Math.max(0, A.p.min[2] - B.p.max[2], B.p.min[2] - A.p.max[2]);
        if (gx * gx + gz * gz < 0.81 - 1e-6) { bad = A.auth + " (top " + A.low.toFixed(2) + ") " + Math.sqrt(gx * gx + gz * gz).toFixed(2) + " m from " + B.p.cat + " (top " + B.low.toFixed(2) + ")"; break; }
      }
    }
    if (bad) E("staircase", bad);
  }
  return err;
}

/** a and b are the same JSON value (numbers ===, keys in the same order, arrays the same length) */
function deepSame(a, b) {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a)) { if (!Array.isArray(b) || a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (!deepSame(a[i], b[i])) return false; return true; }
  if (Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (let i = 0; i < ka.length; i++) { if (ka[i] !== kb[i] || !deepSame(a[ka[i]], b[kb[i]])) return false; }
  return true;
}
// ── a worker: generate + check a slice of the jobs ──────────────────────────────────────────────────────────────────────────────────────
async function runJobs(jobs) {
  const HGmod = await import(pathToFileURL(HG).href);
  const MAN = runJobs.MAN || (runJobs.MAN = loadManifest());       // (once per thread: the workers call this per chunk)
  const out = [];
  for (const j of jobs) {
    const p = Object.assign({}, j.parcel, { theme: j.theme, storeys: j.storeys });
    const t = Date.now();
    const H = HGmod.generate(p, j.opts);
    const ms = Date.now() - t;
    // (the JSON is only needed where it is compared: a house generated twice, and the sampled houses whose hash the main thread / a fresh process check)
    // (twice: the second house compared with the first value by value, key by key in order - the same verdict as comparing their JSON, without
    // building two strings; the hashed houses' JSON is what the main thread and a fresh process hash)
    const js = j.hashed ? JSON.stringify(H) : null, same = j.twice ? deepSame(H, HGmod.generate(p, j.opts)) : true;
    const errors = checkHouse(H, HGmod, MAN);
    if (!same) errors.push("determinism: two runs differ");
    const catsOf = new Map(); for (const q of H.furniture) { let l = catsOf.get(q.room); if (!l) { l = []; catsOf.set(q.room, l); } l.push(q.cat); }
    const keyed = new Map(), key = (k) => { let v = keyed.get(k); if (!v) { v = H.rooms.filter((r) => r.kind === k).map((r) => catsOf.get(r.id) || []); keyed.set(k, v); } return v; };
    const viewShort = H.rooms.filter((r) => Math.max(0, ...(r.views || []).map((v) => v.seen)) < 3).length;
    let lootIn = 0;
    for (const l of H.loot) if (l.on !== "floor") { const p = H.furniture.find((q) => q.room === l.room && q.cat === l.on && l.x > q.min[0] && l.x < q.max[0] && l.z > q.min[2] && l.z < q.max[2]); if (p && l.y < p.max[1] - 0.005) lootIn++; }
    out.push({ key: j.key, hash: j.hashed ? fnv(js) : null, errors, ms, kit: H.kit, viewShort, lootIn, hasTop: H.furniture.some((q) => q.mount === "top"), shell: H.shell || 0, fh: H.fh, hasRug: H.furniture.some((q) => q.cat === "rug") && H.furniture.some((q) => q.deco && q.max[1] - q.min[1] > 0.1), bedrooms: key("bedroom").length, bedless: key("bedroom").filter((l) => !l.includes("bed") && !l.includes("bedSingle")).length,
      baths: key("bath").length, toiletless: key("bath").filter((l) => !l.includes("toilet")).length, livings: key("living").length, sofaless: key("living").filter((l) => !l.includes("sofa") && !l.includes("sofaDesign")).length, storeys: H.storeys, asked: H.storeysAsked, plan: H.plan, use: H.use, roof: H.roof, theme: H.theme, facade: H.facade.mat + ":" + H.facade.color, relief: H.boxes.reduce((a, b) => a + (b.p === "trim" ? 1 : 0), 0),
      dens: H.rooms.map((r) => [r.kind, r.area, H.furniture.reduce((a, q) => a + (q.room === r.id && !q.deco ? 1 : 0), 0), H.furniture.reduce((a, q) => a + (q.room === r.id && q.deco ? 1 : 0), 0)]),
      kitTypes: [...new Set(H.furniture.filter((q) => q.src === "kit").map((q) => q.kit.type))], rooms: H.rooms.length, kinds: H.rooms.map((r) => r.kind),
      furn: H.furniture.length, loot: H.loot.length, chests: H.chests.length, doors: H.doors.length, windows: H.windows.length, tris: H.tris.floors, notes: H.notes, colliders: H.boxes.reduce((a, b) => a + b.c, 0) + H.ramps.length + H.furniture.reduce((a, q) => a + (q.deco ? 0 : q.src === "kit" ? 1 : q.cols.length), 0) });
  }
  return out;
}
module.exports = { checkHouse, parcels, runJobs, loadManifest };
if (!isMainThread) {
  // the workers share one job counter: each claims the next CHUNK jobs until none are left (big towers do not leave one thread running alone)
  (async () => {
    const all = workerData.jobs, ctr = new Int32Array(workerData.counter), out = [];
    for (;;) {
      const i = Atomics.add(ctr, 0, workerData.chunk);
      if (i >= all.length) break;
      for (const r of await runJobs(all.slice(i, i + workerData.chunk))) out.push(r);
    }
    return out;
  })().then((r) => parentPort.postMessage(r), (e) => parentPort.postMessage({ error: String(e && e.stack || e) }));
  return;
}

// ── main ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
function ok(cond, msg, detail) { if (cond) { passed++; console.log("  PASS  " + msg); } else { failed++; console.error("  FAIL  " + msg + (detail ? "   -> " + detail : "")); } }
function info(msg) { console.log("  info  " + msg); }

if (require.main === module) (async () => {
  const HGmod = await import(pathToFileURL(HG).href);
  const TGmod = await import(pathToFileURL(TG).href);
  const MAN = loadManifest();
  console.log("housegen selftest (v" + HGmod.VERSION + ")");
  // ---- constants and tables
  ok(Math.abs(HGmod.DOOR_CLEAR - 2.26) < 1e-9 && HGmod.DOOR_CLEAR === TGmod.DOOR_W && HGmod.U === TGmod.CELL, "doors 2.26 m clear on the 2.5 m grid (= towngen DOOR_W / CELL)");
  ok(HGmod.SILL === SILL && HGmod.HEAD === HEAD && HGmod.CAPSULE.r === R && HGmod.CAPSULE.h === HGT && HGmod.CAPSULE.step === STEP && HGmod.MAX_FLOORS === TGmod.MAX_FLOORS, "cover rule 1.20 / 2.30, capsule 0.45 / 1.8 / 0.55, <= 3 floors (towngen MAX_FLOORS)");
  const mapsSrc = fs.readFileSync(path.join(__dirname, "maps.js"), "utf8"), playerSrc = fs.readFileSync(path.join(__dirname, "player.js"), "utf8");
  ok(/const STEP_UP = 0\.55;/.test(playerSrc) && /return \(PK_\.height \+ arc \+ 0\.10\) \/ m \+ PK_\.radius;/.test(mapsSrc) && /sill  \(y\+0\.00\.\.y\+1\.20\)/.test(mapsSrc), "the game's STEP_UP, stairHeadroomRun and window sill are still the ones copied here");
  let drift = [];
  for (const [type, kb] of Object.entries(HGmod.KIT_BOXES)) {
    const t = MAN.types[type];
    if (!t) { drift.push(type + " missing"); continue; }
    if (t.tris !== kb.tris || t.bbox_min_m.some((v, a) => Math.abs(v - kb.min[a]) > 1e-9) || t.bbox_max_m.some((v, a) => Math.abs(v - kb.max[a]) > 1e-9)) drift.push(type);
  }
  ok(drift.length === 0, "KIT_BOXES == manifest.json / manifest_interior.json bbox_min_m / bbox_max_m / tris for all " + Object.keys(HGmod.KIT_BOXES).length + " kit furniture types", drift.join(", "));
  let rngSame = true;
  for (const sd of [0, 1, 7, 123456, 4294967295]) { const a = HGmod.mulberry32(sd), b = TGmod.mulberry32(sd); for (let k = 0; k < 50; k++) if (a() !== b()) rngSame = false; }
  ok(rngSame && HGmod.hash32("abc") === TGmod.hash32("abc"), "mulberry32 / hash32 == towngen's (the sim's generator)");
  for (const [rise, run] of [[3.4, 5], [3, 5], [4, 5]]) ok(Math.abs(HGmod.stairHeadroomRun(rise, run) - headroomRun(rise, run)) < 1e-12, "stairHeadroomRun(" + rise + ", " + run + ") == maps.js formula (" + headroomRun(rise, run).toFixed(3) + " m)");

  // ---- the 4,500 houses over worker threads
  const PS = parcels(N_PARCELS), jobs = [];
  for (let k = 0; k < PS.length; k++) for (const theme of themesOf(k)) for (let st = 1; st <= 3; st++) jobs.push({ key: k + ":" + theme + ":" + st, parcel: PS[k], theme, storeys: storeysOf(PS[k], k, st), twice: jobs.length % 6 === 0, hashed: jobs.length % 30 === 0 });
  const N_MAIN = jobs.length;
  // the "base" kit profile (the 16 shipped Kenney types + authored boxes: what stage B falls back to if lane H2's kit does not land) on the first 40 parcels
  for (let k = 0; k < Math.min(40, PS.length); k++) for (const theme of themesOf(k)) for (let st = 1; st <= 3; st++) jobs.push({ key: "base:" + k + ":" + theme + ":" + st, parcel: PS[k], theme, storeys: storeysOf(PS[k], k, st), opts: { kit: "base" }, twice: k % 3 === 0 });
  // (one worker per PHYSICAL core: os.cpus() lists hyperthreads - on the 8-core / 16-thread laptop 8 workers ran 14.7-15.7 s, 12 ran 17.3 s, 14 ran 19.4 s)
  const NW = Number(process.env.HG_WORKERS) || Math.max(1, Math.min(8, Math.floor(os.cpus().length / 2)));
  const counter = new SharedArrayBuffer(4), tW = Date.now();
  const resP = Promise.all(Array.from({ length: NW }, () => new Promise((resolve, reject) => {
    const w = new Worker(__filename, { workerData: { jobs, counter, chunk: 8 }, resourceLimits: { maxYoungGenerationSizeMb: Number(process.env.HG_YOUNG) || 64 } });   // (a bigger young generation: a house is ~100 kB of short-lived objects, fewer scavenges)
    w.once("message", (m) => { if (m && m.error) reject(new Error(m.error)); else resolve(m); w.terminate(); });
    w.once("error", reject);
  })));
  // while the workers run: a fresh process and this thread hash every 30th house on their own (cross-thread / cross-process determinism)
  const sampleJobs = jobs.filter((j, i) => i < N_MAIN && i % 30 === 0);
  const cps = sampleJobs.slice(0, 40).map((j) => Object.assign({}, j.parcel, { theme: j.theme, storeys: j.storeys }));
  const childSrc = "import(" + JSON.stringify(pathToFileURL(HG).href) + ").then(M=>{const P=JSON.parse(process.argv[1]);const o=[];for(const p of P){let s=JSON.stringify(M.generate(p)),h=0x811c9dc5;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,0x01000193)}o.push((h>>>0).toString(16))}console.log(JSON.stringify(o))})";
  const childP = new Promise((resolve) => { const c = cp.spawn(process.execPath, ["-e", childSrc, JSON.stringify(cps)]); let out = "", errs = ""; c.stdout.on("data", (d) => { out += d; }); c.stderr.on("data", (d) => { errs += d; }); c.on("close", () => resolve({ out, errs })); });
  const mainHash = new Map();
  for (const j of sampleJobs) mainHash.set(j.key, fnv(JSON.stringify(HGmod.generate(Object.assign({}, j.parcel, { theme: j.theme, storeys: j.storeys })))));   // (j.storeys: the job's own)
  // the fixed rows that need no worker result run here, on this thread, while the workers work (their verdicts print in place below)
  const pre = [], okP = (c, m, d) => pre.push([c, m, d]);
  // storey heights: floor spacing == the use's storey height (or the parcel's), a stair rises one storey
  {
    let bad = [];
    for (const [use, fh] of Object.entries(HGmod.USE_FH)) for (const theme of THEMES) {
      const H = HGmod.generate({ id: "fh-" + use, w: 12.5, d: 12.5, theme, use, storeys: use === "tower" ? 6 : 3, seed: 77 });
      const want = H.floors.length > 1 ? fh : null;
      for (let f = 1; f < H.floors.length; f++) if (Math.abs(H.floors[f].y - H.floors[f - 1].y - fh) > 1e-6) bad.push(use + " floor " + f);
      for (const st of H.stairs) if (Math.abs(st.rise - fh) > 1e-6) bad.push(use + " stair rise " + st.rise);
      if (H.fh !== fh) bad.push(use + " fh " + H.fh);
      void want;
    }
    okP(bad.length === 0, "storey heights: house 3.4, shop 4.0, hall 5.0, shed 3.0, barn 6.0, midrise / tower 4.0 (floors and stairs)", bad.slice(0, 4).join(", "));
  }
  // small plots: towngen's 5 x 5 and 7.5 x 5 m sheds (and a 5 x 7.5 m one) are built AT their size, every turn and theme (walls on the plot's outline)
  {
    let bad = [];
    for (const [w, d] of [[5, 5], [7.5, 5], [5, 7.5]]) for (const theme of THEMES) for (let turn = 0; turn < 4; turn++) {
      const H = HGmod.generate({ id: "shed", w, d, turn, theme, use: "shed", storeys: 1, seed: 5 + turn });
      if (H.W !== (turn % 2 ? w : w) || H.D !== d || H.rooms.length < 1 || !H.furniture.some((p) => !p.deco)) bad.push(w + "x" + d + " " + theme + " t" + turn + " W " + H.W + " D " + H.D);
      const e = checkHouse(H, HGmod, MAN);
      if (e.length) bad.push(w + "x" + d + " " + theme + " t" + turn + ": " + e[0]);
    }
    okP(bad.length === 0, "sheds 5 x 5 / 7.5 x 5 / 5 x 7.5 m built at their plot size, furnished, every check passes (36 sheds)", bad.slice(0, 3).join(" | "));
  }
  // (Wave 8 fix round, lane K1) DOOR_OUT: a parcel's neighbours (P.near, world rects) 1.5 m behind and beside the house - an alley - get no street / back door opening
  // onto them; the same houses without neighbours DO open back / side doors there (the control: the rule bites)
  {
    let bad = [], withNear = 0, without = 0, checks = 0;
    const strip = (H, d) => { const out = [], nx = d.out ? (d.out[0] - d.x) : d.nx, nz = d.out ? (d.out[1] - d.z) : d.nz, l = Math.hypot(nx, nz) || 1; for (let k = 1; k <= 9; k++) for (const lat of [-0.9, 0, 0.9]) out.push([d.x + nx / l * (0.12 + 0.2 + (HGmod.DOOR_OUT - 0.2) * k / 9) - nz / l * lat, d.z + nz / l * (0.12 + 0.2 + (HGmod.DOOR_OUT - 0.2) * k / 9) + nx / l * lat]); return out; };
    for (const theme of ALL_THEMES) for (let turn = 0; turn < 4; turn++) for (const [w, d] of [[10, 10], [12.5, 7.5], [7.5, 12.5]]) {
      const base = { id: "alley-" + theme + turn + w, cx: 50, cz: -20, w, d, turn, theme, use: "house", storeys: 1 + (turn % 2), seed: 9100 + turn * 7 + w };
      const H0 = HGmod.generate(base);
      const A = H0.aabb, g = 1.5;
      // the three sides that are not the street side (the front door's): a 4 m deep building strip g out from the house's box
      const fd = H0.doors.find((q) => q.kind === "front"), fnx = Math.round(fd.out ? fd.out[0] - fd.x : fd.nx), fnz = Math.round(fd.out ? fd.out[1] - fd.z : fd.nz);
      const near = [];
      if (!(fnx < 0)) near.push([A.max[0] + g, A.min[2] - 6, A.max[0] + g + 4, A.max[2] + 6]);
      if (!(fnx > 0)) near.push([A.min[0] - g - 4, A.min[2] - 6, A.min[0] - g, A.max[2] + 6]);
      if (!(fnz < 0)) near.push([A.min[0] - 6, A.max[2] + g, A.max[0] + 6, A.max[2] + g + 4]);
      if (!(fnz > 0)) near.push([A.min[0] - 6, A.min[2] - g - 4, A.max[0] + 6, A.min[2] - g]);
      const H1 = HGmod.generate(Object.assign({}, base, { near }));
      const hits = (H) => H.doors.filter((q) => q.rooms[1] == null && q.kind !== "front" && strip(H, q).some(([x, z]) => near.some((r) => x > r[0] - 0.2 && x < r[2] + 0.2 && z > r[1] - 0.2 && z < r[3] + 0.2)));
      checks++; without += hits(H0).length; const h1 = hits(H1); withNear += h1.length;
      if (h1.length) bad.push(base.id + ": " + h1.map((q) => q.id).join(","));
      const e = checkHouse(H1, HGmod, MAN);
      if (e.length) bad.push(base.id + " (with neighbours): " + e[0]);
    }
    okP(bad.length === 0 && without > 0, "DOOR_OUT: no street / back door onto a neighbour 1.5 m away (" + checks + " houses, every theme and turn; without the neighbours " + without + " such doors open there - the control), every check passes", bad.slice(0, 3).join(" | ") + (without ? "" : " | the control found no door to move"));
  }
  // (stage B, lane I1) translateY: generate({ y: Y }) == translateY(generate({ y: 0 }), Y) number by number (<= 1.5 mm), key by key; and meshData's interior split
  // moves faces between keys, it adds or drops none (maps.js draws the outside per district and the inside per chunk from it)
  {
    let bad = [], nums = 0, splitBad = 0;
    const cmp = (a, b, p) => {
      if (typeof a === "number") { nums++; if (typeof b !== "number" || Math.abs(a - b) > 0.0015) bad.push(p + " " + a + " vs " + b); return; }
      if (a && typeof a === "object") { const ka = Object.keys(a), kb = Object.keys(b || {}); if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) { bad.push(p + " keys"); return; } for (const k of ka) cmp(a[k], b[k], p + "." + k); }
      else if (a !== b) bad.push(p + " " + a + " vs " + b);
    };
    const one = () => [1, 1, 1];
    for (let k = 0; k < 36 && bad.length < 4; k++) {
      const par = Object.assign({}, PS[(k * 13) % PS.length], { theme: THEMES[k % THEMES.length], storeys: 1 + (k % 3), use: HGmod.USES[k % HGmod.USES.length], y: 0 }), Y = 2.37 + 3.11 * k;
      cmp(HGmod.generate(Object.assign({}, par, { y: Y })), HGmod.translateY(HGmod.generate(par), Y), "H");
      const H = HGmod.generate(par), tri = (md) => { let n = 0; for (const g of Object.values(md.groups)) for (const a of g.values()) n += a.idx.length / 3; return n; };
      const m0 = HGmod.meshData(H, one, { wear: false }), m1 = HGmod.meshData(H, one, { interior: true, wear: false });      // (P23: the wear strips are checked in their own row below)
      const kitTris = H.furniture.reduce((a, q) => a + (q.src === "kit" ? q.tris : 0), 0);      // (the kit pieces are the GLBs' triangles, drawn by the caller)
      if (tri(m0) !== tri(m1) || tri(m0) + kitTris !== H.tris.total || [...m1.groups.walls.keys()].some((q) => !/^[a-z_]+(\|in)?$/.test(q))) splitBad++;
    }
    okP(bad.length === 0 && nums > 100000, "translateY == generate at that height, every number of 36 houses (" + nums + " numbers, <= 1.5 mm)", bad.slice(0, 3).join(" | "));
    okP(splitBad === 0, "meshData: the interior split keeps every face (its triangles + the kit pieces' == house.tris.total on 36 houses)", splitBad + " differ");
  }
    // (P23 / LC-17) the wear strips: only on OUTSIDE faces of wall materials, WEAR_OFF in front of a face of a box, never brighter than the wall, the foot strip within
    // WEAR_FOOT[1] of the ground floor and the eave strip within WEAR_EAVE of the top ceiling; the box faces (and so boxRanges) are untouched; <= 14 % more wall triangles
    {
      // (+ 12 RUIN houses: their broken tops wear the WEAR_BURN soot fade, from the face top down <= WEAR_BURN.h1, never over the foot strip)
      let wbad = [], wTris = 0, baseTris = 0, nFoot = 0, nEave = 0, nBurn = 0, ruinTris = 0, ruinBase = 0;
      const grey = () => [0.5, 0.5, 0.5], kMin = Math.min(HGmod.WEAR_K[0], HGmod.WEAR_BURN.k);
      for (let k = 0; k < 48; k++) {
        const ruin = k >= 36;
        const par = Object.assign({}, PS[(k * 7) % PS.length], { theme: ruin ? "ruin" : THEMES[k % THEMES.length], storeys: 1 + (k % 3), use: HGmod.USES[k % HGmod.USES.length], y: 0 });
        const H = HGmod.generate(par);
        const a = HGmod.meshData(H, grey, { interior: true }), b = HGmod.meshData(H, grey, { interior: true, wear: false });
        if (JSON.stringify(a.boxRanges) !== JSON.stringify(b.boxRanges)) wbad.push(par.use + " boxRanges moved");
        const yG = H.floors[0].y, top = H.floors[H.floors.length - 1].ceil;
        for (const [key, g] of a.groups.walls) {
          const g0 = b.groups.walls.get(key), n0 = g0 ? g0.pos.length / 3 : 0;
          if (g0 && g.pos.slice(0, g0.pos.length).some((v, i) => v !== g0.pos[i])) wbad.push(par.use + " " + key + " box vertices changed");
          if (ruin) { ruinBase += n0 / 2; ruinTris += (g.pos.length / 3 - n0) / 2; } else { baseTris += n0 / 2; wTris += (g.pos.length / 3 - n0) / 2; }
          if (g.pos.length / 3 > n0 && key.indexOf("|in") >= 0) wbad.push(par.use + " wear on an inside face (" + key + ")");
          for (let v = n0; v < g.pos.length / 3; v++) {
            const x = g.pos[v * 3], y = g.pos[v * 3 + 1], z = g.pos[v * 3 + 2], c = g.col[v * 3];
            if (c > 0.5 + 1e-9 || c < 0.5 * kMin - 1e-9) wbad.push(par.use + " wear colour " + c.toFixed(3));
            const inFoot = y <= yG + HGmod.WEAR_FOOT[1] + 1e-6, inEave = !ruin && y >= top - HGmod.WEAR_EAVE - 1e-6 && y <= top + 1e-6;
            const inBurn = ruin && y >= top - 0.05 - HGmod.WEAR_BURN.h1 - 1e-6 && y <= H.aabb.max[1] + 1e-6;
            if (!inFoot && !inEave && !inBurn) wbad.push(par.use + (ruin ? " (ruin)" : "") + " wear vertex at y " + y.toFixed(2));
            if (v % 4 === 0) { if (inFoot && !(inBurn && c < 0.5 * HGmod.WEAR_K[0] - 1e-9)) nFoot++; else if (inBurn) nBurn++; else nEave++; }
            // in front of a box face: on a face plane + 0.012 m, inside that face's rectangle
            let onFace = false;
            for (const bx of H.boxes) {
              for (let ax = 0; ax < 3 && !onFace; ax += 2) {
                const q = ax === 0 ? x : z;
                if (Math.abs(q - (bx.max[ax] + 0.012)) > 1e-6 && Math.abs(q - (bx.min[ax] - 0.012)) > 1e-6) continue;
                const ua = ax === 0 ? 2 : 0, u = ua === 0 ? x : z;
                if (u >= bx.min[ua] - 1e-6 && u <= bx.max[ua] + 1e-6 && y >= bx.min[1] - 1e-6 && y <= bx.max[1] + 1e-6) onFace = true;
              }
              if (onFace) break;
            }
            if (!onFace) wbad.push(par.use + " wear vertex " + x.toFixed(2) + "," + y.toFixed(2) + "," + z.toFixed(2) + " is not in front of a box face");
            if (wbad.length > 6) break;
          }
        }
      }
      okP(wbad.length === 0 && nFoot > 200 && nEave > 50 && nBurn > 100 && wTris <= 0.14 * baseTris && ruinTris / 12 <= 1000, "meshData wear strips (LC-17): outside wall faces only, 12 mm in front of a box face, darker than the wall (foot " + nFoot + ", eave " + nEave + " strips on 36 houses; ruin soot " + nBurn + " strips on 12 ruins), +" + (100 * wTris / Math.max(1, baseTris)).toFixed(1) + " % wall triangles (<= 14 %), ruins +" + (ruinTris / 12).toFixed(0) + " triangles a house (<= 1000: drawn in the district mix, no draw call; +" + (100 * ruinTris / Math.max(1, ruinBase)).toFixed(0) + " % of their wall triangles); box vertices and boxRanges untouched", wbad.slice(0, 4).join(" | "));
    }
  // O3 on tall shells: <= 3 walkable floors, the rest closed (one exact mass: nobody gets in), the asked height kept
  {
    let bad = [];
    for (const use of ["tower", "midrise"]) for (const theme of THEMES) for (const st of [4, 6, 9]) {
      const H = HGmod.generate({ id: "tall", w: 15, d: 15, theme, use, storeys: st, seed: 31 + st });
      if (H.floors.length > 3 || H.storeys + H.shell !== st || !H.boxes.some((b) => b.p === "shell" && b.c)) bad.push(use + " " + st + ": walkable " + H.floors.length + " shell " + H.shell);
      if (Math.max(...H.tris.floors) > TRI_BUDGET || H.tris.shell > TRI_BUDGET * Math.max(1, H.shell)) bad.push(use + " " + st + " budget " + H.tris.floors + " / " + H.tris.shell);
    }
    okP(bad.length === 0, "towers / mid-rises asked for 4-9 storeys: <= 3 walkable, the others one closed mass, height kept; budget (18 buildings)", bad.slice(0, 3).join(" | "));
  }
  // ---- builder (three r172 in Node): 24 vertices per box with that box's exact bounds
  try {
    const THREE = await import(pathToFileURL(THREE_JS).href);
    let bad = 0, tot = 0, boundsBad = 0;
    for (let i = 0; i < 30; i++) {
      const jI = jobs.slice(0, N_MAIN), r = jI[i * 149 % jI.length], [k, theme, st] = r.key.split(":");
      const H = HGmod.generate(Object.assign({}, PS[+k], { theme, storeys: storeysOf(PS[+k], +k, +st) }));
      const built = HGmod.buildHouse(THREE, H, { wear: false });
      const meshByMat = new Map(); for (const m of built.meshes) meshByMat.set(m.name, m);
      // each box: its 6 faces live in the meshes of their materials, 4 vertices each; collect them back
      const pos = new Map();
      for (const m of built.meshes) pos.set(m, { p: m.geometry.attributes.position.array, cursor: 0 });
      const gp = {}; for (const m of built.meshes) gp[m.name.split(":").pop() + ":" + (m.parent.name)] = m;
      const cursor = new Map();
      for (const b of H.boxes) {
        const grp = b.p === "furn" || b.p === "deco" ? "furniture" : b.p === "glass" ? "glass" : "walls";
        tot++;
        let faceBad = false;
        for (let fi = 0; fi < 6; fi++) {
          if (b.h & (1 << fi)) continue;                    // culled: covered by another box (checked in checkHouse)
          const m = gp[H.palette[b.f[fi]].mat + ":" + grp], c = cursor.get(m) || 0, a = m.geometry.attributes.position.array;
          // the face's 4 vertices span exactly that face of the box: on its plane, over its whole rectangle
          const ax = fi >> 1, plane = fi & 1 ? b.min[ax] : b.max[ax];
          let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
          for (let v = 0; v < 4; v++) for (let q = 0; q < 3; q++) { const val = a[(c + v) * 3 + q]; mn[q] = Math.min(mn[q], val); mx[q] = Math.max(mx[q], val); }
          for (let q = 0; q < 3; q++) {
            const lo = q === ax ? plane : b.min[q], hi = q === ax ? plane : b.max[q];
            if (Math.abs(mn[q] - lo) > 1e-4 || Math.abs(mx[q] - hi) > 1e-4) faceBad = true;
          }
          cursor.set(m, c + 4);
        }
        if (faceBad) bad++;
      }
      // after the boxes, the walls meshes hold the pitched roofs: 3 vertices per triangle (a plank: top 2, sides 4, free ends 2 each, soffits 2 each; an end wall: its fan)
      const extra = new Map(), addX = (mat, nTri) => { const m = gp[mat + ":walls"]; extra.set(m, (extra.get(m) || 0) + 3 * nTri); };
      for (const rf of H.roofs || []) { addX(H.palette[rf.top].mat, 2); addX(H.palette[rf.edge].mat, 4 + (rf.freeLow ? 2 : 0) + (rf.freeHigh ? 2 : 0) + 2 * rf.soffit.length); }
      for (const g of H.gables || []) addX(H.palette[g.pal].mat, g.pts.length - 2);
      for (const m of built.meshes) if ((cursor.get(m) || 0) + (extra.get(m) || 0) !== m.geometry.attributes.position.count) bad++;
      const bb = new THREE.Box3(); for (const m of built.meshes) bb.union(m.geometry.boundingBox);
      const kitOnly = H.furniture.filter((p) => p.src === "kit");
      const ext = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
      for (const b of H.boxes) for (let a = 0; a < 3; a++) { ext.min[a] = Math.min(ext.min[a], b.min[a]); ext.max[a] = Math.max(ext.max[a], b.max[a]); }
      for (const rf of H.roofs || []) { const r = H.ramps[rf.ramp], hv = HGmod.rampHalfV(r); for (let a = 0; a < 3; a++) { ext.min[a] = Math.min(ext.min[a], r.min[a] - (a === 1 ? hv : 0)); ext.max[a] = Math.max(ext.max[a], r.max[a] + (a === 1 ? hv : 0)); } }
      if (Math.abs(bb.min.x - ext.min[0]) > 1e-4 || Math.abs(bb.max.y - ext.max[1]) > 1e-4 || Math.abs(bb.max.z - ext.max[2]) > 1e-4) boundsBad++;
      if (built.kitList.length !== kitOnly.length || built.colliders.length !== HGmod.collidersOf(H).length) bad++;
      built.dispose();
    }
    okP(bad === 0 && boundsBad === 0, "buildHouse (three r172): every drawn face of every box = 4 vertices spanning exactly that face; vertex counts match; mesh bounds == box bounds (" + tot + " boxes, 30 houses)", bad + " / " + boundsBad);
  } catch (e) { okP(false, "buildHouse runs in Node with the vendored three", String(e && e.stack || e).slice(0, 300)); }
  const resByKey = new Map((await resP).flat().map((r) => [r.key, r]));
  const res = jobs.map((j) => resByKey.get(j.key)).filter(Boolean);       // (in job order: the workers claim chunks in whatever order the box runs them)
  const resBy = new Map(res.map((r) => [r.key, r]));
  info(res.length + " houses generated + checked in " + ((Date.now() - tW) / 1000).toFixed(1) + " s on " + NW + " worker threads (generate p50 " + pctl(res.map((r) => r.ms), 0.5) + " ms, p99 " + pctl(res.map((r) => r.ms), 0.99) + " ms)");
  const byCode = new Map();
  for (const r of res) for (const e of r.errors) { const code = e.split(":")[0]; if (!byCode.has(code)) byCode.set(code, []); byCode.get(code).push(r.key + " " + e); }
  const row = (code, label) => { const l = byCode.get(code) || []; ok(l.length === 0, label + " (" + res.length + " houses)", l.length + " failing, e.g. " + l.slice(0, 3).join(" | ")); };
  ok(res.length === jobs.length && res.filter((r) => r.kit === "interior").length === N_PARCELS * 9, "all " + N_PARCELS + " parcels x 3 themes x 1-3 storeys generated with the default (interior) kit + " + (jobs.length - N_MAIN) + " with the base kit (" + res.length + " houses)");
  row("determinism", "deterministic: same parcel -> byte-identical JSON (generated twice in-thread for every 6th house: " + jobs.filter((j) => j.twice).length + ")");
  row("floors", "<= 3 walkable floors, floors == storeys");
  row("reach", "capsule walk from the street door reaches every room, door side, stair end, loot point and chest");
  row("nav", "nav links join every room to the street node");
  row("furniture", "no furniture overlapping another piece, a collider, a door zone or a stair zone");
  row("doors", "doorways >= 2.0 m clear (width and height, measured on the colliders)");
  row("windows", "windows: empty aperture, sill 1.20 / header 2.30, shootable standing, cover crouched, no tall piece in front");
  row("vis-col", "colliders == visual extents (structure exact; kit vs manifest bbox, authored, steps vs ramp within 2 cm)");
  row("stairs", "stairs <= 45 deg, lip 0, top on the next floor, hole >= stairHeadroomRun");
  row("budget", "<= " + TRI_BUDGET + " triangles per storey (recounted)");
  row("roof", "pitched roofs: every plank IS its ramp (<= 45 deg, underside drawn only outside the walls); the attic sealed by layers under the plank; end walls on the layers");
  row("loot", "floor loot points on free floor (never inside / under a piece's collider)");
  row("staircase", "no furniture staircase: no low clutter (lowest top 0.2-0.55 m) within 0.9 m of a piece one step up");
  const other = [...byCode.keys()].filter((k) => !["determinism", "floors", "reach", "nav", "furniture", "doors", "windows", "vis-col", "stairs", "budget", "roof", "loot", "staircase"].includes(k));
  ok(other.length === 0, "no other checker errors", other.join(", "));
  // cross-thread + fresh process determinism
  let xt = 0;
  for (const j of sampleJobs) if (mainHash.get(j.key) !== resBy.get(j.key).hash) xt++;
  ok(xt === 0, "worker-thread hashes == main-thread hashes (" + sampleJobs.length + " houses)", xt + " differ");
  const cr = await childP;
  let child = null; try { child = JSON.parse(cr.out.trim()); } catch (e) { /* reported below */ }
  ok(child && child.length === cps.length && child.every((h, i) => h === resBy.get(sampleJobs[i].key).hash), "a fresh node process gives the same hashes (" + cps.length + " houses)", (cr.errs || "").slice(0, 200));

  for (const kp of ["interior", "base"]) {
    const rr = res.filter((r) => r.kit === kp), sum = (f) => rr.reduce((a, r) => a + r[f], 0);
    info("key pieces (" + kp + " kit, " + rr.length + " houses): bedrooms with a bed " + (sum("bedrooms") - sum("bedless")) + "/" + sum("bedrooms") + " (bedless ones are relabelled storage, so this is all of them), baths with a toilet " + (sum("baths") - sum("toiletless")) + "/" + sum("baths") + ", living rooms with a sofa " + (sum("livings") - sum("sofaless")) + "/" + sum("livings"));
  }
  // ---- coverage / information
  const kinds = {}; let L = 0, shops = 0, clamped = 0, furn = 0, loot = 0, rooms = 0, chests = 0, wins = 0;
  for (const r of res) { for (const k of r.kinds) kinds[k] = (kinds[k] || 0) + 1; if (r.plan === "L") L++; if (r.use === "shop") shops++; if (r.storeys !== r.asked) clamped++; furn += r.furn; loot += r.loot; rooms += r.rooms; chests += r.chests; wins += r.windows; }
  info("rooms " + rooms + " " + JSON.stringify(kinds) + "; L plans " + L + ", shops " + shops + ", storeys clamped by size " + clamped);
  info("furniture " + furn + " (" + (furn / res.length).toFixed(1) + " / house), loot points " + loot + ", chest slots " + chests + ", windows " + wins);
  const tris = res.flatMap((r) => r.tris);
  info("triangles per storey p50 " + pctl(tris, 0.5) + " p90 " + pctl(tris, 0.9) + " max " + Math.max(...tris) + "; colliders per house p50 " + pctl(res.map((r) => r.colliders), 0.5) + " max " + Math.max(...res.map((r) => r.colliders)));
  ok(L > 0 && shops > 0 && kinds.kitchen > 0 && kinds.bedroom > 0 && kinds.bath > 0 && kinds.living > 0 && kinds.shop > 0 && kinds.office > 0 && kinds.storage > 0, "coverage: L plans, shops and every room kind occur");
  const three = res.filter((r) => r.storeys === 3).length, two = res.filter((r) => r.storeys === 2).length;
  ok(three > 0 && two > 0, "coverage: 2-storey (" + two + ") and 3-storey (" + three + ") houses built");
  const noLoot = res.filter((r) => r.loot === 0).length;
  ok(noLoot === 0, "every house has loot points", noLoot + " without");
  // uses, storey heights, tall shells (stage B hands these over from towngen's ARCH table)
  const uses = new Set(res.map((r) => r.use)), shells = res.filter((r) => r.shell > 0).length, fhs = new Set(res.map((r) => r.fh));
  ok(HGmod.USES.every((u) => uses.has(u)) && shells > 0 && fhs.size >= 8 && kinds.lobby > 0 && kinds.meeting > 0 && kinds.warehouse > 0 && kinds.barn > 0,
    "coverage: every use (" + HGmod.USES.join(" ") + "), " + fhs.size + " storey heights, " + shells + " tall shells with closed storeys, lobby / meeting / warehouse / barn rooms");
  for (const q of pre) ok(q[0], q[1], q[2]);          // (the fixed rows below ran on this thread while the workers worked)
  // round 3: every theme towngen emits has its own look (no silent city), every roof kind occurs, the fronts carry relief, the rooms are dense
  {
    const byTheme = {};
    for (const r of res) { const t = byTheme[r.theme] || (byTheme[r.theme] = { houses: 0, roofs: {}, relief: 0, unknown: 0 }); t.houses++; t.roofs[r.roof] = (t.roofs[r.roof] || 0) + 1; t.relief += r.relief; if (r.notes.some((n) => n.includes("unknown"))) t.unknown++; }
    // its own look: every theme wears facades (material + colour) no other theme wears
    const fac = {}; for (const r of res) (fac[r.theme] || (fac[r.theme] = new Set())).add(r.facade);
    const own = ALL_THEMES.map((t) => [t, [...(fac[t] || [])].filter((k) => ALL_THEMES.every((o) => o === t || !(fac[o] && fac[o].has(k)))).length]);
    const roofKinds = new Set(res.map((r) => r.roof)), allThemes = ALL_THEMES.every((t) => byTheme[t] && byTheme[t].houses >= 700 && !byTheme[t].unknown && res.some((r) => r.theme === t));
    ok(allThemes && own.every((q) => q[1] > 0) && HGmod.generate({ id: "x", theme: "nowhere" }).notes.some((n) => n.includes("unknown")),
      "themes: city resort lodge farm ruin mill each built (>= 700 houses) in its OWN look (facades only it wears: " + JSON.stringify(own) + "), an unknown theme says so in notes; houses " + JSON.stringify(Object.fromEntries(Object.entries(byTheme).map(([k, v]) => [k, v.houses]))));
    ok(["flat", "gable", "gambrel", "lean", "hip"].every((k) => roofKinds.has(k)) && res.every((r) => r.relief > 0 || r.use === "shed"),
      "roofs: flat / gable / gambrel / lean-to / hip all built; every house but a shed wears exterior relief boxes; by theme " + JSON.stringify(Object.fromEntries(Object.entries(byTheme).map(([k, v]) => [k, v.roofs]))));
    const dk = {};
    for (const r of res) for (const [k, a, n, d] of r.dens) { const q = dk[k] || (dk[k] = [0, 0, 0, 0]); q[0]++; q[1] += a; q[2] += n; q[3] += d; }
    info("density (pieces with a collider / drawn-only dressing per room; per 10 m2): " + Object.entries(dk).map(([k, q]) => k + " " + (q[2] / q[0]).toFixed(1) + "+" + (q[3] / q[0]).toFixed(1) + " (" + (10 * q[2] / q[1]).toFixed(2) + "/10m2)").join(", "));
    // the kit GLBs the interior profile can place (every kit entry of its catalog, stand-ins included) <= 0.3 MB of downloads
    const cityDir = path.join(ROOT, "assets", "props", "city"), canPlace = new Set();
    for (const c of Object.values(HGmod.CATALOGS.interior)) for (let q = c; q; q = q.alt) if (q.src === "kit") canPlace.add(q.type);
    let bytes = 0; const missing = [];
    for (const t of canPlace) { const row = MAN.types[t]; if (!row) { missing.push(t); continue; } try { bytes += fs.statSync(path.join(cityDir, row.file)).size; } catch (e) { missing.push(t); } }
    const placed = new Set(res.filter((r) => r.kit === "interior").flatMap((r) => r.kitTypes));
    ok(!missing.length && bytes <= 300000 && [...placed].every((t) => canPlace.has(t)), "kit download: the interior profile can place " + canPlace.size + " kit types = " + bytes + " B of GLB (<= 300,000 B); " + placed.size + " placed in the 4,500 houses", missing.join(", "));
  }
  const vs = res.reduce((a, r) => a + r.viewShort, 0), li = res.reduce((a, r) => a + r.lootIn, 0);
  info("rooms the generator's own view model sees < 3 pieces in from their best entrance (a room's OWN pieces, as interiorcheck counts them since stage B): " + vs + " of " + rooms + " (" + (100 * vs / rooms).toFixed(2) + " %)");
  info("loot points on furniture whose collider reaches above them (a sink's backsplash, a gondola's top shelf): " + li + " (stage B: use loot.y as given, never snap it to supportAt)");


  // ---- negative controls: a planted fault must be caught by its checker
  const base = (() => { for (const r of res) if (r.storeys === 2 && r.windows > 2 && r.furn > 8 && r.errors.length === 0 && r.hasRug && r.hasTop && r.kit === "interior") { const [k, theme, st] = r.key.split(":"); return HGmod.generate(Object.assign({}, PS[+k], { theme, storeys: storeysOf(PS[+k], +k, +st) })); } return null; })();
  const clone = () => JSON.parse(JSON.stringify(base));
  const plants = [
    ["reach", "a box planted across the front doorway", (H) => { const d = H.doors.find((x) => x.kind === "front"); const pi = H.boxes[0].f[0]; H.boxes.push({ p: "wall", min: [d.x - 1.5, d.y, d.z - 1.5], max: [d.x + 1.5, d.y + 3, d.z + 1.5], f: [pi, pi, pi, pi, pi, pi], c: 1, fl: 0 }); }],
    ["doors", "a box planted in an interior doorway", (H) => { const d = H.doors.find((x) => x.kind === "interior"); const pi = H.boxes[0].f[0]; H.boxes.push({ p: "wall", min: [d.x - 0.3, d.y, d.z - 0.3], max: [d.x + 0.3, d.y + 2.6, d.z + 0.3], f: [pi, pi, pi, pi, pi, pi], c: 1, fl: d.floor }); }],
    ["windows", "a window sill raised to 1.0 m (a box in the aperture)", (H) => { const w = H.windows[0]; const pi = H.boxes[0].f[0]; H.boxes.push({ p: "wall", min: [w.x - 0.2, w.sill - 0.2, w.z - 0.2], max: [w.x + 0.2, w.sill + 0.3, w.z + 0.2], f: [pi, pi, pi, pi, pi, pi], c: 1, fl: w.floor }); }],
    ["windows", "a stated header at 2.10", (H) => { H.windows[0].head = H.windows[0].head - 0.2; }],
    ["furniture", "a piece moved into a door zone", (H) => { const d = H.doors.find((x) => x.kind === "interior"); const p = H.furniture.find((q) => q.src === "kit" && q.floor === d.floor); const dx = d.x - (p.min[0] + p.max[0]) / 2 + d.nx * 0.7, dz = d.z - (p.min[2] + p.max[2]) / 2 + d.nz * 0.7; p.min[0] += dx; p.max[0] += dx; p.min[2] += dz; p.max[2] += dz; p.kit.x += dx; p.kit.z += dz; }],
    ["furniture", "two pieces stacked on one spot", (H) => { const ps = H.furniture.filter((q) => q.src === "kit"); const a = ps[0], b = ps.find((q) => q.floor === a.floor && q !== a); const dx = a.min[0] - b.min[0], dz = a.min[2] - b.min[2]; b.min[0] += dx; b.max[0] += dx; b.min[2] += dz; b.max[2] += dz; b.kit.x += dx; b.kit.z += dz; }],
    ["vis-col", "a kit collider 5 cm off its drawn bbox", (H) => { const p = H.furniture.find((q) => q.src === "kit"); p.max[0] += 0.05; }],
    ["vis-col", "a drawn wall box that is not a collider", (H) => { const b = H.boxes.find((q) => q.p === "wall"); b.c = 0; }],
    ["vis-col", "a stair step 0.3 m above the ramp", (H) => { const b = H.boxes.find((q) => q.p === "step"); b.max[1] += 0.3; }],
    ["vis-col", "a picture moved 5 cm off its wall", (H) => { const p = H.furniture.find((q) => q.deco && q.max[1] - q.min[1] > 0.1); const ax = p.max[0] - p.min[0] <= 0.021 ? 0 : 2; p.min[ax] += 0.05; p.max[ax] += 0.05; }],
    ["vis-col", "a rug raised to 5 cm", (H) => { const p = H.furniture.find((q) => q.deco && q.cat === "rug"); p.max[1] += 0.03; }],
    ["stairs", "the stairwell hole closed by a slab", (H) => { const st = H.stairs[0]; const pi = H.boxes[0].f[0]; H.boxes.push({ p: "slab", min: [st.hole[0], st.top[1] - 0.3, st.hole[1]], max: [st.hole[2], st.top[1], st.hole[3]], f: [pi, pi, pi, pi, pi, pi], c: 1, fl: st.to }); }],
    ["stairs", "a ramp steeper than 45 degrees", (H) => { const r = H.ramps[0]; r.max[1] += 3; }],
    ["reach", "a loot point moved 3 m outside the house on the top floor", (H) => { const l = H.loot.find((q) => q.floor === H.floors.length - 1); l.x = H.aabb.max[0] + 3; }],
    ["budget", "400 extra boxes on the ground floor", (H) => { const b = H.boxes.find((q) => q.p === "slab"); for (let k = 0; k < 400; k++) H.boxes.push(Object.assign({}, b, { c: 0, p: "step2" })); }],
    ["floors", "a 4th storey claimed", (H) => { H.floors.push({ f: 3, y: H.floors[1].y + 6.8, ceil: 0 }); H.storeys = 4; }],
    ["nav", "every link of one room dropped", (H) => { const rm = H.rooms[H.rooms.length - 1].id; H.nav.links = H.nav.links.filter((l) => l.a !== rm && l.b !== rm); }],
    ["loot", "a floor loot point moved under a piece", (H) => { const l = H.loot.find((q) => q.on === "floor"), p = H.furniture.find((q) => !q.deco && q.floor === l.floor && q.room === l.room) || H.furniture.find((q) => !q.deco && q.floor === l.floor); l.x = (p.min[0] + p.max[0]) / 2; l.z = (p.min[2] + p.max[2]) / 2; }],
    ["nav", "a room's walkable rectangle moved 3 m out of the house", (H) => { const q = H.rooms[0].walk[0]; q[0] += 30; q[2] += 30; }],
    ["vis-col", "a window frame skin moved 5 cm off its wall", (H) => { const b = H.boxes.find((q) => q.p === "skin"); const ax = b.max[0] - b.min[0] <= 0.016 ? 0 : 2; b.min[ax] += 0.05; b.max[ax] += 0.05; }],
    ["vis-col", "an open door leaf drawn without its collider", (H) => { const b = H.boxes.find((q) => q.p === "leaf"); b.c = 0; }],
    ["windows", "a glass pane lifted 0.3 m out of its aperture", (H) => { const b = H.boxes.find((q) => q.p === "glass"); b.min[1] += 0.3; b.max[1] += 0.3; }],
    ["vis-col", "a lamp lifted 0.2 m off the piece it stands on", (H) => { const p = H.furniture.find((q) => q.mount === "top"); p.min[1] += 0.2; p.max[1] += 0.2; if (p.kit) p.kit.y += 0.2; }],
  ];
  if (!base) ok(false, "a clean 2-storey base house for the negative controls exists");
  else {
    ok(checkHouse(base, HGmod, MAN).length === 0, "negative-control base house passes every check (" + base.id + " " + base.theme + ")");
    for (const [code, label, plant] of plants) {
      const H = clone();
      let errs;
      try { plant(H); errs = checkHouse(H, HGmod, MAN); } catch (e) { errs = ["threw: " + e.message]; }
      ok(errs.some((e) => e.startsWith(code + ":")), "negative control [" + code + "]: " + label + " is caught", errs.slice(0, 2).join(" | ") || "no error raised");
    }
    // the pitched-roof plants on a gable house
    const g0 = HGmod.generate({ id: "gable-base", w: 12.5, d: 10, theme: "lodge", use: "house", storeys: 2, seed: 4, plan: "rect" });
    ok(g0.roof === "gable" && checkHouse(g0, HGmod, MAN).length === 0, "negative-control gable house passes every check (roof " + g0.roof + ")");
    const roofPlants = [
      ["an attic layer raised 0.4 m (above its plank)", (H) => { const b = H.boxes.filter((q) => q.p === "gable").pop(); b.max[1] += 0.4; }],
      ["a gable end wall pushed 0.3 m off its layers", (H) => { const g = H.gables[0], ax = g.n[0] ? 0 : 2; for (const q of g.pts) q[ax] += 0.3 * (g.n[ax] || 1); }],
      ["a roof plank made 60 deg steep", (H) => { const r = H.ramps[H.roofs[0].ramp], run = r.dir < 2 ? r.max[0] - r.min[0] : r.max[2] - r.min[2]; r.max[1] = r.min[1] + run * 1.73; }],
      ["an attic layer shrunk to a 1 cm stub (an open attic)", (H) => { const b = H.boxes.find((q) => q.p === "gable"); b.max[0] = b.min[0] + 0.01; b.max[2] = b.min[2] + 0.01; }],
    ];
    for (const [label, plant] of roofPlants) {
      const H = JSON.parse(JSON.stringify(g0));
      let errs; try { plant(H); errs = checkHouse(H, HGmod, MAN); } catch (e) { errs = ["threw: " + e.message]; }
      ok(errs.some((e) => e.startsWith("roof:")), "negative control [roof]: " + label + " is caught", errs.slice(0, 2).join(" | ") || "no error raised");
    }
    const p2 = Object.assign({}, PS[0], { theme: "city", storeys: 2 });
    ok(fnv(JSON.stringify(HGmod.generate(p2))) !== fnv(JSON.stringify(HGmod.generate(Object.assign({}, p2, { seed: (p2.seed + 1) >>> 0 })))), "negative control [determinism]: a different seed gives a different house (the hash compare bites)");
  }
  const secs = (Date.now() - T0) / 1000, cpu = process.cpuUsage();
  info("CPU: " + ((cpu.user + cpu.system) / 1e6).toFixed(1) + " s for the whole process (all " + (NW + 1) + " threads; a shared box under load stretches the wall time)");
  ok(secs < 15, "selftest ran in " + secs.toFixed(1) + " s (< 15 s)");
  console.log("\n" + (failed ? "FAIL" : "PASS") + "  " + passed + " passed, " + failed + " failed");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("FAIL  selftest crashed: " + (e && e.stack || e)); process.exit(1); });

function pctl(a, p) { if (!a.length) return NaN; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; }
