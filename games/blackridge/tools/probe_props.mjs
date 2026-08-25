#!/usr/bin/env node
// tools/probe_props.mjs [A3] — layout/collider integrity gate.
//
// WAVE 1 (this file, per BUILD_PLAN Part 2 / A3 wave-1 scope): validates the
// THREE-free data layer —
//   1. determinism: two builds are byte-identical (any seed);
//   2. schema: every collider box is well-formed, surface/matClass in vocab;
//   3. no overlapping AABBs (touching faces allowed; interpenetration fails);
//   4. R24 node keys: exactly the frozen 15, unique, inside bounds, walkable,
//      not inside any solid, elevated nodes physically supported;
//   5. every LD §6 spawn coordinate (player + 44) walkable, not inside any
//      solid, supported;
//   6. every authored cover node walkable/clear, dir unit-length, height enum.
//
// WAVE 2 adds the visual prop-contact gate (raycast placement, 1.5 cm sink,
// float >0 mm / clip >3 cm fail, base-decal presence — LD §4.1) on top of
// these checks; the exit-0 contract stays the same.
//
// run: node tools/probe_props.mjs     → exit 0 = pass, 1 = fail

import { buildLayout, computePlacements } from "../core/level/layout.js";
import { buildColliders, propSubBoxes } from "../core/level/colliders.js";
import { rayBox } from "../core/sim/world.js";

const EPS = 0.002; // 2 mm interpenetration tolerance (shared faces pass)
const SURFACES = new Set(["concrete", "metal", "dirt", "wood", "glass"]);
const MATCLASSES = new Set(["soft", "metal_thin", "hard"]);
// Per-map contract data (W4 map split — the BLACKRIDGE_MAP env var selects
// the layout; see core/level/layout.js). meridian_ward keeps the frozen R24
// campaign set + LD §6's 44 bot spawns; lanternwalk carries the 17-key arena
// set (PVP_BUILD_PLAN Part 3.10 i) and probe-emitted spawns live in
// content.json instead of refSpawns.
const NODE_KEY_SETS = {
  meridian_ward: [
    "dock_spawn", "quay_mid", "alley_dogleg_s", "alley_dogleg_n",
    "arcade_ground", "arcade_upper", "plaza_center", "plaza_west",
    "gallery_mid", "blvd_barricade", "blvd_mid", "platform_deck",
    "customs_sandbags", "gate9", "exfil",
  ],
  lanternwalk: [
    "plaza_center", "plaza_west", "plaza_ne", "arcade_ground", "arcade_upper",
    "arcade_lightwell", "alley_mid", "alley_north", "cs1_mid", "street_mouth",
    "corridor_mid", "cut_mouth", "gallery_north", "gallery_mid",
    "gallery_south", "lantern_yard", "exchange_house",
  ],
};
const SEED_NODE = { meridian_ward: "dock_spawn", lanternwalk: "plaza_center" };
const EXPECT_BOT_SPAWNS = { meridian_ward: 44, lanternwalk: 0 };

let failures = 0;
const fail = (msg) => { failures++; console.error(`FAIL  ${msg}`); };
const info = (msg) => console.log(`ok    ${msg}`);

// ---------------------------------------------------------------- build
const C = buildColliders(1);
const L = buildLayout(1);
const MAP = L.mapId || "meridian_ward";
const R24_KEYS = NODE_KEY_SETS[MAP];
console.log(`map: ${MAP}`);

// 1. determinism — same seed twice AND a different seed must produce the
// same data (wave-1 layout is fully authored; seed is cosmetic-reserve only).
{
  const strip = (c) => JSON.stringify({
    boxes: c.boxes, spawns: c.spawns, cover: c.cover,
    nodes: c.nodes, bounds: c.bounds, walkRects: c.walkRects,
    refSpawns: c.refSpawns,
  });
  const a = strip(C);
  const b = strip(buildColliders(1));
  const d = strip(buildColliders(999));
  if (a !== b) fail("determinism: two builds with seed 1 differ");
  else if (a !== d) fail("determinism: seed 999 differs from seed 1 (wave-1 layout must be seed-invariant)");
  else info(`determinism: builds identical (${C.boxes.length} boxes)`);
}

