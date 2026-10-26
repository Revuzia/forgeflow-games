// placement_census.mjs - the Node half of placementcheck.py (lane 5D). NO browser, NO server, NO file edited.
//
//   node placement_census.mjs --root <game dir> --vendor <three vendor dir> --out census.json
//        [--maps isla_viva,ashgrid,deepwood] [--seeds 1,7,1234,31337,2026] [--samples 20000]
//        [--plant y-only-recentre,perimeter-drop,tree-float] [--keep-records]
//
// It imports the UNMODIFIED <root>/runtime/3d/royale/maps.js (and loot.js) through the resolve hook in three_hooks.mjs,
// builds each map for each seed with a minimal fake W (canvas stub, a GLB reader that parses positions + indices), and
// measures what a player SEES against what the game stands on:
//   phys   = map.heightAt (what players, bots and loot stand on)
//   near   = the RENDERED near-ring terrain, read from the real chunk BufferGeometry the map's own LOD updater builds
//            (every triangle, top-most hit at an x,z; a vertical skirt has no x,z area so it never answers a query)
//   far    = the rendered far chunk
// and writes ONE JSON of per-map pooled statistics (placementcheck.py applies the thresholds).
//
// Measured:  instanced props (rocks, trees, bushes, cars, containers, barrels: anchor vs drawn base, float / buried,
// collider top vs drawn top), structure pieces (the boxes maps.js creates, grouped into connected structures: any piece
// with no contact), the ground-vs-rendered error field over dry land, chests and floor-item rings (loot.js populate()
// run for real), ramp starts, doorway clearances, road ribbon float.
//
// A planted fault (--plant) mutates the BUILT map in memory before it is measured; the measurement path is unchanged:
//   y-only-recentre  every rock is drawn where the Wave-4 instancing put it (anchor on the seeded spot, the mesh's own
//                    origin offset left in: 20-90 m away)
//   perimeter-drop   every near-ring chunk's perimeter vertices that sit on the true height drop 0.35 m again
//   tree-float       the first tree is lifted 0.30 m
//   stack-float      the first stacked UPPER container is lifted 0.30 m (the stack-support rule must not forgive it)
//   Wave-6 rows (lane 6E):
//   no-pads          the RENDERED ground is 0.35 m lower on the +x half of every structure footprint (a hillside under a house that was never
//                    levelled: the structure still touches the physics ground, one edge hangs in the air over the drawn one)
//   door-buried      the first 3 doorways read as if the ground rose 0.9 m under their lintel
//   ramp-lip         the first ramp's low edge stands 0.8 m over the floor it starts from
//   roads-lifted     every road ribbon vertex is 0.30 m over the ground
//   ground-shift     the physics ground reads 3 mm higher than the rendered one everywhere
//
// --mode city (lane 6E, Wave 6) runs probe_city.js's measure() on each built map instead (citycheck.py's Node half; see cityMode below);
// --mode towngen scores lane 6B's towngen.js as a Wave-7 forecast on the same rows (see towngenMode below).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { register } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";

// ── CLI ────────────────────────────────────────────────────────────────────────────────────────────────────────
const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith("--")) { const k = a.slice(2); const n = process.argv[i + 1]; if (n === undefined || n.startsWith("--")) args[k] = true; else { args[k] = n; i++; } }
}
const ROOT = path.resolve(args.root || path.join(HERE, ".."));
const VENDOR = path.resolve(args.vendor || path.join(ROOT, "assets", "vendor", "three"));
const MAPS = (args.maps || "isla_viva,ashgrid,deepwood").split(",").filter(Boolean);
const SEEDS = (args.seeds || "1,7,1234,31337,2026").split(",").filter(Boolean).map(Number);
const OUT = args.out || null;
const NSAMP = Number(args.samples || 20000);
const PLANTS = new Set((args.plant || "").split(",").filter(Boolean));
const KEEP = !!args["keep-records"];
const MAPS_JS = path.join(ROOT, "runtime", "3d", "royale", "maps.js");
const LOOT_JS = path.join(ROOT, "runtime", "3d", "royale", "loot.js");
const SIM_JS = path.join(ROOT, "runtime", "sim", "royale.js");
for (const f of [MAPS_JS, SIM_JS]) if (!fs.existsSync(f)) { console.error("placement_census: missing " + f); process.exit(3); }

process.env.LC_THREE_VENDOR = VENDOR;
register("./three_hooks.mjs", import.meta.url);
Error.stackTraceLimit = 20;
const THREE = await import("three");

