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
//
// COLLISION LAYERS (owner report 2026-08: "bullets hit the space around the
// truck as if it's a full rectangular prism"). Props whose visual silhouette
// is not a box now emit a COMPOUND of sub-AABBs matching the visible shape
// (see PROP_SUB_BOXES): bullets/LOS pass where you can see through, hit where
// there is metal. Two additive box fields implement the split:
//   propId:   parent prop id on every compound box (sub-boxes of one prop
//             may legitimately interpenetrate each other — probe exempts them)
//   moveOnly: true ⇒ blocks MOVEMENT/nav only; world.raycast and
//             world.losBlocked skip it. Every compound prop keeps its
//             ORIGINAL coarse AABB as a moveOnly hull, so moveCapsule,
//             sphereGround, bakeNav and every spawn/standpoint check behave
//             byte-identically to the pre-compound collider set (and the nav
//             bake sees the same box count — its 150 ms budget was measured
//             against it).
//   rayOnly:  true ⇒ visible to bullets/LOS only; movement queries
//             (capsuleBlocked/supportAt/sphereGround) and bakeNav skip it.
//             All compound sub-boxes carry it, and each is contained inside
//             its prop's hull.
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

// ------------------------------------------------- compound prop colliders
// Local frame: x across the footprint width (size[0]), y up from the prop
// base (size[1] tall), z along the footprint length (size[2]); +z is the
// prop's visual FRONT (vehicles.js protos are authored front = +z and the
// vehicle kinds never trigger props.js's proportion-swap, since layout
// footprints and protos are both long-in-z). Every non-vehicle compound here
// is deliberately SYMMETRIC in x/z so the renderer's proportion-swap fit
// (props.js) can never orient a visual asymmetry away from its collider.
// All sub-boxes stay inside the original prop AABB.
//
// Numbers trace to the visual builders (vehicles.js buildTruck/buildCar/
// buildVan proto dimensions normalized by their layout footprints; props.js
// buildKind for kiosk/flood_tower/scaffold/fence/transformer_pole/
// route_board/newsbox/tram_shelter).
const box3 = (tag, x0, x1, y0, y1, z0, z1) =>
  ({ tag, min: [x0, y0, z0], max: [x1, y1, z1] });

