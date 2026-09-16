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
// Arena bounds: X ∈ [−58, +46], Z ∈ [−52, +42].
//
// ===========================================================================
// GEN-2 EXPANSION (2026-09-16) — THE FENCES MOVED, THE CITY DID NOT CHANGE
// ===========================================================================
// The gen-1 carve fenced a 73 × 49 m pocket out of a ward that was already
// built and already walkable, and measured 2570 m² of floor — 282 m² per
// actor, CoD-Shipment density. tools/probe_arena.mjs --gen=2 asks for
// 5500–6300 m² and 560–700 m²/actor (CS2-Dust2 class), and turns gen-1's
// one-sided clauses into BANDS: a map can now fail for being too cramped
// (<6 m rays ≤45%, <15 m ≤70%, 15–40 m ≥28%, nearest-of-9 p10 ≥5 m,
// P(≥1 enemy in LOS) ≤60%) as well as for being too empty.
//
// This generation moves the boundary walls OUTWARD onto ward geometry that
// already exists — no invented city. Annexed, west to east:
//   • the Tannery Alley's full width X[−58,−41] and its south dog-leg up to
//     the quay hoarding (the 7 m artery becomes a 17 m two-lane yard);
//   • a service passage carved through bld_s1 (alley ⇄ plaza ramp), which is
//     what stops the southern territory being three cul-de-sacs;
//   • the plaza ramp X[−14,−6] and the plaza's own south 4 m (the B2 market
//     hoarding is gone — the hub must grow WITH the map, see G-HUB);
//   • a dog-legged passage carved through bld_s3 (plaza south ⇄ boulevard);
//   • the NE cut's east end and the Storm Gallery's east door, reopened, plus
//     two shop units carved through bld_ge_c — four rungs between gallery and
//     boulevard, so the east flank is a LADDER and the boulevard is not a
//     60 m spur;
//   • Kirov Boulevard X[+28,+46] entire, with three staggered transverse
//     breaks (tram stop Z+6, collapsed awning Z−20, skip line Z+26) — an
//     86 m straight canyon is a sniper alley and would have run the longest
//     sampled ray past the 95 m ceiling;
//   • the customs yard clipped at Z−52, reached by the market street (the B3
//     barricade is gone) and by the CYE gate lane into the boulevard.
// The QUAY (w_quay, 116 × 12) is deliberately EXCLUDED: it would hit the area
// target on its own but it is a 116 m straight corridor, ~20 m past the
// longest-ray ceiling. Its mouths are closed by the Z+42 hoarding run
// instead (G-H raycasts the AABB edge every 2 m and wants geometry within
// 0.5 m of every sample, so the hoarding is three real boxes, not a limit).
//
// Ward walls the gen-1 carve dropped and this generation KEEPS, because the
// fence line moved onto them: per_w (the ward's west perimeter is now the
// arena's west fence), wall_ce_parapet (the customs yard's east wall) and the
// tram platform mass plat_deck/plat_canopy/plat_post_* (its stair and ramp
// stay dropped, so the deck is a solid cap on the boulevard's north end and
// not a 4.5 m firing step over an 86 m street).

// ===========================================================================
// GEN-2b (2026-09-16) — THE BAND-MIX PASS
// ===========================================================================
// The first gen-2 build hit the area and density targets (G-A/G-B) but failed
// G-C, G-HUB, G-G, G-I, G-J and G-K. Measured then / now:
//
//                       first gen-2   this pass   gen-2 target
//   walkable ground        5979         6245       5500-6300
//   per-actor               623          650         560-700
//   <6 m rays              39.9%        37.4%         25-45
//   <15 m rays             75.5%        71.7%         50-70   (still over)
//   15-40 m rays           22.9%        26.2%          >=28   (still under)
//   longest sampled ray    86.5 m       85.0 m         <=95
//   P(>=1 of 9 in LOS)     55.9%        58.8%          35-60
//   dominant open region   39.1%        48.0%          >=40
//   spawn points             50           82          70-100
//
// WHAT MOVED THE BAND MIX
//  1. MORE WARD FLOOR, spent on DEPTH rather than length. bld_nw2 + bld_gna
//     are carved from the north so the customs yard is 16 m deep instead of
//     12; bld_nbw the same for CS1 (10 -> 15); bld_nea widens the market
//     street (12.5 -> 16.5); the S1 hall grows to 18 x 15 and the plaza ramp
//     to 18 m. A room only produces a 15 m+ ray if its DIAGONAL clears 30 m,
//     so four metres of depth is worth more than forty of corridor.
//  2. WAIST-HIGH INSTEAD OF FULL-HEIGHT in the annexes. The probe casts at
//     y 1.6, and walkable() rejects anything spanning 0.42-1.7, so a 1.4 m
//     container still stops movement and still gives crouch cover while the
//     sightline passes over it. aw_skip / aw_van / aw_cont, cu_line_n/s,
//     bv_skip_1/2, ps_skip, rp_cont and the north artery's n_van / n_boxvan
//     went down to 1.4; the tall breaks that remain are the ones that cap a
//     40 m+ run, not the ones that were chopping 20 m ones.
//  3. KIROV BOULEVARD REBUILT AROUND BAND LENGTH. The first build put six
//     breaks in an 86 m street at Z -36/-31/-20/+6.5/+14.5/+34: five of its
//     six bands were under 9 m, which is why an 18 m street measured 24.2%
//     mid-range. They are now two SEALED PAIRS (Z -23/-18 and Z +9/+14, each
//     pair overlapping ~5 m in x with the movement gap on alternating sides)
//     leaving three bands of 21, 27 and 27 m. Boulevard mid-range 24.2% ->
//     29.9% with NO measured cost to G-E - the single biggest win in the pass.
//  4. The bld_w3 slot was deleted: a 7 x 5 dead-end niche measuring 0%
//     mid-range while eating 35 m2 of the G-A budget.
//
// WHAT IS STILL OPEN (G-C). <15 m sits at 71.7% against a 70% ceiling and
// 15-40 m at 26.2% against a 28% floor. G-C and G-E pull against each other
// on this footprint: over ~60 measured builds the frontier ran
//   mid 28.5% / <15 67.9% <-> P(LOS) 70.0%
//   mid 27.5% / <15 70.3% <-> P(LOS) 60.7%
//   mid 26.2% / <15 71.7% <-> P(LOS) 58.8%   (this build)
// because P(>=1 in LOS) is driven by E[r^2] over the ray profile, and every
// metre of sightline bought for the 15-40 m band is also a metre of mutual
// visibility. Closing G-C from here needs floor this AABB does not contain
// (the quay is the only candidate and it is a 116 m corridor) or a gen-2
// threshold pair that admits a solution. cu_baffle and ms_baffle are the two
// walls holding G-E inside its band; removing them returns ~1.1 points of
// mid-range and puts P(LOS) over 60.
// ===========================================================================