// ── fake DOM (canvas only: procedural textures, clouds, minimap) ───────────────────────────────────────────────
function ctx2d(cv) {
  const noop = () => {};
  const base = {
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    createRadialGradient: () => ({ addColorStop: noop }), createLinearGradient: () => ({ addColorStop: noop }),
    measureText: () => ({ width: 10 }), canvas: cv,
  };
  return new Proxy(base, { get: (t, k) => (k in t ? t[k] : noop), set: (t, k, v) => { t[k] = v; return true; } });
}
globalThis.window = globalThis;
globalThis.document = {
  createElement: () => { const cv = { width: 0, height: 0, style: {} }; cv.getContext = () => ctx2d(cv); cv.addEventListener = () => {}; return cv; },
  createElementNS: (ns, tag) => globalThis.document.createElement(tag),
};
// root-relative fetch for assets the map code may read (a baked collider table, a manifest): <root>/<relative url>
const _realFetch = globalThis.fetch;
globalThis.fetch = async (url, opt) => {
  const u = String(url);
  if (!/^[a-z]+:/i.test(u)) {
    const f = path.join(ROOT, u.split("?")[0].replace(/^\.?\//, ""));
    if (fs.existsSync(f)) {
      const buf = fs.readFileSync(f);
      return { ok: true, status: 200, url: u, json: async () => JSON.parse(buf.toString("utf8")), text: async () => buf.toString("utf8"),
               arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
    }
    return { ok: false, status: 404, url: u, json: async () => { throw new Error("404 " + u); }, text: async () => "", arrayBuffer: async () => new ArrayBuffer(0) };
  }
  return _realFetch(url, opt);
};

// ── GLB reader (positions + indices; enough for bounding boxes and vertex clouds) ─────────────────────────────
const geomLocal = new Map();            // geometry -> { kind, meshLocal }
const _parsed = {};
function readAccessor(j, bin, ai) {
  const a = j.accessors[ai], bv = j.bufferViews[a.bufferView];
  const ncomp = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
  const csize = { 5126: 4, 5125: 4, 5123: 2, 5121: 1, 5122: 2, 5120: 1 }[a.componentType];
  const stride = bv.byteStride || ncomp * csize;
  const off = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const out = a.componentType === 5126 ? new Float32Array(a.count * ncomp) : new Uint32Array(a.count * ncomp);
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  for (let i = 0; i < a.count; i++) for (let c = 0; c < ncomp; c++) {
    const p = off + i * stride + c * csize;
    let v;
    switch (a.componentType) {
      case 5126: v = dv.getFloat32(p, true); break;
      case 5125: v = dv.getUint32(p, true); break;
      case 5123: v = dv.getUint16(p, true); break;
      case 5121: v = dv.getUint8(p); break;
      case 5122: v = dv.getInt16(p, true); break;
      default: v = dv.getInt8(p);
    }
    if (a.normalized && a.componentType !== 5126) v = a.componentType === 5123 ? v / 65535 : a.componentType === 5121 ? v / 255 : a.componentType === 5122 ? Math.max(v / 32767, -1) : Math.max(v / 127, -1);
    out[i * ncomp + c] = v;
  }
  return out;
}
function parseGLB(file, kind) {
  const b = fs.readFileSync(file);
  if (b.readUInt32LE(0) !== 0x46546c67) throw new Error("not a GLB: " + file);
  const jl = b.readUInt32LE(12);
  const j = JSON.parse(b.subarray(20, 20 + jl).toString("utf8"));
  if ((j.extensionsRequired || []).length) throw new Error("GLB needs extensions " + j.extensionsRequired.join(",") + " (placement census reads plain GLBs): " + file);
  const bin = b.subarray(20 + jl + 8);
  const meshGeos = j.meshes.map((m) => m.primitives.map((p) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(readAccessor(j, bin, p.attributes.POSITION), 3));
    if (p.indices != null) g.setIndex(Array.from(readAccessor(j, bin, p.indices)));
    g.userData.kind = kind;
    return g;
  }));
  const mkNode = (ni) => {
    const n = j.nodes[ni];
    const o = new THREE.Group(); o.name = n.name || "";
    if (n.matrix) new THREE.Matrix4().fromArray(n.matrix).decompose(o.position, o.quaternion, o.scale);
    else { if (n.translation) o.position.fromArray(n.translation); if (n.rotation) o.quaternion.fromArray(n.rotation); if (n.scale) o.scale.fromArray(n.scale); }
    if (n.mesh != null) for (const g of meshGeos[n.mesh]) o.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial()));
    for (const c of n.children || []) o.add(mkNode(c));
    return o;
  };
  const root = new THREE.Group();
  for (const ni of j.scenes[j.scene || 0].nodes) root.add(mkNode(ni));
  root.updateMatrixWorld(true);
  root.traverse((o) => { if (o.isMesh) geomLocal.set(o.geometry, { kind, meshLocal: o.matrixWorld.clone() }); });
  return root;
}
async function loadGLTF(url) {
  const rel = String(url).replace(/^.*?assets\//, "assets/").split("?")[0];
  const file = path.join(ROOT, rel);
  const kind = path.basename(rel).replace(/\.glb$/, "");
  if (!fs.existsSync(file)) throw new Error("no such GLB " + rel);
  if (!_parsed[rel]) _parsed[rel] = parseGLB(file, kind === "deco_crystal" ? "crystal" : kind);
  return _parsed[rel].clone(true);
}
// the UMD sim is CommonJS in a scratch/rev copy and a "type": "module" file in the repo (it then publishes on globalThis.FFG)
const _simMod = createRequire(import.meta.url)(SIM_JS);
const SIM = _simMod && _simMod.Storm ? _simMod : (globalThis.FFG && globalThis.FFG.sim && globalThis.FFG.sim.Royale);
if (!SIM || typeof SIM.mulberry32 !== "function") { console.error("placement_census: could not load the Royale sim from " + SIM_JS); process.exit(3); }
function makeW(seed) {
  const groups = {};
  const ev = {};
  return {
    seed, SIM, assetBase: "", mode: "standard", t: 0, phase: "match", settings: { graphics: "high" }, _groups: groups,
    group(name) { if (!groups[name]) { groups[name] = new THREE.Group(); groups[name].name = name; } return groups[name]; },
    scene: { background: null, fog: null, traverse() {}, environment: null, add() {}, remove() {} },
    kernel: { renderer: null, _updaters: [], onUpdate(fn) { this._updaters.push(fn); }, loadGLTF },
    events: { on(n, f) { (ev[n] = ev[n] || []).push(f); }, emit(n, ...a) { for (const f of ev[n] || []) f(...a); } },
    camera: null, player: null, _camFocus: null,
  };
}

const { buildMap } = await import(pathToFileURL(MAPS_JS).href);

// ── rendered-surface sampler: the real terrain chunk triangles, binned on a uniform x,z grid ─────────────────
class Surface {
  constructor(meshes, x0, z0, x1, z1, cell) {
    this.x0 = x0; this.z0 = z0; this.cell = cell;
    this.nx = Math.ceil((x1 - x0) / cell) + 1; this.nz = Math.ceil((z1 - z0) / cell) + 1;
    let nt = 0;
    for (const m of meshes) { const ix = m.geometry.index; nt += ix ? ix.count / 3 : m.geometry.attributes.position.count / 3; }
    const tri = new Float32Array(nt * 9);
    const counts = new Uint32Array(this.nx * this.nz + 1);
    let t = 0;
    const bins = [];
    for (const m of meshes) {
      const pos = m.geometry.attributes.position, ix = m.geometry.index;
      const n = ix ? ix.count / 3 : pos.count / 3;
      for (let k = 0; k < n; k++) {
        const a = ix ? ix.getX(k * 3) : k * 3, b = ix ? ix.getX(k * 3 + 1) : k * 3 + 1, c = ix ? ix.getX(k * 3 + 2) : k * 3 + 2;
        const o = t * 9;
        tri[o] = pos.getX(a); tri[o + 1] = pos.getZ(a); tri[o + 2] = pos.getY(a);
        tri[o + 3] = pos.getX(b); tri[o + 4] = pos.getZ(b); tri[o + 5] = pos.getY(b);
        tri[o + 6] = pos.getX(c); tri[o + 7] = pos.getZ(c); tri[o + 8] = pos.getY(c);
        t++;
      }
    }
    // pass 1: counts per cell; pass 2: fill (CSR)
    const rng = (v, lo, n) => Math.max(0, Math.min(n - 1, Math.floor((v - lo) / cell)));
    for (let k = 0; k < t; k++) {
      const o = k * 9;
      const ax = Math.min(tri[o], tri[o + 3], tri[o + 6]), bx = Math.max(tri[o], tri[o + 3], tri[o + 6]);
      const az = Math.min(tri[o + 1], tri[o + 4], tri[o + 7]), bz = Math.max(tri[o + 1], tri[o + 4], tri[o + 7]);
      const area = (tri[o + 3] - tri[o]) * (tri[o + 7] - tri[o + 1]) - (tri[o + 6] - tri[o]) * (tri[o + 4] - tri[o + 1]);
      if (Math.abs(area) < 1e-9) continue;               // vertical / degenerate (a skirt wall): no x,z footprint
      for (let cx = rng(ax, x0, this.nx); cx <= rng(bx, x0, this.nx); cx++) for (let cz = rng(az, z0, this.nz); cz <= rng(bz, z0, this.nz); cz++) counts[cx * this.nz + cz + 1]++;
    }
    for (let i = 1; i < counts.length; i++) counts[i] += counts[i - 1];
    const list = new Uint32Array(counts[counts.length - 1]);
    const fill = counts.slice(0, -1);
    for (let k = 0; k < t; k++) {
      const o = k * 9;
      const ax = Math.min(tri[o], tri[o + 3], tri[o + 6]), bx = Math.max(tri[o], tri[o + 3], tri[o + 6]);
      const az = Math.min(tri[o + 1], tri[o + 4], tri[o + 7]), bz = Math.max(tri[o + 1], tri[o + 4], tri[o + 7]);
      const area = (tri[o + 3] - tri[o]) * (tri[o + 7] - tri[o + 1]) - (tri[o + 6] - tri[o]) * (tri[o + 4] - tri[o + 1]);
      if (Math.abs(area) < 1e-9) continue;
      for (let cx = rng(ax, x0, this.nx); cx <= rng(bx, x0, this.nx); cx++) for (let cz = rng(az, z0, this.nz); cz <= rng(bz, z0, this.nz); cz++) list[fill[cx * this.nz + cz]++] = k;
    }
    this.tri = tri; this.start = counts; this.list = list; this.nTri = t;
  }
  /** top-most rendered surface height at (x, z); NaN outside every triangle */
  at(x, z) {
    const cx = Math.max(0, Math.min(this.nx - 1, Math.floor((x - this.x0) / this.cell))), cz = Math.max(0, Math.min(this.nz - 1, Math.floor((z - this.z0) / this.cell)));
    const ci = cx * this.nz + cz, tri = this.tri;
    let best = NaN;
    for (let p = this.start[ci]; p < this.start[ci + 1]; p++) {
      const o = this.list[p] * 9;
      const x0 = tri[o], z0 = tri[o + 1], y0 = tri[o + 2], x1 = tri[o + 3], z1 = tri[o + 4], y1 = tri[o + 5], x2 = tri[o + 6], z2 = tri[o + 7], y2 = tri[o + 8];
      const d = (z1 - z2) * (x0 - x2) + (x2 - x1) * (z0 - z2);
      if (d === 0) continue;
      const l0 = ((z1 - z2) * (x - x2) + (x2 - x1) * (z - z2)) / d, l1 = ((z2 - z0) * (x - x2) + (x0 - x2) * (z - z2)) / d, l2 = 1 - l0 - l1;
      const e = -1e-7;
      if (l0 < e || l1 < e || l2 < e) continue;
      const y = l0 * y0 + l1 * y1 + l2 * y2;
      if (!(y <= best)) best = y;
    }
    return best;
  }
}

// ── small stats ────────────────────────────────────────────────────────────────────────────────────────────────
const q = (a, p) => { if (!a.length) return null; const s = Float64Array.from(a).sort(); return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(4); };
const q6 = (a, p) => { if (!a.length) return null; const s = Float64Array.from(a).sort(); return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(7); };       // the Wave-6 ground bar is 1e-4 m: 4 decimals cannot resolve it
const share = (a, f) => (a.length ? +(a.filter(f).length / a.length).toFixed(5) : null);
const r3 = (v) => (v == null || !Number.isFinite(v) ? null : +v.toFixed(3));

// ── plants (faults the gate must catch) ────────────────────────────────────────────────────────────────────────
function applyPlants(ctx) {
  const { byKind, M, terrain, H0 } = ctx;
  const done = [];
  if (PLANTS.has("y-only-recentre") && byKind.rocks) {
    // anchor every rock on its seeded spot (the collider centre): the mesh's own origin offset is drawn again
    const spots = {};
    for (const c of M.colliders) if (c.prop === "rocks") { const s = spots[c.idx] || (spots[c.idx] = { x0: 1e9, x1: -1e9, z0: 1e9, z1: -1e9 }); s.x0 = Math.min(s.x0, c.minX); s.x1 = Math.max(s.x1, c.maxX); s.z0 = Math.min(s.z0, c.minZ); s.z1 = Math.max(s.z1, c.maxZ); }
    const ims = byKind.rocks;
    const Mx = new THREE.Matrix4(), P = new THREE.Vector3(), Qt = new THREE.Quaternion(), S = new THREE.Vector3();
    let n = 0;
    for (let i = 0; i < ims[0].count; i++) {
      const s = spots[i]; if (!s) continue;
      for (const im of ims) {
        const mlk = geomLocal.get(im.geometry).meshLocal;
        im.getMatrixAt(i, Mx);
        Mx.multiply(mlk.clone().invert());             // back to the instance TRS
        Mx.decompose(P, Qt, S);
        P.x = (s.x0 + s.x1) / 2; P.z = (s.z0 + s.z1) / 2;
        Mx.compose(P, Qt, S).multiply(mlk);
        im.setMatrixAt(i, Mx);
      }
      n++;
    }
    done.push("y-only-recentre:" + n);
  }
  if (PLANTS.has("tree-float")) {
    // lift ONE tree so its lowest vertex sits 0.31 m above the physics ground (> the 0.25 m float bar by more than the ground-match error).
    // The candidate is the best-grounded tree 6 m from any chunk border (its lowest vertex closest to the ground, embedded or not: since Wave 5
    // trees are sunk 0.12 m into the ground, so "within 3 cm of the ground" matches nothing and the plant used to apply to NO tree at all)
    const kind = ["tree", "pine", "palm", "birch"].find((k) => byKind[k]);
    if (kind) {
      const ims = byKind[kind], Mx = new THREE.Matrix4(), vv = new THREE.Vector3();
      let pick = -1, bestD = 1e9, pickDy = 0;
      const bd = (c) => { const d = (((c + 800) % 200) + 200) % 200; return Math.min(d, 200 - d); };
      for (let i = 0; i < ims[0].count; i++) {
        let by = 1e9, bx = 0, bz = 0;
        for (const im of ims) {
          im.getMatrixAt(i, Mx); const pos = im.geometry.attributes.position;
          for (let k = 0; k < pos.count; k++) { vv.fromBufferAttribute(pos, k).applyMatrix4(Mx); if (vv.y < by) { by = vv.y; bx = vv.x; bz = vv.z; } }
        }
        if (bd(bx) <= 6 || bd(bz) <= 6) continue;
        const dy = by - H0(bx, bz);
        if (Math.abs(dy) < bestD) { bestD = Math.abs(dy); pick = i; pickDy = dy; }
      }
      if (pick >= 0) {
        const Mx2 = new THREE.Matrix4();
        for (const im of ims) { im.getMatrixAt(pick, Mx2); Mx2.elements[13] += 0.31 - pickDy; im.setMatrixAt(pick, Mx2); im.instanceMatrix.needsUpdate = true; }
        done.push("tree-float:" + kind + "#" + pick);
      } else done.push("tree-float:NO-TREE-AWAY-FROM-A-CHUNK-BORDER");
    } else done.push("tree-float:NO-TREE-KIND");
  }
  if (PLANTS.has("stack-float") && byKind.container) {
    // lift ONE stacked UPPER container (its lowest vertex > 1 m above the ground: it rests on a lower container) by 0.30 m: the
    // stack-support rule must not forgive an upper that really floats
    const ims = byKind.container, Mx = new THREE.Matrix4(), vv = new THREE.Vector3();
    let pick = -1;
    for (let i = 0; i < ims[0].count && pick < 0; i++) {
      let by = 1e9, bx = 0, bz = 0;
      for (const im of ims) {
        im.getMatrixAt(i, Mx); const pos = im.geometry.attributes.position;
        for (let k = 0; k < pos.count; k++) { vv.fromBufferAttribute(pos, k).applyMatrix4(Mx); if (vv.y < by) { by = vv.y; bx = vv.x; bz = vv.z; } }
      }
      if (by - H0(bx, bz) > 1.0) pick = i;
    }
    if (pick >= 0) {
      const Mx2 = new THREE.Matrix4();
      for (const im of ims) { im.getMatrixAt(pick, Mx2); Mx2.elements[13] += 0.3; im.setMatrixAt(pick, Mx2); im.instanceMatrix.needsUpdate = true; }
      done.push("stack-float:container#" + pick);
    } else done.push("stack-float:NO-STACKED-UPPER");
  }
  if (PLANTS.has("perimeter-drop")) {
    let n = 0;
    for (const m of terrain.near) {
      const pos = m.geometry.attributes.position; const bb = m.userData.bb;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), z = pos.getZ(i);
        const edge = Math.abs(x - bb.x0) < 1e-4 || Math.abs(x - bb.x1) < 1e-4 || Math.abs(z - bb.z0) < 1e-4 || Math.abs(z - bb.z1) < 1e-4;
        if (edge && Math.abs(pos.getY(i) - H0(x, z)) < 1e-3) { pos.setY(i, pos.getY(i) - 0.35); n++; }
      }
    }
    done.push("perimeter-drop:" + n);
  }
  return done;
}