// 2. schema
{
  let bad = 0;
  for (const b of C.boxes) {
    const okBox = Array.isArray(b.min) && Array.isArray(b.max) &&
      b.min.length === 3 && b.max.length === 3 &&
      b.min[0] < b.max[0] && b.min[1] < b.max[1] && b.min[2] < b.max[2];
    if (!okBox) { fail(`schema: degenerate box ${b.id}`); bad++; continue; }
    if (!SURFACES.has(b.surface)) { fail(`schema: box ${b.id} bad surface '${b.surface}'`); bad++; }
    if (!MATCLASSES.has(b.matClass)) { fail(`schema: box ${b.id} bad matClass '${b.matClass}'`); bad++; }
    // lanternwalk's C.bounds is the ARENA AABB; skyline masses and boundary
    // backing legitimately extend beyond it, so the containment envelope is
    // the ward's world extent there (arena.md §5.1: "keep them as
    // out-of-bounds mass for the skyline; either is fine").
    const ENV = MAP === "lanternwalk"
      ? { min: [-60, -2, -60], max: [60, 14, 60] }
      : C.bounds;
    const inB =
      b.min[0] >= ENV.min[0] - EPS && b.max[0] <= ENV.max[0] + EPS &&
      b.min[1] >= ENV.min[1] - EPS && b.max[1] <= ENV.max[1] + EPS &&
      b.min[2] >= ENV.min[2] - EPS && b.max[2] <= ENV.max[2] + EPS;
    if (!inB) { fail(`schema: box ${b.id} outside bounds`); bad++; }
  }
  const ids = new Set(C.boxes.map((b) => b.id));
  if (ids.size !== C.boxes.length) fail("schema: duplicate box ids");
  if (!bad) info(`schema: ${C.boxes.length} boxes well-formed, surfaces/matClass in vocab`);
}

// 3. no overlapping AABBs (strict interpenetration in ALL three axes > EPS)
{
  let overlaps = 0;
  const bs = C.boxes;
  for (let i = 0; i < bs.length; i++) {
    for (let j = i + 1; j < bs.length; j++) {
      const a = bs[i], b = bs[j];
      // compound sub-boxes of ONE prop (collision-layer split) may
      // legitimately interpenetrate each other and their moveOnly hull
      if (a.propId && a.propId === b.propId) continue;
      const ox = Math.min(a.max[0], b.max[0]) - Math.max(a.min[0], b.min[0]);
      if (ox <= EPS) continue;
      const oz = Math.min(a.max[2], b.max[2]) - Math.max(a.min[2], b.min[2]);
      if (oz <= EPS) continue;
      const oy = Math.min(a.max[1], b.max[1]) - Math.max(a.min[1], b.min[1]);
      if (oy <= EPS) continue;
      overlaps++;
      fail(`overlap: ${a.id} × ${b.id} (dx=${ox.toFixed(3)} dy=${oy.toFixed(3)} dz=${oz.toFixed(3)})`);
    }
  }
  if (!overlaps) info(`overlap: 0 interpenetrating pairs among ${bs.length} boxes`);
}