import { buildLayout as buildWard } from "./meridian_ward.js";

const BOUNDS = { min: [-58, -2, -52], max: [46, 14, 42] };

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

  V(-25, -12.5, 0, 3.4, -40, -36),
  V(15, 24, 0, 3.4, -40, -36),
  V(-40, -26, 0, 3.4, -33, -28),
  V(0, 4, 0, 3.4, -40, -31),
  // ---- GEN-2 voids -------------------------------------------------------
  // WHY THESE ARE ROOMS AND NOT CORRIDORS. The first gen-2 build carved the
  // new links as 4–5 m passages and measured <15 m rays at 79% against a 70%
  // ceiling: a corridor's perpendicular ray is its width, so 5 m of new
  // corridor buys area and LOSES band mix. Every void below is therefore as
  // WIDE as the block it is cut from allows. Measured per region on that
  // build: a 5 m passage ran 93.5% under 15 m, the 40 × 36 m plaza 67.7%.
  //
  // S1 LOADING HALL (bld_s1) — the single most important addition. Without a
  // link here the alley's south dog-leg and the plaza ramp are two dead-end
  // limbs hanging off the Z+42 hoarding; with it they are one rotation route
  // (plaza → ramp → hall → alley → arcade/plaza). An 18 × 12 m hall with a
  // door at each end, not a bore: the doors are the fight, the hall is room.
  V(-41, -36, 0, 3.4, 24, 29),       // S1 west door ← the alley
  V(-36, -18, 0, 3.4, 21, 36),       // S1 the hall itself
  V(-18, -14, 0, 3.4, 26, 31),       // S1 east door → the plaza ramp
  // RAMP WIDENING (bld_s2) — the ward's plaza ramp is an 8 m slot; at 8 m it
  // measured 91.5% under 15 m. Taking bld_s2's west five metres makes it a
  // 13 m yard for its whole length and keeps the quay mouth at 8 m, so the
  // Z+42 hoarding run still closes it.
  V(-6, 4, 0, 3.4, 20, 40),
  // S3 MARKET PASSAGE (bld_s3) — plaza south ⇄ boulevard, dog-legged so the
  // plaza's 40 m south edge does not become a 71 m line into the boulevard.
  V(15, 22, 0, 3.4, 13, 19),         // S3a
  V(20, 28, 0, 3.4, 16, 21),         // S3b
  // THE GALLERY'S SOUTH HALF, OPENED (gal_e_3 + bld_ge_c, Z[−18,+13]).
  // The Storm Gallery keeps its covered north half — the cut still crosses
  // it, the east door still tunnels through bld_ge_a/b — but south of the NE
  // cut its east wall and the shop row behind it are gone, and the gallery
  // (6 m), the GE strip (3.5 m) and Kirov Boulevard (18 m) read as ONE 29 m
  // wide room 31 m deep. That room is what carries the band mix and the
  // G-HUB dominant-open-region share; four narrow rungs could not.
  V(23, 28, 0, 8, -18, 13),
];

// Buildings the carve excavates — their masses return as wall pieces.
// GEN-2 adds the three south/east blocks the new passages bore through.
const CARVED_BUILDINGS = new Set([
  "bld_nea", "bld_neb", "bld_m1",
  "bld_s1", "bld_s2", "bld_s3", "bld_ge_c", "bld_nw2", "bld_gna", "bld_nbw",
]);

// Walls deleted outright (outside the arena / superseded — arena.md §5.1).
// GEN-2: the fence line moved outward onto ward geometry, so "per_" and
// "plat_" are no longer blanket drops — per_w IS the west boundary now and
// plat_deck IS the boulevard's north cap. Only the platform's stair and ramp
// go, which is what turns the deck from an overlook into a solid mass.
const WALL_DROP_PREFIX = ["plat_stair", "plat_ramp"];
const WALL_DROP = new Set([
  "canal_edge", "per_n_w", "per_gate9", "per_n_e", "per_e",
]);

