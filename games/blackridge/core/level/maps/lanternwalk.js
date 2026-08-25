// core/level/maps/lanternwalk.js [W4 — the PVP arena carve]
// LANTERNWALK — carved from Meridian Ward per _design/pvp/arena.md Part 1
// (edits E1–E19 minus the lighting-profile render half, which is W11) as
// adjudicated by _design/pvp/PVP_BUILD_PLAN.md (C3–C7b, C17–C18, C23–C24).
//
// This module is a TRANSFORM of the preserved campaign map: it builds
// meridian_ward's layout, then applies the carve — excavation voids (boolean
// subtraction, the same operation _design/pvp/arena_probe.mjs measured),
// boundary walls B1–B5, the loop patch L1–L4, the arcade partitions, the two
// mirrored base rooms, and the prop re-cover. Deriving the arena from the
// ward keeps the shipped geometry auditable as a diff against the spec's
// measured numbers (arena.md Part 5.1).
//
// Carved buildings (bld_nea, bld_neb, bld_m1) lose their facade-massing
// entries and return as kind:"wall" concrete pieces — level.js renders walls
// generically by kind (arena.md A7), so the carve needs zero level.js edits.
// All other buildings are KEPT (skyline mass beyond the boundary; the nav
// flood-fill never reaches them).
//
// Coordinate convention unchanged: +X east, +Z south, Y up, metres.
// Arena bounds: X ∈ [−48.5, +24.5], Z ∈ [−34.5, +14.6].

import { buildLayout as buildWard } from "./meridian_ward.js";

const BOUNDS = { min: [-48.5, -2, -34.5], max: [24.5, 14, 14.6] };

// ---------------------------------------------------------------- helpers
function wbox(id, kind, x0, x1, y0, y1, z0, z1, surface = "concrete", matClass = "hard") {
  return {
    id, kind,
    min: [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)],
    max: [Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)],
    surface, matClass,
  };
}

// Same prop constructor as meridian_ward.js (duplicated because the ward
// module exports no helpers and must stay byte-identical — O2).
function prop(id, kind, x, z, rot, sx, sz, h, surface, matClass, opts = {}) {
  const y0 = opts.y0 || 0;
  const c = Math.abs(Math.cos(rot));
  const s = Math.abs(Math.sin(rot));
  const hx = (c * sx + s * sz) / 2;
  const hz = (s * sx + c * sz) / 2;
  const solid = opts.solid !== false;
  const aabb = solid
    ? { min: [x - hx, y0, z - hz], max: [x + hx, y0 + h, z + hz] }
    : null;
  let cover = null;
  if (opts.cover) {
    const d = opts.cover.dir;
    cover = {
      pos: [x - d[0] * (hx + 0.55), y0, z - d[2] * (hz + 0.55)],
      dir: [d[0], 0, d[2]],
      height: opts.cover.height,
    };
  }
  return {
    id, kind, pos: [x, y0, z], rot, size: [sx, h, sz],
    surface, matClass, solid, aabb, cover, flags: opts.flags || null,
  };
}

function steps(list, idp, x0, x1, zFrom, zTo, n, riser, yBase = 0) {
  const tread = (zTo - zFrom) / n;
  for (let i = 0; i < n; i++) {
    const za = zFrom + tread * i;
    const zb = zFrom + tread * (i + 1);
    list.push(wbox(`${idp}_${i}`, "step", x0, x1, 0, yBase + riser * (i + 1), za, zb, "concrete", "hard"));
  }
}