// ------------------------------------------------------- spatial helpers
function insideBoxXZ(x, z, b, eps = 0.01) {
  return x > b.min[0] + eps && x < b.max[0] - eps &&
         z > b.min[2] + eps && z < b.max[2] - eps;
}
function insideBox(x, y, z, b, eps = 0.01) {
  return insideBoxXZ(x, z, b, eps) && y > b.min[1] + eps && y < b.max[1] - eps;
}
// A standing point is blocked if a solid occupies its feet→head band.
function pointBlocked(x, y, z) {
  for (const b of C.boxes) {
    if (b.rayOnly) continue; // ballistic layer — standpoints use move hulls
    if (insideBox(x, y + 0.1, z, b) || insideBox(x, y + 0.9, z, b)) return b;
  }
  return null;
}
function walkable(x, z, y) {
  for (const r of C.walkRects) {
    if (x >= r.min[0] && x <= r.max[0] && z >= r.min[1] && z <= r.max[1] &&
        Math.abs(r.y - y) <= 0.6) return r;
  }
  return null;
}
// Elevated points must stand on something: a box top at their y.
function supported(x, z, y) {
  if (y <= 0.05) return C.groundY(x, z) === 0; // terrain
  for (const b of C.boxes) {
    if (b.rayOnly) continue; // support = movement layer
    if (Math.abs(b.max[1] - y) <= 0.05 &&
        x >= b.min[0] - 0.01 && x <= b.max[0] + 0.01 &&
        z >= b.min[2] - 0.01 && z <= b.max[2] + 0.01) return true;
  }
  return false;
}
function checkStandpoint(label, pos) {
  const [x, y, z] = pos;
  const inB =
    x >= C.bounds.min[0] && x <= C.bounds.max[0] &&
    z >= C.bounds.min[2] && z <= C.bounds.max[2];
  if (!inB) { fail(`${label}: outside bounds (${x},${y},${z})`); return; }
  if (!walkable(x, z, y)) { fail(`${label}: not in any walkable region (${x},${y},${z})`); return; }
  const blk = pointBlocked(x, y, z);
  if (blk) { fail(`${label}: inside solid '${blk.id}' (${x},${y},${z})`); return; }
  if (!supported(x, z, y)) { fail(`${label}: no support under (${x},${y},${z})`); }
}

// 4. R24 nodes
{
  const keys = Object.keys(C.nodes);
  const missing = R24_KEYS.filter((k) => !keys.includes(k));
  const extra = keys.filter((k) => !R24_KEYS.includes(k));
  if (missing.length) fail(`nodes: missing R24 keys: ${missing.join(", ")}`);
  if (extra.length) fail(`nodes: unexpected keys beyond the frozen set: ${extra.join(", ")}`);
  if (new Set(keys).size !== keys.length) fail("nodes: duplicate keys");
  const seen = new Map();
  for (const k of keys) {
    const v = C.nodes[k];
    const sig = v.join(",");
    if (seen.has(sig)) fail(`nodes: ${k} duplicates coordinates of ${seen.get(sig)}`);
    seen.set(sig, k);
    checkStandpoint(`node ${k}`, v);
  }
  if (!failures) info(`nodes: ${keys.length}/${R24_KEYS.length} ${MAP} keys present, unique, walkable, clear, supported`);
}

// 5. LD §6 spawns (ward: player + 44; lanternwalk: player only — the arena's
// spawn set is probe-emitted into content.json by tools/probe_arena.mjs)
{
  const before = failures;
  const names = Object.keys(C.refSpawns);
  const botNames = names.filter((n) => n !== "player");
  if (botNames.length !== EXPECT_BOT_SPAWNS[MAP]) fail(`spawns: expected ${EXPECT_BOT_SPAWNS[MAP]} bot spawns, found ${botNames.length}`);
  checkStandpoint("spawn player", C.refSpawns.player.pos);
  for (const n of botNames) checkStandpoint(`spawn ${n}`, C.refSpawns[n]);
  if (failures === before) info(`spawns: player + ${botNames.length} LD §6 spawns walkable, clear, supported`);
}

