// core/fx/surfaceindex.js — VISIBLE-SURFACE index for bullet-hole placement.
//
// WHY THIS EXISTS (owner report: "when shooting near a wall the bullet hole
// shouldn't be in mid air"). The sim resolves bullets against AABB colliders
// (core/level/colliders.js) — gameplay truth, deterministic, THREE-free. The
// level the player SEES is a different object: facades have recessed windows,
// trim and cornices; rotated props are conservative world AABBs; the map edge
// is an invisible wall. MEASURED live (this session, 450 random rays from street
// level, collider hit vs. the nearest visible mesh triangle):
//     buildings  240 rays  32 hit the collider IN FRONT of the visible surface
//                          (mean 0.20 m, max 0.69 m) and 63 hit BEHIND a visible
//                          trim/cornice surface (decal hidden inside geometry)
//     cars        19 rays  19 floated, mean 3.1 m (rotated-prop AABB corners)
//     edge walls 140 rays  32 had NO visible surface at all
// A decal stamped at the collider hit point therefore hangs in the air, sits
// inside a wall, or marks empty space. The sim must not change (determinism,
// every selftest), so the RENDER layer re-resolves each impact against the real
// triangles and snaps the mark onto what the player actually sees.
//
// THE STRUCTURE: every opaque static triangle of the `level` + `props` groups,
// baked to WORLD space once per mission, bucketed into a uniform XZ grid
// (CSR arrays — no per-cell JS arrays, no allocation per query). A query walks
// the grid cells (DDA) along a short ray window around the sim's hit distance and
// Möller–Trumbore-tests only the few triangles in those cells. Cost per query is
// microseconds; the bake is a few hundred ms and runs off the first frame.

import * as THREE from "three";

const SKIP_NAME = /wet_specular|canal_water|godray|fog|glow|decal|rain|cone|sprite|sky|weather|flag|light|lamp_cone|reflect/i;
const MAX_GRID = 160;

// Visible-material class per mesh, from its (or its parent's) name — lets an impact
// on a window read as GLASS even though the sim's collider under it is concrete.
export const CLS_DEFAULT = 0, CLS_GLASS = 1, CLS_METAL = 2, CLS_WOOD = 3, CLS_DIRT = 4;
function classOfMesh(o) {
  const n = ((o.name || "") + " " + ((o.parent && o.parent.name) || "")).toLowerCase();
  if (/glass|window|pane/.test(n)) return CLS_GLASS;
  if (/truck|car|van|gate|container|dumpster|ac_unit|steel|metal|rail|pipe|tower|pole|lamp|corrugated/.test(n)) return CLS_METAL;
  if (/crate|pallet|kiosk|bench|wood|plank|stall|newsbox/.test(n)) return CLS_WOOD;
  if (/sandbag|dirt|soil|mud|sand/.test(n)) return CLS_DIRT;
  return CLS_DEFAULT;
}

const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _im = new THREE.Matrix4();

