// core/level/colliders.js [A3 — wave-1 deliverable]
// THREE-free collider/spawn/cover/nav-seed export (architecture §3.12).
// Built ENTIRELY from layout.js — the single source — so visuals (level.js,
// wave 2) and collision can never drift.
//
// Frozen return shape (architecture §3.12 as amended by BUILD_PLAN):
//   boxes:   [{min:[3], max:[3], surface, matClass, ...}]
//            surface ∈ 'concrete'|'metal'|'dirt'|'wood'|'glass' (fx/audio
//            vocabulary, architecture §3.14); matClass ∈ 'soft'|'metal_thin'|
//            'hard' (penetration classes, combat_spec §3.2).
//   groundY: (x,z) => y   — TERRAIN height only (base 0; canal −1.5).
//            Elevated walk surfaces (tram deck, arcade balcony slabs, every
//            staircase step) are SOLID BOXES; world.sphereGround (A1) resolves
//            standing height as terrain ∨ box tops (architecture §3.6).
//   spawns:  { player:[3], playerYaw }
//   cover:   [{pos:[3], dir:[3], height:'low'|'high'}]  (combat_spec §5.8 —
//            pos = the crouch position, dir points THROUGH the cover toward
//            the threat it blocks)
//   nodes:   R24 frozen key set (15 keys) — the ONLY keys content.json may
//            reference; contract-gated at load.
//   bounds:  {min:[3], max:[3]}
//
// Private extras (allowed additions): walkRects, refSpawns, zones — probe +
// nav-seeding data. Runtime gameplay reads only the frozen fields.

import { buildLayout, buildLayoutFor } from "./layout.js";

// W4 (PVP map split, PVP_BUILD_PLAN C17): explicit-map variant for probes and
// the match path. buildColliders(seed) keeps its frozen signature and builds
// the ACTIVE map (campaign default: meridian_ward — Amendment A1).
export function buildCollidersFor(mapId, seed = 1) {
  return collidersFromLayout(buildLayoutFor(mapId, seed));
}

export function buildColliders(seed = 1) {
  return collidersFromLayout(buildLayout(seed));
}

function collidersFromLayout(L) {

  const boxes = [];
  for (const b of L.buildings) {
    if (!b.box) continue; // shell buildings (arcade) contribute wall pieces
    boxes.push({
      min: b.box.min, max: b.box.max,
      surface: b.surface, matClass: b.matClass,
      kind: b.kind, id: b.id,
    });
  }
  for (const w of L.walls) {
    boxes.push({
      min: w.min, max: w.max,
      surface: w.surface, matClass: w.matClass,
      kind: w.kind, id: w.id,
    });
  }
  for (const p of L.props) {
    if (!p.solid || !p.aabb) continue;
    boxes.push({
      min: p.aabb.min, max: p.aabb.max,
      surface: p.surface, matClass: p.matClass,
      kind: p.kind, id: p.id,
      flags: p.flags || undefined,
    });
  }

  const cover = [];
  for (const p of L.props) {
    if (p.cover) cover.push(p.cover);
  }

  const canal = L.terrain.canal;
  const groundY = (x, z) => (z >= canal.zMin ? canal.y : L.terrain.base);

  return {
    boxes,
    groundY,
    spawns: {
      player: L.refSpawns.player.pos.slice(),
      playerYaw: L.refSpawns.player.yaw,
    },
    cover,
    nodes: L.nodes,
    bounds: L.bounds,
    // private extras (probes, nav seeding, contract gate):
    walkRects: L.walkRects,
    refSpawns: L.refSpawns,
    zones: L.zones,
  };
}