// 6. cover nodes
{
  const before = failures;
  for (let i = 0; i < C.cover.length; i++) {
    const c = C.cover[i];
    if (c.height !== "low" && c.height !== "high") fail(`cover[${i}]: bad height '${c.height}'`);
    const len = Math.hypot(c.dir[0], c.dir[1], c.dir[2]);
    if (Math.abs(len - 1) > 0.01) fail(`cover[${i}]: dir not unit (${len.toFixed(3)})`);
    checkStandpoint(`cover[${i}] @(${c.pos[0].toFixed(1)},${c.pos[2].toFixed(1)})`, c.pos);
  }
  if (failures === before) info(`cover: ${C.cover.length} nodes walkable, clear, dirs unit`);
}

// 7. ground-level connectivity — flood-fill from dock_spawn over a 0.5 m
// grid (walkRects at y=0 minus solids); every ground node and ground spawn
// must be reachable (LD §2.7: backtracking never required, no sealed lane).
// A cell is blocked by any solid taller than the 0.35 m step-up budget that
// intrudes below standing head-room.
{
  const before = failures;
  const CELL = 0.5;
  const x0 = C.bounds.min[0], z0 = C.bounds.min[2];
  const nx = Math.round((C.bounds.max[0] - x0) / CELL);
  const nz = Math.round((C.bounds.max[2] - z0) / CELL);
  const walkRects0 = C.walkRects.filter((r) => r.y === 0);
  const blockers = C.boxes.filter((b) => !b.rayOnly && b.max[1] > 0.35 && b.min[1] < 1.75);
  const open = new Uint8Array(nx * nz);
  for (let ix = 0; ix < nx; ix++) {
    const x = x0 + (ix + 0.5) * CELL;
    for (let iz = 0; iz < nz; iz++) {
      const z = z0 + (iz + 0.5) * CELL;
      let inRect = false;
      for (const r of walkRects0) {
        if (x >= r.min[0] && x <= r.max[0] && z >= r.min[1] && z <= r.max[1]) { inRect = true; break; }
      }
      if (!inRect) continue;
      let blocked = false;
      for (const b of blockers) {
        if (x > b.min[0] && x < b.max[0] && z > b.min[2] && z < b.max[2]) { blocked = true; break; }
      }
      if (!blocked) open[ix * nz + iz] = 1;
    }
  }
  const reach = new Uint8Array(nx * nz);
  const cellOf = (x, z) => [Math.floor((x - x0) / CELL), Math.floor((z - z0) / CELL)];
  const seedNode = SEED_NODE[MAP];
  const [sx, sz] = cellOf(C.nodes[seedNode][0], C.nodes[seedNode][2]);
  const q = [[sx, sz]];
  reach[sx * nz + sz] = open[sx * nz + sz];
  if (!reach[sx * nz + sz]) fail(`connectivity: ${seedNode} cell itself is not open`);
  while (q.length) {
    const [ix, iz] = q.pop();
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const jx = ix + dx, jz = iz + dz;
      if (jx < 0 || jz < 0 || jx >= nx || jz >= nz) continue;
      const k = jx * nz + jz;
      if (open[k] && !reach[k]) { reach[k] = 1; q.push([jx, jz]); }
    }
  }
  const reachable = (x, z) => {
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const jx = Math.floor((x - x0) / CELL) + dx;
      const jz = Math.floor((z - z0) / CELL) + dz;
      if (jx >= 0 && jz >= 0 && jx < nx && jz < nz && reach[jx * nz + jz]) return true;
    }
    return false;
  };
  const groundNodes = R24_KEYS.filter((k) => C.nodes[k][1] === 0);
  for (const k of groundNodes) {
    const v = C.nodes[k];
    if (!reachable(v[0], v[2])) fail(`connectivity: node ${k} unreachable from dock_spawn`);
  }
  let groundSpawns = 0;
  for (const n of Object.keys(C.refSpawns)) {
    if (n === "player") continue;
    const v = C.refSpawns[n];
    if (v[1] !== 0) continue;
    groundSpawns++;
    if (!reachable(v[0], v[2])) fail(`connectivity: spawn ${n} unreachable from dock_spawn`);
  }
  if (failures === before) {
    info(`connectivity: ${groundNodes.length} ground nodes + ${groundSpawns} ground spawns reachable (${reach.reduce((a, b) => a + b, 0)} cells)`);
  }
}