export function makeSurfaceIndex() {
  let tris = null;          // Float32Array, 9 floats per triangle (world space)
  let triCount = 0;
  let cellStart = null;     // Int32Array [cells+1]
  let cellItems = null;     // Int32Array triangle ids
  let bigList = null;       // Int32Array — triangles too large for the grid
  let stamp = null;         // Uint32Array per triangle (query dedupe)
  let cls = null;           // Uint8Array per triangle — visible-material class
  let stampId = 1;
  let minX = 0, minZ = 0, cell = 4, nx = 0, nz = 0;
  let ready = false;
  const stats = { tris: 0, cells: 0, buildMs: 0, queries: 0, hits: 0, misses: 0 };

  // ---------------------------------------------------------------- bake
  function collect(roots) {
    const meshes = [];
    for (const root of roots) {
      if (!root) continue;
      root.traverse((o) => {
        if (!o.isMesh || o.isSkinnedMesh || !o.visible) return;
        for (let p = o.parent; p; p = p.parent) if (p.visible === false) return;
        const n = o.name || "";
        const pn = (o.parent && o.parent.name) || "";
        if (SKIP_NAME.test(n) || SKIP_NAME.test(pn)) return;
        const mat = Array.isArray(o.material) ? o.material[0] : o.material;
        if (mat && mat.transparent && (mat.opacity ?? 1) < 0.75) return;
        if (mat && mat.depthWrite === false) return;
        const g = o.geometry;
        if (!g || !g.attributes || !g.attributes.position) return;
        meshes.push(o);
      });
    }
    return meshes;
  }

  function bake(roots) {
    const t0 = performance.now();
    ready = false;
    const meshes = collect(roots);
    let total = 0;
    for (const o of meshes) {
      const g = o.geometry;
      const t = (g.index ? g.index.count : g.attributes.position.count) / 3;
      total += t * (o.isInstancedMesh ? o.count : 1);
    }
    tris = new Float32Array(total * 9);
    cls = new Uint8Array(total);
    let w = 0;
    for (const o of meshes) {
      o.updateWorldMatrix(true, false);
      const g = o.geometry;
      const pos = g.attributes.position;
      const idx = g.index;
      const nT = (idx ? idx.count : pos.count) / 3;
      const inst = o.isInstancedMesh ? o.count : 1;
      const meshCls = classOfMesh(o);
      for (let k = 0; k < inst; k++) {
        if (o.isInstancedMesh) { o.getMatrixAt(k, _im); _m.multiplyMatrices(o.matrixWorld, _im); }
        else _m.copy(o.matrixWorld);
        const e = _m.elements;
        for (let t = 0; t < nT; t++) {
          cls[w / 9] = meshCls;
          for (let c = 0; c < 3; c++) {
            const vi = idx ? idx.getX(t * 3 + c) : t * 3 + c;
            const x = pos.getX(vi), y = pos.getY(vi), z = pos.getZ(vi);
            tris[w++] = e[0] * x + e[4] * y + e[8] * z + e[12];
            tris[w++] = e[1] * x + e[5] * y + e[9] * z + e[13];
            tris[w++] = e[2] * x + e[6] * y + e[10] * z + e[14];
          }
        }
      }
    }
    triCount = w / 9;
    if (triCount === 0) { ready = false; return; }

    // grid extents from the triangle soup
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < w; i += 3) {
      const x = tris[i], z = tris[i + 2];
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
    minX = x0; minZ = z0;
    cell = Math.max(3, Math.max(x1 - x0, z1 - z0) / MAX_GRID);
    cell = Math.max(cell, 4);
    nx = Math.min(MAX_GRID, Math.ceil((x1 - x0) / cell) + 1);
    nz = Math.min(MAX_GRID, Math.ceil((z1 - z0) / cell) + 1);
    const cells = nx * nz;
    const counts = new Int32Array(cells + 1);
    const big = [];
    const BIG_CELLS = 48;

    const range = (i) => {
      const o = i * 9;
      let ax = Math.min(tris[o], tris[o + 3], tris[o + 6]), bx = Math.max(tris[o], tris[o + 3], tris[o + 6]);
      let az = Math.min(tris[o + 2], tris[o + 5], tris[o + 8]), bz = Math.max(tris[o + 2], tris[o + 5], tris[o + 8]);
      return [
        Math.max(0, Math.floor((ax - minX) / cell)), Math.min(nx - 1, Math.floor((bx - minX) / cell)),
        Math.max(0, Math.floor((az - minZ) / cell)), Math.min(nz - 1, Math.floor((bz - minZ) / cell)),
      ];
    };

    for (let i = 0; i < triCount; i++) {
      const r = range(i);
      const n = (r[1] - r[0] + 1) * (r[3] - r[2] + 1);
      if (n > BIG_CELLS) { big.push(i); continue; }
      for (let cz = r[2]; cz <= r[3]; cz++) for (let cx = r[0]; cx <= r[1]; cx++) counts[cz * nx + cx + 1]++;
    }
    for (let c = 0; c < cells; c++) counts[c + 1] += counts[c];
    cellStart = counts;
    cellItems = new Int32Array(counts[cells]);
    const fill = new Int32Array(cells);
    for (let i = 0; i < triCount; i++) {
      const r = range(i);
      const n = (r[1] - r[0] + 1) * (r[3] - r[2] + 1);
      if (n > BIG_CELLS) continue;
      for (let cz = r[2]; cz <= r[3]; cz++) {
        for (let cx = r[0]; cx <= r[1]; cx++) {
          const c = cz * nx + cx;
          cellItems[cellStart[c] + fill[c]++] = i;
        }
      }
    }
    bigList = Int32Array.from(big);
    stamp = new Uint32Array(triCount);
    stampId = 1;
    stats.tris = triCount; stats.cells = cells;
    stats.buildMs = Math.round(performance.now() - t0);
    ready = true;
  }

  // ---------------------------------------------------------------- query
  // Möller–Trumbore, double-sided. Returns t or -1.
  function hitTri(i, ox, oy, oz, dx, dy, dz) {
    const o = i * 9;
    const ax = tris[o], ay = tris[o + 1], az = tris[o + 2];
    const e1x = tris[o + 3] - ax, e1y = tris[o + 4] - ay, e1z = tris[o + 5] - az;
    const e2x = tris[o + 6] - ax, e2y = tris[o + 7] - ay, e2z = tris[o + 8] - az;
    const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (det > -1e-9 && det < 1e-9) return -1;
    const inv = 1 / det;
    const tx = ox - ax, ty = oy - ay, tz = oz - az;
    const u = (tx * px + ty * py + tz * pz) * inv;
    if (u < 0 || u > 1) return -1;
    const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
    const v = (dx * qx + dy * qy + dz * qz) * inv;
    if (v < 0 || u + v > 1) return -1;
    return (e2x * qx + e2y * qy + e2z * qz) * inv;
  }

  // First visible triangle along origin + dir*t for t in [tMin, tMax].
  // out = {t, nx, ny, nz} (normal faces the ray origin). Returns bool.
  function firstHit(ox, oy, oz, dx, dy, dz, tMin, tMax, out) {
    if (!ready) return false;
    let bestT = Infinity, bestI = -1;
    const sid = ++stampId;
    const test = (i) => {
      if (stamp[i] === sid) return;
      stamp[i] = sid;
      const t = hitTri(i, ox, oy, oz, dx, dy, dz);
      if (t >= tMin && t <= tMax && t < bestT) { bestT = t; bestI = i; }
    };
    for (let k = 0; k < bigList.length; k++) test(bigList[k]);

    // DDA over the XZ cells covered by [tMin, tMax]
    const sx = ox + dx * tMin, sz = oz + dz * tMin;
    const ex = ox + dx * tMax, ez = oz + dz * tMax;
    let cx = Math.floor((sx - minX) / cell), cz = Math.floor((sz - minZ) / cell);
    const cx1 = Math.floor((ex - minX) / cell), cz1 = Math.floor((ez - minZ) / cell);
    const stepX = cx1 > cx ? 1 : cx1 < cx ? -1 : 0, stepZ = cz1 > cz ? 1 : cz1 < cz ? -1 : 0;
    const walk = Math.abs(cx1 - cx) + Math.abs(cz1 - cz) + 1;
    if (walk > 400) return false;
    // plain stepping (windows are short: ≤ a couple of metres → 1-3 cells); to stay
    // exact for any window we visit the full bounding rectangle of the segment
    const loX = Math.min(cx, cx1), hiX = Math.max(cx, cx1);
    const loZ = Math.min(cz, cz1), hiZ = Math.max(cz, cz1);
    void stepX; void stepZ;
    for (let zc = loZ; zc <= hiZ; zc++) {
      if (zc < 0 || zc >= nz) continue;
      for (let xc = loX; xc <= hiX; xc++) {
        if (xc < 0 || xc >= nx) continue;
        const c = zc * nx + xc;
        for (let s = cellStart[c], e = cellStart[c + 1]; s < e; s++) test(cellItems[s]);
      }
    }
    if (bestI < 0) return false;
    const o = bestI * 9;
    const e1x = tris[o + 3] - tris[o], e1y = tris[o + 4] - tris[o + 1], e1z = tris[o + 5] - tris[o + 2];
    const e2x = tris[o + 6] - tris[o], e2y = tris[o + 7] - tris[o + 1], e2z = tris[o + 8] - tris[o + 2];
    let nxv = e1y * e2z - e1z * e2y, nyv = e1z * e2x - e1x * e2z, nzv = e1x * e2y - e1y * e2x;
    const l = Math.hypot(nxv, nyv, nzv) || 1;
    nxv /= l; nyv /= l; nzv /= l;
    if (nxv * dx + nyv * dy + nzv * dz > 0) { nxv = -nxv; nyv = -nyv; nzv = -nzv; }
    out.t = bestT; out.nx = nxv; out.ny = nyv; out.nz = nzv; out.cls = cls[bestI];
    return true;
  }

  const _o = { t: 0, nx: 0, ny: 1, nz: 0, cls: 0 };
  const _c = { t: 0, nx: 0, ny: 1, nz: 0, cls: 0 };

  // Resolve a sim hit onto the visible surface.
  //   origin  — shot origin (eye)         hitPos — the sim's collider hit point
  //   behind  — how far BEFORE the sim hit a visible surface may sit (trim,
  //             cornice, window frame the bullet should have struck first)
  //   ahead   — how far AFTER it may sit (recessed glass behind the box skin)
  // Returns null when no visible surface is near the sim hit (a phantom hit on
  // an invisible collider / the corner of a rotated AABB). On success fills
  // out = {pos:[3], normal:[3]} and returns it.
  function snap(origin, hitPos, out, behind = 0.9, ahead = 1.0) {
    if (!ready) return undefined; // not baked yet — caller keeps the sim point
    stats.queries++;
    const dx0 = hitPos[0] - origin[0], dy0 = hitPos[1] - origin[1], dz0 = hitPos[2] - origin[2];
    const dist = Math.hypot(dx0, dy0, dz0);
    if (dist < 1e-4) return undefined;
    const dx = dx0 / dist, dy = dy0 / dist, dz = dz0 / dist;
    const tMin = Math.max(0.02, dist - behind), tMax = dist + ahead;
    if (!firstHit(origin[0], origin[1], origin[2], dx, dy, dz, tMin, tMax, _o)) {
      stats.misses++;
      return null;
    }
    stats.hits++;
    out.pos[0] = origin[0] + dx * _o.t; out.pos[1] = origin[1] + dy * _o.t; out.pos[2] = origin[2] + dz * _o.t;
    out.normal[0] = _o.nx; out.normal[1] = _o.ny; out.normal[2] = _o.nz;
    out.cls = _o.cls;
    return out;
  }

  // Does a decal quad of half-size `h` centred at pos (on a surface with normal n)
  // sit fully on visible geometry? Casts 4 short rays at the quad corners back
  // toward the surface; a corner that finds no triangle within 4 cm of the plane
  // is hanging off an edge. Returns the largest of {1, .7, .5} × h that is fully
  // supported, or 0 when even the smallest overhangs.
  const _t1 = [0, 0, 0], _t2 = [0, 0, 0];
  function supportedScale(pos, n, h) {
    if (!ready) return 1;
    const ax0 = Math.abs(n[0]), ay0 = Math.abs(n[1]), az0 = Math.abs(n[2]);
    const ax = (ax0 <= ay0 && ax0 <= az0) ? 0 : (ay0 <= az0 ? 1 : 2);
    _t1[0] = ax === 0 ? 1 : 0; _t1[1] = ax === 1 ? 1 : 0; _t1[2] = ax === 2 ? 1 : 0;
    const d1 = _t1[0] * n[0] + _t1[1] * n[1] + _t1[2] * n[2];
    _t1[0] -= n[0] * d1; _t1[1] -= n[1] * d1; _t1[2] -= n[2] * d1;
    const l1 = Math.hypot(_t1[0], _t1[1], _t1[2]) || 1;
    _t1[0] /= l1; _t1[1] /= l1; _t1[2] /= l1;
    _t2[0] = n[1] * _t1[2] - n[2] * _t1[1];
    _t2[1] = n[2] * _t1[0] - n[0] * _t1[2];
    _t2[2] = n[0] * _t1[1] - n[1] * _t1[0];
    const scales = [1, 0.7, 0.5];
    for (let s = 0; s < scales.length; s++) {
      const r = h * scales[s];
      let ok = true;
      for (let c = 0; c < 4 && ok; c++) {
        const su = (c & 1) ? r : -r, sv = (c & 2) ? r : -r;
        const cx = pos[0] + _t1[0] * su + _t2[0] * sv + n[0] * 0.05;
        const cy = pos[1] + _t1[1] * su + _t2[1] * sv + n[1] * 0.05;
        const cz = pos[2] + _t1[2] * su + _t2[2] * sv + n[2] * 0.05;
        // ray from just off the surface back INTO it, window ±0.06 m of the plane
        if (!firstHit(cx, cy, cz, -n[0], -n[1], -n[2], 0.0, 0.11, _c)) ok = false;
      }
      if (ok) return scales[s];
    }
    return 0;
  }

  return {
    bake, snap, supportedScale,
    isReady: () => ready,
    clear() { ready = false; tris = null; cellStart = null; cellItems = null; stamp = null; cls = null; },
    stats: () => ({ ...stats, ready }),
  };
}
