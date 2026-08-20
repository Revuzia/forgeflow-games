// core/ai/nav.js [A5] — grid bake from colliders + A* + string pulling
// (architecture §3.9, frozen signatures). THREE-free, Node-runnable,
// deterministic. Grid ≤160×160 cells, baked once at mission load (<150 ms
// budget — measured in ai.selftest.cjs).
//
// Floor model: the map is multi-level (arcade upper y4.2, tram deck y4.5,
// stair runs of 0.3 m risers — A3's colliders contract). Each cell holds a
// LIST of floors: the terrain height plus every clear box top over it.
// Traversal: floors connect when |dy| ≤ 0.36 m — BOTH between neighbouring
// cells and WITHIN one cell (a 1 m cell spans 3–4 stair steps; the intra-cell
// chain is what makes 0.3/0.28 m stair runs walkable at this cell size).
// A flood fill from the player spawn + R24 nodes + refSpawns prunes isolated
// islands (car roofs, kiosk tops), so nothing paths onto un-walkable props.
//
// Light bake (combat_spec §5.1 night light-factor): per-cell static light
// 0..1 = POI-zone ambient + practical pools from layout.lightPoles (LD §3.3
// single source — imported read-only; colliders does not re-export it,
// flagged to A3). perception.js reads nav.lightAt(x,z).
// Static v1: the beat-3 blackout does NOT dim AI perception (flagged).

import { buildLayout } from "../level/layout.js";
import { mulberry32 } from "../rng.js";

const STEP = 0.36;          // traversable height delta (A3: risers 0.3)
const CLEAR_H = 1.7;        // headroom needed over a floor
const FOOT_R = 0.2;         // blocking footprint (see stair note below)
const MAX_FLOOR_ABOVE = 6;  // never nav roofs
const GRID_MAX = 160;       // frozen budget

// POI zone ambient light (LD §3.4 zone-contrast plan, scaled to the §5.1
// ground-light term; pools from the practicals add on top).
const ZONE_BASE = {
  poi_dock: 0.06, poi_alleys: 0.05, poi_arcade: 0.25, poi_plaza: 0.35,
  poi_gallery: 0.08, poi_blvd: 0.12, poi_platform: 0.30, poi_customs: 0.65,
};
const DEFAULT_AMBIENT = 0.35; // custom/test collider sets without zones