// 8. LD §4.1 visual ground-contact gate (WAVE 2) — placements are the exact
// data props.js renders (single source). Rules, verbatim from level_design:
//   - every prop Y from a ground raycast, sunk 1.5 cm;
//   - per-corner: gap > 0 mm OR penetration > 3 cm = FAIL;
//   - base decal MANDATORY on every prop with footprint > 0.3 m²
//     (wall mounts carry a rust/drip streak; ceiling mounts have no ground
//     contact and are exempt);
//   - wall/ceiling mounts must be flagged (no accidental floaters).
{
  const before = failures;
  const P = computePlacements(L);
  if (P.length !== L.props.length) {
    fail(`placements: ${P.length} placements for ${L.props.length} props`);
  }
  // determinism of the placement layer itself
  {
    const a = JSON.stringify(P);
    const b = JSON.stringify(computePlacements(buildLayout(999)));
    if (a !== b) fail("placements: not seed-invariant");
  }
  let ground = 0, wall = 0, ceiling = 0, decals = 0;
  for (const p of P) {
    if (p.mount === "ground") {
      ground++;
      // corner contact: bottom sits 1.5 cm into the MAX support; every
      // corner must neither float (>0 mm) nor clip (>3 cm)
      for (let i = 0; i < 4; i++) {
        const gap = p.pos[1] - p.supports[i];
        if (gap > 1e-4) {
          fail(`contact: ${p.id} corner ${i} FLOATS ${(gap * 1000).toFixed(1)} mm above support`);
        } else if (gap < -0.03 - 1e-4) {
          fail(`contact: ${p.id} corner ${i} CLIPS ${(-gap * 1000).toFixed(1)} mm into support (max 30)`);
        }
      }
      // corners must not sit inside a DIFFERENT solid (interpenetration)
      for (const [cx, cz] of p.corners) {
        for (const b of C.boxes) {
          if (b.id === p.id || b.propId === p.id) continue;
          if (insideBox(cx, p.pos[1] + 0.06, cz, b)) {
            fail(`contact: ${p.id} corner inside solid '${b.id}'`);
            break;
          }
        }
      }
      if (Math.abs(p.sink - 0.015) > 1e-9) fail(`contact: ${p.id} sink != 1.5 cm`);
    } else if (p.mount === "wall") {
      wall++;
      if (!p.flags || !p.flags.wallMount || !p.flags.n) {
        fail(`mount: ${p.id} wall mount without wallMount flag / face normal`);
      }
    } else {
      ceiling++;
      if (p.kind !== "ceiling_fan") fail(`mount: ${p.id} unexpected ceiling mount`);
    }
    // mandatory base decals (footprint > 0.3 m²; ceiling exempt)
    if (p.area > 0.3 && p.mount !== "ceiling") {
      if (!p.baseDecal) fail(`decal: ${p.id} footprint ${p.area.toFixed(2)} m² has NO base decal`);
      else decals++;
    }
  }
  if (failures === before) {
    info(`contact: ${ground} ground props seated (1.5 cm sink, 0 floats, 0 clips), ` +
      `${wall} wall-mounted, ${ceiling} ceiling; ${decals} mandatory base decals present`);
  }
}

// 9. groundY sanity
{
  if (C.groundY(0, 0) !== 0) fail("groundY: base is not 0");
  if (C.groundY(0, 55) !== -1.5) fail("groundY: canal height wrong");
  if (typeof C.spawns.playerYaw !== "number") fail("spawns: playerYaw missing");
  info(`groundY/spawns: base 0, canal −1.5, playerYaw ${C.spawns.playerYaw.toFixed(3)}`);
}

