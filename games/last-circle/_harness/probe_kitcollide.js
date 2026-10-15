// probe_kitcollide.js - Node probe: do the city kit's colliders match the mesh that is DRAWN at body height? (Wave 7, lane 7E.) NO browser, NO server, NO file edited.
//
//   node _harness/probe_kitcollide.js [--root <game dir>] [--manifest <manifest.json>] [--citykit <citykit.js>] [--only substr,substr] [--q 0,1,2,3]
//        [--census 7,1234,2026] [--census-map ashgrid] [--out kitcollide.json] [--list] [--no-ship]
//
// What it measures (per kit type x each of the 4 quarter turns, for the colliders in the manifest AND the ones the game really uses):
//   the REAL drawn mesh = the shipped GLB (assets/props/city/**.glb, meshopt-decoded with the vendored decoder, node transforms applied, x suggested_scale,
//   turned about +Y exactly the way citykit.js turns an instance: x' = c x + s z, z' = -s x + c z) is SLICED by horizontal planes every ~5 cm between
//   feet+0.3 m and feet+1.8 m (the body band: lower is a step, higher clears a head). The colliders that count are the boxes whose y range overlaps the
//   band (a player standing on the ground is stopped by any of them, whatever their top). From the slices:
//     poke-out  how far the drawn solid reaches OUTSIDE the colliders: the largest distance from a point on a slice outline to the nearest collider box, over the
//               outline points a player can actually get to (free space connected to the outside; the inside of a shell that the colliders close off is not).
//               A player walks INTO the visible wall by that much.
//     phantom   how far the colliders reach outside the drawn solid: the largest distance from the exposed edge of the collider union (an edge shared by two boxes
//               is not exposed) to the drawn solid, where the drawn solid = the XZ projection of every triangle clipped to the band, with enclosed hollows
//               filled (a hollow shell is solid). The player is stopped by AIR by that much.
//   Both are in metres, at the instance scale 1. The probe prints a table (worst per type) and a gate-able JSON; kitcollide.py judges it (poke <= 0.10 m and
//   phantom <= 0.25 m for EVERY type: the bar is on the tail, not on a percentile).
//
// --census 7,1234,2026  builds ashgrid (or --census-map) for those seeds with the UNMODIFIED maps.js (the world gates' Node environment) and weighs each type by how
//   often the map places it, so "share of placed entries over the bar" and "kit colliders on the map" are reported next to the per-type table.
// --source of the colliders: `man` = manifest.json (what the intake writes), `ship` = citykit.js's embedded COLLIDER_BOXES through the real colliderFor() (what the game
//   uses). They differ until citykit.selftest.cjs --emit-table is applied after an intake run; `drift` lists the types where they do.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith("--")) { const k = a.slice(2); const n = process.argv[i + 1]; if (n === undefined || n.startsWith("--")) args[k] = true; else { args[k] = n; i++; } }
}
const ROOT = path.resolve(args.root || path.join(HERE, ".."));
const MAN_PATH = path.resolve(args.manifest || path.join(ROOT, "assets", "props", "city", "manifest.json"));
const CK_PATH = path.resolve(args.citykit || path.join(ROOT, "runtime", "3d", "royale", "citykit.js"));
const ONLY = args.only ? String(args.only).split(",").filter(Boolean) : null;
const QS = String(args.q || "0,1,2,3").split(",").filter(Boolean).map(Number);
const LO = Number(args["band-lo"] || 0.3), HI = Number(args["band-hi"] || 1.8);
const NSLICE = Math.max(3, Number(args.slices || 31));
const STEP = Number(args.sample || 0.04);                 // m between sample points along an outline / an exposed collider edge
const SOLID_CELL = 0.025, REACH_CELL = 0.1;
const NOMINAL = [0.3, 0.9, 1.5, 1.8];                     // the heights the table reports separately
const r3 = (v) => Math.round(v * 1000) / 1000;
const NOSHIP = !!args["no-ship"];
const DUMP = args.dump ? path.resolve(String(args.dump)) : null;          // --dump <dir>: per type x turn 0, the slices / boxes / solid raster for a plot

// ----------------------------------------- GLB (meshopt) reader -----------------------------------------
const MESHOPT = [args.meshopt, path.join(ROOT, "assets", "vendor", "three", "examples", "jsm", "libs", "meshopt_decoder.module.js"),
  path.join(HERE, "..", "assets", "vendor", "three", "examples", "jsm", "libs", "meshopt_decoder.module.js")].filter(Boolean).map((p) => path.resolve(p)).find((p) => fs.existsSync(p));   // a --rev root has no vendor dir