// ── 2-D helpers (rotated-wall rows) ────────────────────────────────────────────────────────────────────────────
function dRectXZ(c, x, z) { return Math.hypot(Math.max(c.minX - x, 0, x - c.maxX), Math.max(c.minZ - z, 0, z - c.maxZ)); }
function hullXZ(P) {
  P = P.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (P.length < 3) return P;
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = []; for (const p of P) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  const up = []; for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  up.pop(); lo.pop(); return lo.concat(up);
}
function polyArea(H) { let a = 0; for (let i = 0; i < H.length; i++) { const p = H[i], q = H[(i + 1) % H.length]; a += p[0] * q[1] - q[0] * p[1]; } return Math.abs(a) / 2; }
function sdPoly(px, pz, H) {
  if (H.length < 3) { let m = 1e9; for (const q of H) m = Math.min(m, Math.hypot(px - q[0], pz - q[1])); return m; }
  let inside = true, md = 1e9;
  for (let i = 0; i < H.length; i++) {
    const a = H[i], b = H[(i + 1) % H.length], ex = b[0] - a[0], ez = b[1] - a[1], L2 = ex * ex + ez * ez || 1e-12;
    let t = ((px - a[0]) * ex + (pz - a[1]) * ez) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const d = Math.hypot(px - (a[0] + ex * t), pz - (a[1] + ez * t)); if (d < md) md = d;
    if (ex * (pz - a[1]) - ez * (px - a[0]) < 0) inside = false;
  }
  return inside ? -md : md;
}