// Props deleted explicitly (E16 in-arena entries; out-of-arena props are
// auto-dropped by the bounds filter below)
const PROP_DROP = new Set([
  "arc_stall_2", "arc_stall_5", "pl_car_5", "al_scaf_2", "arc_table",
  "ms_barrier_1", "ms_barrier_2",
  "al_van", "al_scaf_1",
  "arc_stall_1", "arc_stall_3", "arc_stall_4", "arc_stall_6",
  "ms_car_1",   // overlapped the new n_kiosk artery blocker (probe_props clip)
  "al_dump_5",  // its crouch node landed inside the new a_container_1
  "al_trash_6", // its footprint landed inside the new a_pallets
  // GEN-2: one of the customs yard's twelve jerseys sits exactly where the
  // transverse container line has to cross the jersey line. Twelve → eleven.
  "cu_jersey_5", "pf_bin_2", "pf_nest_front", "bl_bench",
]);
// Prop moves (E17 + carve de-clip: probe_props gates zero overlaps)
const PROP_MOVE = {
  pl_car_6: [0, 0, -4.5],   // clear of B2 AND of the R1 stall's footprint
  al_dump_6: [2, 0, 0],
  arc_kiosk: [-1.8, 0, 0],  // clear of arc_part_2
  arc_stall_6: [0.9, 0, 0], // clear of arc_part_2
  ms_car_2: [-1, 0, 2.5],   // clear of n_kiosk (and of the sp_m4 bubble)
  // ---- GEN-2 de-clips (all three are 0-overlap fixes, not design moves) --
  cu_jersey_10: [0, 0, 3],  // straddled the Z−52 customs fence
  cu_sand_3: [-3, 0, 0],    // clear of cu_line_n
  bl_car_1: [0, 0, -6],     // clear of the re-sited tram-stop rows
  // ---- GEN-2b de-clips against the new hoarding walls ------------------
  cu_sand_2: [0, 0, 1.6],   // its crouch node hung outside the Z-52 fence
  cu_sand_4: [0, 0, 1.6],   // crouch node was inside pvp_bnd_customs_e
  bl_car_4: [0, 0, 8],      // crouch node was inside the re-sited ba_awn_2
  pl_trash_2: [-6, 0, -4],  // corner was inside ps_container
  pl_trash_4: [-3, 0, -2],  // corner was inside ps_stall
  bl_car_5: [0, 0, -6],     // crouch node was inside the re-sited ba_awn_1
  bl_car_7: [5, 0, -4],     // it bridged the skip line's west gap and cut the
                            // boulevard's south end out of the G-HUB component
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

  // ---- additions: the GEN-2 boundary run, partitions, piers, stair -------
  // (E2, E8, L1 piers, L4 — arena.md §1.1–1.3)
  //
  // THE FENCE LINE. Gen-1's five boundary walls (B1 alley container stack,
  // B2 market hoarding, B3/B3b customs barricade, B4 collapsed tram gantry,
  // B5 welded fire door) are GONE — every one of them fenced off ward floor
  // this generation annexes. Their replacements sit on the new AABB edge,
  // and the rest of that edge is ward mass that was already there (per_w on
  // the west; bld_e1/bld_e2 on the east; bld_cw / wall_ce_parapet / plat_deck
  // on the north; bld_w1 / bld_s1 / bld_s2 / bld_s3 on the south). G-H
  // samples the AABB edge every 2 m and wants geometry within 0.5 m of each
  // sample, so every gap in that ring is a real box below.
  walls.push(
    // Q1–Q3 — THE QUAY HOARDING at Z+42. The quay itself stays out (116 m
    // corridor); these three boxes close its three mouths: the alley mouth,
    // the plaza ramp head and the boulevard mouth.
    wbox("pvp_bnd_quay_w", "wall", -48, -41, 0, 6, 42, 42.5),
    wbox("pvp_bnd_quay_m", "wall", -14, -6, 0, 6, 42, 42.5),
    wbox("pvp_bnd_quay_e", "wall", 28, 46, 0, 6, 42, 42.5),
    // N1/N2 — customs yard north fence at Z−52. Split around bld_gatehouse
    // (x[5,11], z[−55,−50]), which is kept: it fills that span of the edge
    // itself and pushes 2 m of Gate 9 mass into the yard as a real blocker.
    wbox("pvp_bnd_customs_w", "wall", -18, 5, 0, 6, -52, -51.5),
    wbox("pvp_bnd_customs_e", "wall", 11, 24, 0, 6, -52, -51.5),
    // N3 — the tram ramp's slot, filled. plat_ramp is dropped (no stair up to
    // the deck), so without this the boulevard's north end would end in a
    // 1.5 m × 8 m dead slit against the AABB.
    wbox("pvp_bnd_plat_e", "wall", 44.5, 46, 0, 5, -52, -44),
    wbox("arc_part_1", "wall", -33.5, -32.5, 0, 3.6, -19, -17.5),      // arcade shop-unit partitions
    wbox("arc_part_2", "wall", -31.5, -30.5, 0, 3.6, 1.5, 5),
    wbox("arc_part_3", "wall", -36.5, -35.5, 0, 3.6, -9, -8),
    wbox("arc_part_4", "wall", -30, -29, 0, 3.6, -17, -11.3),
    wbox("corr_pier_a", "wall", 5, 6.5, 0, 3.4, -25, -22),           // L1 structural piers (S-bend)
    wbox("corr_pier_b", "wall", 8, 9.5, 0, 3.4, -23, -20),
    wbox("ge_hoard_n", "wall", 23, 28, 0, 2.8, -14.4, -13.6, "concrete", "hard"),
    wbox("ge_hoard_s", "wall", 23, 28, 0, 2.8, 3.6, 4.4, "concrete", "hard"),
    wbox("aw_hoard_s", "wall", -49, -41, 0, 2.8, 29.6, 30.4, "concrete", "hard"),
    wbox("n_hoard_w", "wall", -25, -21.5, 0, 2.8, -20.9, -20.1, "concrete", "hard"),
    wbox("n_hoard_e", "wall", -18, -12.5, 0, 2.8, -23.9, -23.1, "concrete", "hard"),
    wbox("ms_hoard_w", "wall", -12.5, -7.5, 0, 2.8, -23.4, -22.6, "concrete", "hard"),
    wbox("ms_hoard_e", "wall", -4.5, -0.5, 0, 2.8, -27.4, -26.6, "concrete", "hard"),
    wbox("n_pier_a", "wall", -34, -33, 0, 3.4, -33, -29.5),
    wbox("n_pier_b", "wall", -30, -29, 0, 3.4, -31.5, -28),
    wbox("cut_hoard", "wall", 17.5, 20.5, 0, 2.8, -20.4, -19.6, "concrete", "hard"),
    wbox("cye_hoard", "wall", 30, 40, 0, 2.8, -41.4, -40.6, "concrete", "hard"),
    // P5 parity screen: without it the Exchange House stand shoots 52 m east
    // through the D3 tunnel, the gallery and the east door into Kirov
    // Boulevard, against the Lantern Yard stand's 28 m (G-I wants Delta<=10).
    wbox("gal_screen", "wall", 18.5, 22.5, 0, 2.8, -32, -29.5, "concrete", "hard"),
    // market-street baffle, paired with cu_baffle: the widened street runs
    // 23 m from the plaza into the customs yard, and the two of them are
    // what keeps that line off G-E's mutual-visibility term.
    wbox("ms_baffle", "wall", -12, -5, 0, 2.8, -33.4, -32.6, "concrete", "hard"),
    // customs-yard baffle: the yard is 42 m across and its south mouth
    // opens straight down the market street, which is where G-E's
    // mutual-visibility term was coming from. Movement passes either side.
    wbox("cu_baffle", "wall", -12, -2, 0, 2.8, -42.4, -41.6, "concrete", "hard"),

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
  add("n_skip", "container", -31, -26.75, 0, 4.0, 2.5, 1.4, "metal", "metal_thin",
    { cover: { ...E, height: "high" } });
  add("n_van", "van", -37, -22.3, 1.2, 2.2, 5.2, 1.4, "metal", "metal_thin",
    { cover: { ...E, height: "high" } });
  add("n_boxvan", "van", -18, -20.5, 1.35, 2.2, 5.2, 1.4, "metal", "metal_thin",
    { cover: { ...Wd, height: "high" } });
  add("n_kiosk", "kiosk", -6, -24.75, 0, 4.0, 2.5, 2.4, "wood", "soft",
    { cover: { ...Wd, height: "high" } });
  add("n_barrier", "barrier", -23, -25.7, 0, 2.0, 0.6, 1.1, "concrete", "hard",
    { cover: { ...E, height: "low" } });

  // E12 — alley breakers + cover
  add("a_container_1", "container", -46.25, -5.5, 0, 3.5, 3.0, 1.4, "metal", "metal_thin",
    { cover: { ...N, height: "high" } });
  add("a_container_2", "container", -42.5, 4.5, 0, 3.0, 3.0, 1.4, "metal", "metal_thin",
    { cover: { ...S, height: "high" } });
  add("a_dump_1", "dumpster", -46, -22, 0, 1.8, 1.2, 1.25, "metal", "metal_thin",
    { cover: { ...N, height: "high" } });
  add("a_dump_2", "dumpster", -43, 0, 0, 1.8, 1.2, 1.25, "metal", "metal_thin",
    { cover: { ...S, height: "high" } });
  add("a_pallets", "pallet", -46.5, -12, 0, 1.2, 1.0, 1.1, "wood", "soft",
    { cover: { ...N, height: "low" } });

  // E13 — plaza cover uplift (11 → 17 pieces) + the R1 parity stall
  add("pk_kiosk_6", "kiosk", -18, -8, 0, 2.6, 2.6, 1.5, "wood", "soft",
    { cover: { ...N, height: "high" } });
  add("pk_kiosk_7", "kiosk", 6, 6, 0, 2.6, 2.6, 1.5, "wood", "soft",
    { cover: { ...S, height: "high" } });
  add("pk_stall_1", "stall", -12, 4, 0, 2.2, 1.6, 1.5, "wood", "soft",
    { cover: { ...S, height: "high" } });
  add("pk_planter_4", "planter", 8, -10, 0, 2.0, 0.8, 0.9, "concrete", "hard",
    { cover: { ...N, height: "low" } });
  add("pk_container", "container", -2, -13, 0, 6.0, 2.4, 2.6, "metal", "metal_thin",
    { cover: { ...N, height: "high" } });
  add("pk_van", "van", 2, 8, 0, 2.2, 5.2, 1.4, "metal", "metal_thin",
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

  // =======================================================================
  // GEN-2 — TRANSVERSE BREAKS IN THE ANNEXED GROUND
  // =======================================================================
  // This map's idiom for a long artery is a STAGGERED line of tall solids
  // (n_skip / n_van / n_boxvan / n_kiosk / n_barrier on the north artery).
  // The annexed ground needs it more than the artery did: Kirov Boulevard is
  // an 86 m canyon 18 m wide, the widened alley a 64 m one, and the customs
  // yard 42 m across. Everything below is ≥2.4 m tall on purpose — the ray
  // profile is cast at y 1.6, so a 1.1 m jersey barrier is cover that stops
  // movement and NOT a sightline break (which is exactly why the boulevard's
  // own bl_barr line at Z+38 does not count as one of these).
  //
  // BOULEVARD — three breaks, staggered so no column of the street is clear
  // end to end: the tram stop closes X[28,40], the collapsed awning X[34,46],
  // the skip line X[33.5,46]. Longest surviving run ≈50 m (X[28,33.5],
  // Z[−44,+6]), against a 95 m ceiling and an 83 m open canyon without them.
  add("bv_tram_1", "container", 40.5, 9, 0, 11.0, 2.6, 2.8, "metal", "metal_thin",
    { cover: { ...S, height: "high" } });
  add("bv_tram_2", "container", 33.5, 14, 0, 11.0, 2.6, 2.8, "metal", "metal_thin",
    { cover: { ...N, height: "high" } });
  add("ba_awn_1", "container", 33.5, -23, 0, 11.0, 2.6, 2.8, "metal", "metal_thin",
    { cover: { ...N, height: "high" } });
  add("ba_awn_2", "container", 40.5, -18, 0, 11.0, 2.6, 2.8, "metal", "metal_thin",
    { cover: { ...S, height: "high" } });
  add("bv_skip_1", "container", 36.5, 26, 0, 6.0, 2.6, 1.4, "metal", "metal_thin",
    { cover: { ...N, height: "high" } });
  add("bv_skip_2", "container", 42.75, 26, 0, 6.5, 2.6, 1.4, "metal", "metal_thin",
    { cover: { ...S, height: "high" } });

  // CUSTOMS YARD — the transverse line at X+3, in two pieces with a 2 m slip
  // between them, crossing the jersey line rather than running beside it.
  add("cu_line_n", "container", 3, -49, 0, 2.4, 5.0, 1.4, "metal", "metal_thin",
    { cover: { ...E, height: "high" } });
  add("cu_line_s", "container", 3, -42.5, 0, 2.4, 4.0, 1.4, "metal", "metal_thin",
    { cover: { ...Wd, height: "high" } });
  // CYE gate lane — without this the yard, the gate lane and the boulevard
  // line up into a single 64 m east–west shot. It also dog-legs the lane.
  add("cye_container", "container", 25, -42, 0, 2.0, 4.0, 1.4, "metal", "metal_thin",
    { cover: { ...Wd, height: "high" } });

  // ALLEY WEST STRIP — three staggered blockers in the newly opened half, so
  // the 17 m yard reads as two lanes with crossings rather than one canyon.
  add("aw_skip", "container", -50, -16, 0, 5.0, 2.6, 1.4, "metal", "metal_thin",
    { cover: { ...N, height: "high" } });
  add("aw_van", "van", -54.5, 2, 1.5708, 2.2, 5.2, 1.4, "metal", "metal_thin",
    { cover: { ...N, height: "high" } });
  add("aw_cont", "container", -53.5, 24, 0, 9.0, 2.6, 1.4, "metal", "metal_thin",
    { cover: { ...N, height: "high" } });

  // PLAZA SOUTH — the B2 hoarding is gone, so the plaza's south 4 m is open
  // floor; these keep it from becoming a 61 m east–west line that would run
  // the S3 passage straight through the LY D1 door into the west flag room
  // (and blow G-I's P5 longest-into-site parity).
  add("ps_skip", "container", -21, 16, 0, 4.0, 2.4, 1.4, "metal", "metal_thin",
    { cover: { ...N, height: "high" } });
  add("ps_container", "container", -9, 15.4, 0, 4.0, 2.4, 2.6, "metal", "metal_thin",
    { cover: { ...N, height: "high" } });
  add("ps_stall", "stall", 4, 16, 0, 2.2, 1.6, 1.5, "wood", "soft",
    { cover: { ...N, height: "high" } });

  // PLAZA RAMP + S1 SERVICE PASSAGE — cover on the new rotation route.
  add("rp_cont", "container", -12, 24, 0, 2.4, 6.0, 1.4, "metal", "metal_thin",
    { cover: { ...Wd, height: "high" } });
  add("rp_dump", "dumpster", -8, 32, 0, 1.7, 1.1, 1.25, "metal", "metal_thin",
    { cover: { ...N, height: "high" } });
  add("rp_crate", "crate", -12.5, 36, 0, 1.8, 1.8, 1.2, "wood", "soft",
    { cover: { ...Wd, height: "low" } });
  add("sp_crate_1", "crate", -33, 24.5, 0, 1.8, 1.8, 1.2, "wood", "soft",
    { cover: { ...N, height: "low" } });
  add("sp_dump", "dumpster", -28, 30, 0, 1.1, 1.7, 1.25, "metal", "metal_thin",
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

  // Walkable-region rectangles (arena.md §5.1 WALK_RECTS row).
  // GEN-2: w_alley/w_street/w_plaza/w_cut GREW (the fence that clipped each
  // of them is gone) and eleven rects are new. Union semantics — a rect may
  // span solid mass; the solids subtract. G-F requires every ground rect to
  // touch ≥2 others, which is the dead-end clause: each new rect below names
  // its two neighbours.
  const WALK_RECTS = [
    { id: "w_alley", min: [-58, -30], max: [-41, 42], y: 0 },
    { id: "w_cs1a", min: [-41, -33], max: [-25, -20], y: 0 },
    { id: "w_cs1b", min: [-25, -28], max: [-12.5, -18], y: 0 },
    { id: "w_street", min: [-12.5, -41], max: [0, -18], y: 0 },
    { id: "w_plaza", min: [-25, -18], max: [15, 18], y: 0 },
    // ---- GEN-2 annexations ----------------------------------------------
    { id: "w_customs", min: [-18, -52], max: [24, -36], y: 0 },   // w_street, w_cye
    { id: "w_cye", min: [24, -44], max: [46, -39], y: 0 },        // w_customs, w_blvd
    { id: "w_blvd", min: [28, -44], max: [46, 42], y: 0 },        // w_cye, w_cut, …
    { id: "w_gal_edoor", min: [23, -32], max: [28, -28], y: 0 },  // w_gallery, w_blvd
    { id: "w_ge_shop_a", min: [23, -12], max: [28, -8], y: 0 },   // w_gallery, w_blvd
    { id: "w_ge_shop_b", min: [23, 4], max: [28, 8], y: 0 },      // w_gallery, w_blvd
    { id: "w_s3_pass_a", min: [15, 14], max: [22, 18], y: 0 },    // w_plaza, w_s3_pass_b
    { id: "w_s3_pass_b", min: [21, 17], max: [28, 21], y: 0 },    // w_s3_pass_a, w_blvd
    { id: "w_ramp", min: [-14, 18], max: [4, 42], y: 0 },        // w_plaza, w_s1_pass_c
    { id: "w_s1_pass_a", min: [-41, 22], max: [-26, 27], y: 0 },  // w_alley, w_s1_pass_b
    { id: "w_s1_pass_b", min: [-30, 26], max: [-26, 33], y: 0 },  // w_s1_pass_a, _c
    { id: "w_s1_pass_c", min: [-36, 33], max: [-14, 38], y: 0 },  // w_s1_pass_b, w_ramp
    { id: "w_arc_ground", min: [-39, -19], max: [-26, 5], y: 0 },
    { id: "w_arc_wdoor", min: [-41, -4], max: [-39, 0], y: 0 },
    { id: "w_arc_wdoor_n", min: [-41, -17], max: [-39, -13], y: 0 },
    { id: "w_arc_edoor1", min: [-26, -13.5], max: [-25, -10.5], y: 0 },
    { id: "w_arc_edoor2", min: [-26, 0.5], max: [-25, 3.5], y: 0 },
    { id: "w_arc_upper", min: [-39, -19], max: [-26, 5], y: 4.2 },
    { id: "w_gallery", min: [17, -33], max: [23, 13], y: 0 },
    { id: "w_gal_wdoor", min: [15, 8], max: [17, 12], y: 0 },
    { id: "w_gal_middoor", min: [15, -6], max: [17, -2], y: 0 },
    { id: "w_cut", min: [13, -22], max: [28, -18], y: 0 },
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

  // POI zones (arena.md §5.1 ZONES row; ZONE_BASE entries are W3's edit).
  // GEN-2 adds the three annexed districts as their own POIs — the zone set
  // is what the spawn director and the commander read as "regions of the
  // map", so new territory with no zone reads as nowhere.
  const ZONES = {
    poi_alleys: { min: [-58, -30], max: [-41, 42] },
    poi_arcade: { min: [-41, -20], max: [-25, 6] },
    poi_plaza: { min: [-25, -18], max: [15, 18] },
    poi_gallery: { min: [15.5, -34], max: [24.5, 14] },
    poi_lanternyard: { min: [-39, 8], max: [-28, 16] },
    poi_exchange: { min: [1, -34], max: [12, -26] },
    poi_corridor: { min: [0, -25], max: [13, -20] },
    poi_blvd: { min: [28, -44], max: [46, 42] },
    poi_customs: { min: [-18, -52], max: [24, -40] },
    poi_ramp: { min: [-30, 18], max: [-6, 42] },
  };

  // Ground paint (drives the PBR sets — the arena + 3 new rooms + gen-2)
  const ROADS = [
    { id: "r_alley", kind: "asphalt_worn", min: [-58, -30], max: [-41, 42] },
    { id: "r_cs1", kind: "asphalt_worn", min: [-41, -28], max: [-12.5, -18] },
    { id: "r_street", kind: "asphalt", min: [-12.5, -41], max: [0, -18] },
    { id: "r_plaza", kind: "plaza_cobble", min: [-25, -18], max: [15, 18] },
    { id: "r_cut", kind: "asphalt_worn", min: [13, -22], max: [28, -18] },
    { id: "r_blvd", kind: "asphalt_tram", min: [28, -44], max: [46, 42] },
    { id: "r_cye", kind: "asphalt_worn", min: [24, -44], max: [46, -39] },
    { id: "r_customs", kind: "concrete_yard", min: [-18, -52], max: [24, -40] },
    { id: "r_ramp", kind: "asphalt", min: [-14, 18], max: [-6, 42] },
    { id: "r_s1pass", kind: "concrete_interior", min: [-41, 22], max: [-14, 38] },
    { id: "r_s3pass", kind: "concrete_interior", min: [15, 14], max: [28, 21] },
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
    // GEN-2 — two of the three unused keySpot leases go to the annexed
    // districts (pool is 8; this map now runs 7 real, one still spare).
    // An 18 m × 86 m street and a 42 m yard lit only by neighbours would
    // read as off-map, which is the one thing a doubled arena cannot afford.
    { id: "L_BLVD", pos: [36, 7.0, 2], color: "#ff9a3c", kind: "sodium", real: true, aim: [36, 0, 2], cone: 50 },
    { id: "L_CUSTOMS", pos: [2, 9.0, -45], color: "#dce8ff", kind: "flood", real: true, aim: [2, 2, -45], cone: 40, godRay: true },
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
    // GEN-2 fakes (emissive head + cone card + pool decal — zero real lights)
    { id: "fake_blvd_n", pos: [36, 7, -30], color: "#ff9a3c", kind: "sodium", real: false },
    { id: "fake_blvd_s", pos: [36, 7, 30], color: "#ff9a3c", kind: "sodium", real: false },
    { id: "fake_customs_w", pos: [-12, 6, -46], color: "#dce8ff", kind: "flood", real: false, aim: [-12, 0, -46] },
    { id: "fake_customs_e", pos: [18, 6, -46], color: "#dce8ff", kind: "flood", real: false, aim: [18, 0, -46] },
    { id: "fake_alley_s", pos: [-52, 5.5, 20], color: "#ff9a3c", kind: "sodium", real: false },
    { id: "fake_ramp", pos: [-10, 6, 30], color: "#ff9a3c", kind: "sodium", real: false },
    { id: "fake_s1_pass", pos: [-28, 3.2, 30], color: "#cfe0d8", kind: "fluorescent", real: false },
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

// ===========================================================================
// ARENA_SPEC [multi-arena amendment] — the PROBE's map-specific input set.
//
// tools/probe_arena.mjs used to carry LANTERNWALK's CLUSTER_META / spawn
// seeds / flag homes as its own top-level constants, which made the probe a
// single-arena tool. It is now `probe_arena.mjs --map=<id>` and reads those
// constants from the map module that owns them. The values below are MOVED
// verbatim out of the probe — including the four post-assignment inward-yaw
// overrides (SC_WEST/SC_ARCADE −π/2, SC_LANTERN −π/4, SC_GALLERY +π/2), which
// are folded into the literal here so there is exactly one place to read.
//
// forward = (−sin yaw, −cos yaw). inward yaw values:
//   +X → −π/2 ·· −X → +π/2 ·· +Z(south) → π ·· −Z(north) → 0
//
// NOTHING here is consumed at runtime: buildLayout() above is the geometry,
// this block is probe INPUT and the probe's --emit turns it into the
// content.json arena block. Never hand-copy the emitted numbers back here.
// ===========================================================================
export const ARENA_SPEC = {
  id: "lanternwalk",

  // 7 clusters (arena.md §2.2). node = the NODES key a spawn in this cluster
  // hints at; side = CTF half ("mid" = neither, FFA-only by construction).
  clusterMeta: {
    SC_WEST:    { inward: -Math.PI / 2, node: "alley_mid", side: "west" },        // +X
    SC_ARCADE:  { inward: -Math.PI / 2, node: "arcade_lightwell", side: "west" }, // +X
    SC_LANTERN: { inward: -Math.PI / 4, node: "lantern_yard", side: "west" },     // (+X,−Z) blend
    SC_NORTH:   { inward: Math.PI, node: "cs1_mid", side: "east" },               // +Z (south)
    SC_MARKET:  { inward: Math.PI, node: "street_mouth", side: "east" },          // +Z (south)
    SC_GALLERY: { inward: Math.PI / 2, node: "gallery_mid", side: "east" },       // −X
    SC_PLAZA:   { inward: null, node: "plaza_center", side: "mid", modes: ["ffa"] },
  },

  // SPAWN SEEDS — candidates from arena.md §2.2 as amended by C7b (five points
  // inside their own flag room lose CTF; +3 CTF-only Lantern approaches and
  // +2 market-pocket points keep every cluster ≥6 per mode inside the 50 cap).
  // The probe REPAIRS (≤4 m nudge), re-takes yaw inside the cluster's ±60°
  // inward cone, and EMITS — hand transcription is how C7b happened.
  //   [id, x, z, clusterId, modes | null (null = all three)]
  spawnSeeds: [
    // ---- SC_WEST — the Tannery Alley, now its full 17 m width and 68 m run.
    ["sp_w1", -55.0, -28.0, "SC_WEST", null], ["sp_w2", -48.0, -27.0, "SC_WEST", null],
    ["sp_w3", -55.0, -23.0, "SC_WEST", null], ["sp_w4", -45.0, -21.0, "SC_WEST", null],
    ["sp_w5", -56.0, -17.0, "SC_WEST", null], ["sp_w6", -44.0, -13.0, "SC_WEST", null],
    ["sp_w7", -55.0, -10.0, "SC_WEST", null], ["sp_w8", -49.0, -3.0, "SC_WEST", null],
    ["sp_w9", -45.0, 2.0, "SC_WEST", null], ["sp_w10", -54.0, 9.0, "SC_WEST", null],
    ["sp_w11", -46.0, 24.0, "SC_WEST", null], ["sp_w12", -50.0, 30.0, "SC_WEST", null],
    ["sp_w13", -45.0, 37.0, "SC_WEST", null],

    // ---- SC_ARCADE — the arcade hall plus both its alley doors (the bbox the
    // gen-1 set failed was 185 m²; corner-to-corner here it is ~290).
    ["sp_a1", -37.0, -18.0, "SC_ARCADE", null], ["sp_a2", -29.0, -18.0, "SC_ARCADE", null],
    ["sp_a3", -40.0, -15.0, "SC_ARCADE", null], ["sp_a4", -36.0, -13.0, "SC_ARCADE", null],
    ["sp_a5", -28.0, -11.0, "SC_ARCADE", null], ["sp_a6", -35.0, -8.0, "SC_ARCADE", null],
    ["sp_a7", -29.0, -7.0, "SC_ARCADE", null], ["sp_a8", -37.0, -3.0, "SC_ARCADE", null],
    ["sp_a9", -28.0, -3.0, "SC_ARCADE", null], ["sp_a11", -40.0, -2.0, "SC_ARCADE", null],
    // the LY D2 door stares into the west stand from 6 m — V8/V9, so CTF off
    ["sp_a10", -32.0, 6.0, "SC_ARCADE", ["tdm", "ffa"]],

    // ---- SC_LANTERN — the yard, the plaza's west third and the plaza ramp.
    // The four yard points sit inside (or in the mouth of) their own flag room.
    ["sp_l1", -36.0, 10.0, "SC_LANTERN", ["tdm", "ffa"]],
    ["sp_l2", -30.0, 14.0, "SC_LANTERN", ["tdm", "ffa"]],
    ["sp_l3", -37.0, 15.0, "SC_LANTERN", ["tdm", "ffa"]],
    ["sp_l4", -25.0, 10.0, "SC_LANTERN", ["tdm", "ffa"]],
    ["sp_l5", -22.0, 8.0, "SC_LANTERN", null], ["sp_l6", -17.0, 2.0, "SC_LANTERN", null],
    ["sp_l7", -13.0, 12.0, "SC_LANTERN", null], ["sp_l8", -21.0, -5.0, "SC_LANTERN", null],
    ["sp_l10", -12.0, -8.0, "SC_LANTERN", null],
    ["sp_l11", -8.0, 24.0, "SC_LANTERN", null], ["sp_l12", -11.0, 32.0, "SC_LANTERN", null],

    // ---- SC_NORTH — the CS1 service street (now 15 m deep) and the customs
    // yard's west half, which the gen-1 set could not reach at all.
    ["sp_n1", -38.0, -30.0, "SC_NORTH", null], ["sp_n2", -31.0, -30.0, "SC_NORTH", null],
    ["sp_n3", -36.0, -25.0, "SC_NORTH", null], ["sp_n4", -28.0, -22.0, "SC_NORTH", null],
    ["sp_n5", -22.0, -25.0, "SC_NORTH", null], ["sp_n6", -16.0, -21.0, "SC_NORTH", null],
    ["sp_n7", -24.0, -19.0, "SC_NORTH", null], ["sp_n8", -15.0, -47.0, "SC_NORTH", null],
    ["sp_n9", -8.0, -43.0, "SC_NORTH", null], ["sp_n10", -14.0, -39.0, "SC_NORTH", null],
    ["sp_n11", -2.0, -48.0, "SC_NORTH", null], ["sp_n12", -11.0, -45.0, "SC_NORTH", null],

    // ---- SC_MARKET — the market street, the Exchange House and the customs
    // yard's east half. The ExH points are inside the east stand's room.
    ["sp_m1", -10.0, -30.0, "SC_MARKET", null], ["sp_m2", -4.0, -34.0, "SC_MARKET", null],
    ["sp_m3", -8.0, -24.0, "SC_MARKET", null], ["sp_m4", 2.0, -22.0, "SC_MARKET", null],
    ["sp_m5", 10.0, -22.0, "SC_MARKET", null],
    ["sp_m6", 6.0, -32.0, "SC_MARKET", ["tdm", "ffa"]],
    ["sp_m7", 3.0, -28.0, "SC_MARKET", ["tdm", "ffa"]],
    ["sp_m9", 14.0, -29.0, "SC_MARKET", ["tdm", "ffa"]], ["sp_m10", 16.0, -46.0, "SC_MARKET", null],
    ["sp_m11", 20.0, -43.0, "SC_MARKET", null], ["sp_m12", 12.0, -45.0, "SC_MARKET", null],

    // ---- SC_GALLERY — the Storm Gallery, the GE strip and the whole of Kirov
    // Boulevard + the CYE gate lane (68 m of new territory).
    ["sp_g1", 20.0, -31.0, "SC_GALLERY", null], ["sp_g2", 20.0, -24.0, "SC_GALLERY", null],
    ["sp_g3", 21.0, -14.0, "SC_GALLERY", null], ["sp_g4", 19.0, -4.0, "SC_GALLERY", null],
    ["sp_g5", 20.0, 5.0, "SC_GALLERY", null], ["sp_g6", 19.0, 11.0, "SC_GALLERY", null],
    ["sp_g7", 26.0, -8.0, "SC_GALLERY", null], ["sp_g8", 26.0, 7.0, "SC_GALLERY", null],
    ["sp_g9", 32.0, -40.0, "SC_GALLERY", null], ["sp_g10", 36.0, -24.0, "SC_GALLERY", null],
    ["sp_g11", 43.0, -16.0, "SC_GALLERY", null], ["sp_g12", 33.0, 0.0, "SC_GALLERY", null],
    ["sp_g13", 42.0, 10.0, "SC_GALLERY", ["tdm", "ffa"]], ["sp_g14", 34.0, 20.0, "SC_GALLERY", null],
    ["sp_g15", 40.0, 32.0, "SC_GALLERY", ["tdm", "ffa"]], ["sp_g16", 24.0, 18.0, "SC_GALLERY", null],

    // ---- SC_PLAZA — FFA only by construction (side "mid").
    ["sp_p1", -20.0, -12.0, "SC_PLAZA", ["ffa"]], ["sp_p2", -14.0, -2.0, "SC_PLAZA", ["ffa"]],
    ["sp_p3", -2.0, -8.0, "SC_PLAZA", ["ffa"]], ["sp_p4", 8.0, -14.0, "SC_PLAZA", ["ffa"]],
    ["sp_p5", 11.0, 2.0, "SC_PLAZA", ["ffa"]], ["sp_p6", 2.0, 12.0, "SC_PLAZA", ["ffa"]],
    ["sp_p7", -8.0, 4.0, "SC_PLAZA", ["ffa"]], ["sp_p8", 6.0, -2.0, "SC_PLAZA", ["ffa"]],
  ],

  // CTF stand homes. flagWest is team 0's, flagEast is team 1's (arena.md §3.2).
  flagWest: [-33.5, 0, 12.0],
  flagEast: [6.5, 0, -30.0],

  // Spawn-director veto overrides (arena.md §2.4) — emitted into content.arena.
  vetoOverrides: { v1M: 12.0, v2LosM: 25.0, v3ConeM: 20.0 },

  // OPTIONAL probe extensions. Each has a generic fallback in probe_arena.mjs;
  // LANTERNWALK states them explicitly because its gate numbers were measured
  // against these exact values and must not drift when the probe generalises.
  //   flagMeta  — the emitted flag records' identity half (the home position
  //               comes from flagWest/flagEast above).
  //   gates.navSeed        — flood-fill origin for the walkable component; the
  //                          traversal ORDER seeds G-C/G-D sampling and G-E's
  //                          PRNG draws, so it is pinned, not derived.
  //   gates.mid            — "middle of the arena": G-I P3's path origin and
  //                          the inward-yaw target for side:"mid" clusters.
  //   gates.balconyAreaM2  — surface the 0.5 m GROUND grid cannot see (arena.md
  //                          §4.1: the arcade balcony ring), added to G-B.
  //   gates.tdmHomeWest/East — the TDM home clusters G-J measures parity on.
  flagMeta: [
    { id: "flag_amber", team: 0, node: "lantern_yard", standR: 1.2, standH: 2.5 },
    { id: "flag_slate", team: 1, node: "exchange_house", standR: 1.2, standH: 2.5 },
  ],
  gates: {
    navSeed: [-5, 0],
    mid: [-5, -2],
    balconyAreaM2: 250,
    tdmHomeWest: ["SC_LANTERN", "SC_ARCADE", "SC_WEST"],
    tdmHomeEast: ["SC_MARKET", "SC_GALLERY"],
  },
};