if (!MESHOPT) { console.error("probe_kitcollide: meshopt_decoder.module.js not found"); process.exit(2); }
const { MeshoptDecoder } = await import(pathToFileURL(MESHOPT).href);
await MeshoptDecoder.ready;
const CT = { 5120: [Int8Array, 1], 5121: [Uint8Array, 1], 5122: [Int16Array, 2], 5123: [Uint16Array, 2], 5125: [Uint32Array, 4], 5126: [Float32Array, 4] };
const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

function parseGlb(buf) {
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error("not a GLB");
  let off = 12, json = null, bin = null;
  while (off < buf.length) {
    const len = buf.readUInt32LE(off), ty = buf.readUInt32LE(off + 4), body = buf.subarray(off + 8, off + 8 + len);
    if (ty === 0x4e4f534a) json = JSON.parse(body.toString("utf8")); else if (ty === 0x004e4942) bin = body;
    off += 8 + len;
  }
  return { json, bin };
}
function bufferViews(json, bin) {
  return (json.bufferViews || []).map((bv) => {
    const e = bv.extensions && bv.extensions.EXT_meshopt_compression;
    if (e) {
      const o = e.byteOffset || 0, src = bin.subarray(o, o + e.byteLength), out = new Uint8Array(e.count * e.byteStride);
      MeshoptDecoder.decodeGltfBuffer(out, e.count, e.byteStride, src, e.mode, e.filter || "NONE");
      return { data: out, stride: e.byteStride };
    }
    const o = bv.byteOffset || 0;
    return { data: bin.subarray(o, o + bv.byteLength), stride: bv.byteStride || 0 };
  });
}
function readAccessor(json, views, ai) {
  const a = json.accessors[ai], bv = views[a.bufferView], [Arr, cs] = CT[a.componentType], nc = NC[a.type];
  const stride = bv.stride || nc * cs, base = a.byteOffset || 0;
  const dv = new DataView(bv.data.buffer, bv.data.byteOffset, bv.data.byteLength);
  const out = new Float64Array(a.count * nc);
  const get = a.componentType === 5126 ? (p) => dv.getFloat32(p, true) : a.componentType === 5125 ? (p) => dv.getUint32(p, true) : a.componentType === 5123 ? (p) => dv.getUint16(p, true)
    : a.componentType === 5121 ? (p) => dv.getUint8(p) : a.componentType === 5122 ? (p) => dv.getInt16(p, true) : (p) => dv.getInt8(p);
  const nrm = a.normalized ? { 5123: 65535, 5121: 255, 5122: 32767, 5120: 127 }[a.componentType] : 0;
  for (let i = 0; i < a.count; i++) for (let c = 0; c < nc; c++) {
    let v = get(base + i * stride + c * cs);
    if (nrm) v = Math.max(v / nrm, -1);
    out[i * nc + c] = v;
  }
  return out;
}
const mmul = (a, b) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; };
function nodeMatrix(n) {
  if (n.matrix) return n.matrix.slice();
  const t = n.translation || [0, 0, 0], q = n.rotation || [0, 0, 0, 1], s = n.scale || [1, 1, 1], [x, y, z, w] = q;
  const xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
  return [(1 - 2 * (yy + zz)) * s[0], 2 * (xy + wz) * s[0], 2 * (xz - wy) * s[0], 0, 2 * (xy - wz) * s[1], (1 - 2 * (xx + zz)) * s[1], 2 * (yz + wx) * s[1], 0,
    2 * (xz + wy) * s[2], 2 * (yz - wx) * s[2], (1 - 2 * (xx + yy)) * s[2], 0, t[0], t[1], t[2], 1];
}
/** every triangle of a GLB in world (native) units: Float64Array [ax,ay,az, bx,by,bz, cx,cy,cz]* */
function glbTriangles(file) {
  const { json, bin } = parseGlb(fs.readFileSync(file));
  const views = bufferViews(json, bin), out = [];
  const visit = (ni, parent) => {
    const n = json.nodes[ni], M = mmul(parent, nodeMatrix(n));
    if (n.mesh !== undefined) for (const p of json.meshes[n.mesh].primitives) {
      if (p.mode !== undefined && p.mode !== 4) continue;
      const pos = readAccessor(json, views, p.attributes.POSITION), cnt = pos.length / 3;
      const idx = p.indices !== undefined ? readAccessor(json, views, p.indices) : Float64Array.from({ length: cnt }, (_, i) => i);
      const W = new Float64Array(pos.length);
      for (let i = 0; i < cnt; i++) {
        const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
        W[i * 3] = M[0] * x + M[4] * y + M[8] * z + M[12]; W[i * 3 + 1] = M[1] * x + M[5] * y + M[9] * z + M[13]; W[i * 3 + 2] = M[2] * x + M[6] * y + M[10] * z + M[14];
      }
      for (let t = 0; t + 2 < idx.length; t += 3) for (let k = 0; k < 3; k++) { const v = idx[t + k] * 3; out.push(W[v], W[v + 1], W[v + 2]); }
    }
    for (const c of n.children || []) visit(c, M);
  };
  const sc = json.scenes[json.scene || 0];
  for (const r of sc.nodes) visit(r, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  return Float64Array.from(out);
}

// ----------------------------------------- quarter turns (the draw convention of citykit.js) -----------------------------------------
const COS = [1, 0, -1, 0], SIN = [0, 1, 0, -1];
const turnXZ = (x, z, q) => [COS[q] * x + SIN[q] * z, -SIN[q] * x + COS[q] * z];             // M.set(c*sc, 0, s*sc ..., -s*sc, 0, c*sc) of citykit.js buildDistrict
/** manifest box [x0,y0,z0,x1,y1,z1] -> the world box of the instance turned by q (independent of citykit.js pushQuarter: the 4 corners are turned and boxed) */
function turnBox(b, q) {
  const c = [turnXZ(b[0], b[2], q), turnXZ(b[3], b[2], q), turnXZ(b[0], b[5], q), turnXZ(b[3], b[5], q)];
  return { x0: Math.min(...c.map((p) => p[0])), x1: Math.max(...c.map((p) => p[0])), y0: b[1], y1: b[4], z0: Math.min(...c.map((p) => p[1])), z1: Math.max(...c.map((p) => p[1])) };
}

// ----------------------------------------- geometry helpers -----------------------------------------
const planes = (() => { const eps = 0.0013, a = LO + eps, b = HI - eps; return Array.from({ length: NSLICE }, (_, k) => a + (b - a) * k / (NSLICE - 1)); })();
const nominalSlice = NOMINAL.map((h) => { let bi = 0; for (let k = 1; k < planes.length; k++) if (Math.abs(planes[k] - h) < Math.abs(planes[bi] - h)) bi = k; return bi; });

/** slice native-metre triangles with the planes: per plane a deduplicated list of segments [x0,z0,x1,z1] (a triangle that lies between two planes contributes its edges to the nearest one) */
function sliceTriangles(tris) {
  const per = planes.map(() => new Map());
  const put = (k, ax, az, bx, bz) => {
    const ka = Math.round(ax * 1000), kb = Math.round(az * 1000), kc = Math.round(bx * 1000), kd = Math.round(bz * 1000);
    const swap = ka > kc || (ka === kc && kb > kd);
    const key = swap ? kc + "," + kd + "," + ka + "," + kb : ka + "," + kb + "," + kc + "," + kd;
    if (!per[k].has(key)) per[k].set(key, [ax, az, bx, bz]);
  };
  const h0 = planes[0], step = (planes[NSLICE - 1] - h0) / (NSLICE - 1);
  for (let o = 0; o + 8 < tris.length; o += 9) {
    const y0 = tris[o + 1], y1 = tris[o + 4], y2 = tris[o + 7], ymin = Math.min(y0, y1, y2), ymax = Math.max(y0, y1, y2);
    if (ymax < LO || ymin > HI) continue;
    const k0 = Math.max(0, Math.ceil((ymin - h0) / step - 1e-9)), k1 = Math.min(NSLICE - 1, Math.floor((ymax - h0) / step + 1e-9));
    if (k0 > k1) {                                        // between two planes (a flat face): its outline stands for it
      const k = Math.min(NSLICE - 1, Math.max(0, Math.round(((ymin + ymax) / 2 - h0) / step)));
      put(k, tris[o], tris[o + 2], tris[o + 3], tris[o + 5]); put(k, tris[o + 3], tris[o + 5], tris[o + 6], tris[o + 8]); put(k, tris[o + 6], tris[o + 8], tris[o], tris[o + 2]);
      continue;
    }
    for (let k = k0; k <= k1; k++) {
      const h = planes[k], pts = [];
      for (let e = 0; e < 3; e++) {
        const a = o + e * 3, b = o + ((e + 1) % 3) * 3, da = tris[a + 1] - h, db = tris[b + 1] - h;
        if ((da < 0 && db >= 0) || (da >= 0 && db < 0)) { const t = da / (da - db); pts.push(tris[a] + t * (tris[b] - tris[a]), tris[a + 2] + t * (tris[b + 2] - tris[a + 2])); }
      }
      if (pts.length === 4) put(k, pts[0], pts[1], pts[2], pts[3]);
    }
  }
  return per.map((m) => Array.from(m.values()));
}

class Raster {
  constructor(x0, z0, x1, z1, cell) { this.cell = cell; this.x0 = x0; this.z0 = z0; this.W = Math.ceil((x1 - x0) / cell) + 1; this.H = Math.ceil((z1 - z0) / cell) + 1; this.a = new Uint8Array(this.W * this.H); }
  at(x, z) { const i = Math.floor((x - this.x0) / this.cell), j = Math.floor((z - this.z0) / this.cell); return i < 0 || j < 0 || i >= this.W || j >= this.H ? -1 : j * this.W + i; }
  mark(x, z) { const k = this.at(x, z); if (k >= 0) this.a[k] = 1; }
  stroke(ax, az, bx, bz) { const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(L / (this.cell * 0.5))); for (let s = 0; s <= n; s++) this.mark(ax + (bx - ax) * s / n, az + (bz - az) * s / n); }
  fill(poly) {                                           // convex polygon [[x,z],..], cell centres inside
    let zmin = Infinity, zmax = -Infinity;
    for (const p of poly) { if (p[1] < zmin) zmin = p[1]; if (p[1] > zmax) zmax = p[1]; }
    const j0 = Math.max(0, Math.floor((zmin - this.z0) / this.cell)), j1 = Math.min(this.H - 1, Math.floor((zmax - this.z0) / this.cell));
    for (let j = j0; j <= j1; j++) {
      const zc = this.z0 + (j + 0.5) * this.cell;
      let xa = Infinity, xb = -Infinity;
      for (let e = 0; e < poly.length; e++) {
        const p = poly[e], q = poly[(e + 1) % poly.length];
        if ((p[1] <= zc && q[1] > zc) || (q[1] <= zc && p[1] > zc)) { const x = p[0] + (zc - p[1]) / (q[1] - p[1]) * (q[0] - p[0]); if (x < xa) xa = x; if (x > xb) xb = x; }
      }
      if (xa > xb) continue;
      const i0 = Math.max(0, Math.ceil((xa - this.x0) / this.cell - 0.5)), i1 = Math.min(this.W - 1, Math.floor((xb - this.x0) / this.cell - 0.5));
      for (let i = i0; i <= i1; i++) this.a[j * this.W + i] = 1;
    }
  }
  /** cells NOT reachable from the border through zero cells (4-connected) -> Uint8Array(1 = outside) */
  outside() {
    const { W, H, a } = this, out = new Uint8Array(W * H), q = new Int32Array(W * H);
    let h = 0, t = 0;
    const push = (k) => { if (!a[k] && !out[k]) { out[k] = 1; q[t++] = k; } };
    for (let i = 0; i < W; i++) { push(i); push((H - 1) * W + i); }
    for (let j = 0; j < H; j++) { push(j * W); push(j * W + W - 1); }
    while (h < t) {
      const k = q[h++], i = k % W, j = (k / W) | 0;
      if (i > 0) push(k - 1); if (i < W - 1) push(k + 1); if (j > 0) push(k - W); if (j < H - 1) push(k + W);
    }
    return out;
  }
}
const distBoxes = (B, x, z) => { let best = Infinity; for (const b of B) { const d = Math.hypot(Math.max(b.x0 - x, 0, x - b.x1), Math.max(b.z0 - z, 0, z - b.z1)); if (d < best) best = d; } return best; };