// 10. ray-vs-silhouette gate (owner report 2026-08: campaign truck collided
// as a full rectangular prism). For every compound prop kind in this map,
// sample rays through the KNOWN see-through gaps of the visual silhouette —
// they must MISS every ray-visible sub-box — and rays at solid metal — they
// must HIT. Coordinates are fractions of the footprint (x,z ∈ [−0.5,0.5]
// scaled by size, y ∈ [0,1] scaled by height), tested in the prop's LOCAL
// frame against propSubBoxes(kind, size), so the gate covers every instance
// of the kind at that footprint regardless of yaw. Every compound prop must
// ALSO keep its moveOnly hull in the world collider set (movement/nav
// byte-identical to the pre-compound set — the layer split, colliders.js).
{
  const before = failures;
  // rays: [fromFrac, toFrac] segments; from/to sit outside the footprint
  const GATES = {
    truck: {
      gaps: [
        ["under-bed", [-0.8, 0.307, -0.07], [0.8, 0.307, -0.07]],
        ["over-cab", [-0.8, 0.95, 0.33], [0.8, 0.95, 0.33]],
        ["over-hood", [-0.8, 0.65, 0.45], [0.8, 0.65, 0.45]],
      ],
      solids: [
        ["cargo", [-0.8, 0.6, -0.2], [0.8, 0.6, -0.2]],
        ["cab", [-0.8, 0.5, 0.28], [0.8, 0.5, 0.28]],
        ["axle", [-0.8, 0.05, 0.35], [0.8, 0.05, 0.35]],
      ],
    },
    car: {
      gaps: [
        ["over-trunk", [-0.8, 0.78, -0.46], [0.8, 0.78, -0.46]],
        ["over-hood", [-0.8, 0.78, 0.40], [0.8, 0.78, 0.40]],
      ],
      solids: [
        ["body", [-0.8, 0.3, 0], [0.8, 0.3, 0]],
        ["cabin", [-0.8, 0.85, -0.1], [0.8, 0.85, -0.1]],
      ],
    },
    van: {
      gaps: [
        ["over-hood", [-0.8, 0.62, 0.46], [0.8, 0.62, 0.46]],
        ["over-screen", [-0.8, 0.95, 0.33], [0.8, 0.95, 0.33]],
      ],
      solids: [
        ["body", [-0.8, 0.5, -0.1], [0.8, 0.5, -0.1]],
        ["hood", [-0.8, 0.3, 0.46], [0.8, 0.3, 0.46]],
      ],
    },
    kiosk: {
      gaps: [["over-counter", [-0.8, 0.76, -0.2], [0.8, 0.76, -0.2]]],
      solids: [
        ["body", [-0.8, 0.3, 0], [0.8, 0.3, 0]],
        ["awning", [0, 1.3, 0.2], [0, 0.75, 0.2]],
      ],
    },
    flood_tower: {
      gaps: [["lattice-mid", [-0.8, 0.5, 0], [0.8, 0.5, 0]]],
      solids: [
        ["legs", [-0.8, 0.5, 0.36], [0.8, 0.5, 0.36]],
        ["head", [0, 1.2, 0], [0, 0.9, 0]],
      ],
    },
    scaffold: {
      gaps: [["bay", [0.15, 0.62, -0.8], [0.15, 0.62, 0.8]]],
      solids: [
        ["deck", [0, 1.1, 0], [0, 0.8, 0]],
        ["pole", [0.417, 0.5, -0.8], [0.417, 0.5, 0.8]],
      ],
    },
    fence: {
      gaps: [["mesh", [0.08, 0.5, -0.8], [0.08, 0.5, 0.8]]],
      solids: [["rail", [0.08, 0.99, -0.8], [0.08, 0.99, 0.8]]],
    },
    transformer_pole: {
      gaps: [["beside-pole", [0.46, 0.35, -0.8], [0.46, 0.35, 0.8]]],
      solids: [
        ["pole", [0, 0.35, -0.8], [0, 0.35, 0.8]],
        ["head", [0.46, 0.85, -0.8], [0.46, 0.85, 0.8]],
      ],
    },
    route_board: {
      gaps: [
        ["under-board", [0, 0.2, -0.8], [0, 0.2, 0.8]],
        ["over-board", [0, 0.975, -0.8], [0, 0.975, 0.8]],
      ],
      solids: [["board", [0, 0.7, -0.8], [0, 0.7, 0.8]]],
    },
    newsbox: {
      gaps: [["under-cabinet", [-0.8, 0.11, 0], [0.8, 0.11, 0]]],
      solids: [
        ["cabinet", [-0.8, 0.6, 0], [0.8, 0.6, 0]],
        ["legs", [-0.8, 0.1, 0.40], [0.8, 0.1, 0.40]],
      ],
    },
    tram_shelter: {
      gaps: [["open-side", [0.9, 0.5, 0.2], [0.05, 0.5, 0.2]]],
      solids: [
        ["roof", [0, 1.2, 0], [0, 0.85, 0]],
        ["posts", [-0.8, 0.5, 0.42], [0.8, 0.5, 0.42]],
      ],
    },
  };
  const segHits = (a, b, subBoxes) => {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const len = Math.hypot(...d);
    const dn = d.map((v) => v / len);
    for (const sb of subBoxes) {
      const h = rayBox(a, dn, sb);
      if (h && h.tOut > 0 && h.tIn < len) return sb.tag;
    }
    return null;
  };
  const seen = new Set();
  let kindsGated = 0, raysRun = 0;
  for (const p of L.props) {
    if (!p.solid || !GATES[p.kind]) continue;
    const key = `${p.kind}|${p.size.join(",")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kindsGated++;
    const [w, h, l] = [p.size[0], p.size[1], p.size[2]];
    const subs = propSubBoxes(p.kind, p.size);
    if (!subs) { fail(`silhouette: ${p.kind} has a gate but no compound sub-boxes`); continue; }
    const toM = (f) => [f[0] * w, f[1] * h, f[2] * l];
    for (const [name, a, b] of GATES[p.kind].gaps) {
      raysRun++;
      const hit = segHits(toM(a), toM(b), subs);
      if (hit) fail(`silhouette: ${key} gap ray '${name}' HIT sub-box '${hit}' (must pass through visible air)`);
    }
    for (const [name, a, b] of GATES[p.kind].solids) {
      raysRun++;
      if (!segHits(toM(a), toM(b), subs)) {
        fail(`silhouette: ${key} solid ray '${name}' MISSED (must hit visible metal)`);
      }
    }
    // layer split: every compound prop keeps its movement hull
    const hull = C.boxes.find((bx) => bx.propId === p.id && bx.moveOnly);
    if (!hull) fail(`silhouette: ${p.id} (${p.kind}) missing moveOnly movement hull`);
  }
  if (failures === before) {
    info(`silhouette: ${kindsGated} compound kind/footprint combos gated, ${raysRun} rays (gaps pass, metal hits, move hulls present)`);
  }
}

// summary
{
  const solids = L.props.filter((p) => p.solid).length;
  console.log(`----`);
  console.log(`boxes=${C.boxes.length} (buildings=${L.buildings.filter(b => b.box).length}, walls/slabs/steps=${L.walls.length}, solid props=${solids})`);
  console.log(`cover=${C.cover.length} nodes=${Object.keys(C.nodes).length} spawns=${Object.keys(C.refSpawns).length - 1}+player walkRects=${C.walkRects.length} lightPoles=${L.lightPoles.length} (real=${L.lightPoles.filter(l => l.real).length})`);
}

if (failures) {
  console.error(`----\nprobe_props: ${failures} FAILURE(S)`);
  process.exit(1);
} else {
  console.log(`----\nprobe_props: PASS`);
  process.exit(0);
}
