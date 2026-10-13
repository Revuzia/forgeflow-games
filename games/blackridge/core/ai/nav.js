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
//
// BOT-AI PASS (2026-10) — the nav now models the MOVER, not just the floors:
//   - hop validation at bake time: every cross-floor hop and every hop near a
//     kerb/stair tread is REPLAYED through world.moveCapsule's own blocking and
//     support rules (moverHopOk); flat hops get a midpoint/quarter-point capsule
//     test (thin walls between anchors); 4 m collision buckets are padded so a
//     point query sees boxes across a bucket line.
//   - wall-distance classes (clr 0..6 cells) from a multi-source BFS; A* prices
//     them (WALL_PEN) and randomPoint/openSpot can demand a minimum.
//   - findPath(from, to, opts): typed-array A*, PADDED string pull from the
//     bot's exact position, opts {noise,bias,heat,heatW,expose,expW,avoid,pad};
//     the result carries .ids (A* node chain) for crowd-heat stamping.
//   - lineClear(a, b, pad)  capsule-clear leg test (steering lookahead);
//     clearAt(pos), openSpot(pos, r, minClr), makeHeat/stampHeat/decayHeat
//     (caller-owned crowd map — nav stays stateless across sims),
//     exposure(pos, radius) (cached grid shadow-cast: cells in view of pos).
//   Probes: tools/nav_probe.mjs (arrival / stuck / snag / hug / skip metrics).

import { buildLayout } from "../level/layout.js";
import { mulberry32 } from "../rng.js";

const STEP = 0.36;          // traversable height delta (A3: risers 0.3)
const CLEAR_H = 1.7;        // headroom needed over a floor
// W3 nav/capsule honesty fix (matchprobe AC-4/T-CTF-1/T-CTF-4 finding): the
// locomotion capsule is MOVE.CAPSULE_R 0.35 (player.js — bots use the same
// mover), so a floor sample cleared at the old 0.2 footprint could anchor a
// waypoint 0.2–0.35 m from a box face — reachable by the bake, impossible
// for the capsule. A* then routed bots through FOOT_R-only lanes and they
// pushed against the world for 100+ s (measured: 60/60 battery matches with
// worstStuckIdle 68–684 s; 14% of lanternwalk / 39% of meridian_ward nav
// nodes were capsule-blocked). 0.34 = capsule radius minus a hair so faces
// exactly at the mover's own boundary don't flap; cell 0.75's offset
// sampling (±0.09/±0.28 m, max sample gap 0.19 m) keeps every lane ≥0.9 m
// wide walkable, and the arena's narrowest intended lane is the 2.0 m pier
// gap (R4). The kerb exception below still passes ≤STEP risers, so stairs
// are unaffected.
const FOOT_R = 0.34;        // blocking footprint = the locomotion capsule
const MAX_FLOOR_ABOVE = 6;  // never nav roofs
const GRID_MAX = 160;       // frozen budget

// BOT-AI PASS (2026-10, nav_probe.mjs baseline: 80–96% arrival, 18–35% of
// drive ticks hugging a wall, ~1.3k–4.2k skipped waypoints per 300 routes):
//  - PULL_PAD: string-pulled legs keep this much EXTRA clearance beyond the
//    capsule, so a straight leg never grazes a corner the square mover
//    footprint (world.capsuleBlocked is an AABB test, not a circle) would
//    snag on. Legs the pad cannot satisfy (door slits, 1 m lanes) fall back to
//    the plain A* hop, which already sits on the best-clearance node chain.
//  - WALL_PEN: A* step multiplier by wall-distance class (0 = within one cell
//    of an obstacle). Open ground prefers the middle of the space; narrow
//    lanes are uniform so the shortest path still wins there.
//  - the "climb-adjacent" 0.2 m footprint exception now applies ONLY to stair
//    risers (kind==='step'). It used to cover every box ≤2 risers tall — low
//    walls, bollards — which the mover (capsuleBlocked above STEP_UP=0.35)
//    treats as full-radius walls, so paths ran through 0.2–0.35 m "gaps" that
//    snagged every bot that took them.
const PULL_PAD = 0.22;
const WALL_PEN = [0.75, 0.28, 0.08];
const CLR_MAX = 6;
const NOISE_DEFAULT = 0;
// probe-only timing split (nav_probe --perf sets globalThis.__NAV_PERF__)
const PERF = { astarMs: 0, pullMs: 0, calls: 0, nodes: 0 };
const PERF_ON = !!globalThis.__NAV_PERF__;

// POI zone ambient light (LD §3.4 zone-contrast plan, scaled to the §5.1
// ground-light term; pools from the practicals add on top).
// W3 (PVP_BUILD_PLAN C20/X2): the three Lanternwalk PVP rooms get authored
// entries — an unknown key falls through to 0.1 (NOT DEFAULT_AMBIENT), so
// without these the interiors read DARKER to the AI than they render and
// bots over-estimate their own concealment — a fairness bug, not cosmetic.
// poi_alleys rises 0.05 → 0.16 to match the PVP lighting profile's 18%
// floor (the light bake and the rendered scene must not disagree).
// Exported: the ai selftest asserts these values (C20 is a wave-1 blocker).
export const ZONE_BASE = {
  poi_dock: 0.06, poi_alleys: 0.16, poi_arcade: 0.25, poi_plaza: 0.35,
  poi_gallery: 0.08, poi_blvd: 0.12, poi_platform: 0.30, poi_customs: 0.65,
  poi_lanternyard: 0.22, poi_exchange: 0.20, poi_corridor: 0.15,
};
const DEFAULT_AMBIENT = 0.35; // custom/test collider sets without zones