/** XZ polygon of a triangle clipped to the band (Sutherland-Hodgman on y); [] when nothing is in the band */
function clipBand(tris, o) {
  let poly = [[tris[o], tris[o + 1], tris[o + 2]], [tris[o + 3], tris[o + 4], tris[o + 5]], [tris[o + 6], tris[o + 7], tris[o + 8]]];
  for (const [sgn, bound] of [[1, LO], [-1, HI]]) {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length], da = sgn * (a[1] - bound), db = sgn * (b[1] - bound);
      if (da >= 0) out.push(a);
      if ((da >= 0) !== (db >= 0)) { const t = da / (da - db); out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])]); }
    }
    poly = out;
    if (!poly.length) return poly;
  }
  return poly;
}

class SegHash {
  constructor(segs, cell = 0.5) {
    this.cell = cell; this.m = new Map(); this.segs = segs;
    segs.forEach((s, id) => {
      const L = Math.hypot(s[2] - s[0], s[3] - s[1]), n = Math.max(1, Math.ceil(L / cell));
      let last = null;
      for (let t = 0; t <= n; t++) {
        const x = s[0] + (s[2] - s[0]) * t / n, z = s[1] + (s[3] - s[1]) * t / n, key = Math.floor(x / cell) * 100003 + Math.floor(z / cell);
        if (key !== last) { last = key; let l = this.m.get(key); if (!l) this.m.set(key, l = []); if (l[l.length - 1] !== id) l.push(id); }
      }
    });
  }
  nearest(x, z, maxR = 40) {
    const c = this.cell, ci = Math.floor(x / c), cj = Math.floor(z / c);
    let best = Infinity;
    for (let r = 0; r <= maxR; r++) {
      for (let di = -r; di <= r; di++) for (let dj = -r; dj <= r; dj++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const l = this.m.get((ci + di) * 100003 + (cj + dj));
        if (!l) continue;
        for (const id of l) {
          const s = this.segs[id], dx = s[2] - s[0], dz = s[3] - s[1], L2 = dx * dx + dz * dz;
          let t = L2 > 0 ? ((x - s[0]) * dx + (z - s[1]) * dz) / L2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
          const d = Math.hypot(x - (s[0] + t * dx), z - (s[1] + t * dz));
          if (d < best) best = d;
        }
      }
      if (best <= r * c) break;
    }
    return best;
  }
}