// ── the census of one (map, seed) ──────────────────────────────────────────────────────────────────────────────
const FLOAT = 0.10, SINK = 1.0;
const STACKABLE = new Set(["container"]);      // kinds whose instances can rest on another instance of the same kind (maps.js `onTop`)
async function censusOne(mapId, seed, lootMod) {
  globalThis.__LC_BOXES = [];
  const W = makeW(seed);
  const M = await buildMap(W, mapId);
  const H0 = M.heightAt;
  const waterY = typeof M.waterY === "number" ? M.waterY : -999;
  const g = W.group("map");
  g.updateMatrixWorld(true);

  // ---- terrain: far meshes + the near ring the map's own LOD updater builds (one chunk per updater call) ----
  const terrGroup = g.children.find((o) => o.name === "terrain");
  if (!terrGroup) throw new Error("no 'terrain' group under group('map')");
  const upd = (W._mapUpdaters && W._mapUpdaters.length) ? W._mapUpdaters : W.kernel._updaters;
  const farCount = terrGroup.children.length;
  const FOC = [1, 4, 7];
  for (const fi of FOC) for (const fj of FOC) {
    W._camFocus = { pos: { x: -800 + (fi + 0.5) * 200, z: -800 + (fj + 0.5) * 200, y: 0 } };
    for (let k = 0; k < 12; k++) for (const fn of upd) { try { fn(0.016); } catch (e) { /* camera-dependent updaters */ } }
  }
  const chunkKey = (m) => {
    const p = m.geometry.attributes.position; let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i); if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
    m.userData.bb = { x0, x1, z0, z1 };
    return Math.round((x0 + x1) / 2) + ":" + Math.round((z0 + z1) / 2);
  };
  const byChunk = new Map();
  for (const m of terrGroup.children) { if (!m.isMesh) continue; const k = chunkKey(m); (byChunk.get(k) || byChunk.set(k, []).get(k)).push(m); }
  const farMeshes = [], nearMeshes = [];
  for (const [, list] of byChunk) { farMeshes.push(list[0]); if (list.length > 1) nearMeshes.push(list[list.length - 1]); }
  // (the 'terrain' children keep creation order: the far chunk first, the lazily built near chunk last)
  const terrain = { near: nearMeshes, far: farMeshes };
  const bbAll = (ms) => { let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const m of ms) { const b = m.userData.bb; x0 = Math.min(x0, b.x0); x1 = Math.max(x1, b.x1); z0 = Math.min(z0, b.z0); z1 = Math.max(z1, b.z1); } return [x0, z0, x1, z1]; };

  // ---- instanced props ----
  const byKind = {};
  g.traverse((o) => { if (o.isInstancedMesh && o.geometry.userData.kind && !o.castShadow && o.count > 0) (byKind[o.geometry.userData.kind] = byKind[o.geometry.userData.kind] || []).push(o); });

  const ctxP = { byKind, M, terrain, H0 };
  const planted = applyPlants(ctxP);

  const bbN = bbAll(nearMeshes), bbF = bbAll(farMeshes);
  const near = new Surface(nearMeshes, ...bbN, 2.0), far = new Surface(farMeshes, ...bbF, 4.0);
  let dip = null;                                           // plant no-pads: set once the structure boxes are known
  const nearAt = (x, z) => { let y = near.at(x, z); if (Number.isNaN(y)) y = far.at(x, z); return dip ? y - dip(x, z) : y; };

  const rec = { mapId, seed, planted, terrain: { nearChunks: nearMeshes.length, farChunks: farMeshes.length, farCountAtBuild: farCount, nearTris: near.nTri, farTris: far.nTri } };

  // ground error field over dry land: phys - rendered
  if (PLANTS.has("ground-shift")) planted.push("ground-shift:3mm");
  {
    const rnd = SIM.mulberry32((seed ^ 0x77) >>> 0);
    const en = [], ef = [];
    for (let k = 0; k < NSAMP; k++) {
      const x = (rnd() * 2 - 1) * 780, z = (rnd() * 2 - 1) * 780, h = H0(x, z) + (PLANTS.has("ground-shift") ? 0.003 : 0);
      if (waterY > -100 && h < waterY + 0.35) continue;
      const a = near.at(x, z), b = far.at(x, z);
      if (!Number.isNaN(a)) en.push(h - a);
      if (!Number.isNaN(b)) ef.push(h - b);
    }
    rec.field = { near: en, far: ef };
  }

  const propCols = {};
  for (const c of M.colliders) if (c.prop) ((propCols[c.prop] = propCols[c.prop] || {})[c.idx] = propCols[c.prop][c.idx] || []).push(c);
  const mT = new THREE.Matrix4(), mInv = new THREE.Matrix4(), v = new THREE.Vector3(), pA = new THREE.Vector3();
  rec.props = {};
  for (const kind in byKind) {
    const ims = byKind[kind], n = ims[0].count;
    const ml0 = geomLocal.get(ims[0].geometry).meshLocal;
    const out = [];
    // world vertices of drawn instance i (all sub-meshes) + its lowest / highest y
    const collect = (i) => {
      let minY = 1e9, maxY = -1e9;
      const vs = [];
      for (const im of ims) {
        im.getMatrixAt(i, mT);
        const pos = im.geometry.attributes.position;
        for (let k = 0; k < pos.count; k++) { v.fromBufferAttribute(pos, k).applyMatrix4(mT); vs.push(v.x, v.y, v.z); if (v.y < minY) minY = v.y; if (v.y > maxY) maxY = v.y; }
      }
      return { vs, minY, maxY };
    };
    // STACKABLE kinds (a container yard stacks a smaller container on a lower one; maps.js marks that upper `onTop`): a vertex that
    // rests on the drawn TOP of another instance of the same kind is supported by it, not by the ground. Support is the highest top
    // of another instance whose footprint holds the vertex and whose top is at or below the vertex (+ the 0.10 m float tolerance),
    // so an upper that really floats above its lower still reads as floating, an upper sunk into a lower still reads against the
    // ground (not supported), and a ground container that merely overlaps another container's footprint is judged on the ground.
    const stackable = STACKABLE.has(kind);
    const foot = [];
    if (stackable) for (let i = 0; i < n; i++) {
      const c = collect(i); let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
      for (let k = 0; k < c.vs.length; k += 3) { const x = c.vs[k], z = c.vs[k + 2]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
      foot.push({ x0, x1, z0, z1, top: c.maxY, base: c.minY });
    }
    const supportTop = (i, x, z, y) => {
      let best = -1e9;
      for (let j = 0; j < foot.length; j++) {
        if (j === i) continue;
        const f = foot[j];
        if (x < f.x0 - 0.02 || x > f.x1 + 0.02 || z < f.z0 - 0.02 || z > f.z1 + 0.02) continue;
        if (f.top <= y + FLOAT && f.top > best) best = f.top;
      }
      return best;
    };
    for (let i = 0; i < n; i++) {
      const { vs, minY, maxY } = collect(i);
      let onLower = false;
      // TRS anchor = M_i * meshLocal^-1
      ims[0].getMatrixAt(i, mT); mInv.copy(ml0).invert(); mT.multiply(mInv); pA.setFromMatrixPosition(mT);
      const cols = (propCols[kind] || {})[i] || [];
      let cx0 = 1e9, cx1 = -1e9, cz0 = 1e9, cz1 = -1e9, ctop = -1e9, cbot = 1e9;
      for (const c of cols) { cx0 = Math.min(cx0, c.minX); cx1 = Math.max(cx1, c.maxX); cz0 = Math.min(cz0, c.minZ); cz1 = Math.max(cz1, c.maxZ); ctop = Math.max(ctop, c.maxY); cbot = Math.min(cbot, c.minY); }
      const hasCol = cols.length > 0;
      const cenX = hasCol ? (cx0 + cx1) / 2 : pA.x, cenZ = hasCol ? (cz0 + cz1) / 2 : pA.z;
      // base contact (lowest 5 cm of the drawn mesh) and base band (lowest 0.5 m) centre
      let sx = 0, sz = 0, nb = 0, bx0 = 1e9, bx1 = -1e9, bz0 = 1e9, bz1 = -1e9, wx0 = 1e9, wx1 = -1e9, wz0 = 1e9, wz1 = -1e9;
      let floatMax = -1e9, gapMin = 1e9, sinkMax = -1e9, nc = 0;
      let allMin = 1e9, allMax = -1e9;
      const rock = kind === "rocks";
      for (let k = 0; k < vs.length; k += 3) {
        const y = vs[k + 1];
        if (vs[k] < wx0) wx0 = vs[k]; if (vs[k] > wx1) wx1 = vs[k]; if (vs[k + 2] < wz0) wz0 = vs[k + 2]; if (vs[k + 2] > wz1) wz1 = vs[k + 2];
        if (y < minY + 0.5) { sx += vs[k]; sz += vs[k + 2]; nb++; if (vs[k] < bx0) bx0 = vs[k]; if (vs[k] > bx1) bx1 = vs[k]; if (vs[k + 2] < bz0) bz0 = vs[k + 2]; if (vs[k + 2] > bz1) bz1 = vs[k + 2]; }
        const contact = y < minY + 0.05;
        if (contact || rock) {
          let s = nearAt(vs[k], vs[k + 2]);
          if (stackable && contact) {
            const st = supportTop(i, vs[k], vs[k + 2], y);
            if (st > -1e8 && (Number.isNaN(s) || st > s)) { s = st; onLower = true; }
          }
          if (!Number.isNaN(s)) {
            const gap = y - s;
            if (contact) { nc++; if (gap > floatMax) floatMax = gap; if (-gap > sinkMax) sinkMax = -gap; }
            if (gap < allMin) allMin = gap;
            if (gap > allMax) allMax = gap;
          }
        }
      }
      void sx; void sz;
      const visX = (bx0 + bx1) / 2, visZ = (bz0 + bz1) / 2;
      // offset = how far the drawn thing's base is from the collider: the distance from the centre of the drawn BASE (the lowest
      // 0.5 m: a trunk, a barrel, a car) or of the whole drawn FOOTPRINT (a rock cluster) to the nearest collider rectangle of that
      // instance (0 = inside it), whichever is closer. A single box gives the usual centre test; a chain of boxes, or a table that
      // gives a cluster one box per big sub-mesh, is judged on whether the drawn base sits ON it
      const whX = (wx0 + wx1) / 2, whZ = (wz0 + wz1) / 2;
      const physAtAnchor = H0(cenX, cenZ);
      out.push({
        x: r3(cenX), z: r3(cenZ),
        offset: r3(hasCol ? Math.min(...cols.flatMap((c) => [dRectXZ(c, visX, visZ), dRectXZ(c, whX, whZ)])) : Math.min(Math.hypot(visX - cenX, visZ - cenZ), Math.hypot(whX - cenX, whZ - cenZ))),
        offsetCentre: r3(Math.min(Math.hypot(visX - cenX, visZ - cenZ), Math.hypot(whX - cenX, whZ - cenZ))),
        top: r3(maxY), base: r3(minY),
        colTop: hasCol ? r3(ctop) : null, colBase: hasCol ? r3(cbot) : null, colN: cols.length,
        floatMax: nc ? r3(floatMax) : null, sinkMax: nc ? r3(sinkMax) : null, stacked: onLower,
        allMin: rock && allMin < 1e8 ? r3(allMin) : null, allMax: rock && allMax > -1e8 ? r3(allMax) : null,
        slope: r3(Math.hypot(H0(cenX + 1, cenZ) - H0(cenX - 1, cenZ), H0(cenX, cenZ + 1) - H0(cenX, cenZ - 1)) / 2),
        over: waterY > -100 && physAtAnchor < waterY - 0.05,
      });
    }
    rec.props[kind] = out;
  }

  // ---- structure boxes (every BoxGeometry maps.js made) -> connected structures -> pieces with no contact ----
  {
    const T = 0.03;
    const boxes = [];
    for (const b of globalThis.__LC_BOXES) {
      const p = b.geo.attributes.position, cs = [];
      for (let k = 0; k < p.count; k++) { const x = p.getX(k), y = p.getY(k), z = p.getZ(k); if (!cs.some((c) => Math.abs(c[0] - x) < 1e-6 && Math.abs(c[1] - y) < 1e-6 && Math.abs(c[2] - z) < 1e-6)) cs.push([x, y, z]); }
      const bb = { minX: 1e9, maxX: -1e9, minY: 1e9, maxY: -1e9, minZ: 1e9, maxZ: -1e9 };
      for (const c of cs) { bb.minX = Math.min(bb.minX, c[0]); bb.maxX = Math.max(bb.maxX, c[0]); bb.minY = Math.min(bb.minY, c[1]); bb.maxY = Math.max(bb.maxY, c[1]); bb.minZ = Math.min(bb.minZ, c[2]); bb.maxZ = Math.max(bb.maxZ, c[2]); }
      const frames = String(b.stack || "").split("\n").slice(2, 12).map((l) => { const m = l.match(/at (?:async )?(?:Object\.)?([A-Za-z0-9_$.<>]+) \(.*maps\.js:\d+/); return m ? m[1] : null; }).filter(Boolean);
      const isRamp = frames[0] === "addRamp";
      const gen = frames.find((s) => !/^(addBox|addBoxR|addSlabHole|addRamp|buildMap\.addBox)$/.test(s)) || "?";
      // bottom face: 4 lowest corners, gridded to ~1 m
      const bot = cs.slice().sort((a, c) => a[1] - c[1]).slice(0, 4);
      const cxm = bot.reduce((s, c) => s + c[0], 0) / 4, czm = bot.reduce((s, c) => s + c[2], 0) / 4;
      bot.sort((a, c) => Math.atan2(a[2] - czm, a[0] - cxm) - Math.atan2(c[2] - czm, c[0] - cxm));
      const L1 = Math.hypot(bot[1][0] - bot[0][0], bot[1][2] - bot[0][2]), L2 = Math.hypot(bot[3][0] - bot[0][0], bot[3][2] - bot[0][2]);
      const n1 = Math.max(2, Math.min(60, Math.ceil(L1))), n2 = Math.max(2, Math.min(60, Math.ceil(L2)));
      const pts = [];
      for (let a = 0; a <= n1; a++) for (let c = 0; c <= n2; c++) {
        const u = a / n1, w = c / n2, lerp = (k) => bot[0][k] + (bot[1][k] - bot[0][k]) * u + (bot[3][k] - bot[0][k]) * w + (bot[2][k] - bot[1][k] - bot[3][k] + bot[0][k]) * u * w;
        pts.push([lerp(0), lerp(1), lerp(2)]);
      }
      boxes.push({ w: b.w, h: b.h, d: b.d, bb, isRamp, gen, pts, hull: hullXZ(cs.map((c) => [c[0], c[2]])) });
    }
    const par = boxes.map((_, i) => i);
    const find = (i) => (par[i] === i ? i : (par[i] = find(par[i])));
    const grid = new Map();
    boxes.forEach((b, i) => { for (let gx = Math.floor(b.bb.minX / 8); gx <= Math.floor(b.bb.maxX / 8); gx++) for (let gz = Math.floor(b.bb.minZ / 8); gz <= Math.floor(b.bb.maxZ / 8); gz++) { const k = gx * 100000 + gz; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); } });
    for (const [, l] of grid) for (let a = 0; a < l.length; a++) for (let c = a + 1; c < l.length; c++) {
      const A = boxes[l[a]].bb, B = boxes[l[c]].bb;
      if (A.minX - T <= B.maxX && B.minX - T <= A.maxX && A.minY - T <= B.maxY && B.minY - T <= A.maxY && A.minZ - T <= B.maxZ && B.minZ - T <= A.maxZ) par[find(l[a])] = find(l[c]);
    }
    const comps = {};
    boxes.forEach((b, i) => (comps[find(i)] = comps[find(i)] || []).push(i));
    if (PLANTS.has("no-pads")) {
      dip = (x, z) => {
        for (const i of (grid.get(Math.floor(x / 8) * 100000 + Math.floor(z / 8)) || [])) {
          const b = boxes[i]; if (b.isRamp) continue;
          const bb = b.bb;
          if (x >= bb.minX && x <= bb.maxX && z >= bb.minZ && z <= bb.maxZ && x > (bb.minX + bb.maxX) / 2) return 0.35;
        }
        return 0;
      };
      planted.push("no-pads:" + boxes.length);
    }
    const floating = [], grounded = [], pads = [];
    const GEN_PAD = new Set(["house", "hut", "tower", "rangerTower", "waterTower", "steeple", "lighthouse", "farmland"]);
    for (const r in comps) {
      const list = comps[r].map((i) => boxes[i]);
      let touches = false;
      for (const b of list) { for (const p of b.pts) { const hg = H0(p[0], p[2]); if (p[1] - hg <= FLOAT || p[1] - nearAt(p[0], p[2]) <= FLOAT || (waterY > -100 && hg < waterY && Math.abs(p[1] - waterY) <= 0.25)) { touches = true; break; } } if (touches) break; }
      const gens = [...new Set(list.map((b) => b.gen))].join("|");
      const cxm = (list[0].bb.minX + list[0].bb.maxX) / 2, czm = (list[0].bb.minZ + list[0].bb.maxZ) / 2;
      const overWater = waterY > -100 && H0(cxm, czm) < waterY - 0.05;
      if (!touches) {
        let best = 1e9, what = "terrain";
        const cand = [];
        for (const b of list) for (let gx = Math.floor(b.bb.minX / 8); gx <= Math.floor(b.bb.maxX / 8); gx++) for (let gz = Math.floor(b.bb.minZ / 8); gz <= Math.floor(b.bb.maxZ / 8); gz++) for (const j of (grid.get(gx * 100000 + gz) || [])) if (find(j) !== +r) cand.push(j);
        for (const b of list) {
          for (const j of cand) {
            const o = boxes[j].bb;
            if (o.maxX <= b.bb.minX || o.minX >= b.bb.maxX || o.maxZ <= b.bb.minZ || o.minZ >= b.bb.maxZ) continue;
            if (o.maxY > b.bb.minY + 0.05) continue;
            const gap = b.bb.minY - o.maxY; if (gap < best) { best = gap; what = boxes[j].gen; }
          }
          for (const p of b.pts) { const gp = p[1] - Math.max(nearAt(p[0], p[2]), waterY); if (gp < best) { best = gp; what = nearAt(p[0], p[2]) < waterY ? "water" : "terrain"; } }
        }
        floating.push({ gen: gens, x: r3(cxm), z: r3(czm), hover: r3(best), over: what, n: list.length, overWater });
      } else if (!overWater) {
        // base edge float of a grounded structure (Wave-6 row): worst gap of the bottom points of its lowest boxes
        const nonRamp = list.filter((b) => !b.isRamp);
        const baseY = Math.min(...(nonRamp.length ? nonRamp : list).map((b) => b.bb.minY));
        let worst = -1e9;
        for (const b of nonRamp) if (Math.abs(b.bb.minY - baseY) < 0.01) for (const p of b.pts) { const gp = p[1] - nearAt(p[0], p[2]); if (gp > worst) worst = gp; }
        grounded.push({ gen: gens.split("|")[0], edge: r3(worst), x: r3(cxm), z: r3(czm) });
        // pads (Wave 6): the ground under the structure's own footprint (the base-level boxes of its first generator, inset 0.15 m) is one level:
        // the range of the physics ground and of the rendered ground over a <= 1 m grid, the slope the pad was meant to remove
        const g0 = gens.split("|")[0];
        if (GEN_PAD.has(g0)) {
          const base = nonRamp.filter((b) => b.gen === g0 && Math.abs(b.bb.minY - baseY) < 0.01);
          if (base.length) {
            let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
            for (const b of base) { x0 = Math.min(x0, b.bb.minX); x1 = Math.max(x1, b.bb.maxX); z0 = Math.min(z0, b.bb.minZ); z1 = Math.max(z1, b.bb.maxZ); }
            x0 += 0.15; x1 -= 0.15; z0 += 0.15; z1 -= 0.15;
            if (x1 > x0 && z1 > z0) {
              const nx = Math.max(2, Math.ceil(x1 - x0) + 1), nz = Math.max(2, Math.ceil(z1 - z0) + 1);
              let pLo = 1e9, pHi = -1e9, dLo = 1e9, dHi = -1e9;
              for (let a = 0; a < nx; a++) for (let c = 0; c < nz; c++) {
                const x = x0 + (x1 - x0) * a / (nx - 1), z = z0 + (z1 - z0) * c / (nz - 1);
                const hp = H0(x, z), hd = nearAt(x, z);
                if (hp < pLo) pLo = hp; if (hp > pHi) pHi = hp;
                if (!Number.isNaN(hd)) { if (hd < dLo) dLo = hd; if (hd > dHi) dHi = hd; }
              }
              pads.push({ gen: g0, w: r3(x1 - x0), d: r3(z1 - z0), flatPhys: r3(pHi - pLo), flatDraw: dHi >= dLo ? r3(dHi - dLo) : null });
            }
          }
        }
      }
    }
    // the pad rects the map itself reports (Wave 6: M.ground.padLog = { gen, x, z, hx, hz, h }); a revision without pads has none
    const padRects = [];
    if (M.ground && Array.isArray(M.ground.padLog)) for (const pl of M.ground.padLog) {
      let lo = 1e9, hi = -1e9, dlo = 1e9, dhi = -1e9;
      const nx = Math.max(2, Math.ceil(pl.hx * 2) + 1), nz = Math.max(2, Math.ceil(pl.hz * 2) + 1);
      for (let a = 0; a < nx; a++) for (let c = 0; c < nz; c++) {
        const x = pl.x - pl.hx + 2 * pl.hx * a / (nx - 1), z = pl.z - pl.hz + 2 * pl.hz * c / (nz - 1);
        const hp = H0(x, z); if (hp < lo) lo = hp; if (hp > hi) hi = hp;
        const hd = nearAt(x, z); if (!Number.isNaN(hd)) { if (hd < dlo) dlo = hd; if (hd > dhi) dhi = hd; }
      }
      padRects.push({ gen: pl.gen, x: r3(pl.x), z: r3(pl.z), flatPhys: r3(hi - lo), flatDraw: dhi >= dlo ? r3(dhi - dlo) : null, offLevel: r3(Math.abs((hi + lo) / 2 - pl.h)) });
    }
    rec.structures = { boxes: boxes.length, comps: Object.keys(comps).length, floating, grounded, pads, padRects, padApi: !!(M.ground && Array.isArray(M.ground.padLog)) };
    // ramps: step from the supporting floor onto the ramp's low edge (physics ground, or a box top within 0.6 m)
    // (Wave 8, lane K3) a furnished house's pitched-roof PLANKS (house.roofRamps = collider indices, maps.js) are ROOFS, not stairs: their low edge is the eave
    // ~3.6 m over the ground by design, nobody starts a climb there. They are counted apart (information) and never judged as a stair start; every other ramp
    // (house stairs included) is judged as before. A map without houses: the set is empty (unchanged). The ramp-lip plant lifts the first NON-roof ramp.
    const roofSet = new Set();
    for (const h of (M.houses || [])) for (const i of (h.roofRamps || [])) if (M.colliders[i]) roofSet.add(M.colliders[i]);
    // house-stair-lip plant (Wave 8, lane K3): lift the first house STAIR (a ramp inside a house's collider range that is not a roof plank) 0.8 m - the roof exclusion must not hide a real stair
    const houseStair = new Set();
    for (const h of (M.houses || [])) if (h.cols) for (let i = h.cols[0]; i < h.cols[0] + h.cols[2]; i++) { const c2 = M.colliders[i]; if (c2 && c2.kind === "ramp" && !roofSet.has(c2)) houseStair.add(c2); }
    if (PLANTS.has("house-stair-lip")) { const c2 = [...houseStair][0]; if (c2) { c2.minY += 0.8; planted.push("house-stair-lip:1"); } else planted.push("house-stair-lip:NO-STAIR"); }
    const rampsOut = [];
    let rampPlanted = false;
    for (const c of M.colliders) if (c.kind === "ramp") {
      if (PLANTS.has("ramp-lip") && !rampPlanted && !roofSet.has(c)) { c.minY += 0.8; rampPlanted = true; planted.push("ramp-lip:1"); }
      const pts = [];
      for (let t = 0; t <= 4; t++) {
        const u = t / 4;
        if (c.dir === 0) pts.push([c.minX - 0.3, c.minZ + (c.maxZ - c.minZ) * u]); else if (c.dir === 1) pts.push([c.maxX + 0.3, c.minZ + (c.maxZ - c.minZ) * u]);
        else if (c.dir === 2) pts.push([c.minX + (c.maxX - c.minX) * u, c.minZ - 0.3]); else pts.push([c.minX + (c.maxX - c.minX) * u, c.maxZ + 0.3]);
      }
      const supAt = (x, z) => { let f = H0(x, z), what = "ground"; for (const o of M.queryColliders(x, z, 0.05, [])) { if (o === c || o.kind !== "box" || x < o.minX || x > o.maxX || z < o.minZ || z > o.maxZ) continue; if (o.maxY <= c.minY + 0.6 && o.maxY > f) { f = o.maxY; what = "box"; } } return [f, what]; };
      const sups = pts.map((p) => supAt(p[0], p[1]));
      const onWater = waterY > -100 && sups.every((s2) => s2[1] === "ground" && s2[0] < waterY);
      if (!onWater) rampsOut.push({ step: r3(Math.max(...sups.map((s2) => c.minY - s2[0]))), onBox: sups[2][1] === "box", climb: r3(c.maxY - c.minY), roof: roofSet.has(c) });
    }
    if (PLANTS.has("ramp-lip") && !rampPlanted) planted.push("ramp-lip:NO-RAMP");
    rec.ramps = rampsOut;
    // slope of every ramp's plank (C-RAMP authoring: <= 45 degrees), water or not
    rec.rampSlopes = M.colliders.filter((c) => c.kind === "ramp").map((c) => r3(Math.atan2(c.maxY - c.minY, c.dir < 2 ? c.maxX - c.minX : c.maxZ - c.minZ) * 180 / Math.PI));
    // doorways: lintel boxes of house / hut / tower / lighthouse / steeple / farmland -> clearance under the lintel
    const LINTEL = [["house", 1.4, 0.7], ["house", 2.26, 0.7], ["hut", 1.4, 0.8], ["tower", 1.8, 1], ["lighthouse", 1.5, 0.7], ["steeple", 2, 3.2], ["farmland", 3, 1.2]];
    const doors = [];
    for (const b of boxes) {
      const L = LINTEL.find((l) => b.gen === l[0] && Math.abs(b.w - l[1]) < 1e-6 && Math.abs(b.h - l[2]) < 1e-6);
      if (!L) continue;
      const bb = b.bb; let gMax = -1e9;
      const thinX = (bb.maxX - bb.minX) < (bb.maxZ - bb.minZ);
      for (let a = 0; a <= 6; a++) for (let s = -1; s <= 1; s++) {
        const u = a / 6;
        const x = thinX ? (bb.minX + bb.maxX) / 2 + s * 0.6 : bb.minX + (bb.maxX - bb.minX) * u, z = thinX ? bb.minZ + (bb.maxZ - bb.minZ) * u : (bb.minZ + bb.maxZ) / 2 + s * 0.6;
        gMax = Math.max(gMax, H0(x, z));
      }
      if (PLANTS.has("door-buried") && doors.length < 3) { gMax += 0.9; if (doors.length === 0) planted.push("door-buried:3"); }
      doors.push({ sub: L[0], clearance: r3(bb.minY - gMax) });
    }
    if (PLANTS.has("door-buried") && doors.length === 0) planted.push("door-buried:NO-DOOR");
    rec.doors = doors;
    // rotated walls: every drawn box whose x,z outline is a turned rectangle, against the AABB colliders that stand for it.
    // A collider belongs to the drawn box with the SAME bounding box (maps.js addBox: collider = AABB of the turned box), else
    // - for a wall built from a chain of small boxes - to the turned box it fits best. gap = how far the collider's corners
    // reach beyond the drawn outline (HEAD: up to 8.4 m); excess = collider area beyond the drawn area.
    {
      const key = (a, b, c2, d2, e, f2) => [a, b, c2, d2, e, f2].map((v2) => Math.round(v2 * 500)).join(",");
      const exact = new Map();
      for (const b of boxes) if (!b.isRamp) exact.set(key(b.bb.minX, b.bb.maxX, b.bb.minZ, b.bb.maxZ, b.bb.minY, b.bb.maxY), b);
      const turned = boxes.filter((b) => !b.isRamp && b.hull.length >= 3 && (b.bb.maxX - b.bb.minX) * (b.bb.maxZ - b.bb.minZ) - polyArea(b.hull) > 0.02 * (b.bb.maxX - b.bb.minX) * (b.bb.maxZ - b.bb.minZ));
      const gapOf = (c, b) => { let g = 0; for (const [x, z] of [[c.minX, c.minZ], [c.maxX, c.minZ], [c.maxX, c.maxZ], [c.minX, c.maxZ]]) g = Math.max(g, sdPoly(x, z, b.hull)); return g; };
      const per = new Map(turned.map((b) => [b, { gap: 0, area: 0, n: 0 }]));
      const tgrid = new Map();
      turned.forEach((b, i) => { for (let gx = Math.floor((b.bb.minX - 1) / 16); gx <= Math.floor((b.bb.maxX + 1) / 16); gx++) for (let gz = Math.floor((b.bb.minZ - 1) / 16); gz <= Math.floor((b.bb.maxZ + 1) / 16); gz++) { const k = gx * 100000 + gz; if (!tgrid.has(k)) tgrid.set(k, []); tgrid.get(k).push(b); } });
      for (const c of M.colliders) {
        if (c.kind !== "box" || c.prop || c.dead) continue;
        let owner = exact.get(key(c.minX, c.maxX, c.minZ, c.maxZ, c.minY, c.maxY));
        if (!owner || !per.has(owner)) {
          if (owner) continue;                                              // an axis-aligned box's own collider
          let best = null, bg = 1e9;
          const ccx = (c.minX + c.maxX) / 2, ccz = (c.minZ + c.maxZ) / 2;
          for (const b of tgrid.get(Math.floor(ccx / 16) * 100000 + Math.floor(ccz / 16)) || []) {
            if (Math.abs(c.minY - b.bb.minY) > 0.06 || Math.abs(c.maxY - b.bb.maxY) > 0.06) continue;
            if (sdPoly(ccx, ccz, b.hull) > 1.0) continue;
            const g2 = gapOf(c, b); if (g2 < bg) { bg = g2; best = b; }
          }
          owner = best;
        }
        if (!owner || !per.has(owner)) continue;
        const o = per.get(owner); o.gap = Math.max(o.gap, gapOf(c, owner)); o.area += (c.maxX - c.minX) * (c.maxZ - c.minZ); o.n++;
      }
      const list = [...per.entries()].filter(([, o]) => o.n > 0).map(([b, o]) => ({ gen: b.gen, x: r3((b.bb.minX + b.bb.maxX) / 2), z: r3((b.bb.minZ + b.bb.maxZ) / 2), w: r3(b.w), d: r3(b.d), h: r3(b.h), gap: r3(o.gap), excess: r3(Math.max(0, o.area - polyArea(b.hull))), colliders: o.n }));
      rec.rotWalls = { turned: turned.length, owned: list.length, list };
    }
  }
  globalThis.__LC_BOXES = null;

  // ---- roads: the merged asphalt ribbon vs the rendered near surface ----
  {
    let roadMesh = null; g.traverse((o) => { if (o.name === "roads") roadMesh = o; });
    if (roadMesh) {
      const p = roadMesh.geometry.attributes.position, idx = roadMesh.geometry.index;
      let n = 0, floatN = 0, pokeN = 0, worstF = 0;
      const BARY = [[1 / 3, 1 / 3], [0.6, 0.2], [0.2, 0.6], [0.2, 0.2]];
      for (let t = 0; t < idx.count; t += 3) {
        const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2);
        for (const [u, w] of BARY) {
          const x = p.getX(a) + (p.getX(b) - p.getX(a)) * u + (p.getX(c) - p.getX(a)) * w, y = p.getY(a) + (p.getY(b) - p.getY(a)) * u + (p.getY(c) - p.getY(a)) * w, z = p.getZ(a) + (p.getZ(b) - p.getZ(a)) * u + (p.getZ(c) - p.getZ(a)) * w;
          const s = near.at(x, z); if (Number.isNaN(s)) continue;
          const yy = PLANTS.has("roads-lifted") ? y + 0.3 : y;
          n++; if (yy - s > FLOAT) { floatN++; worstF = Math.max(worstF, yy - s); } if (yy - s < 0) pokeN++;
        }
      }
      if (PLANTS.has("roads-lifted")) planted.push("roads-lifted:" + n);
      rec.roads = { n, floatN, pokeN, worstFloat: r3(worstF) };
    } else if (PLANTS.has("roads-lifted")) planted.push("roads-lifted:NO-ROADS");
  }

  // ---- loot: chests and floor-item rings, from the game's own loot.js populate() ----
  rec.loot = null;
  if (lootMod) {
    try {
      W.map = M;
      if (!W.__lootInit) { lootMod.init(W); W.__lootInit = true; }
      lootMod.populate(W);
      const chests = (W.debugChests ? W.debugChests() : []).map((c) => {
        const gy = c.pos.y, ry = (c.pos.x * 13.7 + c.pos.z * 7.3) % (Math.PI * 2), cr = Math.cos(ry), sr = Math.sin(ry);
        const corners = [[-0.8, -0.52], [0.8, -0.52], [0.8, 0.52], [-0.8, 0.52], [0, 0]].map(([a, b]) => [c.pos.x + a * cr + b * sr, c.pos.z - a * sr + b * cr]);
        const under = (x, z) => { let f = nearAt(x, z), box = false; for (const o of M.queryColliders(x, z, 0.05, [])) { if (o.kind !== "box" || x < o.minX || x > o.maxX || z < o.minZ || z > o.maxZ) continue; if (o.maxY <= gy + 0.35 && o.maxY >= gy - 1.5 && o.maxY > f - 0.5 && Math.abs(gy - o.maxY) < Math.abs(gy - f)) { f = o.maxY; box = true; } } return [f, box]; };
        const sup = corners.map(([x, z]) => under(x, z));
        const gaps = sup.map((s2) => gy - s2[0]);
        return { onBox: sup[4][1], gap: r3(gaps[4]), floatMax: r3(Math.max(...gaps)), sinkMax: r3(-Math.min(...gaps)) };
      });
      const rings = [];
      W.group("loot").traverse((o) => {
        if (!(o.isInstancedMesh && o.name === "loot-rings")) return;
        const m4 = new THREE.Matrix4(), e = new THREE.Vector3(), sc = new THREE.Vector3(), qq = new THREE.Quaternion();
        for (let i = 0; i < o.count; i++) {
          o.getMatrixAt(i, m4); m4.decompose(e, qq, sc);
          if (sc.x < 1e-3) continue;
          const d = sc.x / 2, pts = [[0, 0], [d, 0], [-d, 0], [0, d], [0, -d]].map(([a, b]) => [e.x + a, e.z + b]);
          // the support: a box top within 0.3 m below the ring, else the rendered ground
          const hov = pts.map(([x, z]) => { let f = nearAt(x, z), box = false; for (const c of M.queryColliders(x, z, 0.05, [])) { if (c.kind !== "box" || x < c.minX || x > c.maxX || z < c.minZ || z > c.maxZ) continue; if (c.maxY <= e.y + 0.05 && c.maxY > f && e.y - c.maxY < 0.3) { f = c.maxY; box = true; } } return [e.y - f, box]; });
          rings.push({ centre: r3(hov[0][1] ? hov[0][0] : hov[0][0]), onBox: hov[0][1], max: r3(Math.max(...hov.map((h) => h[0]))), min: r3(Math.min(...hov.map((h) => h[0]))) });
        }
      });
      rec.loot = { chests, rings, items: (lootMod.debugItems ? lootMod.debugItems().length : null) };
    } catch (e) {
      rec.loot = { error: String(e && e.stack || e).split("\n").slice(0, 4).join(" | ") };
    }
  }
  // free the map (the process builds 15 of them)
  try { if (typeof M.dispose === "function") M.dispose(); } catch (e) { /* ignore */ }
  return rec;
}

