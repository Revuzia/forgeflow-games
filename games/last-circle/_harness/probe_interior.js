// probe_interior.js - the judge library of interiorcheck.py (Wave 8 stage A, lane H3). ONE file, the same code in the page and in Node:
// it is an expression (an IIFE) that installs globalThis.__LCINT__ and returns its version; interiorcheck.py evaluates its text in the page,
// probe_interior_node.js imports it. It needs no THREE module of its own: it reads three objects (matrixWorld.elements, geometry attributes,
// InstancedMesh.instanceMatrix) and does its own maths, so the page and Node measure with byte-identical code.
//
// GEOMETRY FIRST. Every row is measured on the two things a player meets: the COLLIDERS (the mover's and the bullets' truth: axis-aligned
// boxes and ramps, the game's own `{kind, minX..maxZ, dir}` records) and the DRAWN triangles (what the camera shows: world-space triangles
// collected from the scene under the house, tagged terrain / structure / furniture / glass / soft / other by an adapter callback).
// House RECORDS (housegen output, or a map's house records once stage B wires housegen in) only add precision: which rooms exist, which
// pieces are furniture, where the loot points are. Without records the rooms come from navcheck's room survey (a roofed floor lattice).
//
// Normalized house:  { id, source: 'records' | 'survey', bbox: {minX, maxX, minY, maxY, minZ, maxZ},
//                      rooms: [{ id, floor, minX, maxX, minZ, maxZ, y (floor top), ceil (ceiling underside, optional) }],
//                      furniture: [{ kind, minX, maxX, minY, maxY, minZ, maxZ, col (its collider or null) }], loot: [{ x, y, z }] }
// World adapter:     { heightAt(x, z), query(x, z, r) -> colliders (a COPY), segment(ax, ay, az, bx, by, bz, cols) -> hit | null (the game's
//                      SIM.segmentColliders), waterY, tris: a TriSet (makeTris) }
//
// Rows (judgeStatic): floor (every interior lattice point stands on a COLLIDER floor - not terrain - with a drawn, up-facing, non-terrain
// surface under it within 6 cm), ceiling (a drawn, down-facing structure triangle over every interior point), openings (an ELEVATION bitmap
// per room side: 0.1 m cells, a short segment across the wall line, open/closed by the colliders and by the drawn structure separately;
// connected open regions = doors (touch the floor) and windows), kit-agree (cells where the two disagree, banded sill / header / jamb / wall),
// doors (clear width AND headroom by the colliders, >= 2.0 m), windows (a body-height segment through each window passes the colliders
// and the drawn walls), walls-solid (no drawn-solid cell the colliders let through), furniture-view (pieces in the 88 x 57 deg view from each
// room door, unoccluded by drawn structure), furniture-clear (no furniture collider or drawn furniture in a door's or a stair's clear zone).
// Planner (plan): a layered 0.25 m grid over the house (+ margin): standable surfaces = terrain + collider tops (ramps exact) where the
// mover's capsule (r 0.45, h 1.8, step 0.55) fits; 8-connected, |dy| <= 0.5; A* -> waypoints. FURNITURE TOPS ARE NOT STANDABLE (VERSION 2,
// Wave 8 stage B, lane I4: a route over a coffee table, a bed or a rubble -> table -> chair 'staircase' is not a way into a room - bots plan on
// the floor; the furniture colliders still block the capsule).
// furniture-view (VERSION 2): only the room's OWN pieces count (record.room, else the piece's centre inside the room on its storey); pieces of a
// neighbour room seen through the doorway are printed (borrowed) but never make a room pass. walk(): the REAL mover follows them
// (an adapter supplies the actor and the step function: player.js tick in Node, C.fastForward in the page).
(() => {
  const VERSION = 2;
  const T_NONE = 0, T_TERRAIN = 1, T_STRUCT = 2, T_FURN = 3, T_GLASS = 4, T_SOFT = 5, T_OTHER = 6;
  const TAGS = ["none", "terrain", "structure", "furniture", "glass", "soft", "other"];
  const R = 0.45, HGT = 1.8, STEP = 0.55, EYE = 1.62;
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const OFF = 0.0537;          // bitmap cells sample at OFF + k * 0.1: never exactly on a 0.05 m-aligned kit edge (a sample ON an edge reads open by one truth, solid by the other)
  const TOL = 0.025;           // a disagreeing cell counts only when it still disagrees the same way 2.5 cm along and 2.5 cm up / down (an edge misfit under 5 cm is not visible)
  const r2 = (v) => Math.round(v * 100) / 100;

  // ───────────── colliders ─────────────
  function rampTop(c, x, z) {
    let f;
    if (c.dir === 0) f = (x - c.minX) / Math.max(0.01, c.maxX - c.minX);
    else if (c.dir === 1) f = (c.maxX - x) / Math.max(0.01, c.maxX - c.minX);
    else if (c.dir === 2) f = (z - c.minZ) / Math.max(0.01, c.maxZ - c.minZ);
    else f = (c.maxZ - z) / Math.max(0.01, c.maxZ - c.minZ);
    return c.minY + (c.maxY - c.minY) * Math.min(1, Math.max(0, f));
  }
  const topAt = (c, x, z) => (c.kind === "ramp" ? rampTop(c, x, z) : c.maxY);
  // independent slab test (segment vs box, optionally grown by e); returns t in [0,1] or -1
  function segBox(ax, ay, az, bx, by, bz, c, e) {
    e = e || 0;
    let t0 = 0, t1 = 1;
    const o = [ax, ay, az], d = [bx - ax, by - ay, bz - az];
    const lo = [c.minX - e, c.minY - e, c.minZ - e], hi = [c.maxX + e, c.maxY + e, c.maxZ + e];
    for (let i = 0; i < 3; i++) {
      if (Math.abs(d[i]) < 1e-12) { if (o[i] < lo[i] || o[i] > hi[i]) return -1; continue; }
      let a = (lo[i] - o[i]) / d[i], b = (hi[i] - o[i]) / d[i];
      if (a > b) { const t = a; a = b; b = t; }
      if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) return -1;
    }
    return t0;
  }
  const overlap3 = (a, b, e) => a.minX < b.maxX + (e || 0) && a.maxX > b.minX - (e || 0) && a.minY < b.maxY + (e || 0) && a.maxY > b.minY - (e || 0) && a.minZ < b.maxZ + (e || 0) && a.maxZ > b.minZ - (e || 0);

  // ───────────── drawn triangles ─────────────
  // makeTris(roots, bbox, classify): world-space triangles of every visible mesh under `roots` whose triangle AABB touches bbox (grown 0.5 m).
  // classify(obj, material) -> tag (T_*). Only FRONT faces are "seen" (a FrontSide material is invisible from behind), DoubleSide both ways.
  function makeTris(roots, bbox, classify, opt) {
    opt = opt || {};
    const G = 0.5, bb = { minX: bbox.minX - 0.5, maxX: bbox.maxX + 0.5, minY: bbox.minY - 0.5, maxY: bbox.maxY + 0.5, minZ: bbox.minZ - 0.5, maxZ: bbox.maxZ + 0.5 };
    const P = [], TG = [], DS = [], OB = [];
    const objs = [];
    const visibleChain = (o) => { for (let q = o; q; q = q.parent) if (q.visible === false) return false; return true; };
    for (const root of roots) if (root) root.traverse((o) => { if ((o.isMesh || o.isInstancedMesh) && !o.isSkinnedMesh && visibleChain(o)) objs.push(o); });
    const mul = (a, b) => {           // column-major 4x4 a*b
      const o = new Array(16);
      for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; }
      return o;
    };
    let nObj = 0;
    for (const o of objs) {
      const g = o.geometry; if (!g || !g.attributes || !g.attributes.position) continue;
      if (o.matrixWorldNeedsUpdate || opt.updateMatrices) o.updateMatrixWorld(true);
      const pos = g.attributes.position, idx = g.index ? g.index.array : null;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const groups = Array.isArray(o.material) && g.groups && g.groups.length ? g.groups : [{ start: 0, count: idx ? idx.length : pos.count, materialIndex: 0 }];
      const tags = mats.map((m) => (m && m.visible === false ? T_NONE : classify(o, m)));
      if (tags.every((t) => t === T_NONE || t === T_OTHER)) continue;
      const dss = mats.map((m) => (m && m.side === 2 ? 1 : 0));
      const mats4 = [];
      const MW = o.matrixWorld.elements;
      if (o.isInstancedMesh) { const ia = o.instanceMatrix.array; for (let i = 0; i < o.count; i++) mats4.push(mul(MW, Array.prototype.slice.call(ia, i * 16, i * 16 + 16))); }
      else mats4.push(Array.prototype.slice.call(MW));
      if (!g.boundingBox && g.computeBoundingBox) g.computeBoundingBox();
      const gb = g.boundingBox;
      const id = nObj++;
      for (const m of mats4) {
        if (gb) {          // the geometry box under this matrix vs bb
          let mnx = 1e9, mny = 1e9, mnz = 1e9, mxx = -1e9, mxy = -1e9, mxz = -1e9;
          for (let k = 0; k < 8; k++) {
            const x = k & 1 ? gb.max.x : gb.min.x, y = k & 2 ? gb.max.y : gb.min.y, z = k & 4 ? gb.max.z : gb.min.z;
            const wx = m[0] * x + m[4] * y + m[8] * z + m[12], wy = m[1] * x + m[5] * y + m[9] * z + m[13], wz = m[2] * x + m[6] * y + m[10] * z + m[14];
            if (wx < mnx) mnx = wx; if (wx > mxx) mxx = wx; if (wy < mny) mny = wy; if (wy > mxy) mxy = wy; if (wz < mnz) mnz = wz; if (wz > mxz) mxz = wz;
          }
          if (mxx < bb.minX || mnx > bb.maxX || mxy < bb.minY || mny > bb.maxY || mxz < bb.minZ || mnz > bb.maxZ) continue;
        }
        const det = m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) + m[8] * (m[1] * m[6] - m[2] * m[5]);
        const flip = det < 0;
        for (const gr of groups) {
          const tag = tags[gr.materialIndex || 0] || T_NONE; if (tag === T_NONE || tag === T_OTHER) continue;
          const ds = dss[gr.materialIndex || 0] || 0;
          const end = Math.min(gr.start + gr.count, idx ? idx.length : pos.count);
          for (let i = gr.start; i + 2 < end + 0; i += 3) {
            const v = [];
            for (let k = 0; k < 3; k++) {
              const vi = idx ? idx[i + k] : i + k;
              const x = pos.getX(vi), y = pos.getY(vi), z = pos.getZ(vi);
              v.push(m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]);
            }
            const tx0 = Math.min(v[0], v[3], v[6]), tx1 = Math.max(v[0], v[3], v[6]), ty0 = Math.min(v[1], v[4], v[7]), ty1 = Math.max(v[1], v[4], v[7]);
            const tz0 = Math.min(v[2], v[5], v[8]), tz1 = Math.max(v[2], v[5], v[8]);
            if (tx1 < bb.minX || tx0 > bb.maxX || ty1 < bb.minY || ty0 > bb.maxY || tz1 < bb.minZ || tz0 > bb.maxZ) continue;
            if (flip) P.push(v[0], v[1], v[2], v[6], v[7], v[8], v[3], v[4], v[5]); else P.push(...v);
            // opt.refine(tag, obj, cx, cy, cz) -> tag: a mesh that batches several parts (stage B: a house's INSIDE faces and its furniture in one chunk mesh) is
            // classified per triangle by its centroid
            TG.push(opt.refine ? opt.refine(tag, o, (v[0] + v[3] + v[6]) / 3, (v[1] + v[4] + v[7]) / 3, (v[2] + v[5] + v[8]) / 3) : tag); DS.push(ds); OB.push(id);
          }
        }
      }
    }
    const n = TG.length, p = new Float64Array(P);
    // 2D bins (G m) over xz
    const nx = Math.max(1, Math.ceil((bb.maxX - bb.minX) / G)), nz = Math.max(1, Math.ceil((bb.maxZ - bb.minZ) / G));
    const bins = new Array(nx * nz);
    for (let t = 0; t < n; t++) {
      const o = t * 9;
      const x0 = Math.min(p[o], p[o + 3], p[o + 6]), x1 = Math.max(p[o], p[o + 3], p[o + 6]), z0 = Math.min(p[o + 2], p[o + 5], p[o + 8]), z1 = Math.max(p[o + 2], p[o + 5], p[o + 8]);
      const i0 = Math.max(0, Math.floor((x0 - bb.minX) / G)), i1 = Math.min(nx - 1, Math.floor((x1 - bb.minX) / G));
      const k0 = Math.max(0, Math.floor((z0 - bb.minZ) / G)), k1 = Math.min(nz - 1, Math.floor((z1 - bb.minZ) / G));
      for (let i = i0; i <= i1; i++) for (let k = k0; k <= k1; k++) { const b = k * nx + i; (bins[b] || (bins[b] = [])).push(t); }
    }
    const stamp = new Uint32Array(n); let st = 0;
    const counts = {}; for (const t of TG) counts[TAGS[t]] = (counts[TAGS[t]] || 0) + 1;
    // nearest front-facing (or double-sided) hit along a -> b among `want` tags (a Set or array of tag numbers). Returns {t, tag, ny, d} or null.
    function ray(ax, ay, az, bx, by, bz, want, anyFace) {
      const dx = bx - ax, dy = by - ay, dz = bz - az;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz); if (len < 1e-9) return null;
      st++; if (st > 4e9) { stamp.fill(0); st = 1; }
      let best = null, bt = 1;
      const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / (G * 0.5)));
      for (let s = 0; s <= steps; s++) {
        const f = s / steps, x = ax + dx * f, z = az + dz * f;
        const ci = Math.floor((x - bb.minX) / G), ck = Math.floor((z - bb.minZ) / G);
        for (let di = -1; di <= 1; di++) for (let dk = -1; dk <= 1; dk++) {
          const i = ci + di, k = ck + dk; if (i < 0 || k < 0 || i >= nx || k >= nz) continue;
          const L = bins[k * nx + i]; if (!L) continue;
          for (const t of L) {
            if (stamp[t] === st) continue; stamp[t] = st;
            const tag = TG[t]; if (!want[tag]) continue;
            const o = t * 9;
            const e1x = p[o + 3] - p[o], e1y = p[o + 4] - p[o + 1], e1z = p[o + 5] - p[o + 2];
            const e2x = p[o + 6] - p[o], e2y = p[o + 7] - p[o + 1], e2z = p[o + 8] - p[o + 2];
            const nxv = e1y * e2z - e1z * e2y, nyv = e1z * e2x - e1x * e2z, nzv = e1x * e2y - e1y * e2x;
            const facing = nxv * dx + nyv * dy + nzv * dz;
            if (!anyFace && !DS[t] && facing >= 0) continue;            // a back face: invisible from here
            const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
            const det = e1x * px + e1y * py + e1z * pz;
            if (Math.abs(det) < 1e-12) continue;
            const inv = 1 / det, sx = ax - p[o], sy = ay - p[o + 1], sz = az - p[o + 2];
            const u = (sx * px + sy * py + sz * pz) * inv; if (u < -1e-7 || u > 1 + 1e-7) continue;
            const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
            const v = (dx * qx + dy * qy + dz * qz) * inv; if (v < -1e-7 || u + v > 1 + 1e-7) continue;
            const tt = (e2x * qx + e2y * qy + e2z * qz) * inv;
            if (tt < 0 || tt > bt) continue;
            const nl = Math.sqrt(nxv * nxv + nyv * nyv + nzv * nzv) || 1;
            bt = tt; best = { t: tt, d: tt * len, tag, ny: nyv / nl, obj: OB[t], tri: t };
          }
        }
      }
      return best;
    }
    const W = (arr) => { const o = []; for (const t of arr) o[t] = true; return o; };
    return { n, counts, ray, want: W, p, TG, OB, bbox: bb, kill(pred) {        // planted faults: drop triangles (p zeroed in place -> degenerate)
      let k = 0; for (let t = 0; t < n; t++) { const o = t * 9; if (pred(p.subarray(o, o + 9), TG[t])) { for (let j = 0; j < 9; j++) p[o + j] = p[o]; k++; } } return k; } };
  }

  // ───────────── support / capsule (player.js rules, independent re-implementation) ─────────────
  function supportAt(world, x, z, y, L) {
    L = L || world.query(x, z, 0.8);
    let s = world.heightAt(x, z), col = null;
    for (const c of L) {
      if (c.dead) continue;
      if (x < c.minX - 0.3 || x > c.maxX + 0.3 || z < c.minZ - 0.3 || z > c.maxZ + 0.3) continue;
      const top = topAt(c, x, z);
      if (top <= y + STEP && top > s) { s = top; col = c; }
    }
    return { s, col };
  }
  // the highest collider top under (x, z) with no clearance from the 0.3 m footprint grace (strict), in [y - below, y + up]
  function floorUnder(world, x, z, y, L) {
    L = L || world.query(x, z, 0.5);
    let s = -1e9, col = null;
    for (const c of L) {
      if (c.dead || x < c.minX || x > c.maxX || z < c.minZ || z > c.maxZ) continue;
      const top = topAt(c, x, z);
      if (top <= y + 0.3 && top >= y - 0.6 && top > s) { s = top; col = c; }
    }
    return { s, col };
  }
  function capsuleBlocked(world, x, z, y, L, rr) {
    rr = rr || R;
    L = L || world.query(x, z, 1.0);
    for (const c of L) {
      if (c.dead) continue;
      if (c.kind === "ramp") { if (world.rampBlocks && world.rampBlocks(c, x, z, y, HGT, rr, STEP)) return c; continue; }   // the game's own plank rule (SIM.rampBlocks)
      if (c.maxY <= y + STEP || c.minY >= y + HGT) continue;
      const ex = x - Math.min(Math.max(x, c.minX), c.maxX), ez = z - Math.min(Math.max(z, c.minZ), c.maxZ);
      if (ex * ex + ez * ez < rr * rr) return c;
    }
    return null;
  }

  // ───────────── room survey (navcheck probe_rooms.js section B, for houses without records) ─────────────
  // rooms = connected 1 m lattices of standable floor under a thin roof collider (head room >= 1.85 m), grouped per building.
  function surveyHouses(world, cols, opt) {
    opt = opt || {};
    const roofish = cols.filter((c) => c.kind !== "ramp" && !c.dead && c.maxY - c.minY <= 1.6 && (c.maxX - c.minX) * (c.maxZ - c.minZ) >= 2 && c.maxX - c.minX >= 1.0 && c.maxZ - c.minZ >= 1.0);
    const par = new Map(); roofish.forEach((c) => par.set(c, c));
    const find = (c) => { while (par.get(c) !== c) { par.set(c, par.get(par.get(c))); c = par.get(c); } return c; };
    const B = new Map(), BK = 8;
    roofish.forEach((c) => { for (let bx = Math.floor((c.minX - 0.5) / BK); bx <= Math.floor((c.maxX + 0.5) / BK); bx++) for (let bz = Math.floor((c.minZ - 0.5) / BK); bz <= Math.floor((c.maxZ + 0.5) / BK); bz++) { const k = bx * 100003 + bz; if (!B.has(k)) B.set(k, []); B.get(k).push(c); } });
    for (const l of B.values()) for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++) {
      const a = l[i], b = l[j];
      if (a.maxX + 0.5 < b.minX || b.maxX + 0.5 < a.minX || a.maxZ + 0.5 < b.minZ || b.maxZ + 0.5 < a.minZ) continue;
      const ra = find(a), rb = find(b); if (ra !== rb) par.set(ra, rb);
    }
    const pts = new Map();
    for (const Rf of roofish) {
      if (opt.within && !(Rf.maxX > opt.within.minX && Rf.minX < opt.within.maxX && Rf.maxZ > opt.within.minZ && Rf.minZ < opt.within.maxZ)) continue;
      for (let x = Math.ceil(Rf.minX + 0.4); x <= Rf.maxX - 0.4; x += 1) for (let z = Math.ceil(Rf.minZ + 0.4); z <= Rf.maxZ - 0.4; z += 1) {
        const L = world.query(x, z, 1.2), terr = world.heightAt(x, z);
        let s = terr, sc = null;
        for (const c of L) {
          if (c.dead || c === Rf) continue;
          if (x < c.minX - 0.3 || x > c.maxX + 0.3 || z < c.minZ - 0.3 || z > c.maxZ + 0.3) continue;
          const top = topAt(c, x, z);
          if (top <= Rf.minY - 1.0 && top > s) { s = top; sc = c; }
        }
        if (sc && sc.prop) continue;
        if (Rf.minY - s > 12 || Rf.minY - s < 0.3) continue;
        let lower = false;
        for (const c of L) { if (c === Rf || c.dead) continue; if (x < c.minX || x > c.maxX || z < c.minZ || z > c.maxZ) continue; if (c.minY > s + 0.3 && c.minY < Rf.minY - 1e-3) { lower = true; break; } }
        if (lower) continue;
        if (s <= terr + 1e-6 && terr < world.waterY + 0.3) continue;
        if (Rf.minY - s < 1.85) continue;
        if (capsuleBlocked(world, x, z, s, L)) continue;
        const key = x + "," + z + "," + Math.round(s * 2);
        if (!pts.has(key)) pts.set(key, { x, z, s, terr, bld: find(Rf), ceil: Rf.minY });
      }
    }
    const byXZ = new Map();
    for (const q of pts.values()) { const k = q.x + "," + q.z; if (!byXZ.has(k)) byXZ.set(k, []); byXZ.get(k).push(q); }
    const pr = new Map(); for (const q of pts.values()) pr.set(q, q);
    const fd = (q) => { while (pr.get(q) !== q) { pr.set(q, pr.get(pr.get(q))); q = pr.get(q); } return q; };
    for (const q of pts.values()) for (const [dx, dz] of [[1, 0], [0, 1]]) {
      const l = byXZ.get((q.x + dx) + "," + (q.z + dz)); if (!l) continue;
      for (const w of l) if (Math.abs(w.s - q.s) <= 0.6) { const a = fd(q), b = fd(w); if (a !== b) pr.set(a, b); }
    }
    const groups = new Map();
    for (const q of pts.values()) { const r = fd(q); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(q); }
    const houses = new Map();
    for (const g of groups.values()) {
      if (g.length < 3) continue;
      const bld = g[0].bld;
      let mnx = 1e9, mxx = -1e9, mnz = 1e9, mxz = -1e9, ys = [], ceil = 1e9;
      for (const q of g) { mnx = Math.min(mnx, q.x); mxx = Math.max(mxx, q.x); mnz = Math.min(mnz, q.z); mxz = Math.max(mxz, q.z); ys.push(q.s); ceil = Math.min(ceil, q.ceil); }
      ys.sort((a, b) => a - b);
      if (!houses.has(bld)) houses.set(bld, { rooms: [], roofs: [] });
      houses.get(bld).rooms.push({ minX: mnx - 0.5, maxX: mxx + 0.5, minZ: mnz - 0.5, maxZ: mxz + 0.5, y: ys[Math.floor(ys.length / 2)], ceil, n: g.length, pitch: 1.0, pts: g.map((q) => [q.x, q.z, q.s]) });
    }
    for (const Rf of roofish) { const h = houses.get(find(Rf)); if (h) h.roofs.push(Rf); }
    const out = [];
    let id = 0;
    for (const h of houses.values()) {
      let bb = { minX: 1e9, maxX: -1e9, minY: 1e9, maxY: -1e9, minZ: 1e9, maxZ: -1e9 };
      for (const Rf of h.roofs) { bb.minX = Math.min(bb.minX, Rf.minX); bb.maxX = Math.max(bb.maxX, Rf.maxX); bb.minZ = Math.min(bb.minZ, Rf.minZ); bb.maxZ = Math.max(bb.maxZ, Rf.maxZ); bb.maxY = Math.max(bb.maxY, Rf.maxY); }
      for (const r of h.rooms) bb.minY = Math.min(bb.minY, r.y);
      const rooms = h.rooms.sort((a, b) => a.y - b.y || a.minX - b.minX || a.minZ - b.minZ).map((r, i) => {
        const floor = h.rooms.filter((q) => q.y < r.y - 1.5).length ? 1 + Math.round((r.y - bb.minY) / 3.2) - 1 : 0;
        return Object.assign(r, { id: "r" + i, floor });
      });
      // furniture without records: a prop collider standing on a room floor inside the room
      const furniture = [];
      for (const c of world.query((bb.minX + bb.maxX) / 2, (bb.minZ + bb.maxZ) / 2, Math.hypot(bb.maxX - bb.minX, bb.maxZ - bb.minZ) / 2 + 1)) {
        if (!c.prop || c.dead) continue;
        const cx = (c.minX + c.maxX) / 2, cz = (c.minZ + c.maxZ) / 2;
        if (rooms.some((r) => cx > r.minX && cx < r.maxX && cz > r.minZ && cz < r.maxZ && Math.abs(c.minY - r.y) < 0.3)) furniture.push({ kind: "prop:" + c.prop, minX: c.minX, maxX: c.maxX, minY: c.minY, maxY: c.maxY, minZ: c.minZ, maxZ: c.maxZ, col: c });
      }
      out.push({ id: "s" + (id++), source: "survey", bbox: bb, rooms, furniture, loot: [] });
    }
    out.sort((a, b) => a.bbox.minX - b.bbox.minX || a.bbox.minZ - b.bbox.minZ);
    out.forEach((h, i) => { h.id = "s" + i; });
    return out;
  }

  // ───────────── static rows ─────────────
  const SIDES = [   // [axis normal, sign]: the side's outward normal
    { k: "+x", nx: 1, nz: 0 }, { k: "-x", nx: -1, nz: 0 }, { k: "+z", nx: 0, nz: 1 }, { k: "-z", nx: 0, nz: -1 },
  ];
  function wallCols(world, H, L) {
    if (!H._furnSet) { H._furnSet = new Set(); for (const f of H.furniture) { if (f.col) H._furnSet.add(f.col); for (const c of f.cols || []) H._furnSet.add(c); } }
    return L.filter((c) => !c.dead && !H._furnSet.has(c) && !c.lcFurniture);
  }
  const roomCeil = (H, r) => (r.ceil != null ? r.ceil : r.y + 3.0);
  const inHole = (r, x, z) => (r.holes || []).some((h) => x > h.minX - 0.1 && x < h.maxX + 0.1 && z > h.minZ - 0.1 && z < h.maxZ + 0.1);
  function lattice(r) {
    if (r.pts) return r.pts.map((q) => [q[0], q[1]]);
    const out = [];
    for (let x = r.minX + 0.35; x <= r.maxX - 0.35 + 1e-6; x += 0.5) for (let z = r.minZ + 0.35; z <= r.maxZ - 0.35 + 1e-6; z += 0.5) if (!inHole(r, x, z)) out.push([x, z]);
    return out;
  }

  function judgeFloor(world, H) {
    const T = world.tris, want = T.want([T_STRUCT, T_TERRAIN, T_SOFT]);      // furniture and glass are looked through: the floor under a table is still floor
    const res = { points: 0, badPts: 0, onTerrain: 0, noDrawn: 0, drawnTerrain: 0, drawnSoft: 0, drawnOff: 0, examples: [] };
    for (const r of H.rooms) {
      for (const [x, z] of lattice(r)) {
        const L = world.query(x, z, 0.6);
        if (capsuleBlocked(world, x, z, r.y, L, 0.15)) continue;              // a wall / furniture body, not floor (furniture tops are not judged)
        if (L.some((c) => c.kind === "ramp" && x >= c.minX && x <= c.maxX && z >= c.minZ && z <= c.maxZ)) continue;   // a stair: walked by the mover rows
        // under a piece of furniture the floor is not seen (and a district mesh that merges furniture with the walls would read its top as the floor)
        if (H.furniture.some((f) => x > f.minX - 0.05 && x < f.maxX + 0.05 && z > f.minZ - 0.05 && z < f.maxZ + 0.05 && f.minY < r.y + 0.3 && f.maxY > r.y)) continue;
        res.points++;
        const terr = world.heightAt(x, z);
        const f = floorUnder(world, x, z, r.y, L);
        const terrainFloor = !f.col || f.s <= terr + 0.005;
        const hit = T.ray(x, r.y + 1.0, z, x, r.y - 0.8, z, want);
        let bad = null;
        if (terrainFloor) { res.onTerrain++; bad = "collider floor missing (stands on terrain)"; }
        if (!hit) { res.noDrawn++; bad = bad || "no drawn surface"; }
        else if (hit.tag === T_TERRAIN) { res.drawnTerrain++; bad = bad || "drawn terrain"; }
        else if (hit.tag === T_SOFT) { res.drawnSoft++; bad = bad || "drawn grass/decal"; }
        else if (f.col && Math.abs((r.y + 1.0 - hit.d) - f.s) > 0.06) { res.drawnOff++; bad = bad || "drawn floor " + r3(r.y + 1.0 - hit.d) + " vs collider " + r3(f.s); }
        if (bad) { res.badPts++; if (res.examples.length < 6) res.examples.push({ room: r.id, x: r2(x), z: r2(z), y: r2(r.y), why: bad }); }
      }
    }
    res.bad = res.badPts; delete res.badPts;
    return res;
  }
  function judgeCeiling(world, H) {
    const T = world.tris, wantS = T.want([T_STRUCT]), wantAll = T.want([T_STRUCT, T_FURN, T_GLASS, T_SOFT, T_TERRAIN]);
    const res = { points: 0, seen: 0, noCollider: 0, examples: [] };
    for (const r of H.rooms) {
      for (const [x, z] of lattice(r)) {
        const L = world.query(x, z, 0.6);
        if (capsuleBlocked(world, x, z, r.y, L, 0.15)) continue;
        res.points++;
        const eye = r.y + EYE;
        const reachUp = Math.max(9, (r.ceil != null ? r.ceil - r.y : 0) + 1.0);     // (a surveyed room's roof can stand up to 12 m over its floor)
        const h = T.ray(x, eye, z, x, eye + reachUp, z, wantAll);
        const ok = h && h.tag === T_STRUCT && h.ny < -0.5;
        let colAbove = false;
        for (const c of L) if (!c.dead && x >= c.minX && x <= c.maxX && z >= c.minZ && z <= c.maxZ && c.minY > r.y + 1.85 && c.minY < r.y + reachUp + EYE) { colAbove = true; break; }
        if (ok) res.seen++;
        if (!colAbove) res.noCollider++;
        if ((!ok || !colAbove) && res.examples.length < 6) res.examples.push({ room: r.id, x: r2(x), z: r2(z), y: r2(r.y), hit: h ? TAGS[h.tag] + "@" + r2(h.d) + (h.ny < -0.5 ? "" : " (not a down-facing face)") : "sky", colliderAbove: colAbove });
      }
    }
    return res;
  }
  // the wall face of a room side: median first collider hit at knee height from points along the side (outward), else the AABB edge
  // is (x, z) inside room r? its own test (records: the room's cells), else near one of its lattice points, else its AABB
  // is furniture piece f one of room r's OWN pieces? the record's room id when the house has one, else its centre inside the room's AABB on its storey
  function ownPiece(f, r) {
    if (f.room != null) return f.room === r.id;
    const cx = (f.minX + f.maxX) / 2, cz = (f.minZ + f.maxZ) / 2;
    return cx > r.minX - 0.05 && cx < r.maxX + 0.05 && cz > r.minZ - 0.05 && cz < r.maxZ + 0.05 && f.minY < r.y + 1.5 && f.maxY > r.y - 0.2;
  }
  function roomInside(r, x, z) {
    if (r.inside) return r.inside(x, z);
    if (r.pts) { const tol = (r.pitch || 0.5) * 0.72 + (r.pitch > 0.75 ? 0.25 : 0); return r.pts.some((q) => Math.abs(q[0] - x) <= tol && Math.abs(q[1] - z) <= tol); }   // (a surveyed room's 1 m lattice stands >= 0.45 m off its walls)
    return x > r.minX && x < r.maxX && z > r.minZ && z < r.maxZ;
  }
  // the wall face of a room side: segments outward from 0.6 m inside the side, at 0.3 / 1.0 / 2.0 / 2.6 m (over a door's 2.4 m head), only where the
  // inner end is in THIS room; the face is the nearest hit that at least 15 % of the hits share within 10 cm (a hit beyond an opening is a neighbour)
  function sideFace(world, H, r, S) {
    const hits = [];
    const along = S.nx ? [r.minZ, r.maxZ] : [r.minX, r.maxX];
    const edge = S.nx ? (S.nx > 0 ? r.maxX : r.minX) : (S.nz > 0 ? r.maxZ : r.minZ);
    const top = roomCeil(H, r) - r.y - 0.15;
    for (let a = along[0] + 0.3; a <= along[1] - 0.3; a += 0.25) {
      const ax = S.nx ? edge - S.nx * 0.6 : a, az = S.nx ? a : edge - S.nz * 0.6;
      if (!roomInside(r, ax, az)) continue;
      const bx = S.nx ? edge + S.nx * 2.0 : a, bz = S.nx ? a : edge + S.nz * 2.0;
      const L = wallCols(world, H, world.query((ax + bx) / 2, (az + bz) / 2, 1.6));
      for (const hh of [0.3, 1.0, 2.0, 2.6]) {
        if (hh > top) continue;
        const y = r.y + hh;
        let bt = 2;
        for (const c of L) { if (c.kind === "ramp") continue; const t = segBox(ax, y, az, bx, y, bz, c); if (t >= 0 && t < bt) bt = t; }
        if (bt < 2) hits.push(bt * 2.6);
      }
    }
    if (!hits.length) return { face: edge, n: 0 };
    hits.sort((p, q) => p - q);
    const need = Math.max(2, Math.ceil(hits.length * 0.15));
    let d = hits[0];
    for (let i = 0; i < hits.length; i++) { let n = 0; for (let j = i; j < hits.length && hits[j] <= hits[i] + 0.1; j++) n++; if (n >= need) { d = hits[i]; break; } }
    return { face: edge - 0.6 + d, n: hits.length };
  }
  // elevation bitmap of one room side: rows = heights (0.1 m from floor + 0.05), cols = along the side (0.1 m)
  function sideBitmap(world, H, r, S, opt) {
    const T = world.tris, wantS = T.want([T_STRUCT]);
    const f = sideFace(world, H, r, S);
    const along = S.nx ? [r.minZ, r.maxZ] : [r.minX, r.maxX];
    const top = Math.min(roomCeil(H, r) - 0.1, r.y + 4.0);
    const nr = Math.max(1, Math.floor((top - r.y - OFF) / 0.1) + 1), ncol = Math.max(1, Math.floor((along[1] - along[0] - 2 * OFF) / 0.1) + 1);
    const col = new Uint8Array(nr * ncol), drw = new Uint8Array(nr * ncol), skip = new Uint8Array(nr * ncol), nearEdge = new Uint8Array(nr * ncol);   // 1 = open
    const IN = 0.3, OUT = 0.7;
    const Lall = wallCols(world, H, world.query(S.nx ? f.face : (along[0] + along[1]) / 2, S.nx ? (along[0] + along[1]) / 2 : f.face, (along[1] - along[0]) / 2 + 2));
    const ramps = Lall.filter((c) => c.kind === "ramp");
    const furn = H.furniture;
    for (let j = 0; j < ncol; j++) {
      const a = along[0] + OFF + j * 0.1;
      const seg = (aa) => (S.nx ? [f.face - S.nx * IN, aa, f.face + S.nx * OUT, aa] : [aa, f.face - S.nz * IN, aa, f.face + S.nz * OUT]);
      const [ax, az, bx, bz] = seg(a);
      const Lj = Lall.filter((c) => c.maxX >= Math.min(ax, bx) - 0.05 && c.minX <= Math.max(ax, bx) + 0.05 && c.maxZ >= Math.min(az, bz) - 0.05 && c.minZ <= Math.max(az, bz) + 0.05);
      // a column whose inner end is not in THIS room (an L room's AABB side runs past its notch) is not this room's wall: skipped
      const inner = S.nx ? [f.face - S.nx * 0.6, a] : [a, f.face - S.nz * 0.6];
      const mine = roomInside(r, inner[0], inner[1]);
      const colOpen = (aa, y) => { const [px, pz, qx, qz] = seg(aa); for (const c of Lj) { if (c.kind === "ramp") continue; if (c.minY > y || c.maxY < y) continue; if (segBox(px, y, pz, qx, y, qz, c) >= 0) return 0; } return 1; };
      const drwOpen = (aa, y) => { const [px, pz, qx, qz] = seg(aa); return T.ray(px, y, pz, qx, y, qz, wantS) ? 0 : 1; };
      for (let i = 0; i < nr; i++) {
        const y = r.y + OFF + i * 0.1, k = i * ncol + j;
        const segBB = { minX: Math.min(ax, bx), maxX: Math.max(ax, bx), minY: y - 0.01, maxY: y + 0.01, minZ: Math.min(az, bz), maxZ: Math.max(az, bz) };
        if (!mine || ramps.some((c) => overlap3(c, segBB, 0.1)) || furn.some((q) => overlap3(q, segBB, 0.05))) { skip[k] = 1; continue; }
        // a segment that STARTS inside a wall box (it runs along a partition meeting this side) measures that box, not this wall: skipped
        if (Lj.some((c) => c.kind !== "ramp" && ax > c.minX && ax < c.maxX && y > c.minY && y < c.maxY && az > c.minZ && az < c.maxZ)) { skip[k] = 1; continue; }
        col[k] = colOpen(a, y);
        drw[k] = drwOpen(a, y);
        if (col[k] !== drw[k]) {          // robust? the same disagreement TOL along and TOL up / down, else the edge misfit is under 5 cm: read as agreeing (the collider's answer)
          let robust = true;
          for (const [da, dy] of [[TOL, 0], [-TOL, 0], [0, TOL], [0, -TOL]]) { if (colOpen(a + da, y + dy) !== col[k] || drwOpen(a + da, y + dy) !== drw[k]) { robust = false; break; } }
          if (!robust) { drw[k] = col[k]; nearEdge[k] = 1; }
        }
      }
    }
    let ne = 0; for (let k = 0; k < nearEdge.length; k++) ne += nearEdge[k];
    return { side: S.k, face: f.face, faceHits: f.n, along, nr, ncol, col, drw, skip, y0: r.y, nearEdge: ne };
  }
  // connected open regions (open by EITHER truth) of a bitmap -> openings
  function openings(bm) {
    const { nr, ncol, col, drw, skip } = bm, N = nr * ncol;
    const open = (k) => !skip[k] && (col[k] || drw[k]);
    const lab = new Int32Array(N).fill(-1), comps = [];
    for (let k0 = 0; k0 < N; k0++) {
      if (lab[k0] >= 0 || !open(k0)) continue;
      const c = { id: comps.length, cells: [], minI: 1e9, maxI: -1, minJ: 1e9, maxJ: -1, dOpen: 0, cOpen: 0 };
      const st = [k0]; lab[k0] = c.id;
      while (st.length) {
        const k = st.pop(), i = Math.floor(k / ncol), j = k % ncol;
        c.cells.push(k); if (drw[k]) c.dOpen++; if (col[k]) c.cOpen++; if (i < c.minI) c.minI = i; if (i > c.maxI) c.maxI = i; if (j < c.minJ) c.minJ = j; if (j > c.maxJ) c.maxJ = j;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= nr || jj >= ncol) continue;
          const kk = ii * ncol + jj; if (lab[kk] < 0 && open(kk)) { lab[kk] = c.id; st.push(kk); }
        }
      }
      comps.push(c);
    }
    const out = [];
    for (const c of comps) {
      const nonSkip = N - Array.prototype.reduce.call(skip, (s, v) => s + v, 0);
      const full = c.cells.length >= 0.85 * nonSkip;
      const touchesFloor = c.minI <= 1;
      const h = (c.maxI - c.minI + 1) * 0.1, w = (c.maxJ - c.minJ + 1) * 0.1;
      // what the player SEES decides the kind: a region open only by the colliders (drawn solid in > 90 % of it) is a HOLE - a wall you can shoot and walk through
      let kind = full ? "nowall" : c.dOpen < 0.1 * c.cells.length ? "hole" : touchesFloor ? (h >= 1.0 ? "door" : "gap") : (h >= 0.25 && w >= 0.25 ? "window" : "gap");
      out.push({ id: c.id, kind, minI: c.minI, maxI: c.maxI, minJ: c.minJ, maxJ: c.maxJ, cells: c.cells.length, dOpen: c.dOpen, cOpen: c.cOpen, w: r2(w), h: r2(h) });
    }
    return { comps: out, lab };
  }
  function analyseSide(world, H, r, S) {
    const bm = sideBitmap(world, H, r, S);
    const op = openings(bm);
    const { nr, ncol, col, drw, skip } = bm;
    const at = (i, j) => ({ along: r2(bm.along[0] + OFF + j * 0.1), h: r2(OFF + i * 0.1) });
    const dis = { sill: 0, header: 0, jamb: 0, inOpening: 0, hole: 0, other: 0, phantomOpen: 0, invisibleWall: 0, examples: [] };
    // band of a disagreeing cell (it always lies in an open region): a HOLE (open only by the colliders); else by its place in the opening:
    // within 0.25 m of the opening's bottom = sill, top = header, sides = jamb, inside = in-opening (a drawn post or opaque pane in a real opening)
    const real = op.comps.filter((c) => c.kind === "door" || c.kind === "window");
    const byId = new Map(op.comps.map((c) => [c.id, c]));
    for (let i = 0; i < nr; i++) for (let j = 0; j < ncol; j++) {
      const k = i * ncol + j; if (skip[k] || col[k] === drw[k]) continue;
      const c = byId.get(op.lab[k]);
      let band = "other";
      if (c && c.kind === "hole") band = "hole";
      else if (c && (c.kind === "door" || c.kind === "window" || c.kind === "gap")) band = i - c.minI <= 2 && c.kind !== "door" ? "sill" : c.maxI - i <= 2 ? "header" : (j - c.minJ <= 2 || c.maxJ - j <= 2) ? "jamb" : "inOpening";
      dis[band]++;
      if (col[k] && !drw[k]) dis.phantomOpen++; else dis.invisibleWall++;
      if (dis.examples.length < 4) dis.examples.push(Object.assign({ room: r.id, side: S.k, band, opening: c ? c.kind : null, drawn: drw[k] ? "open" : "solid", collider: col[k] ? "open" : "solid" }, at(i, j)));
    }
    // doors / windows measured on the COLLIDER bitmap (the mover's truth), the drawn one alongside
    const doors = [], windows = [];
    for (const c of real) {
      const cj = Math.round((c.minJ + c.maxJ) / 2);
      if (c.kind === "door") {
        // clear width: the narrowest collider-open run through the centre column, rows 0.1 .. 1.8 m
        let wmin = 1e9, wminD = 1e9;
        // (a cell skipped for a stair or a piece of furniture is not wall: it counts as open here - furniture in a doorway is furniture-clear's row)
        const op = (arr, k) => arr[k] || skip[k];
        for (let i = 1; i <= Math.min(nr - 1, 17); i++) {
          for (const [arr, set] of [[col, 0], [drw, 1]]) {
            if (!op(arr, i * ncol + cj)) { if (set === 0) wmin = 0; else wminD = 0; continue; }
            let a = cj, b = cj; while (a - 1 >= 0 && op(arr, i * ncol + a - 1)) a--; while (b + 1 < ncol && op(arr, i * ncol + b + 1)) b++;
            const w = (b - a + 1) * 0.1; if (set === 0) wmin = Math.min(wmin, w); else wminD = Math.min(wminD, w);
          }
        }
        let hc = 0; while (hc < nr && op(col, hc * ncol + cj)) hc++;
        let hd = 0; while (hd < nr && op(drw, hd * ncol + cj)) hd++;
        const capped = hc >= nr;
        doors.push({ room: r.id, side: S.k, along: r2(bm.along[0] + OFF + cj * 0.1), face: r2(bm.face), y: r2(r.y), width: r2(wmin), widthDrawn: r2(wminD), headroom: r2(OFF + hc * 0.1 - 0.05), headroomDrawn: r2(OFF + hd * 0.1 - 0.05), headroomCapped: capped, spanJ: [c.minJ, c.maxJ] });
      } else {
        windows.push({ room: r.id, side: S.k, along: r2(bm.along[0] + OFF + cj * 0.1), face: r2(bm.face), y: r2(r.y), sill: r2(OFF + c.minI * 0.1 - 0.05), header: r2(OFF + c.maxI * 0.1 + 0.05), w: c.w, rowsOpenCol: null });
      }
    }
    return { bm, op, dis, doors, windows, nowall: op.comps.filter((c) => c.kind === "nowall").length };
  }
  // is a point outside every room (and outside the house bbox shrunk)? decides whether a door is exterior
  function outsideRooms(H, x, z, y) {
    // (inside = the room's own test: its cells / its lattice points; an AABB of a surveyed or L room spans ground that is not in it)
    return !H.rooms.some((r) => Math.abs(r.y - y) < 1.5 && x > r.minX - 0.2 && x < r.maxX + 0.2 && z > r.minZ - 0.2 && z < r.maxZ + 0.2 && (r.pts || r.inside ? roomInside(r, x, z) : true));
  }
  function judgeOpenings(world, H) {
    const res = { sides: 0, doors: [], windows: [], dis: { sill: 0, header: 0, jamb: 0, inOpening: 0, hole: 0, other: 0, phantomOpen: 0, invisibleWall: 0 }, disExamples: [], winShots: { n: 0, pass: 0, examples: [] }, wallShots: { n: 0, blocked: 0, examples: [] } };
    for (const r of H.rooms) for (const S of SIDES) {
      const a = analyseSide(world, H, r, S);
      res.sides++;
      for (const k of Object.keys(res.dis)) res.dis[k] += a.dis[k];
      for (const e of a.dis.examples) if (res.disExamples.length < 8) res.disExamples.push(e);
      for (const d of a.doors) {
        const px = S.nx ? d.face + S.nx * 1.0 : d.along, pz = S.nx ? d.along : d.face + S.nz * 1.0;
        d.exterior = outsideRooms(H, px, pz, r.y);
        d.nx = S.nx; d.nz = S.nz;
        res.doors.push(d);
      }
      for (const w of a.windows) {
        // shootable: a body-height segment through the opening passes the colliders (the game's segment test) and the drawn walls
        const h = Math.min(Math.max(1.5, w.sill + 0.1), w.header - 0.1), y = r.y + h;
        const ax = S.nx ? w.face - S.nx * 0.6 : w.along, az = S.nx ? w.along : w.face - S.nz * 0.6;
        const bx = S.nx ? w.face + S.nx * 0.9 : w.along, bz = S.nx ? w.along : w.face + S.nz * 0.9;
        const L = wallCols(world, H, world.query((ax + bx) / 2, (az + bz) / 2, 1.2));
        const hc = world.segment(ax, y, az, bx, y, bz, L);
        const hd = world.tris.ray(ax, y, az, bx, y, bz, world.tris.want([T_STRUCT]));
        res.winShots.n++;
        const ok = !hc && !hd;
        if (ok) res.winShots.pass++;
        else if (res.winShots.examples.length < 6) res.winShots.examples.push({ room: r.id, side: S.k, along: w.along, h: r2(h), collider: hc ? "blocked" : "pass", drawn: hd ? "blocked" : "pass" });
        w.nx = S.nx; w.nz = S.nz; w.shotH = r2(h); w.shootable = ok;
        res.windows.push(w);
      }
      // walls not shoot-through: every body-height cell (0.9 .. 1.8 m) of the drawn WALL (drawn solid, not inside a real door / window) must be collider
      // solid; a drawn-solid cell the colliders let through inside a HOLE region is a shot through a wall (posts / panes inside real openings: kit-agree)
      const { nr, ncol, col, drw, skip } = a.bm;
      const kindAt = new Map(a.op.comps.map((c) => [c.id, c.kind]));
      for (let i = 8; i <= Math.min(17, nr - 1); i++) for (let j = 0; j < ncol; j++) {
        const k = i * ncol + j; if (skip[k] || drw[k]) continue;
        const kd = a.op.lab[k] >= 0 ? kindAt.get(a.op.lab[k]) : null;
        if (kd === "door" || kd === "window" || kd === "gap" || kd === "nowall") continue;
        res.wallShots.n++;
        if (col[k]) { if (res.wallShots.examples.length < 6) res.wallShots.examples.push({ room: r.id, side: S.k, along: r2(a.bm.along[0] + OFF + j * 0.1), h: r2(OFF + i * 0.1) }); }
        else res.wallShots.blocked++;
      }
    }
    // the same door seen from the two rooms it joins is ONE door: merge doors on the same face line within 0.6 m
    const merged = [];
    for (const d of res.doors) {
      const m = merged.find((q) => q.nx === -d.nx && q.nz === -d.nz && Math.abs(q.along - d.along) < 0.6 && Math.abs(q.face - d.face) < 0.8 && Math.abs(q.y - d.y) < 0.5);
      if (m) { m.rooms.push(d.room); m.width = Math.min(m.width, d.width); m.headroom = Math.min(m.headroom, d.headroom); m.exterior = m.exterior && d.exterior; }
      else merged.push(Object.assign({}, d, { rooms: [d.room] }));
    }
    res.doorList = merged;
    return res;
  }
  // furniture in view from each room door: eye 0.6 m inside the door at 1.62 m, looking into the room; a piece is in view when one of its
  // sample points lies inside the 88 x 57 deg frustum within 30 m and the eye -> point segment meets no drawn structure first
  function judgeFurnitureView(world, H, ops, stairs) {
    const T = world.tris, wantS = T.want([T_STRUCT]);
    const HF = 44 * Math.PI / 180, VF = 28.5 * Math.PI / 180;
    const rooms = [];
    for (const r of H.rooms) {
      // entrances: the room's doors (eye 0.6 m inside, looking along the inward normal) and the tops of stairs that land in it (eye 0.6 m past the
      // top edge, looking toward the room centre: a player arriving upstairs turns into the room)
      const ents = [];
      for (const d of ops.doors.filter((q) => q.room === r.id)) ents.push({ what: "door " + d.side + "@" + d.along, ex: d.nx ? d.face - d.nx * 0.6 : d.along, ez: d.nx ? d.along : d.face - d.nz * 0.6, fx: -d.nx, fz: -d.nz });
      for (const s of stairs || []) {
        const c = s.col, D = [[1, 0], [-1, 0], [0, 1], [0, -1]][c.dir] || [1, 0];
        if (Math.abs(c.maxY - r.y) > 0.4) continue;
        const tx = c.dir === 0 ? c.maxX + 0.6 : c.dir === 1 ? c.minX - 0.6 : (c.minX + c.maxX) / 2, tz = c.dir === 2 ? c.maxZ + 0.6 : c.dir === 3 ? c.minZ - 0.6 : (c.minZ + c.maxZ) / 2;
        if (!(tx > r.minX - 0.3 && tx < r.maxX + 0.3 && tz > r.minZ - 0.3 && tz < r.maxZ + 0.3)) continue;
        let fx = (r.minX + r.maxX) / 2 - tx, fz = (r.minZ + r.maxZ) / 2 - tz; const l = Math.hypot(fx, fz);
        if (l < 0.5) { fx = D[0]; fz = D[1]; } else { fx /= l; fz /= l; }
        ents.push({ what: "stair top", ex: tx, ez: tz, fx, fz });
      }
      const inRoom = H.furniture.filter((f) => !f.deco && f.maxY - f.minY >= 0.25 && ownPiece(f, r));
      let best = -1, bestAll = -1; const views = [];
      for (const e of ents) {
        const ex = e.ex, ez = e.ez, ey = r.y + EYE, fx = e.fx, fz = e.fz;
        let n = 0, nAll = 0; const seen = [], borrowed = [];
        for (const f of H.furniture) {
          if (f.maxY < r.y - 0.3 || f.minY > r.y + 2.6) continue;            // another storey's furniture is not "in this room's view"
          if (f.deco || f.maxY - f.minY < 0.25) continue;                     // a rug or a mat is not a piece of furniture
          const sx = (f.maxX - f.minX) * 0.4, sy = (f.maxY - f.minY) * 0.4, sz = (f.maxZ - f.minZ) * 0.4, cx = (f.minX + f.maxX) / 2, cy = (f.minY + f.maxY) / 2, cz = (f.minZ + f.maxZ) / 2;
          const P = [[cx, cy, cz], [cx, f.maxY - 0.01, cz]];
          for (const a of [-1, 1]) for (const b of [-1, 1]) for (const c of [-1, 1]) P.push([cx + a * sx, cy + b * sy, cz + c * sz]);
          let vis = false;
          for (const p of P) {
            const vx = p[0] - ex, vy = p[1] - ey, vz = p[2] - ez, dist = Math.hypot(vx, vy, vz); if (dist > 30 || dist < 0.2) continue;
            const fwd = vx * fx + vz * fz; if (fwd <= 0.05) continue;
            const lat = vx * -fz + vz * fx;
            if (Math.abs(Math.atan2(lat, fwd)) > HF || Math.abs(Math.atan2(vy, Math.hypot(fwd, lat))) > VF) continue;
            const h = T.ray(ex, ey, ez, p[0], p[1], p[2], wantS);
            if (!h || h.d > dist - 0.05) { vis = true; break; }
          }
          if (vis) { nAll++; if (ownPiece(f, r)) { n++; seen.push(f.kind); } else borrowed.push(f.kind); }
        }
        views.push({ from: e.what, n, nAll, seen: seen.slice(0, 10), borrowed: borrowed.slice(0, 6) });
        if (n > best) best = n;
        if (nAll > bestAll) bestAll = nAll;
      }
      rooms.push({ room: r.id, kind: r.kind || null, floor: r.floor, y: r2(r.y), entrances: ents.length, furnitureInRoom: inRoom.length, bestInView: Math.max(0, best), bestInViewAll: Math.max(0, bestAll), views });
    }
    return rooms;
  }
  // no furniture (collider or drawn) inside a door's clear zone (width x 0.9 m each side x 1.8 m) or a stair's run + 1 m landings
  function judgeFurnitureClear(world, H, ops, stairs) {
    const T = world.tris;
    const res = { doors: 0, stairs: 0, blocked: [] };
    const furnInZone = (Z) => {
      const hitC = H.furniture.filter((f) => overlap3(f, Z, -0.02)).map((f) => f.kind);
      // drawn furniture triangles inside the zone (centroids)
      let tri = 0;
      for (let t = 0; t < T.n; t++) {
        if (T.TG[t] !== T_FURN) continue;
        const o = t * 9, x = (T.p[o] + T.p[o + 3] + T.p[o + 6]) / 3, y = (T.p[o + 1] + T.p[o + 4] + T.p[o + 7]) / 3, z = (T.p[o + 2] + T.p[o + 5] + T.p[o + 8]) / 3;
        if (x > Z.minX && x < Z.maxX && y > Z.minY && y < Z.maxY && z > Z.minZ && z < Z.maxZ) tri++;
      }
      return { hitC, tri };
    };
    // the doors: the house records' own doors when it has them (exact centre and width), else the doors the bitmaps found
    const recDoors = (H.doors || []).map((d) => ({ face: d.axis === "z" ? d.x : d.z, along: d.axis === "z" ? d.z : d.x, nx: d.axis === "z" ? 1 : 0, nz: d.axis === "z" ? 0 : 1, width: d.width, y: d.y, rooms: d.rooms || [d.id], side: d.axis === "z" ? "x-wall" : "z-wall" }));
    res.doorSource = recDoors.length ? "records" : "bitmaps";
    for (const d of recDoors.length ? recDoors : ops.doorList) {
      res.doors++;
      const hw = Math.max(0.3, d.width / 2 - 0.05);
      const Z = d.nx ? { minX: d.face - 0.9, maxX: d.face + 0.9, minZ: d.along - hw, maxZ: d.along + hw } : { minX: d.along - hw, maxX: d.along + hw, minZ: d.face - 0.9, maxZ: d.face + 0.9 };
      Z.minY = d.y + 0.15; Z.maxY = d.y + 1.8;
      const f = furnInZone(Z);
      if (f.hitC.length || f.tri) res.blocked.push({ what: "door", room: d.rooms.join("+"), side: d.side, along: d.along, furniture: f.hitC, drawnTris: f.tri });
    }
    for (const s of stairs) {
      res.stairs++;
      const c = s.col, ext = 1.0;
      const Z = { minX: c.minX - (c.dir === 1 ? ext : c.dir === 0 ? ext : 0), maxX: c.maxX + (c.dir === 0 ? ext : c.dir === 1 ? ext : 0), minZ: c.minZ - (c.dir === 3 || c.dir === 2 ? ext : 0), maxZ: c.maxZ + (c.dir === 2 || c.dir === 3 ? ext : 0), minY: c.minY + 0.15, maxY: c.maxY + 1.8 };
      // the zone above the ramp surface only: furniture under a high ramp is not in the way; judge per piece by its top vs the ramp top there
      const hitC = H.furniture.filter((f) => overlap3(f, Z, -0.02) && f.maxY > rampTop(c, Math.min(Math.max((f.minX + f.maxX) / 2, c.minX), c.maxX), Math.min(Math.max((f.minZ + f.maxZ) / 2, c.minZ), c.maxZ)) + 0.1 && f.minY < rampTop(c, Math.min(Math.max((f.minX + f.maxX) / 2, c.minX), c.maxX), Math.min(Math.max((f.minZ + f.maxZ) / 2, c.minZ), c.maxZ)) + 1.8).map((f) => f.kind);
      if (hitC.length) res.blocked.push({ what: "stair", at: [r2((c.minX + c.maxX) / 2), r2((c.minZ + c.maxZ) / 2)], furniture: hitC });
    }
    return res;
  }
  function houseStairs(world, H) {
    const b = H.bbox, L = world.query((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2, Math.hypot(b.maxX - b.minX, b.maxZ - b.minZ) / 2 + 0.5);
    return L.filter((c) => c.kind === "ramp" && !c.dead && c.minX > b.minX - 0.5 && c.maxX < b.maxX + 0.5 && c.minZ > b.minZ - 0.5 && c.maxZ < b.maxZ + 0.5).map((c) => ({ col: c }));
  }
  function judgeStatic(world, H) {
    const t0 = Date.now();
    const floor = judgeFloor(world, H);
    const ceiling = judgeCeiling(world, H);
    const ops = judgeOpenings(world, H);
    const stairs = houseStairs(world, H);
    const view = judgeFurnitureView(world, H, ops, stairs);
    const clear = judgeFurnitureClear(world, H, ops, stairs);
    return {
      id: H.id, source: H.source, rooms: H.rooms.length, floors: new Set(H.rooms.map((r) => r.floor)).size, furniture: H.furniture.length, loot: H.loot.length, stairs: stairs.length, tris: world.tris.counts,
      floor, ceiling, openings: { sides: ops.sides, dis: ops.dis, disExamples: ops.disExamples, winShots: ops.winShots, wallShots: ops.wallShots,
        doors: ops.doorList.map((d) => ({ rooms: d.rooms, side: d.side, along: d.along, y: d.y, width: d.width, widthDrawn: d.widthDrawn, headroom: d.headroom, headroomDrawn: d.headroomDrawn, exterior: d.exterior })),
        windows: ops.windows.map((w) => ({ room: w.room, side: w.side, along: w.along, sill: w.sill, header: w.header, w: w.w, shootable: w.shootable })) },
      view, clear, ms: Date.now() - t0, _ops: ops,
    };
  }

  // ───────────── planner: a layered 0.25 m grid over the house + margin ─────────────
  function makeGrid(world, H, opt) {
    opt = opt || {};
    const CS = 0.25, M = opt.margin || 5;
    const b = H.bbox, x0 = b.minX - M, z0 = b.minZ - M, nx = Math.ceil((b.maxX - b.minX + 2 * M) / CS), nz = Math.ceil((b.maxZ - b.minZ + 2 * M) / CS);
    const cols = world.query((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2, Math.hypot(b.maxX - b.minX, b.maxZ - b.minZ) / 2 + M + 2);
    // the house's furniture colliders: their tops are NOT standable (VERSION 2); opt.furnitureTops = true restores the stage-A planner (diagnostics only)
    const furnCols = new Set();
    if (!opt.furnitureTops) for (const f of H.furniture || []) { for (const c of f.cols || []) if (c) furnCols.add(c); if (f.col) furnCols.add(f.col); }
    const nodes = [];          // {i, k, x, z, y}
    const at = new Map();      // i*nz+k -> [node ids]
    for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) {
      const x = x0 + (i + 0.5) * CS, z = z0 + (k + 0.5) * CS;
      const L = cols.filter((c) => !c.dead && c.maxX > x - 1 && c.minX < x + 1 && c.maxZ > z - 1 && c.minZ < z + 1);
      const terr = world.heightAt(x, z);
      const cands = [terr];
      // (player.js supportIn: a top counts within 0.3 m of its footprint; a ramp's height is read at the nearest footprint point)
      // (a ramp only along its run: its long sides are the plank's edges, a walker beside them falls off - the planner must keep to the plank)
      for (const c of L) {
        if (furnCols.has(c)) continue;                     // a furniture top is not a floor (the collider still blocks the capsule below)
        const alongX = c.kind === "ramp" && c.dir < 2, alongZ = c.kind === "ramp" && c.dir >= 2;
        const gx = alongZ ? -0.2 : 0.3, gz = alongX ? -0.2 : 0.3;
        if (x >= c.minX - gx && x <= c.maxX + gx && z >= c.minZ - gz && z <= c.maxZ + gz) { const t = topAt(c, Math.min(Math.max(x, c.minX), c.maxX), Math.min(Math.max(z, c.minZ), c.maxZ)); if (t > terr - 0.01) cands.push(t); }
      }
      cands.sort((p, q) => p - q);
      const surf = [];
      for (const y of cands) {
        if (surf.length && Math.abs(surf[surf.length - 1] - y) < 0.3) { surf[surf.length - 1] = Math.max(surf[surf.length - 1], y); continue; }
        surf.push(y);
      }
      for (const y of surf) {
        if (y < world.waterY + 0.2 && y <= terr + 0.01) continue;
        // a supporting top that is really a wall top inside a wall is excluded by the capsule test at that height
        if (capsuleBlocked(world, x, z, y, L)) continue;
        // a collider surface 0.3..1.8 m above this one at this point means a body cannot stand here (it is inside a slab)
        if (L.some((c) => !c.dead && c.kind !== "ramp" && x >= c.minX && x <= c.maxX && z >= c.minZ && z <= c.maxZ && c.minY > y + 0.05 && c.minY < y + HGT)) continue;
        const id = nodes.length; nodes.push({ i, k, x, z, y });
        const key = i * nz + k; if (!at.has(key)) at.set(key, []); at.get(key).push(id);
      }
    }
    const edgeCost = new Float32Array(nodes.length);
    for (let q = 0; q < nodes.length; q++) {
      const a = nodes[q];
      for (const [di, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const l = at.get((a.i + di) * nz + (a.k + dk));
        if (!l || !l.some((u) => Math.abs(nodes[u].y - a.y) <= 0.5)) { edgeCost[q] = 1.5; break; }
      }
    }
    const nb = (id) => {
      const a = nodes[id], out = [];
      for (let di = -1; di <= 1; di++) for (let dk = -1; dk <= 1; dk++) {
        if (!di && !dk) continue;
        const l = at.get((a.i + di) * nz + (a.k + dk)); if (!l || a.i + di < 0 || a.i + di >= nx || a.k + dk < 0 || a.k + dk >= nz) continue;
        for (const q of l) {
          const b2 = nodes[q]; if (Math.abs(b2.y - a.y) > 0.5) continue;
          if (di && dk) {      // no corner cutting
            const l1 = at.get((a.i + di) * nz + a.k), l2 = at.get(a.i * nz + (a.k + dk));
            if (!l1 || !l2 || !l1.some((u) => Math.abs(nodes[u].y - a.y) <= 0.5) || !l2.some((u) => Math.abs(nodes[u].y - a.y) <= 0.5)) continue;
          }
          out.push([q, (di && dk ? 1.414 : 1) * CS + Math.abs(b2.y - a.y) + edgeCost[q]]);
        }
      }
      // a straight hop over ONE cell with no standable surface at this height (a stair's top meeting a landing slab 0.6 m on: the mover crosses it in 3 ticks)
      for (const [di, dk] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) {
        const l = at.get((a.i + di) * nz + (a.k + dk)); if (!l || a.i + di < 0 || a.i + di >= nx || a.k + dk < 0 || a.k + dk >= nz) continue;
        const mid = at.get((a.i + di / 2) * nz + (a.k + dk / 2)) || [];
        for (const q of l) {
          const b2 = nodes[q]; if (Math.abs(b2.y - a.y) > 0.5) continue;
          if (mid.some((u) => Math.abs(nodes[u].y - a.y) <= 0.5 || Math.abs(nodes[u].y - b2.y) <= 0.5)) continue;
          const mx = a.x + (b2.x - a.x) / 2, mz = a.z + (b2.z - a.z) / 2, my = Math.max(a.y, b2.y);
          if (capsuleBlocked(world, mx, mz, my - 0.05)) continue;
          out.push([q, 2 * CS + Math.abs(b2.y - a.y) + 0.25]);
        }
      }
      return out;
    };
    // the standable node nearest (x, z) within maxD whose height is in [y - dyDown, y + dyUp] (default +-0.3)
    const nearest = (x, y, z, maxD, dyDown, dyUp) => {
      let best = -1, bd = maxD || 1.2;
      const lo = y - (dyDown == null ? 0.3 : dyDown), hi = y + (dyUp == null ? 0.3 : dyUp);
      const ci = Math.floor((x - x0) / CS), ck = Math.floor((z - z0) / CS), rr = Math.ceil((maxD || 1.2) / CS);
      for (let i = ci - rr; i <= ci + rr; i++) for (let k = ck - rr; k <= ck + rr; k++) {
        const l = at.get(i * nz + k); if (!l || i < 0 || k < 0 || i >= nx || k >= nz) continue;
        for (const q of l) { const n = nodes[q]; if (n.y < lo || n.y > hi) continue; const d = Math.hypot(n.x - x, n.z - z); if (d < bd) { bd = d; best = q; } }
      }
      return best;
    };
    // every standable node within maxD (xz) of (x, z) with height in [lo, hi], nearest first
    const around = (x, z, maxD, lo, hi) => {
      const out = [];
      const ci = Math.floor((x - x0) / CS), ck = Math.floor((z - z0) / CS), rr = Math.ceil(maxD / CS);
      for (let i = ci - rr; i <= ci + rr; i++) for (let k = ck - rr; k <= ck + rr; k++) {
        const l = at.get(i * nz + k); if (!l || i < 0 || k < 0 || i >= nx || k >= nz) continue;
        for (const q of l) { const n = nodes[q]; if (n.y < lo || n.y > hi) continue; const d = Math.hypot(n.x - x, n.z - z); if (d <= maxD) out.push([d, q]); }
      }
      return out.sort((a, b) => a[0] - b[0]).map((e) => e[1]);
    };
    // every node reachable from `from` (node ids) over the same edges the planner uses
    function flood(from) {
      const seen = new Uint8Array(nodes.length), st = [];
      for (const q of from) if (q >= 0 && !seen[q]) { seen[q] = 1; st.push(q); }
      while (st.length) { const q = st.pop(); for (const [w] of nb(q)) if (!seen[w]) { seen[w] = 1; st.push(w); } }
      return seen;
    }
    function path(a, bId) {
      if (a < 0 || bId < 0) return null;
      const g = new Float64Array(nodes.length).fill(Infinity), from = new Int32Array(nodes.length).fill(-1), done = new Uint8Array(nodes.length);
      const B = nodes[bId], hh = (q) => Math.hypot(nodes[q].x - B.x, nodes[q].z - B.z) + Math.abs(nodes[q].y - B.y);
      const heap = [];
      const push = (q, f) => { heap.push([f, q]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
      const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
      g[a] = 0; push(a, hh(a));
      let it = 0;
      while (heap.length && it++ < 400000) {
        const [, q] = pop(); if (done[q]) continue; done[q] = 1;
        if (q === bId) break;
        for (const [w, c] of nb(q)) { const ng = g[q] + c; if (ng < g[w]) { g[w] = ng; from[w] = q; push(w, ng + hh(w)); } }
      }
      if (!done[bId]) return null;
      const ids = []; for (let q = bId; q >= 0; q = from[q]) ids.push(q); ids.reverse();
      return ids;
    }
    // waypoints: every 3rd cell, every height change and the goal
    function waypoints(ids) {
      const wp = [];
      for (let j = 0; j < ids.length; j++) {
        const n = nodes[ids[j]], prev = j ? nodes[ids[j - 1]] : null;
        if (j === ids.length - 1 || j % 3 === 0 || (prev && Math.abs(prev.y - n.y) > 0.05)) wp.push({ x: n.x, y: n.y, z: n.z });
      }
      return wp;
    }
    return { nodes, nearest, around, path, flood, waypoints, nx, nz, CS, x0, z0, furnitureColliders: furnCols.size };
  }
  // a street start: a standable grid node 2.5..4.5 m out of an exterior door, outside every room
  function streetStart(grid, H, d) {
    for (const off of [3.0, 2.5, 3.5, 4.5, 2.0, 1.6, 1.2]) {      // (a door onto a deck or a landing: the 'street' is the first standable ground outside)
      const x = d.nx ? d.face + d.nx * off : d.along, z = d.nx ? d.along : d.face + d.nz * off;
      const q = grid.nearest(x, d.y - 0.2, z, 1.0, 1.0, 0.5);
      if (q >= 0 && outsideRooms(H, grid.nodes[q].x, grid.nodes[q].z, grid.nodes[q].y)) return q;
    }
    return -1;
  }
  // ───────────── the real mover follows waypoints ─────────────
  // mover = { a: actor (pos, input, onGround, swimming), place(x, y, z), step(dt) }. Steer at the next waypoint, advance on arrival (0.55 m, the last 0.45 m),
  // give up after 2.5 s without 5 cm of progress toward the current waypoint, or swimming, or the time budget.
  function follow(mover, start, wp) {
    const a = mover.a, DT = 1 / 60;
    mover.place(start.x, start.y + 0.02, start.z);
    let wi = 0, ticks = 0, total = 0, px = start.x, pz = start.z;
    for (const w of wp) { total += Math.hypot(w.x - px, w.z - pz); px = w.x; pz = w.z; }
    const cap = Math.ceil((total / 3.0 + 12) * 60);
    let lastProg = 0, bestD = Infinity;
    while (ticks < cap) {
      const w = wp[wi];
      const dx = w.x - a.pos.x, dz = w.z - a.pos.z, d = Math.hypot(dx, dz);
      const last = wi === wp.length - 1;
      if (d <= (last ? 0.45 : 0.55) && Math.abs(a.pos.y - w.y) < 1.0) {
        if (last) return { ok: true, ticks, total: r2(total) };
        wi++; bestD = Infinity; lastProg = ticks; continue;
      }
      a.input.yaw = Math.atan2(-dx, -dz); a.input.mz = 1; a.input.mx = 0; a.input.sprint = false; a.input.jump = false;
      mover.step(DT); ticks++;
      if (d < bestD - 0.05) { bestD = d; lastProg = ticks; }
      if (ticks - lastProg > 150) return { ok: false, why: "stuck", wi, of: wp.length, at: [r2(a.pos.x), r2(a.pos.y), r2(a.pos.z)], toward: [r2(w.x), r2(w.y), r2(w.z)], total: r2(total) };
      if (a.swimming) return { ok: false, why: "swim", wi, of: wp.length, at: [r2(a.pos.x), r2(a.pos.y), r2(a.pos.z)], total: r2(total) };
    }
    return { ok: false, why: "time", wi, of: wp.length, at: [r2(a.pos.x), r2(a.pos.y), r2(a.pos.z)], toward: [r2(wp[wi].x), r2(wp[wi].y), r2(wp[wi].z)], total: r2(total) };
  }
  // street -> room -> street for every room, street -> loot -> street for every loot point, through the house's exterior doors
  function judgeReach(world, H, st, mover, opt) {
    opt = opt || {};
    const grid = makeGrid(world, H, { furnitureTops: !!opt.furnitureTops });
    const ext = st._ops.doorList.filter((d) => d.exterior);
    const starts = []; for (const d of ext) { const q = streetStart(grid, H, d); if (q >= 0) starts.push({ q, door: d.side + "@" + d.along }); }
    // and the GROUND round the house: on each side, the open ground node (on the terrain, outside every room) nearest the side's middle 1.5-5 m out
    // (a cabin on a deck, a porch room or a side open to the yard has no detected door: the street is still the ground it is reached from)
    {
      const b = H.bbox, mids = [["+x", b.maxX, (b.minZ + b.maxZ) / 2, 1, 0], ["-x", b.minX, (b.minZ + b.maxZ) / 2, -1, 0], ["+z", (b.minX + b.maxX) / 2, b.maxZ, 0, 1], ["-z", (b.minX + b.maxX) / 2, b.minZ, 0, -1]];
      for (const [k, mx, mz, nx, nz] of mids) {
        let best = -1, bd = 1e9;
        grid.nodes.forEach((n, i) => {
          const out = nx ? (n.x - mx) * nx : (n.z - mz) * nz;
          if (out < 1.5 || out > 5) return;
          if (Math.abs(n.y - world.heightAt(n.x, n.z)) > 0.15 || !outsideRooms(H, n.x, n.z, n.y)) return;
          const d = Math.hypot(n.x - (nx ? mx + nx * 3 : mx), n.z - (nz ? mz + nz * 3 : mz)); if (d < bd) { bd = d; best = i; }
        });
        if (best >= 0) starts.push({ q: best, door: "ground " + k });
      }
    }
    const res = { gridNodes: grid.nodes.length, furnitureColliders: grid.furnitureColliders, exteriorDoors: ext.length, streetStarts: starts.length, rooms: [], loot: [] };
    const reach = grid.flood(starts.map((q) => q.q));
    res.reachableNodes = reach.reduce((n, v) => n + v, 0);
    // goal: the street-reachable node nearest the target (a room: on its floor inside it; a loot point: within the walk-over radius);
    // when no reachable node qualifies, the nearest unreachable one is reported (planned = false)
    const trip = (cands, check) => {
      const tr = { planned: false, inOk: false, outOk: false };
      if (!cands.length) { tr.why = check ? "no standable node within the 1.5 m walk-over pickup radius" : "no standable node in the room"; return tr; }
      const goalQ = cands.find((q) => reach[q]);
      if (goalQ == null) { tr.why = starts.length ? "no node of it is reachable from the street (" + cands.length + " candidates)" : "no exterior door with a street start"; return tr; }
      for (const s of starts) {
        if (!reach[s.q]) continue;
        const pin = grid.path(s.q, goalQ); if (!pin) continue;
        const pout = grid.path(goalQ, s.q); if (!pout) continue;
        tr.planned = true; tr.door = s.door;
        const S0 = grid.nodes[s.q], G0 = grid.nodes[goalQ];
        const win = follow(mover, S0, grid.waypoints(pin));
        if (win.ok && check) { const why = check(mover.a.pos); if (why) { win.ok = false; win.why = why; } }
        const wout = follow(mover, G0, grid.waypoints(pout));
        tr.inOk = win.ok; tr.outOk = wout.ok;
        if (!win.ok) tr.inFail = win; if (!wout.ok) tr.outFail = wout;
        if (win.ok && wout.ok) break;
      }
      if (!tr.planned) tr.why = "no grid path from any street start";
      return tr;
    };
    const roomCands = (r) => {
      const cx = (r.minX + r.maxX) / 2, cz = (r.minZ + r.maxZ) / 2, out = [];
      grid.nodes.forEach((n, i) => { if (Math.abs(n.y - r.y) < 0.15 && n.x > r.minX && n.x < r.maxX && n.z > r.minZ && n.z < r.maxZ && (!r.pts || r.pts.some((q) => Math.abs(q[0] - n.x) <= 0.5 && Math.abs(q[1] - n.z) <= 0.5))) out.push([Math.hypot(n.x - cx, n.z - cz), i]); });
      return out.sort((a, b) => a[0] - b[0]).map((e) => e[1]);
    };
    for (const r of H.rooms) { const t = trip(roomCands(r)); res.rooms.push(Object.assign({ room: r.id, floor: r.floor, y: r2(r.y) }, t)); }
    // loot: reached when the walker STANDS within the walk-over pickup radius (loot.js: horizontal 1.5 m, |dy| < 2.2 m) - the end position is checked
    for (const l of H.loot) {
      const cands = grid.around(l.x, l.z, 1.3, l.y - 2.15, l.y + 0.3);
      const check = (p) => { const d = Math.hypot(p.x - l.x, p.z - l.z), dy = Math.abs(p.y - l.y); return d < 1.5 && dy < 2.2 ? null : "stopped " + r2(d) + " m / dy " + r2(dy) + " from the item (walk-over 1.5 m / 2.2 m)"; };
      const t = trip(cands, check); res.loot.push(Object.assign({ at: [r2(l.x), r2(l.y), r2(l.z)], on: l.on || null }, t));
    }
    return res;
  }

  const API = { VERSION, TAGS, ownPiece, T_NONE, T_TERRAIN, T_STRUCT, T_FURN, T_GLASS, T_SOFT, T_OTHER, rampTop, topAt, segBox, makeTris, supportAt, floorUnder, capsuleBlocked,
    surveyHouses, judgeFloor, judgeCeiling, judgeOpenings, judgeFurnitureView, judgeFurnitureClear, houseStairs, judgeStatic, makeGrid, follow, judgeReach, analyseSide, SIDES };
  globalThis.__LCINT__ = API;
  return VERSION;
})()