const PROP_SUB_BOXES = {
  // Lorry: cab + hood + enclosed cargo box riding ABOVE the chassis, wheels
  // and rails visible below — the see-through band under the bed and the air
  // over the cab/hood are the exact spaces the owner shot into.
  truck(w, h, l) {
    const hw = w / 2;
    return [
      box3("cargo", -hw, hw, 0.33 * h, h, -0.493 * l, 0.157 * l),
      box3("cab", -hw, hw, 0.15 * h, 0.90 * h, 0.157 * l, 0.40 * l),
      box3("hood", -hw, hw, 0.15 * h, 0.59 * h, 0.40 * l, 0.5 * l),
      box3("chassis", -0.29 * w, 0.29 * w, 0.20 * h, 0.28 * h, -0.457 * l, 0.171 * l),
      box3("axle_f", -0.46 * w, 0.46 * w, 0, 0.34 * h, 0.279 * l, 0.421 * l),
      box3("axle_m", -0.46 * w, 0.46 * w, 0, 0.34 * h, -0.266 * l, -0.121 * l),
      box3("axle_r", -0.46 * w, 0.46 * w, 0, 0.34 * h, -0.436 * l, -0.291 * l),
    ];
  },
  // Sedan/estate: full-footprint lower body to the beltline, narrower
  // greenhouse over the cabin only — shots skim over hood and trunk.
  car(w, h, l) {
    const hw = w / 2;
    return [
      box3("body", -hw, hw, 0, 0.66 * h, -l / 2, l / 2),
      box3("cabin", -0.478 * w, 0.478 * w, 0.66 * h, h, -0.40 * l, 0.223 * l),
    ];
  },
  // Panel van: full-height box body, raked windscreen, low hood nose.
  van(w, h, l) {
    const hw = w / 2;
    return [
      box3("body", -hw, hw, 0, h, -l / 2, 0.23 * l),
      box3("cabin", -hw, hw, 0, 0.88 * h, 0.23 * l, 0.41 * l),
      box3("hood", -hw, hw, 0, 0.47 * h, 0.41 * l, l / 2),
    ];
  },
  // Kiosk: counter body + four corner posts + awning slab. The air over the
  // counter (between posts, under the awning) is open on every side.
  kiosk(w, h, l) {
    const out = [
      box3("body", -0.46 * w, 0.46 * w, 0, 0.67 * h, -0.46 * l, 0.46 * l),
      box3("awning", -w / 2, w / 2, 0.86 * h, h, -l / 2, l / 2),
    ];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      out.push(box3(`post${sx > 0 ? "e" : "w"}${sz > 0 ? "s" : "n"}`,
        sx * 0.44 * w - 0.04, sx * 0.44 * w + 0.04, 0, h,
        sz * 0.44 * l - 0.04, sz * 0.44 * l + 0.04));
    }
    return out;
  },
  // Floodlight lattice tower: four legs + head platform; the lattice is air.
  flood_tower(w, h, l) {
    const out = [box3("head", -w / 2, w / 2, 0.985 * h, h, -l / 2, l / 2)];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      out.push(box3(`leg${sx > 0 ? "e" : "w"}${sz > 0 ? "s" : "n"}`,
        sx * 0.36 * w - 0.06 * w, sx * 0.36 * w + 0.06 * w, 0, h,
        sz * 0.36 * l - 0.06 * l, sz * 0.36 * l + 0.06 * l));
    }
    return out;
  },
  // Scaffold: four standards + one plank deck per level. The tarp is cloth —
  // bullets pass through it (no collider), and the bays are open.
  scaffold(w, h, l) {
    const out = [];
    const px = w / 2 - 0.05, pz = l / 2 - 0.05;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      out.push(box3(`pole${sx > 0 ? "e" : "w"}${sz > 0 ? "s" : "n"}`,
        sx * px - 0.045, sx * px + 0.045, 0, h, sz * pz - 0.045, sz * pz + 0.045));
    }
    const levels = Math.max(2, Math.round(h / 2));
    for (let lv = 1; lv <= levels; lv++) {
      const y = (h / levels) * lv - 0.05;
      out.push(box3(`deck${lv}`, -w / 2, w / 2, y - 0.025, y + 0.025, -l / 2, l / 2));
    }
    return out;
  },
  // Chain-link gate/fence: posts + top rail stop bullets; the mesh does not
  // (and bots can see through it, matching its 42% visual opacity).
  fence(w, h, l) {
    const out = [box3("rail", -w / 2, w / 2, h - 0.04, h, -l / 2, l / 2)];
    const posts = Math.max(2, Math.round(w / 2));
    for (let i = 0; i <= posts; i++) {
      const x = -w / 2 + (w / posts) * i;
      out.push(box3(`post${i}`, Math.max(-w / 2, x - 0.04), Math.min(w / 2, x + 0.04),
        0, h, -l / 2, l / 2));
    }
    return out;
  },
  // Utility pole: a slim trunk plus the transformer/crossarm head — the old
  // 0.45 m prism caught shots a hand-width from the wood.
  transformer_pole(w, h, l) {
    const rx = Math.min(0.18, w / 2), rz = Math.min(0.18, l / 2);
    return [
      box3("pole", -rx, rx, 0, h, -rz, rz),
      box3("head", -w / 2, w / 2, 0.72 * h, h, -l / 2, l / 2),
    ];
  },
  // Route board: two posts + the board panel; open above and below the board.
  route_board(w, h, l) {
    const out = [box3("board", -w / 2, w / 2, 0.45 * h, 0.95 * h, -l / 2, l / 2)];
    for (const sx of [-1, 1]) {
      out.push(box3(`post${sx > 0 ? "e" : "w"}`,
        sx * 0.35 * w - 0.045, sx * 0.35 * w + 0.045, 0, h, -l / 2, l / 2));
    }
    return out;
  },
  // Newspaper vending box: cabinet on four legs — daylight under the cabinet.
  newsbox(w, h, l) {
    const out = [box3("cabinet", -w / 2, w / 2, 0.24 * h, h, -l / 2, l / 2)];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      out.push(box3(`leg${sx > 0 ? "e" : "w"}${sz > 0 ? "s" : "n"}`,
        sx * 0.40 * w - 0.06 * w, sx * 0.40 * w + 0.06 * w, 0, 0.24 * h,
        sz * 0.40 * l - 0.06 * l, sz * 0.40 * l + 0.06 * l));
    }
    return out;
  },
  // Tram shelter: roof + corner posts. The glass panes stay out of the ray
  // set (glass, soft-class — shots pass into the shelter interior); the
  // coarse move-box below keeps the interior non-walkable as before.
  tram_shelter(w, h, l) {
    const out = [box3("roof", -w / 2, w / 2, 0.92 * h, h, -l / 2, l / 2)];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      out.push(box3(`post${sx > 0 ? "e" : "w"}${sz > 0 ? "s" : "n"}`,
        sx * 0.42 * w - 0.035, sx * 0.42 * w + 0.035, 0, 0.92 * h,
        sz * 0.42 * l - 0.035, sz * 0.42 * l + 0.035));
    }
    return out;
  },
};