// ── pooled statistics ──────────────────────────────────────────────────────────────────────────────────────────
function summarise(results) {
  const per = {};
  for (const R of results) {
    const S = (per[R.mapId] = per[R.mapId] || { seeds: [], field: { near: [], far: [] }, props: {}, floating: [], grounded: [], ramps: [], doors: [], roads: { n: 0, floatN: 0, pokeN: 0 }, chests: [], rings: [], planted: R.planted, lootError: null, rot: { turned: 0, list: [] } });
    S.seeds.push(R.seed);
    S.field.near.push(...R.field.near); S.field.far.push(...R.field.far);
    for (const kind in R.props) (S.props[kind] = S.props[kind] || []).push(...R.props[kind].filter((p) => !p.over));
    S.floating.push(...R.structures.floating.map((f) => ({ ...f, seed: R.seed })));
    S.grounded.push(...R.structures.grounded.map((g2) => ({ ...g2, seed: R.seed })));
    (S.pads = S.pads || []).push(...(R.structures.pads || [])); (S.padRects = S.padRects || []).push(...(R.structures.padRects || []).map((r4) => ({ ...r4, seed: R.seed }))); S.padApi = S.padApi || R.structures.padApi;
    S.ramps.push(...R.ramps); S.doors.push(...R.doors); (S.rampSlopes = S.rampSlopes || []).push(...(R.rampSlopes || []));
    S.rot.turned += R.rotWalls.turned; S.rot.list.push(...R.rotWalls.list.map((r) => ({ ...r, seed: R.seed })));
    if (R.roads) { S.roads.n += R.roads.n; S.roads.floatN += R.roads.floatN; S.roads.pokeN += R.roads.pokeN; }
    if (R.loot && R.loot.error) S.lootError = R.loot.error;
    else if (R.loot) { S.chests.push(...R.loot.chests); S.rings.push(...R.loot.rings); }
  }
  const out = {};
  for (const mapId in per) {
    const S = per[mapId];
    const o = { seeds: S.seeds, planted: S.planted };
    const fe = (a) => ({ n: a.length, p50: q(a, 0.5), p95: q(a, 0.95), p99: q(a, 0.99), p999: q(a, 0.999), max: q(a, 1), min: q(a, 0), shareGt10: share(a, (e) => e > 0.1), shareAbsGt10: share(a, (e) => Math.abs(e) > 0.1), absP99: q6(a.map(Math.abs), 0.99), absMax: q6(a.map(Math.abs), 1), absP999: q6(a.map(Math.abs), 0.999), shareAbsGt1e4: share(a, (e) => Math.abs(e) > 1e-4) });
    o.field = { near: fe(S.field.near), far: fe(S.field.far) };
    o.props = {};
    for (const kind in S.props) {
      const L = S.props[kind], rock = kind === "rocks";
      const has = L.filter((p) => p.floatMax != null);
      o.props[kind] = {
        n: L.length,
        offsetP50: q(L.map((p) => p.offset), 0.5), offsetP90: q(L.map((p) => p.offset), 0.9), offsetMax: q(L.map((p) => p.offset), 1),
        centreP50: q(L.map((p) => p.offsetCentre), 0.5), centreMax: q(L.map((p) => p.offsetCentre), 1),
        floatShare: share(has, (p) => p.floatMax > FLOAT), floatP50: q(has.map((p) => p.floatMax), 0.5), floatP90: q(has.map((p) => p.floatMax), 0.9), floatMaxMax: q(has.map((p) => p.floatMax), 1),
        sunkShare: share(has, (p) => p.sinkMax > SINK), sunkMax: q(has.map((p) => p.sinkMax), 1),
        stackedN: has.filter((p) => p.stacked).length,                                                       // instances resting on another instance's top
        stackedFloatMax: q(has.filter((p) => p.stacked).map((p) => p.floatMax), 1),
        stackedFloatShare: share(has.filter((p) => p.stacked), (p) => p.floatMax > FLOAT),
        hoverShare02: rock ? share(L.filter((p) => p.allMin != null), (p) => p.allMin > 0.2) : null,        // lowest vertex still > 0.2 m above the surface
        airShare: rock ? share(L.filter((p) => p.allMin != null), (p) => p.allMin > 0) : null,             // wholly in the air
        buriedFullyShare: rock ? share(L.filter((p) => p.allMax != null), (p) => p.allMax < 0) : null,     // every vertex under the surface
        buriedDeepShare: rock ? share(has, (p) => p.sinkMax > 0.5) : null,
        colTopN: L.filter((p) => p.colTop != null).length,
        colTopMissShare: share(L.filter((p) => p.colTop != null), (p) => Math.abs(p.colTop - p.top) > 0.3),
        colTopDiffP50: q(L.filter((p) => p.colTop != null).map((p) => Math.abs(p.colTop - p.top)), 0.5), colTopDiffMax: q(L.filter((p) => p.colTop != null).map((p) => Math.abs(p.colTop - p.top)), 1),
        noCollider: L.filter((p) => p.colTop == null).length,
      };
    }
    // structures: floating pieces by generator
    const fg = {};
    for (const f of S.floating) { const k = f.gen; (fg[k] = fg[k] || []).push(f); }
    o.floating = Object.keys(fg).sort().map((k) => ({ gen: k, n: fg[k].length, hoverP50: q(fg[k].map((f) => f.hover), 0.5), hoverMax: q(fg[k].map((f) => f.hover), 1), over: fg[k][0].over, overWater: fg[k][0].overWater, e: [fg[k][0].seed, fg[k][0].x, fg[k][0].z] }));
    const gg = {};
    for (const s2 of S.grounded) { (gg[s2.gen] = gg[s2.gen] || []).push(s2.edge); }
    o.grounded = Object.keys(gg).sort().map((k) => ({ gen: k, n: gg[k].length, edgeGt10Share: share(gg[k], (e) => e > 0.1), edgeP50: q(gg[k], 0.5), edgeMax: q(gg[k], 1),
      worst: S.grounded.filter((s3) => s3.gen === k).sort((a2, b2) => b2.edge - a2.edge).slice(0, 3).map((s3) => ({ seed: s3.seed, x: s3.x, z: s3.z, edge: s3.edge })) }));
    // Wave 6 pads: the flatness (max - min of the ground) under every pad-generator structure's footprint, physics and drawn; and of every pad
    // rect the map reports (M.ground.padLog). A pad is flat when the range is <= 0.02 m.
    const pr = (a, k) => a.map((e) => e[k]).filter((v2) => v2 != null);
    const flatShare = (a, k, lim) => (a.length ? +(a.filter((e) => e[k] != null && e[k] > lim).length / a.length).toFixed(5) : null);
    const byGenP = {};
    for (const e of (S.pads || [])) (byGenP[e.gen] = byGenP[e.gen] || []).push(e);
    o.pads = { n: (S.pads || []).length, over02Phys: flatShare(S.pads || [], "flatPhys", 0.02), over02Draw: flatShare(S.pads || [], "flatDraw", 0.02),
      maxPhys: q(pr(S.pads || [], "flatPhys"), 1), maxDraw: q(pr(S.pads || [], "flatDraw"), 1), p50Draw: q(pr(S.pads || [], "flatDraw"), 0.5), p90Draw: q(pr(S.pads || [], "flatDraw"), 0.9),
      byGen: Object.keys(byGenP).sort().map((g) => ({ gen: g, n: byGenP[g].length, over02Draw: flatShare(byGenP[g], "flatDraw", 0.02), maxDraw: q(pr(byGenP[g], "flatDraw"), 1), maxPhys: q(pr(byGenP[g], "flatPhys"), 1) })),
      api: !!S.padApi, rects: (S.padRects || []).length, rectsOver02Phys: flatShare(S.padRects || [], "flatPhys", 0.02), rectsOver02Draw: flatShare(S.padRects || [], "flatDraw", 0.02),
      rectsMaxPhys: q(pr(S.padRects || [], "flatPhys"), 1), rectsMaxDraw: q(pr(S.padRects || [], "flatDraw"), 1), rectsOffLevelMax: q(pr(S.padRects || [], "offLevel"), 1),
      rectsWorst: (S.padRects || []).slice().sort((a2, b2) => b2.flatPhys - a2.flatPhys).slice(0, 5).map((r4) => ({ seed: r4.seed, gen: r4.gen, x: r4.x, z: r4.z, flatPhys: r4.flatPhys, flatDraw: r4.flatDraw })),
      rectsByGen: Object.entries((S.padRects || []).reduce((m3, r4) => { const b3 = m3[r4.gen] || (m3[r4.gen] = { n: 0, over: 0 }); b3.n++; if (r4.flatPhys > 0.02) b3.over++; return m3; }, {})).filter(([, b3]) => b3.over).map(([g, b3]) => ({ gen: g, n: b3.n, over: b3.over })) };
    o.rampSlope = { n: (S.rampSlopes || []).length, gt45: (S.rampSlopes || []).filter((d) => d > 45.05).length, max: q(S.rampSlopes || [], 1), p50: q(S.rampSlopes || [], 0.5) };
    const stairR = S.ramps.filter((r) => !r.roof), roofR = S.ramps.filter((r) => r.roof);
    o.ramps = { n: stairR.length, stepGt055: stairR.filter((r) => r.step > 0.55).length, stepMax: q(stairR.map((r) => r.step), 1),
      roofN: roofR.length, roofStepGt055: roofR.filter((r) => r.step > 0.55).length, roofStepMax: q(roofR.map((r) => r.step), 1) };
    o.doors = { n: S.doors.length, minClear: q(S.doors.map((d) => d.clearance), 0), ltCapsule: S.doors.filter((d) => d.clearance < 1.85).length, lt20: S.doors.filter((d) => d.clearance < 2.0).length };
    o.roads = { n: S.roads.n, floatShare: S.roads.n ? +(S.roads.floatN / S.roads.n).toFixed(5) : null, pokeShare: S.roads.n ? +(S.roads.pokeN / S.roads.n).toFixed(5) : null };
    const ct = S.chests.filter((c) => !c.onBox), cb = S.chests.filter((c) => c.onBox);
    o.chests = { n: S.chests.length, terrainN: ct.length, gapP50: q(ct.map((c) => c.gap), 0.5), gapP90: q(ct.map((c) => c.gap), 0.9), gapMax: q(ct.map((c) => c.gap), 1), floatP50: q(ct.map((c) => c.floatMax), 0.5), floatMaxMax: q(ct.map((c) => c.floatMax), 1),
      sunkP90: q(ct.map((c) => c.sinkMax), 0.9), boxN: cb.length, boxGapP50: q(cb.map((c) => c.gap), 0.5), boxGapMin: q(cb.map((c) => c.gap), 0), boxGapMax: q(cb.map((c) => c.gap), 1) };
    const rt = S.rings.filter((r) => !r.onBox);
    o.rings = { n: S.rings.length, terrainN: rt.length, centreP50: q(rt.map((r) => r.centre), 0.5), centreP99: q(rt.map((r) => r.centre), 0.99), maxP99: q(rt.map((r) => r.max), 0.99), maxMax: q(rt.map((r) => r.max), 1), minMin: q(rt.map((r) => r.min), 0) };
    o.rotWalls = { turned: S.rot.turned, owned: S.rot.list.length, gapMax: q(S.rot.list.map((r) => r.gap), 1), gapP95: q(S.rot.list.map((r) => r.gap), 0.95), excessM2: r3(S.rot.list.reduce((a2, r) => a2 + r.excess, 0)),
      worst: S.rot.list.slice().sort((a2, b2) => b2.gap - a2.gap).slice(0, 4), bySite: Object.fromEntries(Object.entries(S.rot.list.reduce((m2, r) => { const b2 = m2[r.gen] || (m2[r.gen] = { n: 0, gapMax: 0, excess: 0 }); b2.n++; b2.gapMax = Math.max(b2.gapMax, r.gap); b2.excess += r.excess; return m2; }, {})).map(([k, v2]) => [k, { n: v2.n, gapMax: r3(v2.gapMax), excessM2: r3(v2.excess) }])) };
    o.lootError = S.lootError;
    out[mapId] = o;
  }
  return out;
}