// Axis-aligned boolean subtraction: box minus cut → up to 6 pieces.
function subtract(box, cut) {
  const [ax0, ay0, az0] = box.min, [ax1, ay1, az1] = box.max;
  const [bx0, by0, bz0] = cut.min, [bx1, by1, bz1] = cut.max;
  if (bx1 <= ax0 || bx0 >= ax1 || by1 <= ay0 || by0 >= ay1 || bz1 <= az0 || bz0 >= az1) return [box];
  const out = [];
  const mk = (x0, x1, y0, y1, z0, z1) => {
    if (x1 - x0 > 1e-6 && y1 - y0 > 1e-6 && z1 - z0 > 1e-6) {
      out.push(Object.assign({}, box, { id: `${box.id}~${out.length}`, min: [x0, y0, z0], max: [x1, y1, z1] }));
    }
  };
  const cx0 = Math.max(ax0, bx0), cx1 = Math.min(ax1, bx1);
  const cy0 = Math.max(ay0, by0), cy1 = Math.min(ay1, by1);
  const cz0 = Math.max(az0, bz0), cz1 = Math.min(az1, bz1);
  mk(ax0, cx0, ay0, ay1, az0, az1);
  mk(cx1, ax1, ay0, ay1, az0, az1);
  mk(cx0, cx1, ay0, ay1, az0, cz0);
  mk(cx0, cx1, ay0, ay1, cz1, az1);
  mk(cx0, cx1, ay0, cy0, cz0, cz1);
  mk(cx0, cx1, cy1, ay1, cz0, cz1);
  return out;
}

const V = (x0, x1, y0, y1, z0, z1) => ({ min: [x0, y0, z0], max: [x1, y1, z1] });

// ------------------------------------------------- the carve, as data
// Excavation voids (arena.md §1.2, §1.5 — probe-measured exactly this list)
const CUTS = [
  V(0, 13, 0, 3.4, -25, -20),        // L1 north service corridor
  V(2, 5, 0, 2.4, -20, -18),         // L1 corridor south door (west)
  V(9, 12, 0, 2.4, -20, -18),        // L1 corridor south door (east)
  V(1, 12, 0, 3.4, -34, -26),        // Exchange House room
  V(3, 7, 0, 2.4, -26, -25),         // ExH D1 → corridor
  V(0, 1, 0, 2.4, -33, -29),         // ExH D2 → market street
  V(12, 17, 0, 2.6, -31, -27),       // ExH D3 tunnel → gallery north
  V(-39, -28, 0, 3.4, 8, 16),        // Lantern Yard room
  V(-28, -25, 0, 2.4, 11, 15),       // LY D1 → plaza
  V(-34, -30, 0, 2.4, 5, 8),         // LY D2 → arcade (splits arc_n)
  V(-41, -39, 0, 2.4, 9, 13),        // LY D3 → alley
  V(15.5, 17, 0, 2.4, -6, -2),       // L2 mid-gallery door (splits gal_w_2)
  V(-41, -39, 0, 2.4, -17, -13),     // L3 alley ⇄ arcade north door
  V(-41, -39, 4.2, 6.4, -12, -9.3),  // L4 upper door onto arc_slab_wa
];

// Buildings the carve excavates — their masses return as wall pieces.
const CARVED_BUILDINGS = new Set(["bld_nea", "bld_neb", "bld_m1"]);

// Walls deleted outright (outside the arena / superseded — arena.md §5.1)
const WALL_DROP_PREFIX = ["per_", "plat_", "hdr_ge_"];
const WALL_DROP = new Set(["canal_edge", "wall_ce_parapet"]);

// Props deleted explicitly (E16 in-arena entries; out-of-arena props are
// auto-dropped by the bounds filter below)
const PROP_DROP = new Set([
  "arc_stall_2", "arc_stall_5", "pl_car_5", "al_scaf_2", "arc_table",
  "ms_barrier_1", "ms_barrier_2",
  "ms_car_1",   // overlapped the new n_kiosk artery blocker (probe_props clip)
  "al_dump_5",  // its crouch node landed inside the new a_container_1
  "al_trash_6", // its footprint landed inside the new a_pallets
]);
// Prop moves (E17 + carve de-clip: probe_props gates zero overlaps)
const PROP_MOVE = {
  pl_car_6: [0, 0, -4.5],   // clear of B2 AND of the R1 stall's footprint
  al_dump_6: [2, 0, 0],
  arc_kiosk: [-1.8, 0, 0],  // clear of arc_part_2
  arc_stall_6: [0.9, 0, 0], // clear of arc_part_2
  ms_car_2: [-1, 0, 2.5],   // clear of n_kiosk (and of the sp_m4 bubble)
};