export function bakeNav(colliders, opts = {}) {
  const t0 = (globalThis.performance ? performance.now() : Date.now());
  const marks = [];
  const mark = (n) => marks.push([n, (globalThis.performance ? performance.now() : Date.now()) - t0]);
  const cellOpt = opts.cell != null ? opts.cell : 1.0;
  // rayOnly boxes are the ballistic collision layer (compound prop
  // silhouettes, colliders.js) — movement/nav uses each prop's moveOnly
  // hull instead, so the bake sees the same box count it was budgeted for.
  const boxes = (colliders.boxes || []).filter((b) => !b.rayOnly);
  const groundY = colliders.groundY || (() => 0);
  const bounds = colliders.bounds || { min: [-60, -2, -60], max: [60, 14, 60] };

  const W = bounds.max[0] - bounds.min[0];
  const H = bounds.max[2] - bounds.min[2];
  const cell = Math.max(cellOpt, W / GRID_MAX, H / GRID_MAX);
  const nx = Math.min(GRID_MAX, Math.max(1, Math.round(W / cell)));
  const nz = Math.min(GRID_MAX, Math.max(1, Math.round(H / cell)));
  const ox = bounds.min[0], oz = bounds.min[2];

  // ---- box buckets (8 m) for fast per-cell queries
  const BK = 4, BK_PAD = 0.9; // 4 m buckets: ~4x fewer boxes per point query than 8 m
  const bw = Math.ceil(W / BK) + 1, bh = Math.ceil(H / BK) + 1;
  const buckets = new Array(bw * bh);
  for (let i = 0; i < buckets.length; i++) buckets[i] = [];
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    // BOT-AI PASS: bucket by the box inflated by BK_PAD (> FOOT_R + PULL_PAD +
    // lookahead pad). A point query only sees its OWN bucket, so a point
    // 0.2 m from a bucket line used to miss a box whose face was 0.2 m away on
    // the other side — nodes and legs within the capsule radius of a wall at
    // every 8 m grid line were declared clear (nav_probe: bad hops clustered
    // there).
    const i0 = Math.max(0, Math.floor((b.min[0] - BK_PAD - ox) / BK));
    const i1 = Math.min(bw - 1, Math.floor((b.max[0] + BK_PAD - ox) / BK));
    const j0 = Math.max(0, Math.floor((b.min[2] - BK_PAD - oz) / BK));
    const j1 = Math.min(bh - 1, Math.floor((b.max[2] + BK_PAD - oz) / BK));
    for (let bi = i0; bi <= i1; bi++) for (let bj = j0; bj <= j1; bj++) buckets[bi * bh + bj].push(i);
  }
  const nearBoxes = (x, z) => {
    const bi = Math.min(bw - 1, Math.max(0, Math.floor((x - ox) / BK)));
    const bj = Math.min(bh - 1, Math.max(0, Math.floor((z - oz) / BK)));
    return buckets[bi * bh + bj];
  };

  mark("buckets");
  // ---- floors per cell
  // node storage: flat arrays; cellNodes[ci] = array of node ids
  const cellNodes = new Array(nx * nz).fill(null);
  let nodeX = [], nodeY = [], nodeZ = [], nodeCell = [];
  const scratch = [];
  const cellNear = [];

  // Stair note (why two radii): a 0.28 m-deep step top is ALWAYS within
  // 0.34 m of the +2 riser's face, so the full capsule footprint would mark
  // every stair-run sample blocked and sever arcade_upper/platform_deck
  // (measured: ai.selftest R24 reachability broke at FOOT_R 0.34 flat).
  // The real mover climbs through that proximity — y rises as it advances,
  // so a "+2" riser is "+1" by the time its face is inside the radius. A
  // box ≤2 risers above the floor is therefore climb-adjacent and keeps the
  // legacy 0.2 footprint; anything taller is a wall and gets the capsule's.
  function blockedAt(x, z, y, near, pad) {
    const pd = pad || 0;
    for (let k = 0; k < near.length; k++) {
      const b = boxes[near[k]];
      if (b.max[1] <= y + STEP + 0.01) continue;   // step/kerb — walkable over
      if (b.min[1] >= y + CLEAR_H) continue;       // high ceiling — clear
      // climb-adjacent exception: STAIR RISERS only (see header note)
      const r = (b.kind === "step" && b.max[1] - y <= 2 * STEP + 0.01 ? 0.2 : FOOT_R) + pd;
      if (x + r <= b.min[0] || x - r >= b.max[0]) continue;
      if (z + r <= b.min[2] || z - r >= b.max[2]) continue;
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
      // cull the 4 m bucket list down to the boxes that can touch ANY sample of
      // this cell (samples sit <= 0.28 m from the centre, the footprint reaches
      // 0.34 m further: 0.7 m is exact-safe) — most cells then have none
      const nearAll = nearBoxes(x, z);
      const near = cellNear;
      near.length = 0;
      for (let q = 0; q < nearAll.length; q++) {
        const bq = boxes[nearAll[q]];
        if (x + 0.7 < bq.min[0] || x - 0.7 > bq.max[0] || z + 0.7 < bq.min[2] || z - 0.7 > bq.max[2]) continue;
        near.push(nearAll[q]);
      }
      // fast path: no box can touch this cell and the terrain is flat across
      // its samples -> exactly one ground node at the centre (what the 9-sample
      // pass + dedupe would produce, minus ~9 closure calls; ~60% of cells)
      if (near.length === 0) {
        const g0 = groundY(x, z), ex = 0.375 * cell;
        if (groundY(x - ex, z) === g0 && groundY(x + ex, z) === g0 && groundY(x, z - ex) === g0 && groundY(x, z + ex) === g0) {
          if (g0 >= -0.5) {
            nodeX.push(x); nodeY.push(g0); nodeZ.push(z);
            nodeCell.push(ix * nz + iz);
            cellNodes[ix * nz + iz] = [nodeX.length - 1];
          }
          continue;
        }
      }
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
  mark("floors");
  const N = nodeX.length;
  // typed copies (hot A*/line loops); values identical to the build arrays
  nodeX = Float64Array.from(nodeX); nodeY = Float64Array.from(nodeY);
  nodeZ = Float64Array.from(nodeZ); nodeCell = Int32Array.from(nodeCell);

  // ---- mover-faithful hop check (BOT-AI PASS). world.moveCapsule resolves X
  // then Z with the capsule's footprint tested at the CURRENT feet height and
  // only afterwards lifts the feet onto the support under the new position.
  // That ordering makes a stair tread entered from the SIDE impassable
  // whenever the next riser (top > feet + STEP_UP) overlaps the footprint
  // before the lift happens — while the same tread climbed along the run is
  // fine. The floor-graph rules (|dy| <= STEP, kind==='step' footprint
  // exception) cannot see that, so nav_probe watched bots push at the
  // first-tread side of a 3 m wide stair run for 40 s (switchyard gbank_step).
  // This replays the mover's own rules along a straight hop in 6 cm steps
  // (below one 4.6 m/s tick, 7.7 cm) and answers whether the capsule gets
  // there. Used for every cross-floor link at bake time and for any pulled /
  // steering leg whose floor height changes. R = FOOT_R (a hair under the
  // mover's 0.35, matching how node anchors were cleared).
  // Cells within 0.9 m of a LOW ground-attached box (kerb / stair tread /
  // sandbag / barrier: top 0.05..1.1 m). The floor graph labels a hop across
  // such a box "flat" (a <= STEP box is walk-over-able), but the mover can
  // still be blocked by a TALLER neighbour tread while it is lifting - e.g. a
  // run entered from the side (switchyard plat_e_stair_n: bots pushed at the
  // west flank of the run for a full minute). Every hop / leg touching a
  // flagged cell is replayed through the mover rules; elsewhere it is skipped
  // (the replay on all ~60k hops would cost ~80 ms of bake).
  // cells within 1 m of anything taller than a step: flat hops elsewhere cannot
  // hit a wall and skip the midpoint test entirely
  const solidFlag = new Uint8Array(nx * nz);
  for (let bi = 0; bi < boxes.length; bi++) {
    const b = boxes[bi];
    const gy = groundY((b.min[0] + b.max[0]) / 2, (b.min[2] + b.max[2]) / 2) || 0;
    if (b.max[1] - gy <= STEP + 0.01 && b.kind !== "step") continue;
    const i0 = Math.max(0, Math.floor((b.min[0] - 1.1 - ox) / cell)), i1 = Math.min(nx - 1, Math.floor((b.max[0] + 1.1 - ox) / cell));
    const j0 = Math.max(0, Math.floor((b.min[2] - 1.1 - oz) / cell)), j1 = Math.min(nz - 1, Math.floor((b.max[2] + 1.1 - oz) / cell));
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) solidFlag[i * nz + j] = 1;
  }
  const lowFlag = new Uint8Array(nx * nz);
  for (let bi = 0; bi < boxes.length; bi++) {
    const b = boxes[bi];
    const top = b.max[1] - (groundY((b.min[0] + b.max[0]) / 2, (b.min[2] + b.max[2]) / 2) || 0);
    // only things the floor graph treats as walk-over-able (<= STEP) or that are
    // stair treads can disagree with the mover; a taller box is a wall to both
    if (!(top > 0.05 && (top <= 0.4 || b.kind === "step")) || b.min[1] > 0.4) continue;
    const i0 = Math.max(0, Math.floor((b.min[0] - 0.9 - ox) / cell)), i1 = Math.min(nx - 1, Math.floor((b.max[0] + 0.9 - ox) / cell));
    const j0 = Math.max(0, Math.floor((b.min[2] - 0.9 - oz) / cell)), j1 = Math.min(nz - 1, Math.floor((b.max[2] + 0.9 - oz) / cell));
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) lowFlag[i * nz + j] = 1;
  }
  const MV_STEP_UP = 0.35, MV_H = 1.8, MV_SUP_R = 0.35 * 0.6;
  const hopBoxes = [];
  function moverBlocked(x, y, z) {
    for (let k = 0; k < hopBoxes.length; k++) {
      const b = hopBoxes[k];
      if (x + FOOT_R <= b.min[0] || x - FOOT_R >= b.max[0]) continue;
      if (z + FOOT_R <= b.min[2] || z - FOOT_R >= b.max[2]) continue;
      if (b.max[1] <= y + MV_STEP_UP) continue;
      if (b.min[1] >= y + MV_H) continue;
      return true;
    }
    return false;
  }
  function moverSupport(x, z, y) {
    let sup = groundY(x, z);
    for (let k = 0; k < hopBoxes.length; k++) {
      const b = hopBoxes[k];
      if (x + MV_SUP_R < b.min[0] || x - MV_SUP_R > b.max[0] || z + MV_SUP_R < b.min[2] || z - MV_SUP_R > b.max[2]) continue;
      const top = b.max[1];
      if (top <= y + MV_STEP_UP && top > sup) sup = top;
    }
    return sup;
  }
  let replays = 0;
  function moverHopOk(ax, ay, az, bx, by, bz) {
    replays++;
    const dx = bx - ax, dz = bz - az;
    const dist = Math.sqrt(dx * dx + dz * dz);
    // local box list: everything the 0.34 footprint / 0.21 support can touch
    // along this hop (hop bounds + 0.5 m)
    hopBoxes.length = 0;
    const lx0 = Math.min(ax, bx) - 0.5, lx1 = Math.max(ax, bx) + 0.5;
    const lz0 = Math.min(az, bz) - 0.5, lz1 = Math.max(az, bz) + 0.5;
    const near = nearBoxes((ax + bx) * 0.5, (az + bz) * 0.5);
    for (let k = 0; k < near.length; k++) {
      const b = boxes[near[k]];
      if (b.max[0] < lx0 || b.min[0] > lx1 || b.max[2] < lz0 || b.min[2] > lz1) continue;
      hopBoxes.push(b);
    }
    const steps = Math.max(2, Math.ceil(dist / 0.06));
    let x = ax, y = ay, z = az;
    // a node floor is point-sampled; the mover STANDS on the highest tread its
    // 0.21 m support footprint touches (up to a riser higher on 0.225 m treads),
    // so start from that settled height, not the sampled one
    for (let r = 0; r < 4; r++) { const s2 = moverSupport(x, z, y); if (s2 <= y + 1e-6) break; y = s2; }
    for (let s = 1; s <= steps; s++) {
      const nxp = ax + dx * (s / steps), nzp = az + dz * (s / steps);
      if (moverBlocked(nxp, y, z)) return false;
      x = nxp;
      if (moverBlocked(x, y, nzp)) return false;
      z = nzp;
      y = moverSupport(x, z, y);
    }
    // the mover's support uses a 0.21 m footprint, so on 0.225 m treads it sits
    // up to one riser ABOVE the point-sampled node floor: tolerate 2 risers
    return Math.abs(y - by) <= 0.65;
  }

  // ---- adjacency (4-neighbour + diagonals w/ corner-cut guard) + intra-cell
  const adj = new Array(N);
  for (let i = 0; i < N; i++) adj[i] = [];
  const link = (a, b) => { adj[a].push(b); adj[b].push(a); };
  // BOT-AI PASS: a hop between two clear anchors can still cut straight
  // through a thin wall / fence / rail that fits BETWEEN the anchors of
  // neighbouring cells (anchors are offset up to 0.375 cell from centres, so a
  // hop is up to ~1.5 cell long). nav_probe measured ~9% of A* hops blocked
  // for the capsule, some by solid boxes. Test the hop midpoint with the same
  // footprint (anchor squares + midpoint square leave < 0.07 m of unchecked
  // line). Cross-floor (stair) hops use the lower floor, where a +1 riser is
  // passable by the STEP rule. Intra-cell stair chains skip the check.
  let hopsCut = 0;
  let hopNear = [], hopCell = -1, hopFresh = false;
  function hopList() {
    if (hopFresh) return hopNear;
    hopFresh = true;
    const ix = (hopCell / nz) | 0, iz = hopCell - ix * nz;
    const cx = ox + (ix + 0.5) * cell, cz = oz + (iz + 0.5) * cell;
    const all = nearBoxes(cx, cz);
    hopNear.length = 0;
    for (let q = 0; q < all.length; q++) {
      const bq = boxes[all[q]];
      if (cx + 1.7 < bq.min[0] || cx - 1.7 > bq.max[0] || cz + 1.7 < bq.min[2] || cz - 1.7 > bq.max[2]) continue;
      hopNear.push(all[q]);
    }
    return hopNear;
  }
  const cutLog = [];
  const linkMid = (a, b) => {
    // stair hops (any height change) keep the pre-pass rule: the riser/side-wall
    // geometry there is exactly what the kind==='step' footprint exception models
    if (Math.abs(nodeY[a] - nodeY[b]) > 0.05) {
      // faithful replay in the direction of the climb (lower -> higher): the
      // limiting case — a descent falls gradually, so its footprint is tested
      // from ABOVE the risers and is never stricter than the climb
      const lo = nodeY[a] <= nodeY[b] ? a : b, hi = lo === a ? b : a;
      if (moverHopOk(nodeX[lo], nodeY[lo], nodeZ[lo], nodeX[hi], nodeY[hi], nodeZ[hi])) link(a, b);
      else { hopsCut++; if (cutLog.length < 3000) cutLog.push([nodeX[lo], nodeY[lo], nodeZ[lo], nodeX[hi], nodeY[hi], nodeZ[hi]]); }
      return;
    }
    if (lowFlag[nodeCell[a]] || lowFlag[nodeCell[b]]) {
      if (!moverHopOk(nodeX[a], nodeY[a], nodeZ[a], nodeX[b], nodeY[b], nodeZ[b]) ||
          !moverHopOk(nodeX[b], nodeY[b], nodeZ[b], nodeX[a], nodeY[a], nodeZ[a])) {
        hopsCut++;
        if (cutLog.length < 3000) cutLog.push([nodeX[a], nodeY[a], nodeZ[a], nodeX[b], nodeY[b], nodeZ[b]]);
        return;
      }
    }
    if (!solidFlag[nodeCell[a]] && !solidFlag[nodeCell[b]]) { link(a, b); return; } // open ground
    const my = Math.min(nodeY[a], nodeY[b]);
    const hx = nodeX[b] - nodeX[a], hz = nodeZ[b] - nodeZ[a];
    // long / diagonal hops also get the quarter points: a square footprint
    // can clip a box corner between the midpoint and an anchor
    const long = hx * hx + hz * hz > 0.81;
    for (let q = long ? 1 : 2; q <= (long ? 3 : 2); q += long ? 1 : 2) {
      const f = q * (long ? 0.25 : 0.25);
      const mx = nodeX[a] + hx * f, mz = nodeZ[a] + hz * f;
      if (blockedAt(mx, mz, my, hopList())) { hopsCut++; return; }
    }
    link(a, b);
  };
  const bestPair = (idsA, idsB) => {
    // link every floor pair within STEP (stairs need the full chain)
    for (let a = 0; a < idsA.length; a++) {
      for (let b = 0; b < idsB.length; b++) {
        if (Math.abs(nodeY[idsA[a]] - nodeY[idsB[b]]) <= STEP) linkMid(idsA[a], idsB[b]);
      }
    }
  };
  for (let ix = 0; ix < nx; ix++) {
    for (let iz = 0; iz < nz; iz++) {
      const ids = cellNodes[ix * nz + iz];
      if (!ids) continue;
      // boxes that can touch any hop leaving this cell (E, S, SE, SW: <= 1.1 m
      // from the centre + the 0.34 footprint): culled once per cell
      hopCell = ix * nz + iz; hopFresh = false; // hopNear is built on first use (open ground never needs it)
      // intra-cell floor chain (stair runs inside one cell)
      for (let a = 0; a < ids.length; a++) {
        for (let b = a + 1; b < ids.length; b++) {
          if (Math.abs(nodeY[ids[a]] - nodeY[ids[b]]) <= STEP) {
            const A = ids[a], B = ids[b];
            const lo = nodeY[A] <= nodeY[B] ? A : B, hi = lo === A ? B : A;
            if (Math.abs(nodeY[A] - nodeY[B]) <= 0.05 ||
                moverHopOk(nodeX[lo], nodeY[lo], nodeZ[lo], nodeX[hi], nodeY[hi], nodeZ[hi])) link(A, B);
          }
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
            if (ok(o1) && ok(o2)) linkMid(idsA[a], idsB[b]);
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

  mark("adjacency");
  // ---- wall-distance classes (BOT-AI PASS). An "edge" node is one whose
  // eight neighbour cells are not ALL linked at a compatible floor (a wall,
  // prop, or the map boundary sits within ~one cell). A multi-source BFS over
  // the link graph then gives every node its distance, in cells, to the
  // nearest edge — O(N), ~3 ms, no raycasts. clr: 0 = against an obstacle,
  // CLR_MAX = open ground. A* prices low classes (WALL_PEN) and randomPoint /
  // openSpot can demand a minimum so goals are not chosen in doorways.
  const clr = new Uint8Array(N).fill(CLR_MAX);
  {
    const q = new Int32Array(N);
    let qh = 0, qt = 0;
    for (let i = 0; i < N; i++) {
      const ci = nodeCell[i], cix = (ci / nz) | 0, ciz = ci - cix * nz;
      let mask = 0;
      const a = adj[i];
      for (let k = 0; k < a.length; k++) {
        const cj = nodeCell[a[k]];
        if (cj === ci) continue;
        const dx = ((cj / nz) | 0) - cix, dz = (cj - ((cj / nz) | 0) * nz) - ciz;
        if (dx < -1 || dx > 1 || dz < -1 || dz > 1) continue;
        mask |= 1 << ((dx + 1) * 3 + (dz + 1));
      }
      if ((mask | 16) !== 511) { clr[i] = 0; q[qt++] = i; } // bit 4 = self cell
    }
    while (qh < qt) {
      const c = q[qh++], d = clr[c] + 1;
      if (d >= CLR_MAX) continue;
      const a = adj[c];
      for (let k = 0; k < a.length; k++) {
        const nb = a[k];
        if (clr[nb] > d) { clr[nb] = d; q[qt++] = nb; }
      }
    }
  }
  const wallPen = new Float32Array(N);
  for (let i = 0; i < N; i++) wallPen[i] = clr[i] < WALL_PEN.length ? WALL_PEN[clr[i]] : 0;

  mark("clearance");
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

  mark("flood");
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
  // base ambient per cell (zones), then each practical SPLATS its pool onto
  // the cells inside its radius (same per-cell add order as the old
  // cell-major loop: poles in array order -> identical floats, a fraction of
  // the cost — the light bake was ~30-40 ms of the budget)
  const lightD = new Float64Array(nx * nz); // double accumulation == the old per-cell local
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
      lightD[ix * nz + iz] = L;
    }
  }
  for (const p of poleData) {
    const i0 = Math.max(0, Math.floor((p.x - p.r - ox) / cell));
    const i1 = Math.min(nx - 1, Math.floor((p.x + p.r - ox) / cell));
    const j0 = Math.max(0, Math.floor((p.z - p.r - oz) / cell));
    const j1 = Math.min(nz - 1, Math.floor((p.z + p.r - oz) / cell));
    for (let ix = i0; ix <= i1; ix++) {
      for (let iz = j0; iz <= j1; iz++) {
        const x = ox + (ix + 0.5) * cell, z = oz + (iz + 0.5) * cell;
        const d = Math.hypot(x - p.x, z - p.z);
        if (d < p.r) lightD[ix * nz + iz] += p.peak * (1 - d / p.r);
      }
    }
  }
  for (let i = 0; i < light.length; i++) light[i] = Math.min(1, Math.max(0, lightD[i]));
  mark("light");
  // ---- A* (typed-array binary heap; BOT-AI PASS rewrite — the Map/Set
  // version cost 2–3.4 ms mean / 22 ms worst per path on these maps).
  // Edge cost = geometric length × (1 + wall class penalty + per-bot lane
  // noise + squad heat + exposure) — every extra term is >= 0, so the octile
  // heuristic stays admissible. opts (all optional, all pure inputs):
  //   noise,bias   — per-bot deterministic lane jitter amplitude + hash seed
  //   heat,heatW   — Float32Array(N) crowd map owned by the CALLER (nav stays
  //                  stateless across sims: matchprobe shares ONE nav)
  //   expose,expW  — Uint8Array(nx*nz) mask of cells in view of a known threat
  //   avoid        — [x, z, r, w]: extra cost inside a disc (stuck re-routes)
  const gS = new Float32Array(N);
  const par = new Int32Array(N);
  const seenG = new Int32Array(N);
  const cloG = new Int32Array(N);
  let gen = 0;
  let heapId = new Int32Array(8192), heapF = new Float32Array(8192), hn = 0;
  function hpush(id, f) {
    if (hn === heapId.length) {
      const ni = new Int32Array(hn * 2), nf = new Float32Array(hn * 2);
      ni.set(heapId); nf.set(heapF); heapId = ni; heapF = nf;
    }
    let c = hn++;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (heapF[p] <= f) break;
      heapId[c] = heapId[p]; heapF[c] = heapF[p]; c = p;
    }
    heapId[c] = id; heapF[c] = f;
  }
  function hpop() {
    const top = heapId[0];
    hn--;
    if (hn > 0) {
      const id = heapId[hn], f = heapF[hn];
      let c = 0;
      for (;;) {
        const l = 2 * c + 1;
        if (l >= hn) break;
        const r = l + 1;
        const m = (r < hn && heapF[r] < heapF[l]) ? r : l;
        if (heapF[m] >= f) break;
        heapId[c] = heapId[m]; heapF[c] = heapF[m]; c = m;
      }
      heapId[c] = id; heapF[c] = f;
    }
    return top;
  }
  // integer hash → [0,1): deterministic per (node, seed), no rng stream used
  function hash01(i, seed) {
    let h = (Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(seed + 7, 0x85ebca6b)) >>> 0;
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
    h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
    return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
  }
  function astar(a, b, opts) {
    gen++;
    hn = 0;
    const bx = nodeX[b], bz = nodeZ[b], by = nodeY[b];
    const noise = opts && opts.noise ? opts.noise : NOISE_DEFAULT;
    const bias = opts && opts.bias ? opts.bias | 0 : 0;
    const heat = opts && opts.heat ? opts.heat : null;
    const heatW = opts && opts.heatW != null ? opts.heatW : 0.25;
    const expose = opts && opts.expose ? opts.expose : null;
    const expW = opts && opts.expW != null ? opts.expW : 0.9;
    const avoid = opts && opts.avoid ? opts.avoid : null;
    const ax0 = nodeX[a], az0 = nodeZ[a];
    let dxa = Math.abs(ax0 - bx), dza = Math.abs(az0 - bz);
    gS[a] = 0; par[a] = -1; seenG[a] = gen;
    hpush(a, Math.max(dxa, dza) + 0.4142 * Math.min(dxa, dza) + Math.abs(nodeY[a] - by));
    while (hn > 0) {
      const cur = hpop();
      if (cur === b) {
        const path = [];
        for (let n = b; n >= 0; n = par[n]) path.push(n);
        path.reverse();
        return path;
      }
      if (cloG[cur] === gen) continue;
      cloG[cur] = gen;
      const a2 = adj[cur];
      const cx = nodeX[cur], cz = nodeZ[cur], cy = nodeY[cur], gc = gS[cur];
      for (let k = 0; k < a2.length; k++) {
        const nb = a2[k];
        if (!walk[nb] || cloG[nb] === gen) continue;
        const dx = nodeX[nb] - cx, dz = nodeZ[nb] - cz, dy = nodeY[nb] - cy;
        const len = Math.sqrt(dx * dx + dz * dz);
        let mult = 1 + wallPen[nb];
        if (noise) mult += noise * hash01(nb, bias);
        if (heat) mult += heat[nb] * heatW;
        if (expose && expose[nodeCell[nb]]) mult += expW;
        if (avoid) {
          const ex = nodeX[nb] - avoid[0], ez = nodeZ[nb] - avoid[1];
          if (ex * ex + ez * ez < avoid[2] * avoid[2]) mult += avoid[3];
        }
        const g = gc + len * mult + (dy < 0 ? -dy : dy) * 1.5;
        if (seenG[nb] === gen && g >= gS[nb]) continue;
        seenG[nb] = gen;
        gS[nb] = g;
        par[nb] = cur;
        const ex2 = Math.abs(nodeX[nb] - bx), ez2 = Math.abs(nodeZ[nb] - bz);
        hpush(nb, g + Math.max(ex2, ez2) + 0.4142 * Math.min(ex2, ez2) + Math.abs(nodeY[nb] - by));
      }
    }
    return null;
  }

  // straight-line walkability (string pulling): supercover samples along the
  // segment must find a floor chaining within STEP of the running height —
  // AND clear the capsule footprint (W3 nav/capsule honesty fix, part 2:
  // pulled segments used to hug corners a cleared-anchor path never touched;
  // bots wedged mid-segment pushing into concave pockets at vel 0 — measured
  // live: a flag CARRIER pinned 297 s at one such corner, seed 17 0-0).
  // Step 0.4×cell (~0.3 m at cell 0.75): the FOOT_R pad makes even a corner
  // graze block ≥~0.3 m of the line, so samples cannot skip past one.
  // pad (BOT-AI PASS): extra clearance on top of the capsule footprint, and a
  // denser sample step (a padded graze blocks a longer stretch of the line, so
  // 0.4×cell samples cannot skip it; unpadded keeps the legacy step).
  let lwDY = 0; // largest |floor height - start| seen by the last lineWalkable
  function lineWalkable(x0, y0, z0, x1, y1, z1, pad) {
    const pd = pad || 0;
    lwDY = 0;
    let lowHit = false;
    const dx0 = x1 - x0, dz0 = z1 - z0;
    const dist = Math.sqrt(dx0 * dx0 + dz0 * dz0);
    const steps = Math.max(1, Math.ceil(dist / (cell * (pd > 0 ? 0.33 : 0.4))));
    let y = y0;
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const x = x0 + dx0 * t, z = z0 + dz0 * t;
      const ci = cellOf(x, z);
      if (ci < 0) return false;
      const ids = cellNodes[ci];
      if (!ids) return false;
      let ok = false;
      for (let k = 0; k < ids.length; k++) {
        if (walk[ids[k]] && Math.abs(nodeY[ids[k]] - y) <= STEP + 0.02) { y = nodeY[ids[k]]; ok = true; break; }
      }
      if (!ok) return false;
      if (lowFlag[ci]) lowHit = true;
      if (blockedAt(x, z, y, nearBoxes(x, z), pd)) return false;
      const dyy = y - y0;
      if (dyy > lwDY) lwDY = dyy; else if (-dyy > lwDY) lwDY = -dyy;
    }
    if (Math.abs(y - y1) > STEP + 0.02) return false;
    // any leg that climbs / descends must also survive the mover's own rules
    if (lwDY > 0.05 || lowHit) return moverHopOk(x0, y0, z0, x1, y1, z1);
    return true;
  }

  const fallbackRng = mulberry32(0x5eed5eed); // API-compat only; pass rng!

  const bakeMs = (globalThis.performance ? performance.now() : Date.now()) - t0;

  // start-node resolution with reachability (W3 wedge fix, part 3): nodeAt's
  // score picks the geometrically nearest node — which can sit in a concave
  // pocket the capsule cannot enter from the caller's side (measured: bot at
  // 6.85,-24.65 vs node 6.63,-25.41 across a 0.5 m pier/building slit — every
  // repath re-resolved the same unreachable first waypoint and the bot pushed
  // at the corner for the rest of the match). Iterate candidates in score
  // order and take the first with a capsule-clear straight line from `pos`;
  // fall back to the plain nearest when none is (old behavior, never worse).
  function reachableNodeAt(pos, maxDy = 2.0) {
    const px = pos[0], py = pos[1] || 0, pz = pos[2];
    const cix = Math.floor((px - ox) / cell), ciz = Math.floor((pz - oz) / cell);
    const cands = [];
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
          cands.push([score, id]);
        }
      }
    }
    if (!cands.length) return -1;
    cands.sort((u1, u2) => u1[0] - u2[0]);
    const lim = Math.min(cands.length, 10);
    for (let k = 0; k < lim; k++) {
      const id = cands[k][1];
      if (lineWalkable(px, py, pz, nodeX[id], nodeY[id], nodeZ[id])) return id;
    }
    return cands[0][1];
  }

  // ---- exposure (lazy; nothing here runs at bake time)
  let opaque = null;
  const expCache = new Map();
  function buildOpaque() {
    opaque = new Uint8Array(nx * nz);
    const all = colliders.boxes || [];
    for (let bi = 0; bi < all.length; bi++) {
      const b = all[bi];
      if (b.moveOnly) continue;               // movement hull - transparent to sight
      if (!(b.min[1] < 1.2 && b.max[1] > 1.3)) continue; // does not cross the eye line
      const i0 = Math.max(0, Math.floor((b.min[0] - 0.1 - ox) / cell));
      const i1 = Math.min(nx - 1, Math.floor((b.max[0] + 0.1 - ox) / cell));
      const j0 = Math.max(0, Math.floor((b.min[2] - 0.1 - oz) / cell));
      const j1 = Math.min(nz - 1, Math.floor((b.max[2] + 0.1 - oz) / cell));
      for (let i = i0; i <= i1; i++) {
        for (let j = j0; j <= j1; j++) {
          const cx = ox + (i + 0.5) * cell, cz = oz + (j + 0.5) * cell;
          // real overlap of the cell centre +-0.25 cell with the box
          if (cx + cell * 0.25 > b.min[0] && cx - cell * 0.25 < b.max[0] &&
              cz + cell * 0.25 > b.min[2] && cz - cell * 0.25 < b.max[2]) opaque[i * nz + j] = 1;
        }
      }
    }
  }
  function exposureMask(pos, radius) {
    const sci = Math.floor((pos[0] - ox) / cell), scj = Math.floor((pos[2] - oz) / cell);
    if (sci < 0 || sci >= nx || scj < 0 || scj >= nz) return null;
    const R = Math.min(60, Math.max(2, Math.ceil(radius / cell)));
    const key = ((sci * 1000 + scj) * 100) + R;
    const hit = expCache.get(key);
    if (hit) return hit;
    if (!opaque) buildOpaque();
    const W = 2 * R + 1;
    const vis = new Uint8Array(W * W);
    const mask = new Uint8Array(nx * nz);
    vis[R * W + R] = 1;
    const R2 = R * R;
    // rings of increasing Chebyshev distance so the cell "one step back" is done
    for (let d = 1; d <= R; d++) {
      for (let dx = -d; dx <= d; dx++) {
        for (let dz = -d; dz <= d; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== d) continue;
          if (dx * dx + dz * dz > R2) continue;
          const ax = Math.abs(dx), az = Math.abs(dz);
          let px, pz;
          if (ax >= az) { px = dx - Math.sign(dx); pz = Math.round(dz * (ax - 1) / ax); }
          else { pz = dz - Math.sign(dz); px = Math.round(dx * (az - 1) / az); }
          if (!vis[(px + R) * W + (pz + R)]) continue;
          if (px !== 0 || pz !== 0) {
            const ci = sci + px, cj = scj + pz;
            if (ci < 0 || ci >= nx || cj < 0 || cj >= nz) continue;
            if (opaque[ci * nz + cj]) continue;
          }
          vis[(dx + R) * W + (dz + R)] = 1;
          const gi = sci + dx, gj = scj + dz;
          if (gi >= 0 && gi < nx && gj >= 0 && gj < nz) mask[gi * nz + gj] = 1;
        }
      }
    }
    mask[sci * nz + scj] = 1;
    if (expCache.size >= 8) expCache.delete(expCache.keys().next().value);
    expCache.set(key, mask);
    return mask;
  }

  const nav = {
    // -------------------------------------------------- frozen signatures
    // findPath(from, to [, opts]) — A* over the floor graph, then a PADDED
    // string pull (PULL_PAD clearance beyond the capsule) from the bot's exact
    // position. opts: see astar() header + { pad } to override the pull pad
    // (0 = legacy unpadded). The result carries .ids (the A* node chain) so a
    // caller can stamp a crowd-heat map without re-resolving nodes.
    findPath(from, to, opts) {
      const a = reachableNodeAt(from), b = nodeAt(to);
      if (a < 0 || b < 0 || !walk[a] || !walk[b]) return null;
      if (comp[a] !== comp[b]) return null;
      const tP0 = PERF_ON ? performance.now() : 0;
      const ids = astar(a, b, opts);
      if (PERF_ON) { PERF.astarMs += performance.now() - tP0; PERF.calls++; PERF.nodes += ids ? ids.length : 0; }
      if (!ids) return null;
      const tP1 = PERF_ON ? performance.now() : 0;
      const pad = opts && opts.pad != null ? opts.pad : PULL_PAD;
      const L = [];
      // exact start (see v2.2 note below): the chain's first node is kept as a
      // waypoint only when the pull cannot skip it
      const aY = nodeY[ids[0]];
      const fromCi = cellOf(from[0], from[2]);
      const toCi = cellOf(to[0], to[2]);
      L.push([from[0], aY, from[2]]);
      for (let k = 0; k < ids.length; k++) L.push([nodeX[ids[k]], nodeY[ids[k]], nodeZ[ids[k]]]);
      const lastN = L[L.length - 1];
      let goalPt = null;
      if (Math.hypot(lastN[0] - to[0], lastN[2] - to[2]) > 0.4 &&
          (nodeCell[b] === toCi ||
           lineWalkable(lastN[0], lastN[1], lastN[2], to[0], lastN[1], to[2]))) {
        goalPt = [to[0], lastN[1], to[2]];
        L.push(goalPt);
      }
      // exact endpoints at nav height (v2.2, A0 wave-3, SCOPED): nodeAt's
      // ring search can resolve an OFF-MESH endpoint to a node ~1 cell away;
      // blindly replacing that node with the exact endpoint created a first
      // leg that crossed the very solid the ring was avoiding (measured: the
      // alley scaffold al_scaf_1). A start/goal point that is NOT line-reachable
      // from its resolved node keeps that node as a waypoint — the pull below
      // only skips a node when a straight capsule-clear leg exists.
      const lastIdx = L.length - 1;
      const out = [L[0]];
      let i = 0;
      while (i < lastIdx) {
        const jmax = Math.min(lastIdx, i + 56);
        let j = jmax;
        for (; j > i + 1; j--) {
          if (Math.abs(L[j][1] - L[i][1]) > STEP + 0.02) continue;
          const dxl = L[j][0] - L[i][0], dzl = L[j][2] - L[i][2];
          if (dxl * dxl + dzl * dzl > 1600) continue;
          if (lineWalkable(L[i][0], L[i][1], L[i][2], L[j][0], L[j][1], L[j][2], pad)) break;
        }
        // Unpadded legs are allowed only SHORT and only at the two ends: the
        // start (the bot is where it is, possibly against a wall) and the goal
        // (a flag stand may sit 0.35 m off a wall). An unpadded long goal leg
        // ran 0.08 m off a crate and the bot, drifting 0.3 m, wedged on its face.
        if (i === 0 || jmax === lastIdx) {
          for (let jj = jmax; jj > j; jj--) {
            if (!(i === 0 || jj === lastIdx)) continue;
            if (Math.abs(L[jj][1] - L[i][1]) > STEP + 0.02) continue;
            const dxl = L[jj][0] - L[i][0], dzl = L[jj][2] - L[i][2];
            if (dxl * dxl + dzl * dzl > 9) continue;
            if (lineWalkable(L[i][0], L[i][1], L[i][2], L[jj][0], L[jj][1], L[jj][2], 0)) { j = jj; break; }
          }
        }
        out.push(L[j]);
        i = j;
      }
      void fromCi;
      if (PERF_ON) PERF.pullMs += performance.now() - tP1;
      out.ids = ids;
      return out;
    },

    // minClr (BOT-AI PASS, optional): demand a wall-distance class >= minClr so
    // wander / investigate / hold goals are not picked in doorways and against
    // walls; falls back to the unfiltered set when nothing qualifies. Still
    // exactly ONE rng() draw per call (stream discipline unchanged).
    randomPoint(near, r, rng, minClr) {
      const rand = rng || fallbackRng;
      const cix = Math.floor((near[0] - ox) / cell), ciz = Math.floor((near[2] - oz) / cell);
      const rr = Math.max(1, Math.ceil(r / cell));
      const cands = [];
      const want = minClr | 0;
      let loose = null;
      if (want > 0) loose = [];
      const r2 = r * r, ny0 = near[1] || 0;
      for (let dx = -rr; dx <= rr; dx++) {
        for (let dz = -rr; dz <= rr; dz++) {
          const ix = cix + dx, iz = ciz + dz;
          if (ix < 0 || ix >= nx || iz < 0 || iz >= nz) continue;
          const ids = cellNodes[ix * nz + iz];
          if (!ids) continue;
          for (let k = 0; k < ids.length; k++) {
            const id = ids[k];
            if (!walk[id]) continue;
            const ex = nodeX[id] - near[0], ez = nodeZ[id] - near[2];
            if (ex * ex + ez * ez <= r2 && Math.abs(nodeY[id] - ny0) <= 3.5) {
              if (want > 0) { if (clr[id] >= want) cands.push(id); else loose.push(id); }
              else cands.push(id);
            }
          }
        }
      }
      const pool = cands.length ? cands : (loose && loose.length ? loose : null);
      if (!pool) return [near[0], near[1] || 0, near[2]];
      const id = pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))];
      return [nodeX[id], nodeY[id], nodeZ[id]];
    },

    reachable(from, to) {
      const a = nodeAt(from), b = nodeAt(to);
      return a >= 0 && b >= 0 && walk[a] === 1 && walk[b] === 1 && comp[a] === comp[b];
    },

    // -------------------------------------------------- BOT-AI PASS additions
    // capsule-clear straight leg from a to b following the floor graph, with
    // `pad` metres of extra clearance (steering lookahead; ~10 samples/3 m)
    lineClear(a, b, pad) {
      return lineWalkable(a[0], a[1] || 0, a[2], b[0], b[1] != null ? b[1] : (a[1] || 0), b[2], pad || 0);
    },
    // wall-distance class (0 = against an obstacle ... CLR_MAX = open) of the
    // node nearest `pos`; -1 off the mesh
    clearAt(pos) {
      const id = nodeAt(pos, 1.5);
      return id < 0 ? -1 : clr[id];
    },
    // nearest walkable node >= minClr within r of pos, for nudging a hold /
    // wander goal out of a doorway (deterministic; no rng). null when none.
    openSpot(pos, r, minClr) {
      const cix = Math.floor((pos[0] - ox) / cell), ciz = Math.floor((pos[2] - oz) / cell);
      const rr = Math.max(1, Math.ceil(r / cell));
      let best = -1, bestD = Infinity;
      for (let dx = -rr; dx <= rr; dx++) {
        for (let dz = -rr; dz <= rr; dz++) {
          const ix = cix + dx, iz = ciz + dz;
          if (ix < 0 || ix >= nx || iz < 0 || iz >= nz) continue;
          const ids = cellNodes[ix * nz + iz];
          if (!ids) continue;
          for (let k = 0; k < ids.length; k++) {
            const id = ids[k];
            if (!walk[id] || clr[id] < minClr) continue;
            if (Math.abs(nodeY[id] - (pos[1] || 0)) > 0.8) continue;
            const ex = nodeX[id] - pos[0], ez = nodeZ[id] - pos[2];
            const d = ex * ex + ez * ez;
            if (d < bestD && d <= r * r) { bestD = d; best = id; }
          }
        }
      }
      return best < 0 ? null : [nodeX[best], nodeY[best], nodeZ[best]];
    },
    // crowd heat (lane diversity). The map is owned by the CALLER (nav is
    // shared between sims/matches and must stay stateless).
    makeHeat() { return new Float32Array(N); },
    stampHeat(heat, ids, amt) {
      if (!heat || !ids) return;
      for (let k = 0; k < ids.length; k++) {
        const id = ids[k];
        heat[id] += amt;
        const a = adj[id];
        for (let m = 0; m < a.length; m++) heat[a[m]] += amt * 0.5;
      }
    },
    decayHeat(heat, f) { if (heat) for (let i = 0; i < heat.length; i++) heat[i] *= f; },
    // which cells can a viewer standing at pos see (ground-level eye line,
    // radius metres)? Uint8Array(nx*nz); pure function of (pos cell, radius),
    // cached (8 entries). Approximate permissive grid shadow-cast: a cell is
    // seen if the cell one step back toward the viewer is seen and not opaque.
    exposure(pos, radius) {
      return exposureMask(pos, radius);
    },
    cellOfPos(x, z) { return cellOf(x, z); },
    // read-only graph view for probes / debugging (not a stable API)
    _graph() { return { nodeX, nodeY, nodeZ, nodeCell, adj, walk, clr, nodeAt }; },

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
    stats: { cells: nx * nz, nodes: N, walkable: 0, bakeMs, cell, nx, nz, perf: PERF, hopsCut, marks, cutLog, get replays() { return replays; } },
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