// ── --mode city (lane 6E, Wave 6): the Node half of citycheck.py ───────────────────────────────────────────────────
//   node placement_census.mjs --mode city --root <game dir> --vendor <three vendor dir> --maps ashgrid --seeds 7,1,2 --out city.json
//        [--legacy-seeds 7,1234] [--grid 4] [--buildings] [--towngen] [--city-plant wet-street]   (Wave 7b: --city-plant forces 10 layout street samples wet, the town-roads-dry control)
// Builds each (map, seed) with the UNMODIFIED maps.js and runs probe_city.js's measure() on the BUILT map: enterable buildings (the pinned
// door-checked detector), land distance to them, town-road wetness, per-town enterable counts, the endgame cover counts. The same function
// runs in the page (citycheck.py's live half), so a mismatch between the two is a harness defect, not a game one. Nothing is written but --out.
async function cityMode() {
  const API = (0, eval)("(" + fs.readFileSync(path.join(HERE, "probe_city.js"), "utf8") + ")()");
  const legacySeeds = new Set((args["legacy-seeds"] || "").split(",").filter(Boolean).map(Number));
  const grid = Number(args.grid || 4);
  const rows = [];
  const t0 = Date.now();
  for (const mapId of MAPS) for (const seed of SEEDS) {
    const t1 = Date.now();
    globalThis.__LC_BOXES = null;
    const W = makeW(seed);
    const warn = console.warn; console.warn = () => {};
    let M;
    try { M = await buildMap(W, mapId); } finally { console.warn = warn; }
    let roadMesh = null;
    W.group("map").traverse((o) => { if (o.name === "roads") roadMesh = o; });
    const rec = API.measure(M, { SIM, seed, mapId, roadMesh, grid, legacy: legacySeeds.has(seed), withBuildings: !!args.buildings, plant: args["city-plant"] || null });
    rec.buildMs = Date.now() - t1 - rec.ms;
    rows.push(rec);
    try { if (typeof M.dispose === "function") M.dispose(); } catch (e) { /* ignore */ }
    process.stderr.write(`city ${mapId} seed ${seed}: build ${rec.buildMs} ms, measure ${rec.ms} ms, enterable ${rec.enterable} (sealed ${rec.sealed}), median ${rec.cover.median} m\n`);
  }
  const doc = { tool: "placement_census.mjs --mode city", root: ROOT, maps: MAPS, seeds: SEEDS, probe: API.PIN, wallS: +((Date.now() - t0) / 1000).toFixed(1), rows };
  const text = JSON.stringify(doc);
  if (OUT) { fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true }); fs.writeFileSync(OUT, text); process.stderr.write("placement_census city: wrote " + OUT + " (" + text.length + " bytes)\n"); }
  else process.stdout.write(text);
  process.exit(0);
}
if (args.mode === "city") await cityMode();