// ---------------------------------------------------------------- export
export function buildLayout(seed = 1) {
  const ward = buildWard(seed);

  // ---- walls: drop the out-of-arena sets, then carve the doors ----------
  let walls = ward.walls.filter((w) =>
    !WALL_DROP.has(w.id) && !WALL_DROP_PREFIX.some((p) => w.id.startsWith(p)));

  // ---- carved buildings become wall boxes; the rest stay buildings ------
  const buildings = [];
  for (const b of ward.buildings) {
    if (CARVED_BUILDINGS.has(b.id) && b.box) {
      walls.push(wbox(b.id, "wall",
        b.box.min[0], b.box.max[0], b.box.min[1], b.box.max[1],
        b.box.min[2], b.box.max[2], b.surface, b.matClass));
    } else {
      buildings.push(b);
    }
  }

  // ---- boolean carve --------------------------------------------------
  for (const cut of CUTS) {
    const next = [];
    for (const w of walls) next.push(...subtract(w, cut));
    walls = next;
  }

  // ---- additions: boundary B1–B5, partitions, piers, stair --------------
  // (E2, E8, L1 piers, L4 — arena.md §1.1–1.3)
  walls.push(
    wbox("pvp_bnd_alley_w", "wall", -48.5, -48, 0, 7, -30, 14),      // B1 container stack line
    wbox("pvp_bnd_plaza_s", "wall", -25, 15, 0, 6, 14, 14.6),        // B2 market hoarding
    wbox("pvp_bnd_street_n", "wall", -12.5, 0, 0, 6, -30.6, -30),    // B3 customs barricade
    // B4/B5 fill the door voids BELOW the existing GE headers (hdr_gal_e_cut
    // y≥2.6, hdr_gal_e_door y≥2.4) — full-height boxes would double the mass.
    wbox("pvp_bnd_cut_e", "wall", 23, 24.5, 0, 2.6, -22, -18),       // B4 collapsed tram gantry
    wbox("pvp_bnd_galdoor_e", "wall", 23, 24.5, 0, 2.4, -32, -28),   // B5 welded fire door
    // B3b — north cap of the market-street pocket (the strip behind the B3
    // barricade stays playable as ExH D2's back approach; its far end must be
    // geometry, not the arena AABB — no invisible walls, G-H)
    wbox("pvp_bnd_street_n2", "wall", -12.5, 0, 0, 6, -34.5, -34),
    wbox("arc_part_1", "wall", -33.5, -32.5, 0, 3.6, -19, -12),      // arcade shop-unit partitions
    wbox("arc_part_2", "wall", -31.5, -30.5, 0, 3.6, -1.5, 5),
    wbox("arc_part_3", "wall", -36.5, -35.5, 0, 3.6, -9, -4),
    wbox("arc_part_4", "wall", -30, -29, 0, 3.6, -16.5, -13.6),
    wbox("corr_pier_a", "wall", 5, 6.5, 0, 3.4, -25, -22),           // L1 structural piers (S-bend)
    wbox("corr_pier_b", "wall", 8, 9.5, 0, 3.4, -23, -20),
  );
  // L4 alley scaffold stair — identical cadence to arc_stair_nw (landing +
  // 13 × 0.30 m risers, yBase 0.3); tops out at 4.2 = the upper door sill.
  steps(walls, "alley_stair_L", -42.6, -41, -13.2, -12.2, 1, 0.3);
  steps(walls, "alley_stair", -42.6, -41, -12.2, -9.1, 13, 0.3, 0.3);

  // ---- props ------------------------------------------------------------
  const inArena = (p) =>
    p.pos[0] >= BOUNDS.min[0] && p.pos[0] <= BOUNDS.max[0] &&
    p.pos[2] >= BOUNDS.min[2] && p.pos[2] <= BOUNDS.max[2];
  const props = [];
  for (const p of ward.props) {
    if (PROP_DROP.has(p.id) || !inArena(p)) continue;
    // E18 — strip the campaign script hooks (the blackout trigger; the
    // handoff/explodable carriers are deleted or out of the arena already)
    if (p.flags && p.flags.transformer) {
      const f = Object.assign({}, p.flags);
      delete f.transformer;
      p.flags = Object.keys(f).length ? f : null;
    }
    const mv = PROP_MOVE[p.id];
    if (mv) {
      p.pos = [p.pos[0] + mv[0], p.pos[1] + mv[1], p.pos[2] + mv[2]];
      if (p.aabb) {
        for (let i = 0; i < 3; i++) { p.aabb.min[i] += mv[i]; p.aabb.max[i] += mv[i]; }
      }
      if (p.cover) { p.cover.pos[0] += mv[0]; p.cover.pos[1] += mv[1]; p.cover.pos[2] += mv[2]; }
    }
    props.push(p);
  }

  const E = { dir: [1, 0, 0] }, Wd = { dir: [-1, 0, 0] };
  const N = { dir: [0, 0, -1] }, S = { dir: [0, 0, 1] };
  const add = (...a) => props.push(prop(...a));

  // E11 — north artery blockers (staggered, alternating sides)
  add("n_skip", "container", -31, -26.75, 0, 4.0, 2.5, 2.6, "metal", "metal_thin",
    { cover: { ...E, height: "high" } });
  add("n_van", "van", -37, -22.3, 1.2, 2.2, 5.2, 2.4, "metal", "metal_thin",
    { cover: { ...E, height: "high" } });
  add("n_boxvan", "van", -18, -20.5, 1.35, 2.2, 5.2, 2.4, "metal", "metal_thin",
    { cover: { ...Wd, height: "high" } });
  add("n_kiosk", "kiosk", -6, -24.75, 0, 4.0, 2.5, 2.4, "wood", "soft",
    { cover: { ...Wd, height: "high" } });
  add("n_barrier", "barrier", -23, -25.7, 0, 2.0, 0.6, 1.1, "concrete", "hard",
    { cover: { ...E, height: "low" } });

  // E12 — alley breakers + cover
  add("a_container_1", "container", -46.25, -5.5, 0, 3.5, 3.0, 2.6, "metal", "metal_thin",
    { cover: { ...N, height: "high" } });
  add("a_container_2", "container", -42.5, 4.5, 0, 3.0, 3.0, 2.6, "metal", "metal_thin",
    { cover: { ...S, height: "high" } });
  add("a_dump_1", "dumpster", -46, -22, 0, 1.8, 1.2, 1.25, "metal", "metal_thin",
    { cover: { ...N, height: "high" } });
  add("a_dump_2", "dumpster", -43, 0, 0, 1.8, 1.2, 1.25, "metal", "metal_thin",
    { cover: { ...S, height: "high" } });
  add("a_pallets", "pallet", -46.5, -12, 0, 1.2, 1.0, 1.1, "wood", "soft",
    { cover: { ...N, height: "low" } });

  // E13 — plaza cover uplift (11 → 17 pieces) + the R1 parity stall
  add("pk_kiosk_6", "kiosk", -18, -8, 0, 2.6, 2.6, 2.3, "wood", "soft",
    { cover: { ...N, height: "high" } });
  add("pk_kiosk_7", "kiosk", 6, 6, 0, 2.6, 2.6, 2.3, "wood", "soft",
    { cover: { ...S, height: "high" } });
  add("pk_stall_1", "stall", -12, 4, 0, 2.2, 1.6, 2.4, "wood", "soft",
    { cover: { ...S, height: "high" } });
  add("pk_planter_4", "planter", 8, -10, 0, 2.0, 0.8, 0.9, "concrete", "hard",
    { cover: { ...N, height: "low" } });
  add("pk_container", "container", -2, -13, 0, 6.0, 2.4, 2.6, "metal", "metal_thin",
    { cover: { ...N, height: "high" } });
  add("pk_van", "van", 2, 8, 0, 2.2, 5.2, 2.4, "metal", "metal_thin",
    { cover: { ...E, height: "high" } });
  // R1 fix (arena.md §6.3): screens LY D1's plaza approach so the two flag
  // sites' longest sightlines land inside the ±10 m parity contract. Cover
  // OUTSIDE the mirrored rooms — P2's exact mirror stays intact.
  add("pk_stall_2", "stall", -24.5, 13, 0, 2.2, 1.6, 2.2, "wood", "soft",
    { cover: { ...E, height: "high" } });

  // E14 — gallery: low crates only (the 46 m lane is the point)
  add("g_crate_1", "crate", 19.5, -16, 0, 1.8, 1.8, 1.2, "wood", "soft",
    { cover: { ...N, height: "low" } });
  add("g_crate_2", "crate", 21.5, 2, 0, 1.8, 1.8, 1.2, "wood", "soft",
    { cover: { ...S, height: "low" } });
  add("g_shelf_4", "shelving", 22.7, -28, 0, 0.5, 1.8, 1.8, "metal", "metal_thin",
    { cover: { ...N, height: "high" } });

  // E15 — base-room cover, mirrored piece for piece (probe-measured boxes)
  add("ly_c1", "crate", -30.5, 14.0, 0, 1.4, 1.2, 1.25, "wood", "soft",
    { cover: { ...S, height: "low" } });
  add("ly_c2", "crate", -36.5, 14.0, 0, 1.4, 1.2, 1.25, "wood", "soft",
    { cover: { ...S, height: "low" } });
  add("ly_c3", "container", -36.25, 10.0, 0, 1.5, 3.0, 3.4, "metal", "metal_thin",
    { cover: { ...E, height: "high" } });
  add("ly_c4", "stall", -29.8, 9.7, 0, 1.2, 2.2, 2.2, "wood", "soft",
    { cover: { ...Wd, height: "high" } });
  add("ex_c1", "crate", 4.5, -30.8, 0, 1.4, 1.2, 1.25, "wood", "soft",
    { cover: { ...N, height: "low" } });
  add("ex_c2", "crate", 10.5, -30.8, 0, 1.4, 1.2, 1.25, "wood", "soft",
    { cover: { ...N, height: "low" } });
  add("ex_c3", "container", 9.25, -28.0, 0, 1.5, 3.0, 3.4, "metal", "metal_thin",
    { cover: { ...Wd, height: "high" } });
  add("ex_c4", "stall", 2.8, -29.7, 0, 1.2, 2.2, 2.2, "wood", "soft",
    { cover: { ...E, height: "high" } });

  // Boundary dressing (B2/B3 read as objects, not limits — carve rule 1).
  // No cover specs: their protected side is the boundary wall itself, and a
  // crouch node inside a wall fails probe_props.
  add("bnd_truck", "truck", -5, 12.7, 1.5708, 2.5, 7, 3, "metal", "metal_thin");
  add("bnd_jersey_1", "barrier", -9.5, -29.5, 0.08, 2.0, 0.6, 1.1, "concrete", "hard");
  add("bnd_jersey_2", "barrier", -3.5, -29.6, -0.06, 2.0, 0.6, 1.1, "concrete", "hard");

  // ---- nodes (the 17-key arena set — PVP_BUILD_PLAN Part 3.10 i / W4 row)
  const NODES = {
    plaza_center: [-5, 0, 0],
    plaza_west: [-20, 0, 0],
    plaza_ne: [8, 0, -6],
    arcade_ground: [-28.5, 0, -3],
    arcade_upper: [-33, 4.2, -14],
    arcade_lightwell: [-32, 0, -8],
    alley_mid: [-44, 0, -8],
    alley_north: [-44, 0, -26],
    cs1_mid: [-26, 0, -23],
    street_mouth: [-6, 0, -21],
    corridor_mid: [11, 0, -21],
    cut_mouth: [14, 0, -20],
    gallery_north: [20, 0, -25],
    gallery_mid: [20, 0, -4],
    gallery_south: [20, 0, 8],
    lantern_yard: [-33.5, 0, 12],
    exchange_house: [6.5, 0, -30],
  };

  // Reference spawn (nav flood seed + boot fallback; content.json arena data
  // is the runtime spawn source — probe-emitted, never hand-copied)
  const REF_SPAWNS = {
    player: { pos: [-23, 0, 2], yaw: -Math.PI / 2 }, // plaza west, faces east
  };

  // Walkable-region rectangles (arena.md §5.1 WALK_RECTS row)
  const WALK_RECTS = [
    { id: "w_alley", min: [-48, -30], max: [-41, 14], y: 0 },
    { id: "w_cs1a", min: [-41, -28], max: [-25, -20], y: 0 },
    { id: "w_cs1b", min: [-25, -28], max: [-12.5, -18], y: 0 },
    { id: "w_street", min: [-12.5, -30], max: [0, -18], y: 0 },
    { id: "w_plaza", min: [-25, -18], max: [15, 14], y: 0 },
    { id: "w_arc_ground", min: [-39, -19], max: [-26, 5], y: 0 },
    { id: "w_arc_wdoor", min: [-41, -4], max: [-39, 0], y: 0 },
    { id: "w_arc_wdoor_n", min: [-41, -17], max: [-39, -13], y: 0 },
    { id: "w_arc_edoor1", min: [-26, -13.5], max: [-25, -10.5], y: 0 },
    { id: "w_arc_edoor2", min: [-26, 0.5], max: [-25, 3.5], y: 0 },
    { id: "w_arc_upper", min: [-39, -19], max: [-26, 5], y: 4.2 },
    { id: "w_gallery", min: [17, -33], max: [23, 13], y: 0 },
    { id: "w_gal_wdoor", min: [15, 8], max: [17, 12], y: 0 },
    { id: "w_gal_middoor", min: [15, -6], max: [17, -2], y: 0 },
    { id: "w_cut", min: [13, -22], max: [23, -18], y: 0 },
    { id: "w_corridor", min: [0, -25], max: [13, -20], y: 0 },
    { id: "w_exh", min: [1, -34], max: [12, -26], y: 0 },
    { id: "w_exh_tunnel", min: [12, -31], max: [17, -27], y: 0 },
    { id: "w_exh_d1", min: [3, -26], max: [7, -25], y: 0 },
    { id: "w_exh_d2", min: [0, -33], max: [1, -29], y: 0 },
    { id: "w_ly", min: [-39, 8], max: [-28, 16], y: 0 },
    { id: "w_ly_d2", min: [-34, 5], max: [-30, 8], y: 0 },
    { id: "w_ly_d1", min: [-28, 11], max: [-25, 15], y: 0 },
    { id: "w_ly_d3", min: [-41, 9], max: [-39, 13], y: 0 },
    { id: "w_alley_stair", min: [-42.6, -13.2], max: [-41, -9.1], y: 0 },
  ];

  // POI zones (arena.md §5.1 ZONES row; ZONE_BASE entries are W3's edit)
  const ZONES = {
    poi_alleys: { min: [-48.5, -30], max: [-41, 14] },
    poi_arcade: { min: [-41, -20], max: [-25, 6] },
    poi_plaza: { min: [-25, -18], max: [15, 14] },
    poi_gallery: { min: [15.5, -34], max: [24.5, 14] },
    poi_lanternyard: { min: [-39, 8], max: [-28, 16] },
    poi_exchange: { min: [1, -34], max: [12, -26] },
    poi_corridor: { min: [0, -25], max: [13, -20] },
  };

  // Ground paint (drives the PBR sets — trimmed to the arena + 3 new rooms)
  const ROADS = [
    { id: "r_alley", kind: "asphalt_worn", min: [-48.5, -30], max: [-41, 14] },
    { id: "r_cs1", kind: "asphalt_worn", min: [-41, -28], max: [-12.5, -18] },
    { id: "r_street", kind: "asphalt", min: [-12.5, -34.5], max: [0, -18] },
    { id: "r_plaza", kind: "plaza_cobble", min: [-25, -18], max: [15, 14] },
    { id: "r_cut", kind: "asphalt_worn", min: [13, -22], max: [24.5, -18] },
    { id: "r_gallery", kind: "concrete_interior", min: [15.5, -34], max: [24.5, 14] },
    { id: "r_arcade", kind: "tile_interior", min: [-39, -19], max: [-26, 5] },
    { id: "r_corridor", kind: "concrete_interior", min: [0, -25], max: [13, -20] },
    { id: "r_ly", kind: "tile_interior", min: [-39, 8], max: [-28, 16] },
    { id: "r_exh", kind: "concrete_interior", min: [1, -34], max: [12, -26] },
  ];

  // Practicals — DATA half of E19 only (pole positions; the intensity /
  // lighting-profile render half is W11, gated on the aim wave). Reals kept:
  // L_PLAZA_KEY + L_ARCADE_SKY unchanged, L_ALLEY_A relocated into the
  // bounded alley's south end; two freed keySpot leases move to the corridor
  // and the gallery (pool size never changes — three leases go unused).
  const LIGHT_POLES = [
    { id: "L_ALLEY_A", pos: [-45, 5.5, 8], color: "#ff9a3c", kind: "sodium", real: true, aim: [-45, 0, 6], cone: 60, godRay: true },
    { id: "L_PLAZA_KEY", pos: [-5, 9.0, 0], color: "#c86ee0", kind: "neon_bounce", real: true, aim: [-5, 0, 0], cone: 85, blackout: { relight: "#4adcd6", level: 0.4 } },
    { id: "L_ARCADE_SKY", pos: [-32, 7.8, -8], color: "#7c8fb8", kind: "skylight", real: true, aim: [-32, 0, -8], cone: 35, godRay: true },
    { id: "L_CORRIDOR", pos: [3.5, 3.2, -22.5], color: "#cfe0d8", kind: "fluorescent", real: true, aim: [3.5, 0, -22.5], cone: 70 },
    { id: "L_GALLERY", pos: [20, 4.4, -6], color: "#ff9a3c", kind: "sodium", real: true, aim: [20, 0, -8], cone: 60 },
    // Fakes (emissive head + cone card + pool decal — zero real lights):
    // the two alley sodium heads backlight the arena's long-axis keyholes
    // (arena.md §4.4) and the checkpoint flood dresses B3.
    { id: "fake_alley_k1", pos: [-45.5, 5.5, -20], color: "#ff9a3c", kind: "sodium", real: false },
    { id: "fake_alley_k2", pos: [-45.5, 5.5, 2], color: "#ff9a3c", kind: "sodium", real: false },
    { id: "fake_corridor_e", pos: [10, 3.2, -21.5], color: "#cfe0d8", kind: "fluorescent", real: false },
    { id: "fake_street_1", pos: [-10, 6, -22], color: "#ff9a3c", kind: "sodium", real: false },
    { id: "fake_street_2", pos: [-2, 6, -30], color: "#ff9a3c", kind: "sodium", real: false },
    // [W6 cross-lane fix, flagged] level.js:2916 (case "flood") reads lp.aim
    // unconditionally; this entry had none and buildLevel crashed on ANY
    // lanternwalk render ("Cannot read properties of undefined (reading '0')").
    // aim mirrors pos at ground level, like every sibling entry.
    { id: "fake_checkpoint", pos: [-6, 5, -29.7], color: "#dce8ff", kind: "flood", real: false, aim: [-6, 0, -29.7] },
    { id: "neon_club", pos: [15.4, 6, -12], color: "#e83ea8", kind: "neon", real: false, sign: "ЗАРОВ НОЧЬ" },
    { id: "neon_meridian", pos: [15.4, 5, -6], color: "#38d8d0", kind: "neon", real: false, sign: "MERIDIAN 24" },
    { id: "neon_noodle", pos: [15.4, 4.5, 0], color: "#ff4040", kind: "neon", real: false, sign: "ЛАПША ДОМ" },
    { id: "neon_pharmacy", pos: [15.4, 5.5, 5], color: "#3cff88", kind: "neon", real: false, sign: "+" },
    { id: "neon_pawn", pos: [15.4, 4.8, 10], color: "#ffb340", kind: "neon", real: false, sign: "ЗОЛОТО ЗАРОВ" },
  ];

  // Terrain: canal retained as data (zMin 54 — far outside the arena; keeps
  // colliders.groundY and computePlacements signatures working unchanged).
  const TERRAIN = {
    base: ward.terrain.base,
    canal: ward.terrain.canal,
    heroPuddles: ward.terrain.heroPuddles,
  };

  return {
    buildings,
    walls,
    props,
    roads: ROADS,
    terrain: TERRAIN,
    zones: ZONES,
    lightPoles: LIGHT_POLES,
    nodes: NODES,
    refSpawns: REF_SPAWNS,
    walkRects: WALK_RECTS,
    bounds: BOUNDS,
    seed,
    mapId: "lanternwalk",
  };
}