// ----------------------------------------- the measurement -----------------------------------------
/** one type, one quarter turn, one collider set. segsBySlice: unturned deduplicated slices (metres); tris0: unturned metre triangles */
function measure(boxes, segsBySlice, tris0, q, bbox) {
  const B = boxes.filter((b) => b.y1 > LO && b.y0 < HI);                       // the boxes a player on the ground meets
  const turnSeg = (s) => { const a = turnXZ(s[0], s[1], q), b = turnXZ(s[2], s[3], q); return [a[0], a[1], b[0], b[1]]; };
  const segs = segsBySlice.map((sl) => sl.map(turnSeg));
  let xa = Infinity, xb = -Infinity, za = Infinity, zb = -Infinity;
  const grow = (x, z) => { if (x < xa) xa = x; if (x > xb) xb = x; if (z < za) za = z; if (z > zb) zb = z; };
  for (let i = 0; i < 4; i++) { const p = turnXZ(i & 1 ? bbox.max[0] : bbox.min[0], i & 2 ? bbox.max[2] : bbox.min[2], q); grow(p[0], p[1]); }
  for (const b of B) { grow(b.x0, b.z0); grow(b.x1, b.z1); }
  const pad = 1.5;
  const res = { poke: 0, pokeAt: null, pokeBySlice: planes.map(() => 0), phantom: 0, phantomAt: null, nBox: boxes.length, nBand: B.length, segments: 0 };

  // ---- poke-out: slice outline points outside the colliders, in free space connected to the outside
  const reach = new Raster(xa - pad, za - pad, xb + pad, zb + pad, REACH_CELL);
  for (const b of B) {
    const i0 = Math.floor((b.x0 - reach.x0) / REACH_CELL), i1 = Math.floor((b.x1 - reach.x0) / REACH_CELL), j0 = Math.floor((b.z0 - reach.z0) / REACH_CELL), j1 = Math.floor((b.z1 - reach.z0) / REACH_CELL);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const cx = reach.x0 + (i + 0.5) * REACH_CELL, cz = reach.z0 + (j + 0.5) * REACH_CELL;
      if (cx > b.x0 && cx < b.x1 && cz > b.z0 && cz < b.z1) reach.a[j * reach.W + i] = 1;
    }
  }
  const out = reach.outside();
  const reachable = (x, z) => {
    const k = reach.at(x, z);
    if (k < 0) return true;
    const i = k % reach.W, j = (k / reach.W) | 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const ii = i + di, jj = j + dj; if (ii >= 0 && jj >= 0 && ii < reach.W && jj < reach.H && out[jj * reach.W + ii]) return true; }
    return false;
  };
  const cache = new Map();
  for (let k = 0; k < segs.length; k++) {
    let worst = 0;
    for (const s of segs[k]) {
      const key = Math.round(s[0] * 1000) + "," + Math.round(s[1] * 1000) + "," + Math.round(s[2] * 1000) + "," + Math.round(s[3] * 1000);
      let c = cache.get(key);
      if (!c) {
        const L = Math.hypot(s[2] - s[0], s[3] - s[1]), n = Math.max(1, Math.ceil(L / STEP));
        c = { d: 0, x: 0, z: 0 };
        for (let t = 0; t <= n; t++) {
          const x = s[0] + (s[2] - s[0]) * t / n, z = s[1] + (s[3] - s[1]) * t / n;
          const d = B.length ? distBoxes(B, x, z) : 9.99;
          if (d > c.d + 1e-9 && d > 1e-4 && reachable(x, z)) { c.d = d; c.x = x; c.z = z; }
        }
        cache.set(key, c);
      }
      if (c.d > worst) worst = c.d;
      if (c.d > res.poke) { res.poke = c.d; res.pokeAt = [r3(c.x), r3(planes[k]), r3(c.z)]; }
    }
    res.pokeBySlice[k] = worst;
    res.segments += segs[k].length;
  }

  // ---- phantom: exposed collider edges that are not on / in the drawn solid (band projection, hollows filled)
  const solid = new Raster(xa - pad, za - pad, xb + pad, zb + pad, SOLID_CELL);
  for (let o = 0; o + 8 < tris0.length; o += 9) {
    const poly = clipBand(tris0, o);
    if (poly.length < 2) continue;
    const P = poly.map((p) => turnXZ(p[0], p[2], q));
    for (let e = 0; e < P.length; e++) solid.stroke(P[e][0], P[e][1], P[(e + 1) % P.length][0], P[(e + 1) % P.length][1]);
    if (P.length >= 3) solid.fill(P);
  }
  const sOut = solid.outside();
  const inside = (x, z) => { const k = solid.at(x, z); return k >= 0 && !sOut[k]; };
  const all = [];
  for (const sl of segs) for (const s of sl) all.push(s);
  const hash = all.length ? new SegHash(all) : null;
  const inBox = (x, z, tol) => { for (const b of B) if (x > b.x0 + tol && x < b.x1 - tol && z > b.z0 + tol && z < b.z1 - tol) return true; return false; };
  for (const b of B) {
    const edges = [[b.x0, b.z0, b.x1, b.z0, 0, -1], [b.x0, b.z1, b.x1, b.z1, 0, 1], [b.x0, b.z0, b.x0, b.z1, -1, 0], [b.x1, b.z0, b.x1, b.z1, 1, 0]];
    for (const [ax, az, bx, bz, nx, nz] of edges) {
      const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(L / STEP));
      for (let t = 0; t <= n; t++) {
        const x = ax + (bx - ax) * t / n, z = az + (bz - az) * t / n;
        if (inBox(x + nx * 0.02, z + nz * 0.02, -1e-9)) continue;            // a seam between two boxes (or inside another): not an exposed face
        if (inside(x, z)) continue;
        const d = hash ? hash.nearest(x, z) : 99;
        if (d > res.phantom) { res.phantom = d; res.phantomAt = [r3(x), r3(z)]; }
      }
    }
  }
  if (DUMP) {
    const bits = new Uint8Array(solid.W * solid.H);
    for (let k = 0; k < bits.length; k++) bits[k] = solid.a[k] || !sOut[k] ? 1 : 0;
    res.dump = { boxes: B, segs: segs.map((sl, k) => sl.map((s) => [r3(s[0]), r3(s[1]), r3(s[2]), r3(s[3])]).concat([])), planes, raster: { x0: solid.x0, z0: solid.z0, cell: solid.cell, W: solid.W, H: solid.H, bits: Buffer.from(bits).toString("base64") } };
  }
  return res;
}