// ── --mode towngen (lane 6E, Wave 6): a pre-wiring FORECAST of Wave 7 ───────────────────────────────────────────────
//   node placement_census.mjs --mode towngen --root <game dir> --vendor <three vendor dir> --maps ashgrid --seeds 7,1,2 --out tg.json
// Lane 6B's runtime/3d/royale/towngen.js is not wired into the live game in Wave 6. This scores what Wave 7 would give: the CURRENT world (built by
// the unmodified maps.js, real heightAt, snapped POIs) with the contents of every POI that towngen fills (a layout with >= 1 enterable parcel)
// REPLACED by the generator's layout, plus the compounds:
//   enterable buildings = the pinned detector's buildings on the current map that lie outside the replaced POI circles (poi.r + 15 m)
//                         + every enterable parcel of every town and compound layout (parcel.building.aabb)
//   per town            = the layout's own enterable count (a POI the generator leaves empty keeps its current count)
//   town roads          = every street corridor of every town layout (the polyline C-PAD would flatten, 10 m wide) sampled every 4 m at 5 cross-section
//                         offsets, on the CURRENT ground: a vertex whose ground is under waterY is wet (the same rule as the live row)
//   endgame cover       = the current map's static cover pieces outside the replaced circles + K per enterable parcel whose middle lies in the circle,
//                         K = the MEDIAN number of pieces (>= 1.2 m tall static colliders) that today's enterable buildings hold, at least 4 (a FORECAST:
//                         the generator emits no collider list yet; Kp10 is recorded too)
// The record has the shape of --mode city's, so citycheck.py judges it with the same rows.
async function towngenMode() {
  const TG_JS = path.join(ROOT, "runtime", "3d", "royale", "towngen.js");
  if (!fs.existsSync(TG_JS)) { console.error("placement_census: no towngen.js at " + TG_JS); process.exit(4); }
  const TG = await import(pathToFileURL(TG_JS).href);
  const API = (0, eval)("(" + fs.readFileSync(path.join(HERE, "probe_city.js"), "utf8") + ")()");
  const grid = Number(args.grid || 4);
  const rows = [];
  const t0 = Date.now();
  for (const mapId of MAPS) for (const seed of SEEDS) {
    const t1 = Date.now();
    globalThis.__LC_BOXES = null;
    const W = makeW(seed);
    const warn = console.warn; console.warn = () => {};
    let M;
    try { M = await buildMap(W, mapId); } finally { console.warn = warn; }
    const base = API.measure(M, { SIM, seed, mapId, roadMesh: null, grid, legacy: false, withBuildings: true });
    const wy = M.waterY, dryMap = wy < -100;
    const pois = M.pois.map((p) => ({ id: p.id, name: p.name, x: p.x, z: p.z, r: p.r }));
    const t2 = Date.now();
    const lay = TG.layoutMap(seed, mapId, pois.map((p) => ({ id: p.id, x: p.x, z: p.z, r: p.r })), M.heightAt, wy);
    const tgMs = Date.now() - t2;
    const sites = lay.towns.concat(lay.compounds);
    const replaced = pois.filter((p) => { const T = lay.towns.find((q) => q.id === p.id); return T && T.stats.enterable > 0; });
    const inReplaced = (x, z) => replaced.some((p) => Math.hypot(x - p.x, z - p.z) < p.r + 15);
    // K: static cover pieces per enterable building today (10th percentile, at least 4)
    const cols = M.colliders.filter((c) => !c.prop && !c.dead && c.kind !== "ramp" && c.maxY - c.minY >= 1.2);
    const perB = base.buildings.map((b) => cols.filter((c) => { const mx = (c.minX + c.maxX) / 2, mz = (c.minZ + c.maxZ) / 2; return mx >= b[2] - 0.6 && mx <= b[3] + 0.6 && mz >= b[4] - 0.6 && mz <= b[5] + 0.6; }).length).sort((a, b) => a - b);
    const K = Math.max(4, perB.length ? perB[perB.length >> 1] : 4), Kp10 = perB.length ? perB[Math.floor(perB.length * 0.1)] : 0;
    const kept = base.buildings.filter((b) => !inReplaced(b[0], b[1]));
    const fresh = [];
    for (const T of sites) for (const par of T.parcels) if (par.building && par.building.enterable) { const a = par.building.aabb; fresh.push({ x0: a[0], z0: a[1], x1: a[2], z1: a[3], cx: (a[0] + a[2]) / 2, cz: (a[1] + a[3]) / 2, site: T.id }); }
    const rects = kept.map((b) => ({ x0: b[2], x1: b[3], z0: b[4], z1: b[5] })).concat(fresh.map((f) => ({ x0: f.x0, x1: f.x1, z0: f.z0, z1: f.z1 })));
    const cover = API.landDistance(rects, M.heightAt, wy, M.half || 800, grid);
    // per town
    const perPoi = {};
    for (const p of pois) { const T = lay.towns.find((q) => q.id === p.id); perPoi[p.id] = T && T.stats.enterable > 0 ? T.stats.enterable : (base.perPoi[p.id] || 0); }
    // town roads on the current ground
    const roads = { meshFound: true, verts: 0, townVerts: 0, wetTown: 0, wetAll: 0, wetByPoi: {}, townByPoi: {}, linkWet: lay.links.reduce((a, l) => a + (l.wetVerts || 0), 0), links: lay.links.length };
    for (const T of lay.towns) for (const c of T.corridors || []) {
      const hw = (c.width || 10) / 2;
      for (let i = 0; i + 1 < c.points.length; i++) {
        const ax = c.points[i][0], az = c.points[i][1], bx = c.points[i + 1][0], bz = c.points[i + 1][1], len = Math.hypot(bx - ax, bz - az) || 1;
        const n = Math.max(1, Math.ceil(len / 4)), ux = (bx - ax) / len, uz = (bz - az) / len;
        for (let k = 0; k <= n; k++) for (const off of [-1, -0.5, 0, 0.5, 1]) {
          const x = ax + (bx - ax) * k / n + (-uz) * off * hw, z = az + (bz - az) * k / n + ux * off * hw;
          roads.verts++; roads.townVerts++; roads.townByPoi[T.id] = (roads.townByPoi[T.id] || 0) + 1;
          if (!dryMap && M.heightAt(x, z) < wy) { roads.wetTown++; roads.wetAll++; roads.wetByPoi[T.id] = (roads.wetByPoi[T.id] || 0) + 1; }
        }
      }
    }
    // endgame
    let endgame = null;
    if (SIM && typeof SIM.Storm === "function") {
      const St = new SIM.Storm({ seed, mode: "standard", half: M.half });
      const cs = St.circles, idx = [cs.length - 3, cs.length - 2, cs.length - 1];
      const cols2 = M.colliders.filter((c) => !c.prop && !c.dead && c.kind !== "ramp");
      endgame = {};
      for (const i of idx) {
        const c = cs[i]; let pieces = 0, roofs = 0;
        for (const k of cols2) {
          const mx = (k.minX + k.maxX) / 2, mz = (k.minZ + k.maxZ) / 2;
          if (Math.hypot(mx - c.x, mz - c.z) > c.r || inReplaced(mx, mz)) continue;
          if (k.maxY - k.minY >= 1.2) pieces++;
          if (Math.abs((k.maxY - k.minY) - 0.3) < 0.01 && (k.maxX - k.minX) * (k.maxZ - k.minZ) > 20) roofs++;
        }
        const nb = fresh.filter((f) => Math.hypot(f.cx - c.x, f.cz - c.z) <= c.r).length;
        endgame["c" + i] = { x: Math.round(c.x * 10) / 10, z: Math.round(c.z * 10) / 10, r: Math.round(c.r * 10) / 10, pieces: pieces + K * nb, roofs: roofs + nb, forecastBuildings: nb };
      }
      endgame.final = "c" + (cs.length - 1); endgame.finalPieces = endgame[endgame.final].pieces; endgame.finalRoofs = endgame[endgame.final].roofs;
    }
    const ent = kept.length + fresh.length;
    rows.push({ map: mapId, seed, half: M.half, waterY: wy, enterable: ent, sealed: 0, pois, perPoi, cover, roads, endgame, legacyCluster: null,
      tg: { version: TG.VERSION, ms: tgMs, towns: lay.towns.length, compounds: lay.compounds.length, enterableTowns: lay.towns.reduce((a, T) => a + T.stats.enterable, 0), enterableCompounds: lay.compounds.reduce((a, T) => a + T.stats.enterable, 0),
        keptCurrent: kept.length, replacedPois: replaced.map((p) => p.id), K, Kp10, shellsTowns: lay.towns.reduce((a, T) => a + T.stats.shells, 0), buildingsAll: lay.stats.buildings, enterableAll: lay.stats.enterable,
        maxFloors: Math.max(0, ...sites.flatMap((T) => T.parcels.filter((q) => q.building && q.building.enterable).map((q) => q.building.floors))) },
      currentEnterable: base.enterable });
    try { if (typeof M.dispose === "function") M.dispose(); } catch (e) { /* ignore */ }
    process.stderr.write(`towngen ${mapId} seed ${seed}: build ${t2 - t1} ms, layoutMap ${tgMs} ms, enterable ${ent} (current ${base.enterable}), median ${cover.median} m\n`);
  }
  const doc = { tool: "placement_census.mjs --mode towngen", root: ROOT, maps: MAPS, seeds: SEEDS, towngenVersion: TG.VERSION, wallS: +((Date.now() - t0) / 1000).toFixed(1), rows };
  const text = JSON.stringify(doc);
  if (OUT) { fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true }); fs.writeFileSync(OUT, text); process.stderr.write("placement_census towngen: wrote " + OUT + " (" + text.length + " bytes)\n"); }
  else process.stdout.write(text);
  process.exit(0);
}
if (args.mode === "towngen") await towngenMode();