// Local metre sub-boxes for a prop kind at a given footprint, or null when
// the kind's visual IS its AABB (crates, dumpsters, barriers, sandbag
// stacks, containers, huts …). Exported for tools/probe_props.mjs's
// ray-vs-silhouette gate.
export function propSubBoxes(kind, size) {
  const gen = PROP_SUB_BOXES[kind];
  return gen ? gen(size[0], size[1], size[2]) : null;
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
    const subs = propSubBoxes(p.kind, p.size);
    if (!subs) {
      boxes.push({
        min: p.aabb.min, max: p.aabb.max,
        surface: p.surface, matClass: p.matClass,
        kind: p.kind, id: p.id,
        flags: p.flags || undefined,
      });
      continue;
    }
    // Rotation about Y by p.rot (matches props.js's setFromAxisAngle(up,rot):
    // local (x,z) → world (x·cos + z·sin, −x·sin + z·cos)); each rotated
    // sub-box is emitted as its conservative world AABB, exactly the
    // expansion prop() applies to the whole footprint.
    const c = Math.cos(p.rot), s = Math.sin(p.rot);
    const ac = Math.abs(c), as = Math.abs(s);
    const y0 = p.pos[1];
    for (const sb of subs) {
      const cx = (sb.min[0] + sb.max[0]) / 2, cz = (sb.min[2] + sb.max[2]) / 2;
      const bx = (sb.max[0] - sb.min[0]) / 2, bz = (sb.max[2] - sb.min[2]) / 2;
      const wx = p.pos[0] + cx * c + cz * s;
      const wz = p.pos[2] - cx * s + cz * c;
      const hx = ac * bx + as * bz, hz = as * bx + ac * bz;
      boxes.push({
        min: [wx - hx, y0 + sb.min[1], wz - hz],
        max: [wx + hx, y0 + sb.max[1], wz + hz],
        surface: p.surface, matClass: p.matClass,
        kind: p.kind, id: `${p.id}~${sb.tag}`, propId: p.id, rayOnly: true,
        flags: p.flags || undefined,
      });
    }
    // movement hull: the original coarse AABB, invisible to bullets/LOS
    boxes.push({
      min: p.aabb.min, max: p.aabb.max,
      surface: p.surface, matClass: p.matClass,
      kind: p.kind, id: `${p.id}~move`, propId: p.id, moveOnly: true,
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