export function bakeNav(colliders, opts = {}) {
  const t0 = (globalThis.performance ? performance.now() : Date.now());
  const cellOpt = opts.cell != null ? opts.cell : 1.0;
  const boxes = colliders.boxes || [];
  const groundY = colliders.groundY || (() => 0);
  const bounds = colliders.bounds || { min: [-60, -2, -60], max: [60, 14, 60] };

  const W = bounds.max[0] - bounds.min[0];
  const H = bounds.max[2] - bounds.min[2];
  const cell = Math.max(cellOpt, W / GRID_MAX, H / GRID_MAX);
  const nx = Math.min(GRID_MAX, Math.max(1, Math.round(W / cell)));
  const nz = Math.min(GRID_MAX, Math.max(1, Math.round(H / cell)));
  const ox = bounds.min[0], oz = bounds.min[2];

  // ---- box buckets (8 m) for fast per-cell queries
  const BK = 8;
  const bw = Math.ceil(W / BK) + 1, bh = Math.ceil(H / BK) + 1;
  const buckets = new Array(bw * bh);
  for (let i = 0; i < buckets.length; i++) buckets[i] = [];
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    const i0 = Math.max(0, Math.floor((b.min[0] - ox) / BK));
    const i1 = Math.min(bw - 1, Math.floor((b.max[0] - ox) / BK));
    const j0 = Math.max(0, Math.floor((b.min[2] - oz) / BK));
    const j1 = Math.min(bh - 1, Math.floor((b.max[2] - oz) / BK));
    for (let bi = i0; bi <= i1; bi++) for (let bj = j0; bj <= j1; bj++) buckets[bi * bh + bj].push(i);
  }
  const nearBoxes = (x, z) => {
    const bi = Math.min(bw - 1, Math.max(0, Math.floor((x - ox) / BK)));
    const bj = Math.min(bh - 1, Math.max(0, Math.floor((z - oz) / BK)));
    return buckets[bi * bh + bj];
  };

  // ---- floors per cell
  // node storage: flat arrays; cellNodes[ci] = array of node ids
  const cellNodes = new Array(nx * nz).fill(null);
  const nodeX = [], nodeY = [], nodeZ = [], nodeCell = [];
  const scratch = [];

  function blockedAt(x, z, y, near) {
    for (let k = 0; k < near.length; k++) {
      const b = boxes[near[k]];
      if (x + FOOT_R <= b.min[0] || x - FOOT_R >= b.max[0]) continue;
      if (z + FOOT_R <= b.min[2] || z - FOOT_R >= b.max[2]) continue;
      if (b.max[1] <= y + STEP + 0.01) continue;   // step/kerb — walkable over
      if (b.min[1] >= y + CLEAR_H) continue;       // high ceiling — clear
      return true;
    }
    return false;
  }

  // Floor sampling: stair steps are ~0.28 m deep at 0.3 m risers (A3), so a
  // single center sample misses the intermediate steps and the ≤0.36 chain
  // breaks. Sample the center plus 4 offsets along EACH axis (spacing 0.25 ×
  // cell) — consecutive samples on a 1.08 rise/m stair differ ≤0.27 m, and
  // the cross-cell sample gap is one spacing, so chains connect everywhere.
  const OFFS = [-0.375, -0.125, 0.125, 0.375];
  for (let ix = 0; ix < nx; ix++) {
    for (let iz = 0; iz < nz; iz++) {
      const x = ox + (ix + 0.5) * cell, z = oz + (iz + 0.5) * cell;
      const near = nearBoxes(x, z);
      scratch.length = 0;
      // v2.2 (A0 wave-3): a GROUND floor requires the cell CENTER POINT to not
      // sit INSIDE a tall solid. Offset samples alone could resurrect a
      // mostly-solid cell (measured: the alley scaffold covers 60% of its
      // cell; one free 0.4 m edge strip registered a ground node AT THE CELL
      // CENTER — inside the box — and A* then routed player and bots straight
      // into the solid, deadlocking the mission at beat 2). The test is
      // strict point-in-box (NOT the FOOT_R-padded blockedAt: padding also
      // killed legitimate walkway cells whose center is merely 0.1 m from a
      // stair face — measured: it severed the arcade SE stair approach).
      // Stairs are unaffected: the kerb exception passes ≤STEP risers, and
      // step TOPS keep the full offset sampling below.
      // EPS: a center EXACTLY on a solid's face (measured: the arcade east
      // door row — cell center sat on the wall corner at z==wall.max, the
      // mover rubbed the corner forever) counts as inside; 0.02 m is far
      // below the 0.1 m stair-adjacent walkway clearance that must survive.
      const EPS = 0.02;
      const pointInSolid = (px, pz, py) => {
        for (let k = 0; k < near.length; k++) {
          const b = boxes[near[k]];
          if (px < b.min[0] - EPS || px > b.max[0] + EPS) continue;
          if (pz < b.min[2] - EPS || pz > b.max[2] + EPS) continue;
          if (b.max[1] <= py + STEP + 0.01) continue;
          if (b.min[1] >= py + CLEAR_H) continue;
          return true;
        }
        return false;
      };
      const centerTerrOk = !pointInSolid(x, z, groundY(x, z));
      // v2.2 (A0 wave-3, measured): each floor entry keeps the SAMPLE POINT
      // that passed, and the node is ANCHORED at the passing sample nearest
      // the cell center — never blindly at the center. The kiosk cell at
      // (-9.5,-9.5) had a BLOCKED center (kiosk face 0.08 m away) but a clear
      // offset sample; the old bake still anchored the node at the center,
      // so A* waypoints sat in capsule-impossible spots — bot 47 wedged
      // against pl_kiosk_1's corner for 700 s and the e2e walker with it.
      const sample = (sx, sz) => {
        const d = Math.abs(sx - x) + Math.abs(sz - z);
        const terr = groundY(sx, sz);
        if (terr >= -0.5 && centerTerrOk && !blockedAt(sx, sz, terr, near)) {
          scratch.push({ y: terr, sx, sz, d });
        }
        for (let k = 0; k < near.length; k++) {
          const b = boxes[near[k]];
          if (sx < b.min[0] || sx > b.max[0] || sz < b.min[2] || sz > b.max[2]) continue;
          const top = b.max[1];
          if (top > terr && top - terr <= MAX_FLOOR_ABOVE && !blockedAt(sx, sz, top, near)) {
            scratch.push({ y: top, sx, sz, d });
          }
        }
      };
      sample(x, z);
      for (let o = 0; o < OFFS.length; o++) {
        sample(x + OFFS[o] * cell, z);
        sample(x, z + OFFS[o] * cell);
      }
      if (!scratch.length) continue;
      scratch.sort((a, b) => a.y - b.y);
      // dedupe (<0.15 clusters): height = the cluster's highest (stepping
      // stays conservative); anchor = the cluster member closest to center.
      let ids = null;
      let cStart = 0;
      for (let k = 0; k < scratch.length; k++) {
        if (k + 1 < scratch.length && scratch[k + 1].y - scratch[k].y < 0.15) continue;
        let best = scratch[cStart];
        for (let m = cStart + 1; m <= k; m++) if (scratch[m].d < best.d) best = scratch[m];
        cStart = k + 1;
        if (!ids) ids = [];
        nodeX.push(best.sx); nodeY.push(scratch[k].y); nodeZ.push(best.sz);
        nodeCell.push(ix * nz + iz);
        ids.push(nodeX.length - 1);
        if (ids.length >= 6) break;
      }
      if (ids) cellNodes[ix * nz + iz] = ids;
    }
  }
  const N = nodeX.length;

  // ---- adjacency (4-neighbour + diagonals w/ corner-cut guard) + intra-cell
  const adj = new Array(N);
  for (let i = 0; i < N; i++) adj[i] = [];
  const link = (a, b) => { adj[a].push(b); adj[b].push(a); };
  const bestPair = (idsA, idsB) => {
    // link every floor pair within STEP (stairs need the full chain)
    for (let a = 0; a < idsA.length; a++) {
      for (let b = 0; b < idsB.length; b++) {
        if (Math.abs(nodeY[idsA[a]] - nodeY[idsB[b]]) <= STEP) link(idsA[a], idsB[b]);
      }
    }
  };
  for (let ix = 0; ix < nx; ix++) {
    for (let iz = 0; iz < nz; iz++) {
      const ids = cellNodes[ix * nz + iz];
      if (!ids) continue;
      // intra-cell floor chain (stair runs inside one cell)
      for (let a = 0; a < ids.length; a++) {
        for (let b = a + 1; b < ids.length; b++) {
          if (Math.abs(nodeY[ids[a]] - nodeY[ids[b]]) <= STEP) link(ids[a], ids[b]);
        }
      }
      // east + south orthogonals (each pair linked once)
      if (ix + 1 < nx) { const e = cellNodes[(ix + 1) * nz + iz]; if (e) bestPair(ids, e); }
      if (iz + 1 < nz) { const s = cellNodes[ix * nz + iz + 1]; if (s) bestPair(ids, s); }
      // diagonals (SE, SW) only when both orthogonal cells are walkable AT A
      // COMPATIBLE HEIGHT. v2.2 (A0 wave-3, measured): existence alone let a
      // ground-level diagonal thread the 0.5 m slit between the arcade east
      // wall (arc_e_b2, floor-on-top y5.3) and the SE stair columns
      // (arc_stair_se_13, floor-on-top y3.9) — both orthogonal cells "exist"
      // but only as elevated floors, and the 0.8 m player capsule wedged in
      // the concave pocket forever (e2e froze at (-26.4, 0.6) every run).
      // A diagonal pair now needs each orthogonal cell to hold a floor
      // within STEP of the pair — the same clearance a capsule actually
      // sweeps when cutting that corner.
      const diagPair = (idsA, idsB, o1, o2) => {
        if (!o1 || !o2) return;
        for (let a = 0; a < idsA.length; a++) {
          for (let b = 0; b < idsB.length; b++) {
            if (Math.abs(nodeY[idsA[a]] - nodeY[idsB[b]]) > STEP) continue;
            const yRef = Math.min(nodeY[idsA[a]], nodeY[idsB[b]]);
            const ok = (o) => {
              for (let k = 0; k < o.length; k++) {
                if (Math.abs(nodeY[o[k]] - yRef) <= STEP) return true;
              }
              return false;
            };
            if (ok(o1) && ok(o2)) link(idsA[a], idsB[b]);
          }
        }
      };
      if (ix + 1 < nx && iz + 1 < nz) {
        const se = cellNodes[(ix + 1) * nz + iz + 1];
        if (se) diagPair(ids, se, cellNodes[(ix + 1) * nz + iz], cellNodes[ix * nz + iz + 1]);
      }
      if (ix - 1 >= 0 && iz + 1 < nz) {
        const sw = cellNodes[(ix - 1) * nz + iz + 1];
        if (sw) diagPair(ids, sw, cellNodes[(ix - 1) * nz + iz], cellNodes[ix * nz + iz + 1]);
      }
    }
  }

  // ---- reachability: flood fill from seeds; unreachable floors dropped
  const comp = new Int32Array(N).fill(-1);
  let compCount = 0;
  const stack = [];
  for (let i = 0; i < N; i++) {
    if (comp[i] >= 0) continue;
    stack.length = 0; stack.push(i); comp[i] = compCount;
    while (stack.length) {
      const c = stack.pop();
      const a = adj[c];
      for (let k = 0; k < a.length; k++) if (comp[a[k]] < 0) { comp[a[k]] = compCount; stack.push(a[k]); }
    }
    compCount++;
  }
  const cellOf = (x, z) => {
    const ix = Math.floor((x - ox) / cell), iz = Math.floor((z - oz) / cell);
    if (ix < 0 || ix >= nx || iz < 0 || iz >= nz) return -1;
    return ix * nz + iz;
  };
  // nearest node to a position (full ≤2-cell ring search; walkable floors
  // strongly preferred over pruned islands like prop tops). `walkArr` is
  // assigned after the flood fill — nodeAt is used both before (seeding,
  // where walkArr is null and the preference is a no-op) and after.
  let walkArr = null;
  function nodeAt(pos, maxDy = 2.0) {
    const px = pos[0], py = pos[1] || 0, pz = pos[2];
    let best = -1, bestScore = Infinity;
    const cix = Math.floor((px - ox) / cell), ciz = Math.floor((pz - oz) / cell);
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        const ix = cix + dx, iz = ciz + dz;
        if (ix < 0 || ix >= nx || iz < 0 || iz >= nz) continue;
        const ids = cellNodes[ix * nz + iz];
        if (!ids) continue;
        for (let k = 0; k < ids.length; k++) {
          const id = ids[k];
          const dy = Math.abs(nodeY[id] - py);
          if (dy > maxDy) continue;
          const score = dy * 3 + Math.abs(nodeX[id] - px) + Math.abs(nodeZ[id] - pz)
            + (walkArr && !walkArr[id] ? 100 : 0);
          if (score < bestScore) { bestScore = score; best = id; }
        }
      }
    }
    return best;
  }

  // seeds: player spawn + R24 nodes + refSpawns → the KEEP component set
  const keep = new Set();
  const seedPts = [];
  if (colliders.spawns && colliders.spawns.player) seedPts.push(colliders.spawns.player);
  for (const k of Object.keys(colliders.nodes || {})) seedPts.push(colliders.nodes[k]);
  if (colliders.refSpawns) {
    for (const k of Object.keys(colliders.refSpawns)) {
      const v = colliders.refSpawns[k];
      if (Array.isArray(v)) seedPts.push(v);
      else if (v && Array.isArray(v.pos)) seedPts.push(v.pos);
    }
  }
  if (!seedPts.length) seedPts.push([ox + W / 2, 0, oz + H / 2]);
  for (const p of seedPts) {
    const id = nodeAt(p, 2.0);
    if (id >= 0) keep.add(comp[id]);
  }
  const walk = new Uint8Array(N);
  for (let i = 0; i < N; i++) walk[i] = keep.has(comp[i]) ? 1 : 0;
  walkArr = walk; // nodeAt now prefers walkable floors

  // ---- static light bake (per cell, single XZ layer)
  const light = new Float32Array(nx * nz);
  const zones = colliders.zones || null;
  let poles = colliders.lightPoles || null;
  if (!poles && zones) {
    // real map colliders (zones present, poles not re-exported): read the
    // single source (layout.lightPoles) directly. Custom test colliders
    // (no zones) get flat ambient — no cross-import surprises in probes.
    try { poles = buildLayout(1).lightPoles; } catch (e) { poles = null; }
  }
  const zoneList = zones ? Object.keys(zones).map((k) => ({ k, z: zones[k] })) : null;
  const poleData = (poles || []).map((p) => {
    const h = Math.max(2, (p.pos[1] || 6));
    const coneR = p.cone ? Math.tan((p.cone * Math.PI / 180) / 2) * h : 4;
    const real = !!p.real;
    let peak = real ? (p.kind === "flood" ? 1.0 : 0.9) : (p.kind === "neon" ? 0.35 : 0.5);
    // aimed practicals pool around the AIM point on the ground, not the head
    const cx = p.aim ? p.aim[0] : p.pos[0];
    const cz = p.aim ? p.aim[2] : p.pos[2];
    return { x: cx, z: cz, r: Math.min(14, Math.max(3, real ? coneR : 4)), peak };
  });
  for (let ix = 0; ix < nx; ix++) {
    for (let iz = 0; iz < nz; iz++) {
      const x = ox + (ix + 0.5) * cell, z = oz + (iz + 0.5) * cell;
      let L = DEFAULT_AMBIENT;
      if (zoneList) {
        L = 0.04; // outside every POI: near-dark night streets
        for (const zn of zoneList) {
          const b = zn.z;
          if (x >= b.min[0] && x <= b.max[0] && z >= b.min[1] && z <= b.max[1]) {
            L = ZONE_BASE[zn.k] != null ? ZONE_BASE[zn.k] : 0.1;
            break;
          }
        }
      }
      for (const p of poleData) {
        const d = Math.hypot(x - p.x, z - p.z);
        if (d < p.r) L += p.peak * (1 - d / p.r);
      }
      light[ix * nz + iz] = Math.min(1, Math.max(0, L));
    }
  }

  // ---- A*
  const gScore = new Float64Array(N);
  const fromN = new Int32Array(N);
  const closedGen = new Int32Array(N);
  let gen = 0;
  function astar(a, b) {
    gen++;
    const open = [a]; // binary heap of node ids keyed by f
    const fKey = new Map();
    gScore[a] = 0; fromN[a] = -1; closedGen[a] = gen; // closedGen doubles as "seen this gen"
    const hx = (i) => {
      const dx = Math.abs(nodeX[i] - nodeX[b]), dz = Math.abs(nodeZ[i] - nodeZ[b]);
      return Math.max(dx, dz) + 0.4142 * Math.min(dx, dz) + Math.abs(nodeY[i] - nodeY[b]);
    };
    fKey.set(a, hx(a));
    const done = new Set();
    const up = (i) => { let c = i; while (c > 0) { const p = (c - 1) >> 1; if (fKey.get(open[p]) <= fKey.get(open[c])) break; const t = open[p]; open[p] = open[c]; open[c] = t; c = p; } };
    const down = () => { let c = 0; for (;;) { let m = c; const l = 2 * c + 1, r = l + 1; if (l < open.length && fKey.get(open[l]) < fKey.get(open[m])) m = l; if (r < open.length && fKey.get(open[r]) < fKey.get(open[m])) m = r; if (m === c) break; const t = open[m]; open[m] = open[c]; open[c] = t; c = m; } };
    while (open.length) {
      const cur = open[0];
      const last = open.pop();
      if (open.length) { open[0] = last; down(); }
      if (cur === b) {
        const path = [];
        for (let n = b; n >= 0; n = fromN[n]) path.push(n);
        path.reverse();
        return path;
      }
      if (done.has(cur)) continue;
      done.add(cur);
      const a2 = adj[cur];
      for (let k = 0; k < a2.length; k++) {
        const nb = a2[k];
        if (!walk[nb] || done.has(nb)) continue;
        const dx = nodeX[nb] - nodeX[cur], dz = nodeZ[nb] - nodeZ[cur], dy = nodeY[nb] - nodeY[cur];
        const g = gScore[cur] + Math.hypot(dx, dz) + Math.abs(dy) * 1.5;
        if (closedGen[nb] === gen && g >= gScore[nb]) continue;
        closedGen[nb] = gen;
        gScore[nb] = g;
        fromN[nb] = cur;
        fKey.set(nb, g + hx(nb));
        open.push(nb);
        up(open.length - 1);
      }
    }
    return null;
  }

  // straight-line walkability (string pulling): supercover samples along the
  // segment must find a floor chaining within STEP of the running height.
  function lineWalkable(x0, y0, z0, x1, y1, z1) {
    const dist = Math.hypot(x1 - x0, z1 - z0);
    const steps = Math.max(1, Math.ceil(dist / (cell * 0.5)));
    let y = y0;
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
      const ci = cellOf(x, z);
      if (ci < 0) return false;
      const ids = cellNodes[ci];
      if (!ids) return false;
      let ok = false;
      for (let k = 0; k < ids.length; k++) {
        if (walk[ids[k]] && Math.abs(nodeY[ids[k]] - y) <= STEP + 0.02) { y = nodeY[ids[k]]; ok = true; break; }
      }
      if (!ok) return false;
    }
    return Math.abs(y - y1) <= STEP + 0.02;
  }

  const fallbackRng = mulberry32(0x5eed5eed); // API-compat only; pass rng!

  const bakeMs = (globalThis.performance ? performance.now() : Date.now()) - t0;

  const nav = {
    // -------------------------------------------------- frozen signatures
    findPath(from, to) {
      const a = nodeAt(from), b = nodeAt(to);
      if (a < 0 || b < 0 || !walk[a] || !walk[b]) return null;
      if (comp[a] !== comp[b]) return null;
      const ids = astar(a, b);
      if (!ids) return null;
      // string pulling: greedy skip while the straight line stays walkable
      const pts = ids.map((i) => [nodeX[i], nodeY[i], nodeZ[i]]);
      const out = [pts[0]];
      let i = 0;
      while (i < pts.length - 1) {
        let j = pts.length - 1;
        for (; j > i + 1; j--) {
          if (Math.abs(pts[j][1] - pts[i][1]) <= STEP + 0.02 || j === i + 1) {
            if (lineWalkable(pts[i][0], pts[i][1], pts[i][2], pts[j][0], pts[j][1], pts[j][2])) break;
          }
        }
        out.push(pts[j]);
        i = j;
      }
      // exact endpoints at nav height (v2.2, A0 wave-3, SCOPED): nodeAt's
      // ring search can resolve an OFF-MESH endpoint to a node ~1 cell away;
      // blindly replacing that node with the exact endpoint created a first
      // leg that crossed the very solid the ring was avoiding (measured: the
      // alley scaffold al_scaf_1 — player AND three bots pressed into its
      // faces forever). The validation applies ONLY when the endpoint was
      // ring-resolved out of its own cell (the pathological case) — normal
      // paths keep the original replace/append byte-for-byte, so the frozen
      // fairness/passivity probes see unchanged routes.
      const fromCi = cellOf(from[0], from[2]);
      const toCi = cellOf(to[0], to[2]);
      const aY = out[0][1];
      if (nodeCell[a] === fromCi ||
          (out.length >= 2 &&
           lineWalkable(from[0], aY, from[2], out[1][0], out[1][1], out[1][2])) ||
          Math.hypot(out[0][0] - from[0], out[0][2] - from[2]) <= 0.4) {
        out[0] = [from[0], aY, from[2]];
      } else {
        out.unshift([from[0], aY, from[2]]); // keep the resolved node as a waypoint
      }
      const last = out[out.length - 1];
      if (Math.hypot(last[0] - to[0], last[2] - to[2]) > 0.4 &&
          (nodeCell[b] === toCi ||
           lineWalkable(last[0], last[1], last[2], to[0], last[1], to[2]))) {
        out.push([to[0], last[1], to[2]]);
      }
      return out;
    },

    randomPoint(near, r, rng) {
      const rand = rng || fallbackRng;
      const cix = Math.floor((near[0] - ox) / cell), ciz = Math.floor((near[2] - oz) / cell);
      const rr = Math.max(1, Math.ceil(r / cell));
      const cands = [];
      for (let dx = -rr; dx <= rr; dx++) {
        for (let dz = -rr; dz <= rr; dz++) {
          const ix = cix + dx, iz = ciz + dz;
          if (ix < 0 || ix >= nx || iz < 0 || iz >= nz) continue;
          const ids = cellNodes[ix * nz + iz];
          if (!ids) continue;
          for (let k = 0; k < ids.length; k++) {
            const id = ids[k];
            if (!walk[id]) continue;
            if (Math.hypot(nodeX[id] - near[0], nodeZ[id] - near[2]) <= r &&
                Math.abs(nodeY[id] - (near[1] || 0)) <= 3.5) cands.push(id);
          }
        }
      }
      if (!cands.length) return [near[0], near[1] || 0, near[2]];
      const id = cands[Math.min(cands.length - 1, Math.floor(rand() * cands.length))];
      return [nodeX[id], nodeY[id], nodeZ[id]];
    },

    reachable(from, to) {
      const a = nodeAt(from), b = nodeAt(to);
      return a >= 0 && b >= 0 && walk[a] === 1 && walk[b] === 1 && comp[a] === comp[b];
    },

    // -------------------------------------------------- private additions
    lightAt(x, z) {
      const ci = cellOf(x, z);
      return ci < 0 ? 0.1 : light[ci];
    },
    onNav(pos, maxDy = 1.0) {
      const id = nodeAt(pos, maxDy);
      return id >= 0 && walk[id] === 1;
    },
    floorAt(pos) {
      const id = nodeAt(pos, 2.0);
      return id < 0 ? null : nodeY[id];
    },
    stats: { cells: nx * nz, nodes: N, walkable: 0, bakeMs, cell, nx, nz },
    _hash() {
      // deterministic bake fingerprint for probes
      let h = 5381 >>> 0;
      for (let i = 0; i < N; i++) {
        h = ((h * 33) ^ (nodeCell[i] + 7)) >>> 0;
        h = ((h * 33) ^ (Math.round(nodeY[i] * 100) + walk[i])) >>> 0;
      }
      for (let i = 0; i < light.length; i += 7) h = ((h * 33) ^ Math.round(light[i] * 255)) >>> 0;
      return h.toString(16);
    },
  };
  let wc = 0;
  for (let i = 0; i < N; i++) wc += walk[i];
  nav.stats.walkable = wc;
  return nav;
}