// ── main ───────────────────────────────────────────────────────────────────────────────────────────────────────
let lootMod = null, lootNote = null;
if (!args["no-loot"]) {
  if (!fs.existsSync(LOOT_JS)) lootNote = "no loot.js at " + LOOT_JS;
  else { try { lootMod = await import(pathToFileURL(LOOT_JS).href); } catch (e) { lootNote = "loot.js import failed: " + String(e && e.stack || e).split("\n").slice(0, 3).join(" | "); } }
}
const results = [];
const t0 = Date.now();
for (const mapId of MAPS) for (const seed of SEEDS) {
  const t1 = Date.now();
  const r = await censusOne(mapId, seed, lootMod);
  results.push(r);
  process.stderr.write(`placement_census ${mapId} seed ${seed}: ${((Date.now() - t1) / 1000).toFixed(1)} s, nearChunks ${r.terrain.nearChunks}, planted ${JSON.stringify(r.planted)}\n`);
}
const doc = { tool: "placement_census.mjs", root: ROOT, maps: MAPS, seeds: SEEDS, plants: [...PLANTS], lootNote, wallS: +((Date.now() - t0) / 1000).toFixed(1), summary: summarise(results) };
if (KEEP) doc.records = results;
const text = JSON.stringify(doc);
if (OUT) { fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true }); fs.writeFileSync(OUT, text); process.stderr.write("placement_census: wrote " + OUT + " (" + text.length + " bytes)\n"); }
else process.stdout.write(text);
process.exit(0);