// ----------------------------------------- load -----------------------------------------
const manifest = JSON.parse(fs.readFileSync(MAN_PATH, "utf8"));
const GLB_DIR = path.resolve(args["glb-dir"] || path.join(ROOT, "assets", "props", "city"));   // the shipped GLBs (a scratch --manifest keeps measuring THESE)
let CK = null, ckErr = null;
if (!NOSHIP) { try { CK = await import(pathToFileURL(CK_PATH).href); } catch (e) { ckErr = String(e && e.message || e); } }
const drift = CK ? CK.tableDrift(manifest) : null;
const ids = Object.keys(manifest.types).filter((id) => !ONLY || ONLY.some((s) => id.includes(s)));
const types = {};
const decode = { ok: 0, bad: [] };
const t0 = Date.now();
for (const id of ids) {
  const T = manifest.types[id], sc = T.suggested_scale;
  let tris;
  try { tris = glbTriangles(path.join(GLB_DIR, T.file)); } catch (e) { decode.bad.push({ id, error: String(e && e.message || e) }); continue; }
  for (let i = 0; i < tris.length; i++) tris[i] *= sc;
  const nT = tris.length / 9;
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < tris.length; i += 3) for (let a = 0; a < 3; a++) { if (tris[i + a] < mn[a]) mn[a] = tris[i + a]; if (tris[i + a] > mx[a]) mx[a] = tris[i + a]; }
  const bboxErr = Math.max(...[0, 1, 2].map((a) => Math.max(Math.abs(mn[a] - T.bbox_min_m[a]), Math.abs(mx[a] - T.bbox_max_m[a]))));
  if (nT !== T.tris || bboxErr > 0.003) decode.bad.push({ id, tris: nT, manifestTris: T.tris, bboxErr: r3(bboxErr) }); else decode.ok++;
  const segsBySlice = sliceTriangles(tris);
  const bbox = { min: mn, max: mx };
  const manLocal = T.colliders.map((c) => [...c.min, ...c.max]);
  const shipLocal = CK && CK.hasType(id) ? CK.localBoxes(id).map((a) => Array.from(a)) : null;
  const rec = { id, group: T.group, mode: T.collider_mode, scale: sc, tris: nT, boxes: manLocal.length, shipBoxes: shipLocal ? shipLocal.length : null, height: r3(mx[1]), q: {} };
  for (const q of QS) {
    const man = measure(manLocal.map((b) => turnBox(b, q)), segsBySlice, tris, q, bbox);
    if (DUMP && man.dump) { fs.mkdirSync(DUMP, { recursive: true }); fs.writeFileSync(path.join(DUMP, id.replace(/\//g, "__") + ".q" + q + ".json"), JSON.stringify({ id, q, poke: man.poke, pokeAt: man.pokeAt, phantom: man.phantom, phantomAt: man.phantomAt, ...man.dump })); }
    const row = { man: { poke: r3(man.poke), pokeAt: man.pokeAt, phantom: r3(man.phantom), phantomAt: man.phantomAt, bySlice: nominalSlice.map((k) => r3(man.pokeBySlice[k])), nBand: man.nBand } };
    if (shipLocal) {
      const sh = measure(shipLocal.map((b) => turnBox(b, q)), segsBySlice, tris, q, bbox);
      row.ship = { poke: r3(sh.poke), pokeAt: sh.pokeAt, phantom: r3(sh.phantom), phantomAt: sh.phantomAt, bySlice: nominalSlice.map((k) => r3(sh.pokeBySlice[k])), nBand: sh.nBand };
      // the game's own colliderFor() against the independent turn of the same table (rotation convention check)
      const cs = CK.colliderFor(id, 0, 0, 0, q), ref = shipLocal.map((b) => turnBox(b, q));
      let dmax = cs.length === ref.length ? 0 : 9.99;
      if (dmax === 0) for (let i = 0; i < cs.length; i++) dmax = Math.max(dmax, Math.abs(cs[i].minX - ref[i].x0), Math.abs(cs[i].maxX - ref[i].x1), Math.abs(cs[i].minZ - ref[i].z0), Math.abs(cs[i].maxZ - ref[i].z1), Math.abs(cs[i].minY - ref[i].y0), Math.abs(cs[i].maxY - ref[i].y1));
      row.turnDiff = r3(dmax);
    }
    rec.q[q] = row;
  }
  const worst = (src, f) => Math.max(...QS.map((q) => rec.q[q][src] ? rec.q[q][src][f] : 0));
  const spread = (src, f) => { const v = QS.map((q) => rec.q[q][src] ? rec.q[q][src][f] : 0); return Math.max(...v) - Math.min(...v); };
  rec.worstPoke = r3(worst("man", "poke")); rec.worstPhantom = r3(worst("man", "phantom"));
  rec.spread = r3(Math.max(spread("man", "poke"), spread("man", "phantom")));
  if (shipLocal) { rec.shipWorstPoke = r3(worst("ship", "poke")); rec.shipWorstPhantom = r3(worst("ship", "phantom")); rec.turnDiff = r3(Math.max(...QS.map((q) => rec.q[q].turnDiff))); }
  types[id] = rec;
}

// ----------------------------------------- census (how often the map places each type) -----------------------------------------
let census = null;
if (args.census) {
  const seeds = String(args.census).split(",").filter(Boolean).map(Number), mapId = String(args["census-map"] || "ashgrid");
  try {
    const { makeEnv } = await import(pathToFileURL(path.join(HERE, "world_env.mjs")).href);
    const E = await makeEnv({ root: ROOT, vendor: args.vendor });
    const { buildMap } = await E.importMaps();
    census = { map: mapId, seeds: {}, counts: {}, entries: 0, boxesMan: 0, boxesShip: 0 };
    for (const seed of seeds) {
      const M = await buildMap(E.makeW(seed), mapId);
      const kit = (M.city && M.city.kit) || [];
      const c = { entries: kit.length, byType: {}, boxesMan: 0, boxesShip: 0, builtColliders: M.colliders ? M.colliders.length : null };
      for (const it of kit) {
        c.byType[it.type] = (c.byType[it.type] || 0) + 1;
        const t = manifest.types[it.type];
        if (t) c.boxesMan += t.colliders.length;
        if (CK && CK.hasType(it.type)) c.boxesShip += CK.localBoxes(it.type).length;
        census.counts[it.type] = (census.counts[it.type] || 0) + 1;
      }
      census.entries += c.entries; census.boxesMan += c.boxesMan; census.boxesShip += c.boxesShip;
      census.seeds[seed] = c;
      process.stderr.write(`census ${mapId} seed ${seed}: ${c.entries} kit entries, ${c.boxesMan} manifest boxes, ${c.boxesShip} shipped boxes\n`);
    }
  } catch (e) { census = { error: String(e && e.stack || e).slice(0, 600) }; }
}

const doc = {
  tool: "probe_kitcollide.js", root: ROOT, manifest: MAN_PATH, citykit: CK ? CK_PATH : null, citykitError: ckErr, band: [LO, HI], slices: NSLICE, sample: STEP, nominalHeights: NOMINAL, qs: QS,
  pokeBar: 0.10, phantomBar: 0.25, wallS: +((Date.now() - t0) / 1000).toFixed(1),
  decode: { ok: decode.ok, bad: decode.bad }, drift, types, census,
};
if (args.out) { fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true }); fs.writeFileSync(args.out, JSON.stringify(doc)); }

// table
const rows = Object.values(types).sort((a, b) => b.worstPoke - a.worstPoke);
const pad = (s, n) => String(s).padEnd(n);
console.log(`probe_kitcollide: ${ids.length} types x ${QS.length} turns, band ${LO}-${HI} m, ${NSLICE} slices, ${doc.wallS} s; decode ok ${decode.ok}/${ids.length}${decode.bad.length ? " BAD " + JSON.stringify(decode.bad.slice(0, 3)) : ""}`);
console.log(pad("type", 36) + pad("mode", 10) + pad("box", 4) + pad("poke", 7) + pad("@0.3", 6) + pad("@0.9", 6) + pad("@1.5", 6) + pad("@1.8", 6) + pad("phantom", 8) + pad("spread", 7) + (CK ? "ship poke/phantom  turnDiff" : ""));
for (const r of rows) {
  if (!args.list && r.worstPoke <= 0.1 && r.worstPhantom <= 0.25) continue;
  const q0 = r.q[QS[0]].man.bySlice;
  console.log(pad(r.id, 36) + pad(r.mode, 10) + pad(r.boxes, 4) + pad(r.worstPoke.toFixed(3), 7) + q0.map((v) => pad(v.toFixed(2), 6)).join("") + pad(r.worstPhantom.toFixed(3), 8) + pad(r.spread.toFixed(3), 7) + (CK ? `${r.shipWorstPoke.toFixed(3)} / ${r.shipWorstPhantom.toFixed(3)}  ${r.turnDiff}` : ""));
}
const over = rows.filter((r) => r.worstPoke > 0.1), overP = rows.filter((r) => r.worstPhantom > 0.25);
console.log(`types with poke > 0.10 m: ${over.length} of ${rows.length}; phantom > 0.25 m: ${overP.length} of ${rows.length}; boxes ${rows.reduce((a, r) => a + r.boxes, 0)}`);
if (census && census.counts) {
  const bad = (id) => types[id] && (types[id].worstPoke > 0.1 || types[id].worstPhantom > 0.25);
  const n = Object.entries(census.counts).filter(([id]) => bad(id)).reduce((a, [, c]) => a + c, 0);
  console.log(`census ${census.map} seeds ${Object.keys(census.seeds).join(",")}: ${census.entries} entries, ${n} on a type over the bar (${(100 * n / Math.max(1, census.entries)).toFixed(2)} %), manifest boxes ${census.boxesMan}, shipped boxes ${census.boxesShip}`);
}
