// core/level/layout.js [A3 — wave-1 deliverable]
// THREE-free SINGLE SOURCE of the Meridian Ward map (BUILD_PLAN R1:
// level_design.md wins wholesale). colliders.js and level.js BOTH read this
// file, so visuals and collision can never drift (architecture §3.12).
//
// Coordinate convention (level_design §2.1): origin at map centre,
// +X = east, +Z = south, Y up (−Z is "north"). All metres.
// Playable bounds X ∈ [−60,+60], Z ∈ [−60,+60]; canal (water, non-playable)
// at Z ≥ +54. Mission axis runs south → north (Z +52 → Z −58).
//
// Everything here is AUTHORED metre-exact per level_design §2/§4/§6 — the
// `seed` parameter is accepted per the frozen signature and reserved for
// wave-2 cosmetic scatter (trash bags, paper decals); wave-1 placement uses
// no RNG so layout, colliders and nav are bit-identical for every seed.
//
// Exported extras beyond the architecture §3.12 shape (private additions,
// allowed by the freeze): `nodes` (R24 coordinates — colliders re-exports),
// `refSpawns` (the LD §6 spawn coordinates, REFERENCE data for probes and
// the contract gate; content.json [A2] is the authoritative runtime copy),
// `walkRects` (walkable-region rectangles for probes + nav seeding),
// `bounds`.

const BOUNDS = { min: [-60, -2, -60], max: [60, 14, 60] };

// ---------------------------------------------------------------- helpers
function box(id, kind, x0, x1, y0, y1, z0, z1, surface, matClass) {
  return {
    id, kind,
    min: [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)],
    max: [Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)],
    surface, matClass,
  };
}

// Staircases are runs of solid step boxes (riser 0.3 m — sim capsule step-up
// budget; see lane report needsElsewhere for A1's moveCapsule contract).
function steps(list, idp, x0, x1, zFrom, zTo, n, riser, yBase = 0) {
  // yBase (v2.2): lets a run start above a landing step — heights are
  // yBase + riser*(i+1). Solid columns from y 0 (AABB world, no inclines).
  const tread = (zTo - zFrom) / n;
  for (let i = 0; i < n; i++) {
    const za = zFrom + tread * i;
    const zb = zFrom + tread * (i + 1);
    list.push(box(`${idp}_${i}`, "step", x0, x1, 0, yBase + riser * (i + 1), za, zb, "concrete", "hard"));
  }
}

// Props: pos is the footprint centre, rot radians about Y. The collider AABB
// is the rotation-expanded bound of the footprint (conservative — rotations
// are kept near-axis so the expansion stays small). `cover` generates the
// authored cover node (combat_spec §5.8): pos = the crouch position on the
// protected side, dir = unit vector from that position THROUGH the cover
// toward the expected threat.
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

// ------------------------------------------------------- solid geometry
// Building masses (kind 'building'; concrete/hard unless noted). These are
// the blocks between the three lanes + flank of level_design §2.2/§2.3.
function makeBuildings() {
  const B = [];
  const bld = (id, x0, x1, z0, z1, h, floors = 1) => {
    const b = box(id, "building", x0, x1, 0, h, z0, z1, "concrete", "hard");
    B.push({
      id, kind: "building",
      footprint: { min: [b.min[0], b.min[2]], max: [b.max[0], b.max[2]] },
      floors, height: h, box: { min: b.min, max: b.max },
      surface: "concrete", matClass: "hard",
    });
  };

  // West zone — Tannery Alleys blockers (LD §2.3: dog-legs at Z+18 and Z−6)
  bld("bld_w1", -58, -48, 34, 42, 7);      // forces the quay mouth at (−44,+42)
  bld("bld_w2", -48, -41, 14, 22, 8);      // south dog-leg (Z+18)
  bld("bld_w3", -58, -51, -9, -2, 7);      // north dog-leg (Z−6)
  bld("bld_nw", -58, -41, -40, -30, 9);    // caps the alley's north end
  bld("bld_nbw", -41, -25, -40, -28, 9);   // south of cross-street CS1a
  bld("bld_m1", -41, -25, 6, 18, 8, 2);    // between arcade north wall and S-band

  // South band (quay facades; openings: alley mouth x[−48,−41],
  // plaza ramp x[−14,−6], boulevard x[+28,+46])
  bld("bld_s1", -41, -14, 18, 42, 9, 2);
  bld("bld_s2", -6, 15, 18, 42, 8, 2);
  bld("bld_s3", 15, 28, 14, 42, 9, 2);

  // North blocks (market street runs x[−12.5,0] between them)
  bld("bld_nw2", -25, -12.5, -40, -28, 8, 2);
  bld("bld_nea", 0, 13, -40, -18, 9, 2);
  bld("bld_neb", 13, 15, -40, -22, 9, 2);  // carved for the plaza NE cut
  bld("bld_gna", 15, 24, -40, -34, 9);
  bld("bld_gnb", 24, 28, -39, -34, 9);

  // East facades along the boulevard
  bld("bld_e1", 46, 58, -40, 42, 10, 3);
  bld("bld_e2", 46, 58, -52, -40, 10, 3);

  // Customs flanking masses
  bld("bld_cw", -58, -18, -58, -40, 10, 2);
  bld("bld_ce", 24, 58, -58, -52, 10, 2);

  // Gatehouse (LD §2.2: (+8,−52); lit interior is a fake practical)
  bld("bld_gatehouse", 5, 11, -55, -50, 3.2);

  // Storm Gallery east strip (GE) between gallery and boulevard, carved by
  // the gallery east door (z[−32,−28]) and the plaza NE cut (z[−22,−18])
  bld("bld_ge_a", 24.5, 28, -34, -32, 8);
  bld("bld_ge_b", 24.5, 28, -28, -22, 8);
  bld("bld_ge_c", 24.5, 28, -18, 14, 8, 2);

  // Pale Lantern Arcade — 2-storey shell; the interior is built from wall/
  // slab/step pieces in makeWalls(), so this entry carries NO collider box.
  B.push({
    id: "bld_arcade", kind: "arcade",
    footprint: { min: [-41, -20], max: [-25, 6] },
    floors: 2, height: 8.5, box: null,
    surface: "concrete", matClass: "hard",
  });

  return B;
}

// Walls, slabs, roofs, steps, headers, perimeter, deck (kind ≠ 'building').
function makeWalls() {
  const W = [];
  const push = (...a) => W.push(box(...a));

  // Perimeter (LD §2.1 playable bounds; exfil gate at (0,−58))
  push("per_n_w", "wall", -60, -3, 0, 6, -60, -58, "concrete", "hard");
  push("per_gate9", "gate", -3, 3, 0, 2.6, -60, -58, "metal", "metal_thin");
  push("per_n_e", "wall", 3, 60, 0, 6, -60, -58, "concrete", "hard");
  push("per_w", "wall", -60, -58, 0, 6, -58, 60, "concrete", "hard");
  push("per_e", "wall", 58, 60, 0, 6, -58, 60, "concrete", "hard");
  // Canal coping + railing — keeps the play space out of the water while the
  // S1 vista still reads over it (visual railing lands in wave 2).
  push("canal_edge", "wall", -58, 58, 0, 2.2, 54, 58, "concrete", "hard");

  // Customs east parapet — low so the tram platform overlooks the yard
  // (LD §2.5) but too tall to mantle (combat_spec §1.5: ledge ≤ 1.35 m).
  push("wall_ce_parapet", "wall", 24, 28, 0, 1.6, -52, -44, "concrete", "hard");

  // ---- Pale Lantern Arcade shell (x[−41,−25], z[−20,+6]; LD §2.4/§2.5)
  // West wall (door to alley at z[−4,0])
  push("arc_w_1", "wall", -41, -39, 0, 8.2, -20, -4, "concrete", "hard");
  push("arc_w_2", "wall", -41, -39, 0, 8.2, 0, 6, "concrete", "hard");
  push("hdr_arc_wdoor", "wall", -41, -39, 2.3, 8.2, -4, 0, "concrete", "hard");
  // South / north walls
  push("arc_s", "wall", -39, -26, 0, 8.2, -20, -19, "concrete", "hard");
  push("arc_n", "wall", -39, -26, 0, 8.2, 5, 6, "concrete", "hard");
  // East wall — ground doors to the plaza at z[−13.5,−10.5] and z[+0.5,+3.5]
  // (LD §2.3 C2); upper window band y[5.3,7.3] overlooks the plaza (§2.5).
  push("arc_e_b1", "wall", -26, -25, 0, 5.3, -20, -13.5, "concrete", "hard");
  push("arc_e_b2", "wall", -26, -25, 0, 5.3, -10.5, 0.5, "concrete", "hard");
  push("arc_e_b3", "wall", -26, -25, 0, 5.3, 3.5, 6, "concrete", "hard");
  push("hdr_arc_edoor1", "wall", -26, -25, 2.3, 5.3, -13.5, -10.5, "concrete", "hard");
  push("hdr_arc_edoor2", "wall", -26, -25, 2.3, 5.3, 0.5, 3.5, "concrete", "hard");
  push("arc_e_m1", "wall", -26, -25, 5.3, 7.3, -20, -16, "concrete", "hard");
  push("arc_e_m2", "wall", -26, -25, 5.3, 7.3, -13, -9, "concrete", "hard");
  push("arc_e_m3", "wall", -26, -25, 5.3, 7.3, -6, -2, "concrete", "hard");
  push("arc_e_m4", "wall", -26, -25, 5.3, 7.3, 1, 6, "concrete", "hard");
  push("arc_e_hdr", "wall", -26, -25, 7.3, 8.2, -20, 6, "concrete", "hard");
  // Roof with the broken-skylight hole over the lightwell (x[−35,−29],
  // z[−11,−5]) — the L_ARCADE_SKY shaft + rain drip come through here.
  push("arc_roof_w", "roof", -41, -35, 8.2, 8.5, -20, 6, "concrete", "hard");
  push("arc_roof_e", "roof", -29, -25, 8.2, 8.5, -20, 6, "concrete", "hard");
  push("arc_roof_n", "roof", -35, -29, 8.2, 8.5, -20, -11, "concrete", "hard");
  push("arc_roof_s", "roof", -35, -29, 8.2, 8.5, -5, 6, "concrete", "hard");
  // Upper floor slabs at y 4.2 (balcony ring around the lightwell; voids cut
  // for the NW and SE staircases)
  push("arc_slab_wa", "slab", -39, -37.6, 3.95, 4.2, -15.1, 5, "concrete", "hard");
  push("arc_slab_wb", "slab", -37.6, -35, 3.95, 4.2, -19, 5, "concrete", "hard");
  push("arc_slab_n", "slab", -35, -29, 3.95, 4.2, -19, -11, "concrete", "hard");
  push("arc_slab_s", "slab", -35, -29, 3.95, 4.2, -5, 5, "concrete", "hard");
  push("arc_slab_ea", "slab", -29, -27.4, 3.95, 4.2, -19, 5, "concrete", "hard");
  // v2.2: south edge 1 → 0.5 so the shifted SE stair (base 4.4, see below)
  // LANDS at the slab edge instead of sliding its top two steps underneath
  // (slab underside 3.95 left 0.05 m headroom over the 3.9 step — nav
  // dropped that floor and the stair chain broke).
  push("arc_slab_eb", "slab", -27.4, -26, 3.95, 4.2, -19, 0.5, "concrete", "hard");
  // Lightwell balcony railing (metal, thin — penetrable per combat_spec §3.2)
  push("rail_lw_n", "rail", -35, -29, 4.2, 5.2, -11.08, -11, "metal", "metal_thin");
  push("rail_lw_s", "rail", -35, -29, 4.2, 5.2, -5, -4.92, "metal", "metal_thin");
  push("rail_lw_w", "rail", -35.08, -35, 4.2, 5.2, -11, -5, "metal", "metal_thin");
  push("rail_lw_e", "rail", -29, -28.92, 4.2, 5.2, -11, -5, "metal", "metal_thin");
  // Staircases (LD §2.5: NW (−38,−16) and SE (−27,+4) corners)
  // v2.2 (A0 wave-3, measured): BOTH arcade staircases were physically
  // unclimbable — their base steps sat flush against 8.2 m shell walls
  // (arc_s / arc_n), so the only capsule-legal approach band (r 0.35 needs
  // ~0.5 m beyond the base row) was inside the wall. obj_cinderlock at
  // arcade_upper was unreachable for player AND bots; the full-mission e2e
  // deadlocked at beat 4. Fix: a 1.0 m-deep LANDING step at each base
  // (side-entry band ~0.9 m from the open side), then 13 risers at
  // yBase 0.3 — riser 0.3 and tread 0.223 keep the moveCapsule step-up
  // cadence (footprint 0.21 lifts feet per tread). Summits unchanged.
  steps(W, "arc_stair_nw_L", -39, -37.6, -19, -18.0, 1, 0.3);
  steps(W, "arc_stair_nw", -39, -37.6, -18.0, -15.1, 13, 0.3, 0.3);
  steps(W, "arc_stair_se_L", -27.4, -26, 4.4, 3.4, 1, 0.3);
  steps(W, "arc_stair_se", -27.4, -26, 3.4, 0.5, 13, 0.3, 0.3);

  // ---- Storm Gallery (x[+15.5,+24.5] walls, z[−34,+14]; LD §2.3 flank)
  // West wall (plaza door z[+8,+12]; NE-cut crossing z[−22,−18])
  push("gal_w_1", "wall", 15.5, 17, 0, 5.5, -33, -22, "concrete", "hard");
  push("gal_w_2", "wall", 15.5, 17, 0, 5.5, -18, 8, "concrete", "hard");
  push("gal_w_3", "wall", 15.5, 17, 0, 5.5, 12, 13, "concrete", "hard");
  push("hdr_gal_w_cut", "wall", 15.5, 17, 2.6, 5.5, -22, -18, "concrete", "hard");
  push("hdr_gal_w_door", "wall", 15.5, 17, 2.4, 5.5, 8, 12, "concrete", "hard");
  // East wall (boulevard door z[−32,−28]; NE-cut crossing z[−22,−18])
  push("gal_e_1", "wall", 23, 24.5, 0, 5.5, -33, -32, "concrete", "hard");
  push("gal_e_2", "wall", 23, 24.5, 0, 5.5, -28, -22, "concrete", "hard");
  push("gal_e_3", "wall", 23, 24.5, 0, 5.5, -18, 13, "concrete", "hard");
  push("hdr_gal_e_door", "wall", 23, 24.5, 2.4, 5.5, -32, -28, "concrete", "hard");
  push("hdr_gal_e_cut", "wall", 23, 24.5, 2.6, 5.5, -22, -18, "concrete", "hard");
  // End caps + roof (covered arcade — one of the 4 rain-occlusion volumes)
  push("gal_cap_s", "wall", 15.5, 24.5, 0, 5.5, 13, 14, "concrete", "hard");
  push("gal_cap_n", "wall", 15.5, 24.5, 0, 5.5, -34, -33, "concrete", "hard");
  push("gal_roof", "roof", 17, 23, 4.6, 5.0, -33, 13, "concrete", "hard");
  // GE strip tunnel headers (gallery east door + NE cut pass through it)
  push("hdr_ge_door", "wall", 24.5, 28, 2.6, 8, -32, -28, "concrete", "hard");
  push("hdr_ge_cut", "wall", 24.5, 28, 2.6, 8, -22, -18, "concrete", "hard");

  // ---- Tram platform (LD §2.5: deck y+4.5, stairs at X+30, ramp at X+46)
  push("plat_deck", "deck", 28, 44.5, 0, 4.5, -52, -44, "concrete", "hard");
  steps(W, "plat_stair", 29, 31.5, -40.2, -44, 15, 0.3);
  steps(W, "plat_ramp", 44.5, 46, -40, -52, 15, 0.3);
  // Canopy over half the deck (LD §4.2) — 4th rain-occlusion volume
  push("plat_canopy", "roof", 30, 44, 7.3, 7.6, -52, -48, "metal", "metal_thin");
  push("plat_post_1", "post", 30.875, 31.125, 4.5, 7.3, -51.125, -50.875, "metal", "hard");
  push("plat_post_2", "post", 36.875, 37.125, 4.5, 7.3, -51.125, -50.875, "metal", "hard");
  push("plat_post_3", "post", 42.875, 43.125, 4.5, 7.3, -51.125, -50.875, "metal", "hard");

  return W;
}

// ---------------------------------------------------------------- props
// Dressing per LD §4.2 with cover density per §2.6. Solid props become
// collider boxes; `solid:false` props are wave-2 visual dressing recorded
// here so the single source stays single.
function makeProps() {
  const P = [];
  const p = (...a) => P.push(prop(...a));
  const N = { dir: [0, 0, -1] }; // threat north (player-side cover)
  const S = { dir: [0, 0, 1] };  // threat south (bot-side / defense cover)

  // -- Dockside Cut (5 cover pieces — teach, don't fight; LD §2.6)
  p("q_van", "van", -24, 48, 0.18, 2.2, 5.2, 2.4, "metal", "metal_thin",
    { cover: { ...N, height: "high" } });
  p("q_crate_1", "crate", -52, 45, 0.3, 1.2, 1.2, 1.2, "wood", "soft");
  p("q_crate_2", "crate", -48, 50, -0.2, 1.2, 1.2, 1.2, "wood", "soft");
  p("q_crate_3", "crate", -26, 44, 0.5, 1.2, 1.2, 1.2, "wood", "soft",
    { cover: { ...N, height: "low" } });
  p("q_crate_4", "crate", 8, 50, 0.9, 1.2, 1.2, 1.2, "wood", "soft",
    { cover: { ...N, height: "low" } });
  p("q_crate_5", "crate", -12, 52, -0.7, 1.2, 1.2, 1.2, "wood", "soft");
  p("q_crate_6", "crate", 22, 45, 0.4, 1.2, 1.2, 1.2, "wood", "soft",
    { cover: { ...N, height: "low" } });
  p("q_pallet_1", "pallet", -44, 52, 0.1, 1.2, 1.0, 0.9, "wood", "soft");
  p("q_pallet_2", "pallet", -34, 52.5, -0.3, 1.2, 1.0, 0.9, "wood", "soft");
  p("q_pallet_3", "pallet", 14, 46, 0, 1.2, 1.0, 0.9, "wood", "soft",
    { cover: { ...N, height: "low" } });
  p("q_pallet_4", "pallet", 30, 52, 0.6, 1.2, 1.0, 0.9, "wood", "soft");
  for (let i = 0; i < 8; i++) {
    p(`q_bollard_${i + 1}`, "bollard", -54 + i * 14, 53.2, 0, 0.35, 0.35, 0.65,
      "metal", "hard");
  }
  // Chain-link gate panel across part of the boulevard mouth
  p("q_gate", "fence", 33, 41.6, 0, 6, 0.15, 2.2, "metal", "metal_thin");
  p("q_rope_1", "rope", -40, 46, 0.4, 0.8, 0.8, 0.3, "wood", "soft", { solid: false });
  p("q_rope_2", "rope", 4, 52, 1.1, 0.8, 0.8, 0.3, "wood", "soft", { solid: false });
  p("q_rope_3", "rope", 36, 47, -0.5, 0.8, 0.8, 0.3, "wood", "soft", { solid: false });

  // -- Tannery Alleys (9 cover pieces; steam vents in the light beams)
  p("al_dump_1", "dumpster", -55, 31, 0.1, 1.7, 1.1, 1.25, "metal", "metal_thin",
    { cover: { ...N, height: "high" } });
  p("al_dump_2", "dumpster", -46.5, 25, -0.15, 1.7, 1.1, 1.25, "metal", "metal_thin",
    { cover: { ...N, height: "high" } });
  p("al_dump_3", "dumpster", -55.5, 8, 0.2, 1.7, 1.1, 1.25, "metal", "metal_thin",
    { cover: { ...N, height: "high" } });
  p("al_dump_4", "dumpster", -51, 2, 1.5708, 1.7, 1.1, 1.25, "metal", "metal_thin",
    { cover: { ...N, height: "high" } });
  p("al_dump_5", "dumpster", -45, -8, -0.1, 1.7, 1.1, 1.25, "metal", "metal_thin",
    { cover: { ...N, height: "high" } });
  p("al_dump_6", "dumpster", -48, -16, 0.25, 1.7, 1.1, 1.25, "metal", "metal_thin",
    { cover: { ...N, height: "high" } });
  p("al_van", "van", -46, 37, 0.15, 2.2, 5.2, 2.4, "metal", "metal_thin",
    { cover: { ...N, height: "high" } });
  p("al_scaf_1", "scaffold", -48.3, 17, 0, 0.6, 4, 6, "metal", "metal_thin",
    { cover: { dir: [1, 0, 0], height: "high" } });
  p("al_scaf_2", "scaffold", -41.35, -12, 0, 0.6, 6, 6, "metal", "metal_thin",
    { cover: { dir: [1, 0, 0], height: "high" } });
  p("vent_alley_1", "steam_vent", -52, 20, 0, 0.6, 0.6, 0.1, "metal", "hard",
    { solid: false, flags: { steam: true } });
  p("vent_alley_2", "steam_vent", -46, -14, 0, 0.6, 0.6, 0.1, "metal", "hard",
    { solid: false, flags: { steam: true } });
  // AC units flush-mounted on real building faces (LD §4.1 rule 5 — mount
  // plate against the wall; flags.n = outward face normal for props.js)
  p("al_ac_1", "ac_unit", -47.73, 38, 0, 0.8, 0.5, 0.6, "metal", "metal_thin",
    { solid: false, y0: 2.8, flags: { wallMount: true, n: [1, 0] } });   // bld_w1 E face
  p("al_ac_2", "ac_unit", -48.27, 18, 0, 0.8, 0.5, 0.6, "metal", "metal_thin",
    { solid: false, y0: 2.8, flags: { wallMount: true, n: [-1, 0] } });  // bld_w2 W face
  p("al_ac_3", "ac_unit", -50.73, -5.5, 0, 0.8, 0.5, 0.6, "metal", "metal_thin",
    { solid: false, y0: 2.8, flags: { wallMount: true, n: [1, 0] } });   // bld_w3 E face
  p("al_ac_4", "ac_unit", -41.27, 26, 0, 0.8, 0.5, 0.6, "metal", "metal_thin",
    { solid: false, y0: 2.8, flags: { wallMount: true, n: [-1, 0] } });  // bld_s1 W face
  for (let i = 0; i < 6; i++) {
    p(`al_trash_${i + 1}`, "trash_bags", -54 + (i % 3) * 4, 28 - i * 8, i * 0.7,
      1.0, 1.0, 0.6, "wood", "soft", { solid: false });
  }

  // -- Pale Lantern Arcade interior (stalls hug the walls; LD §4.2)
  // (x −36.2: keeps the stall footprint clear of the NW stair run at x −37.6
  // — the §4.1 contact gate flagged the original −36.5 as an edge-toucher)
  p("arc_stall_1", "stall", -36.2, -18.1, 0, 2.2, 1.6, 2.4, "wood", "soft",
    { cover: { ...N, height: "high" } });
  p("arc_stall_2", "stall", -33, -18.1, 0, 2.2, 1.6, 2.4, "wood", "soft",
    { cover: { ...N, height: "high" } });
  p("arc_stall_3", "stall", -29.5, -18.1, 0, 2.2, 1.6, 2.4, "wood", "soft",
    { cover: { ...N, height: "high" } });
  p("arc_stall_4", "stall", -36.5, 4.1, 0, 2.2, 1.6, 2.4, "wood", "soft",
    { cover: { ...S, height: "high" } });
  p("arc_stall_5", "stall", -33, 4.1, 0, 2.2, 1.6, 2.4, "wood", "soft",
    { cover: { ...S, height: "high" } });
  p("arc_stall_6", "stall", -29.8, 4.1, 0, 2.2, 1.6, 2.4, "wood", "soft",
    { cover: { ...S, height: "high" } });
  p("arc_stall_7", "stall", -38.1, -7.5, 1.5708, 2.2, 1.6, 2.4, "wood", "soft",
    { cover: { ...N, height: "high" } });
  p("arc_stall_8", "stall", -38.1, 1.8, 1.5708, 2.2, 1.6, 2.4, "wood", "soft",
    { cover: { ...S, height: "high" } });
  p("arc_kiosk", "kiosk", -32, -1.5, 0.2, 2.4, 2.4, 2.2, "wood", "soft",
    { cover: { ...N, height: "high" } });
  p("arc_table", "table", -34, -12, 0, 1.4, 0.7, 0.95, "wood", "soft",
    { y0: 4.2, flags: { handoff: true } }); // CINDERLOCK case (beat 4)
  p("arc_chairs", "chairs", -27.5, -16, 0.4, 0.9, 0.9, 1.1, "wood", "soft",
    { solid: false });
  p("arc_fan_1", "ceiling_fan", -32, -14, 0, 1.4, 1.4, 0.3, "metal", "metal_thin",
    { solid: false, y0: 3.6, flags: { turning: true } });
  p("arc_fan_2", "ceiling_fan", -32, 1, 0, 1.4, 1.4, 0.3, "metal", "metal_thin",
    { solid: false, y0: 3.6 });

  // -- Meridian Market plaza (14 cover pieces — densest; LD §2.6)
  p("pl_car_1", "car", -20, -12, 0.3, 1.9, 4.4, 1.3, "metal", "metal_thin",
    { cover: { ...N, height: "low" } });
  p("pl_car_2", "car", -17, 4, -1.2, 1.9, 4.4, 1.3, "metal", "metal_thin",
    { cover: { ...N, height: "low" }, flags: { alarmBlink: true } });
  p("pl_car_3", "car", 11, -14, 2.0, 1.9, 4.4, 1.3, "metal", "metal_thin",
    { cover: { ...N, height: "low" } });
  p("pl_car_4", "car", 12, 12, 1.7, 1.9, 4.4, 1.3, "metal", "metal_thin",
    { cover: { ...S, height: "low" } });
  p("pl_car_5", "car", -1, 14.5, -0.4, 1.9, 4.4, 1.3, "metal", "metal_thin",
    { cover: { ...N, height: "low" }, flags: { alarmBlink: true } });
  p("pl_car_6", "car", -21.5, 14, 0.9, 1.9, 4.4, 1.3, "metal", "metal_thin",
    { cover: { ...N, height: "low" } });
  p("pl_kiosk_1", "kiosk", -11, -11, 0.1, 2.6, 2.6, 2.3, "wood", "soft",
    { cover: { ...N, height: "high" } });
  p("pl_kiosk_2", "kiosk", -4, -4, -0.2, 2.6, 2.6, 2.3, "wood", "soft",
    { cover: { ...N, height: "high" } });
  p("pl_kiosk_3", "kiosk", 4, -2, 0.15, 2.6, 2.6, 2.3, "wood", "soft",
    { cover: { ...N, height: "high" } });
  p("pl_kiosk_4", "kiosk", -16, 11, -0.1, 2.6, 2.6, 2.3, "wood", "soft",
    { cover: { ...S, height: "high" } });
  p("pl_kiosk_5", "kiosk", -22.5, -3, 0.05, 2.6, 2.6, 2.3, "wood", "soft",
    { cover: { dir: [1, 0, 0], height: "high" } });
  p("pl_plant_1", "planter", -8, -9, 0, 2.0, 0.8, 0.9, "concrete", "hard",
    { cover: { ...N, height: "low" } });
  p("pl_plant_2", "planter", 2, -16, 0, 2.0, 0.8, 0.9, "concrete", "hard",
    { cover: { ...N, height: "low" } });
  p("pl_plant_3", "planter", -15, 15.5, 1.5708, 2.0, 0.8, 0.9, "concrete", "hard",
    { cover: { ...N, height: "low" } });
  p("pl_newsbox_1", "newsbox", 14.3, 2, 0, 0.6, 0.6, 1.1, "metal", "metal_thin");
  p("pl_newsbox_2", "newsbox", -24.3, 6.5, 0, 0.6, 0.6, 1.1, "metal", "metal_thin");
  p("pl_newsbox_3", "newsbox", 0, -17.5, 0, 0.6, 0.6, 1.1, "metal", "metal_thin");
  p("pl_newsbox_4", "newsbox", 9, 17.3, 0, 0.6, 0.6, 1.1, "metal", "metal_thin");
  p("pl_phone", "phone_booth", 14.2, 8, 0, 1.0, 1.0, 2.5, "metal", "metal_thin");
  p("pl_transformer", "transformer_pole", 14.55, -6, 0, 0.45, 0.45, 6.5,
    "metal", "hard", { flags: { transformer: true } }); // beat-3 blackout source
  p("pl_manhole", "steam_vent", 2, 12, 0, 0.8, 0.8, 0.05, "metal", "hard",
    { solid: false, flags: { steam: true } });
  // explicit positions (the loop-generated set clipped pl_car_5 — §4.1 gate)
  [[-18, -16.5], [-12, 17], [-6, -16.8], [5, 16.8], [10, -16.7], [12, 17.3]]
    .forEach(([tx, tz], i) => {
      p(`pl_trash_${i + 1}`, "trash_bags", tx, tz, i, 1.0, 1.0, 0.6,
        "wood", "soft", { solid: false });
    });

  // -- Market street (thin on purpose — pre-gate sprint; LD §2.6)
  p("ms_car_1", "car", -9, -28, 0.2, 1.9, 4.4, 1.3, "metal", "metal_thin",
    { cover: { ...N, height: "low" } });
  p("ms_car_2", "car", -3.5, -22, -0.15, 1.9, 4.4, 1.3, "metal", "metal_thin",
    { cover: { ...N, height: "low" } });
  p("ms_barrier_1", "barrier", -6, -33, 0.1, 2.0, 0.6, 1.1, "concrete", "hard",
    { cover: { ...N, height: "low" } });
  p("ms_barrier_2", "barrier", -9.5, -36, -0.2, 2.0, 0.6, 1.1, "concrete", "hard",
    { cover: { ...N, height: "low" } });

  // -- Storm Gallery (5 cover pieces; near-dark CQB)
  p("gal_shelf_1", "shelving", 17.3, -26, 0, 0.5, 1.8, 1.8, "metal", "metal_thin",
    { cover: { ...N, height: "high" } });
  p("gal_shelf_2", "shelving", 22.7, -14, 0, 0.5, 1.8, 1.8, "metal", "metal_thin",
    { cover: { ...N, height: "high" } });
  p("gal_shelf_3", "shelving", 17.3, 2, 0, 0.5, 1.8, 1.8, "metal", "metal_thin",
    { cover: { ...S, height: "high" } });
  p("gal_dump_1", "dumpster", 17.6, -31, 0, 1.1, 1.7, 1.25, "metal", "metal_thin",
    { cover: { ...N, height: "high" } });
  p("gal_dump_2", "dumpster", 22.4, 6, 0, 1.1, 1.7, 1.25, "metal", "metal_thin",
    { cover: { ...S, height: "high" } });
  p("vent_gallery", "steam_vent", 20, -10, 0, 0.6, 0.6, 0.1, "metal", "hard",
    { solid: false, flags: { steam: true } });
  p("gal_bucket", "mop_bucket", 21.5, -20.5, 0, 0.4, 0.4, 0.5, "metal", "metal_thin",
    { solid: false });
  // breaker boxes on the gallery interior faces (LD §4.2; wall-mounted)
  p("gal_breaker_1", "breaker_box", 17.09, -24, 0, 0.4, 0.18, 0.6, "metal", "metal_thin",
    { solid: false, y0: 1.3, flags: { wallMount: true, n: [1, 0] } });
  p("gal_breaker_2", "breaker_box", 22.91, -8, 0, 0.4, 0.18, 0.6, "metal", "metal_thin",
    { solid: false, y0: 1.3, flags: { wallMount: true, n: [-1, 0] } });
  p("gal_breaker_3", "breaker_box", 17.09, 6, 0, 0.4, 0.18, 0.6, "metal", "metal_thin",
    { solid: false, y0: 1.3, flags: { wallMount: true, n: [1, 0] } });

  // -- Tramline Boulevard (cars at roadway EDGES only, centre lane clear)
  p("bl_car_1", "car", 30.6, 8, 0.1, 1.9, 4.4, 1.3, "metal", "metal_thin",
    { cover: { ...N, height: "low" }, flags: { headlights: true } }); // LD §3.3
  p("bl_car_2", "car", 44, 3, -0.08, 1.9, 4.4, 1.3, "metal", "metal_thin",
    { cover: { ...N, height: "low" } });
  p("bl_car_3", "car", 30.4, -10, 0.12, 1.9, 4.4, 1.3, "metal", "metal_thin",
    { cover: { ...N, height: "low" } });
  p("bl_car_4", "car", 44.2, -16, -0.1, 1.9, 4.4, 1.3, "metal", "metal_thin",
    { cover: { ...N, height: "low" } });
  p("bl_car_5", "car", 30.5, -26, 0.15, 1.9, 4.4, 1.3, "metal", "metal_thin",
    { cover: { ...N, height: "low" } });
  p("bl_car_6", "car", 44, -32, -0.12, 1.9, 4.4, 1.3, "metal", "metal_thin",
    { cover: { ...N, height: "low" } });
  p("bl_car_7", "car", 30.5, 24, 0.1, 1.9, 4.4, 1.3, "metal", "metal_thin",
    { cover: { ...N, height: "low" } });
  p("bl_shelter", "tram_shelter", 43.6, -2, 0, 1.6, 4.0, 2.6, "glass", "soft");
  p("bl_plant_1", "planter", 29.2, 32, 1.5708, 2.0, 0.8, 0.9, "concrete", "hard",
    { cover: { ...N, height: "low" } });
  p("bl_plant_2", "planter", 43, 18, 1.5708, 2.0, 0.8, 0.9, "concrete", "hard",
    { cover: { ...N, height: "low" } });
  p("bl_bench", "bench", 45.2, 12, 0, 0.6, 1.8, 0.9, "wood", "soft");
  // Barricade line at Z+38 (LD §2.2; the S2/beat-5 player line)
  p("bl_barr_1", "barrier", 33, 38, 0, 2.0, 0.6, 1.1, "concrete", "hard",
    { cover: { ...N, height: "low" } });
  p("bl_barr_2", "barrier", 37, 38.3, 0, 2.0, 0.6, 1.1, "concrete", "hard",
    { cover: { ...N, height: "low" } });
  p("bl_barr_3", "barrier", 41, 38, 0, 2.0, 0.6, 1.1, "concrete", "hard",
    { cover: { ...N, height: "low" } });

  // -- Tram platform deck (y 4.5; marksman nest is a Vektor emplacement)
  p("pf_bench_1", "bench", 34, -47, 0, 1.8, 0.6, 0.9, "wood", "soft", { y0: 4.5 });
  p("pf_bench_2", "bench", 41, -47, 0, 1.8, 0.6, 0.9, "wood", "soft", { y0: 4.5 });
  p("pf_ticket", "ticket_machine", 31, -50.5, 0, 0.8, 0.6, 1.9, "metal", "metal_thin",
    { y0: 4.5 });
  p("pf_board", "route_board", 43, -50.2, 0, 1.2, 0.2, 2.2, "metal", "metal_thin",
    { y0: 4.5 });
  p("pf_bin_1", "bin", 36, -50, 0, 0.5, 0.5, 0.9, "metal", "metal_thin", { y0: 4.5 });
  p("pf_bin_2", "bin", 40, -44.7, 0, 0.5, 0.5, 0.9, "metal", "metal_thin", { y0: 4.5 });
  p("pf_nest_front", "sandbags", 38, -47.3, 0, 2.2, 0.8, 1.0, "dirt", "hard",
    { y0: 4.5, cover: { ...S, height: "low" } });
  p("pf_nest_l", "sandbags", 36.9, -46.2, 0, 0.8, 1.4, 1.0, "dirt", "hard", { y0: 4.5 });
  p("pf_nest_r", "sandbags", 39.1, -46.2, 0, 0.8, 1.4, 1.0, "dirt", "hard", { y0: 4.5 });

  // -- Customs Yard / Gate 9 (defense arena: strong at the gate, weak at the
  // mouths; 12 jerseys + 6 sandbag emplacements per LD §2.6)
  p("cu_jersey_1", "barrier", -10, -44, 0.1, 2.0, 0.64, 1.07, "concrete", "hard",
    { cover: { ...S, height: "low" } });
  p("cu_jersey_2", "barrier", -7, -45.5, -0.15, 2.0, 0.64, 1.07, "concrete", "hard",
    { cover: { ...S, height: "low" } });
  p("cu_jersey_3", "barrier", -4, -44.2, 0.05, 2.0, 0.64, 1.07, "concrete", "hard",
    { cover: { ...S, height: "low" } });
  p("cu_jersey_4", "barrier", -1, -45.5, 0.12, 2.0, 0.64, 1.07, "concrete", "hard",
    { cover: { ...S, height: "low" } });
  p("cu_jersey_5", "barrier", 2, -44, -0.08, 2.0, 0.64, 1.07, "concrete", "hard",
    { cover: { ...S, height: "low" } });
  p("cu_jersey_6", "barrier", 6, -45.3, 0.1, 2.0, 0.64, 1.07, "concrete", "hard",
    { cover: { ...S, height: "low" } });
  p("cu_jersey_7", "barrier", 12, -44.2, -0.12, 2.0, 0.64, 1.07, "concrete", "hard",
    { cover: { ...S, height: "low" } });
  p("cu_jersey_8", "barrier", 12.8, -46.8, 0.06, 2.0, 0.64, 1.07, "concrete", "hard",
    { cover: { ...S, height: "low" } });
  p("cu_jersey_9", "barrier", 22, -48.5, 0.3, 2.0, 0.64, 1.07, "concrete", "hard",
    { cover: { ...S, height: "low" } });
  p("cu_jersey_10", "barrier", -14, -52, -0.2, 2.0, 0.64, 1.07, "concrete", "hard",
    { cover: { ...S, height: "low" } });
  p("cu_jersey_11", "barrier", 13, -55, 0.15, 2.0, 0.64, 1.07, "concrete", "hard",
    { cover: { ...S, height: "low" } });
  p("cu_jersey_12", "barrier", 20, -53, -0.1, 2.0, 0.64, 1.07, "concrete", "hard",
    { cover: { ...S, height: "low" } });
  p("cu_sand_1", "sandbags", -8, -50, 0, 1.8, 1.2, 1.0, "dirt", "hard",
    { cover: { ...S, height: "low" } });
  p("cu_sand_2", "sandbags", -4, -51, 0, 1.8, 1.2, 1.0, "dirt", "hard",
    { cover: { ...S, height: "low" } });
  p("cu_sand_3", "sandbags", 2, -49, 0.2, 1.8, 1.2, 1.0, "dirt", "hard",
    { cover: { ...S, height: "low" } });
  p("cu_sand_4", "sandbags", 12.5, -50.5, 0, 1.8, 1.2, 1.0, "dirt", "hard",
    { cover: { ...S, height: "low" } });
  p("cu_sand_5", "sandbags", 19.5, -46.5, 0, 1.8, 1.2, 1.0, "dirt", "hard",
    { cover: { ...S, height: "low" } });
  p("cu_sand_6", "sandbags", -12, -46.5, 0, 1.8, 1.2, 1.0, "dirt", "hard",
    { cover: { ...S, height: "low" } });
  p("cu_truck_1", "truck", -14, -55.5, 1.5708, 2.5, 7, 3, "metal", "metal_thin",
    { cover: { ...S, height: "high" } });
  p("cu_truck_2", "truck", 16, -46, 0, 2.5, 7, 3, "metal", "metal_thin",
    { cover: { ...S, height: "high" } });
  p("cu_hut", "guard_hut", 20.5, -56, 0, 3, 2.5, 2.6, "metal", "metal_thin");
  p("cu_drums", "fuel_drums", 9.2, -43.9, 0, 1.8, 1.6, 0.9, "metal", "metal_thin",
    { flags: { explodable: true } }); // beat-6 set-piece tool (fx-pool light)
  p("cu_pallet_1", "pallet", -16, -42.5, 0, 1.2, 1.0, 0.9, "wood", "soft");
  p("cu_pallet_2", "pallet", 22, -42.5, 0, 1.2, 1.0, 0.9, "wood", "soft");
  p("cu_pallet_3", "pallet", -16, -48.5, 0, 1.2, 1.0, 0.9, "wood", "soft");
  p("cu_tower_w", "flood_tower", -14, -44, 0, 1.2, 1.2, 9, "metal", "hard",
    { flags: { floodTower: true } });
  p("cu_tower_e", "flood_tower", 18, -44, 0, 1.2, 1.2, 9, "metal", "hard",
    { flags: { floodTower: true } });
  // (z −47.2: LD names (−6, −46) but that clips jersey cu_jersey_2 — A3 owns
  // coordinate adjustments inside the designated area; §4.1 gate enforced)
  p("vent_customs", "steam_vent", -6, -47.2, 0, 0.6, 0.6, 0.1, "metal", "hard",
    { solid: false, flags: { steam: true } });

  return P;
}

// -------------------------------------------------- nodes / spawns / zones
// R24 frozen node key set — the ONLY keys content.json may reference
// (contract-gated at load). Coordinates from level_design §2.
const NODES = {
  dock_spawn: [-38, 0, 50],
  quay_mid: [0, 0, 48],
  alley_dogleg_s: [-50, 0, 18],
  alley_dogleg_n: [-48, 0, -6],
  arcade_ground: [-32, 0, -7],
  arcade_upper: [-33, 4.2, -14],
  plaza_center: [-5, 0, 0],
  plaza_west: [-20, 0, 0],
  gallery_mid: [20, 0, -4],
  blvd_barricade: [37, 0, 36],
  blvd_mid: [37, 0, -2],
  platform_deck: [38, 4.5, -48],
  customs_sandbags: [-2, 0, -50],
  gate9: [4, 0, -52],
  exfil: [0, 0, -57],
};

// LD §6 spawn coordinates — REFERENCE data (probes + contract gate).
// content.json (A2) is the authoritative runtime source; these are the
// level designer's coordinates the probe validates for walkability.
const REF_SPAWNS = {
  player: { pos: [-38, 0, 50], yaw: -Math.PI / 2 }, // faces east along the quay
  sp_dock_1: [-18, 0, 48], sp_dock_2: [2, 0, 46],
  sp_alley_1: [-50, 0, 26], sp_alley_2: [-54, 0, 14], sp_alley_3: [-46, 0, -2],
  sp_alley_4: [-52, 0, -10], sp_alley_5: [-44, 0, -20],
  sp_plaza_a1: [-2, 0, -14], sp_plaza_a2: [8, 0, -8], sp_plaza_a3: [-14, 0, -6],
  sp_plaza_a4: [12, 0, 4], sp_plaza_a5: [-8, 0, -16],
  sp_plaza_b1: [-12, 0, -38], sp_plaza_b2: [-4, 0, -40],
  sp_plaza_b3: [18, 0, 12], sp_plaza_b4: [-25, 0, -12],
  sp_arc_1: [-36, 0, -4], sp_arc_2: [-29, 0, -14],
  sp_arc_3: [-38, 4.2, -14], sp_arc_4: [-28, 4.2, 2],
  sp_marks_1: [38, 4.5, -46],
  sp_blvd_1: [30, 0, -2], sp_blvd_2: [44, 0, -6], sp_blvd_3: [30, 0, -18],
  sp_blvd_4: [44, 0, -24], sp_blvd_5: [36, 0, -34],
  sp_cust_w1_1: [-8, 0, -40], sp_cust_w1_2: [-6, 0, -40], sp_cust_w1_3: [-4, 0, -40],
  sp_cust_w1_4: [-2, 0, -40], sp_cust_w1_5: [0, 0, -40],
  sp_cust_w2_1: [30, 0, -40], sp_cust_w2_2: [31.6, 0, -40], sp_cust_w2_3: [33.2, 0, -40],
  sp_cust_w2_4: [34.8, 0, -40], sp_cust_w2_5: [36.4, 0, -40], sp_cust_w2_6: [38, 0, -40],
  // Beat-6 wave 3 is 7 bots INCLUDING the 2 heavies (LD §6: 5/6/7 = 18):
  // five regular ids + the two heavy ids below.
  sp_cust_w3_1: [-7, 0, -40], sp_cust_w3_2: [-3, 0, -40], sp_cust_w3_3: [-1, 0, -40],
  sp_cust_w3_4: [31, 0, -40], sp_cust_w3_5: [33, 0, -40],
  sp_cust_heavy_1: [-4, 0, -40], sp_cust_heavy_2: [34, 0, -40],
};

// Walkable-region rectangles (union semantics: a point is walkable when it
// is inside ANY rect at that y AND not inside a solid collider box).
// Feed probes and A5's nav bake seeding.
const WALK_RECTS = [
  { id: "w_quay", min: [-58, 42], max: [58, 54], y: 0 },
  { id: "w_alley", min: [-58, -30], max: [-41, 42], y: 0 },
  { id: "w_cs1a", min: [-41, -28], max: [-25, -20], y: 0 },
  { id: "w_cs1b", min: [-25, -28], max: [-12.5, -18], y: 0 },
  { id: "w_street", min: [-12.5, -41], max: [0, -18], y: 0 },
  { id: "w_plaza", min: [-25, -18], max: [15, 18], y: 0 },
  { id: "w_ramp", min: [-14, 18], max: [-6, 42], y: 0 },
  { id: "w_arc_ground", min: [-39, -19], max: [-26, 5], y: 0 },
  { id: "w_arc_wdoor", min: [-41, -4], max: [-39, 0], y: 0 },
  { id: "w_arc_edoor1", min: [-26, -13.5], max: [-25, -10.5], y: 0 },
  { id: "w_arc_edoor2", min: [-26, 0.5], max: [-25, 3.5], y: 0 },
  { id: "w_arc_upper", min: [-39, -19], max: [-26, 5], y: 4.2 },
  { id: "w_gallery", min: [17, -33], max: [23, 13], y: 0 },
  { id: "w_gal_wdoor", min: [15, 8], max: [17, 12], y: 0 },
  { id: "w_gal_edoor", min: [23, -32], max: [28, -28], y: 0 },
  { id: "w_cut", min: [13, -22], max: [28, -18], y: 0 },
  { id: "w_blvd", min: [28, -41], max: [46, 42], y: 0 },
  { id: "w_cye", min: [24, -44], max: [46, -39], y: 0 },
  { id: "w_customs", min: [-18, -58], max: [24, -40], y: 0 },
  { id: "w_deck", min: [28, -52], max: [44.5, -44], y: 4.5 },
];

// POI zones (LD §2.4 — ids are the content keys)
const ZONES = {
  poi_dock: { min: [-58, 42], max: [58, 54] },
  poi_alleys: { min: [-58, -30], max: [-41, 42] },
  poi_arcade: { min: [-41, -20], max: [-25, 6] },
  poi_plaza: { min: [-25, -18], max: [15, 18] },
  poi_gallery: { min: [15.5, -34], max: [24.5, 14] },
  poi_blvd: { min: [28, -41], max: [46, 41] },
  poi_platform: { min: [28, -52], max: [46, -40] },
  poi_customs: { min: [-18, -58], max: [24, -40] },
};

// Practicals map (LD §3.3). `real:true` entries are the 8 keySpot leases
// (level.js emits them as staticLightSpecs in wave 2; A6 binds to the pool).
// Everything else is emissive + glow card + ground decal — zero real lights.
const LIGHT_POLES = [
  { id: "L_QUAY", pos: [-30, 6.5, 47], color: "#ff9a3c", kind: "sodium", real: true, aim: [-30, 0, 47], cone: 55, godRay: true },
  { id: "L_ALLEY_A", pos: [-52, 5.5, 24], color: "#ff9a3c", kind: "sodium", real: true, aim: [-52, 0, 22], cone: 60, godRay: true },
  { id: "L_PLAZA_KEY", pos: [-5, 9.0, 0], color: "#c86ee0", kind: "neon_bounce", real: true, aim: [-5, 0, 0], cone: 85, blackout: { relight: "#4adcd6", level: 0.4 } },
  { id: "L_ARCADE_SKY", pos: [-32, 7.8, -8], color: "#7c8fb8", kind: "skylight", real: true, aim: [-32, 0, -8], cone: 35, godRay: true },
  { id: "L_BLVD_1", pos: [36, 7.0, 20], color: "#ff9a3c", kind: "sodium", real: true, aim: [36, 0, 20], cone: 50 },
  { id: "L_BLVD_3", pos: [36, 7.0, -28], color: "#ff9a3c", kind: "sodium", real: true, aim: [36, 0, -28], cone: 50 },
  { id: "L_FLOOD_W", pos: [-14, 9.0, -44], color: "#dce8ff", kind: "flood", real: true, aim: [-11, 2, -37], cone: 40, godRay: true },
  { id: "L_FLOOD_E", pos: [18, 9.0, -44], color: "#dce8ff", kind: "flood", real: true, aim: [21, 2, -37], cone: 40, godRay: true },
  // Fakes (emissive head + cone card + pool decal)
  { id: "fake_quay_1", pos: [-52, 6, 42.3], color: "#ff9a3c", kind: "sodium", real: false },
  { id: "fake_quay_2", pos: [12, 6, 42.3], color: "#ff9a3c", kind: "sodium", real: false },
  { id: "fake_alley_n", pos: [-48, 5.5, -4], color: "#ff9a3c", kind: "sodium", real: false },
  { id: "fake_street_1", pos: [-10, 6, -22], color: "#ff9a3c", kind: "sodium", real: false },
  { id: "fake_street_2", pos: [-2, 6, -30], color: "#ff9a3c", kind: "sodium", real: false },
  { id: "fake_street_3", pos: [-8, 6, -38], color: "#ff9a3c", kind: "sodium", real: false },
  { id: "fake_blvd_2", pos: [36, 7, -4], color: "#ff9a3c", kind: "sodium", real: false },
  { id: "neon_club", pos: [15.4, 6, -12], color: "#e83ea8", kind: "neon", real: false, sign: "ЗАРОВ НОЧЬ" },
  { id: "neon_meridian", pos: [15.4, 5, -6], color: "#38d8d0", kind: "neon", real: false, sign: "MERIDIAN 24" },
  { id: "neon_noodle", pos: [15.4, 4.5, 0], color: "#ff4040", kind: "neon", real: false, sign: "ЛАПША ДОМ" },
  { id: "neon_pharmacy", pos: [15.4, 5.5, 5], color: "#3cff88", kind: "neon", real: false, sign: "+" },
  { id: "neon_pawn", pos: [15.4, 4.8, 10], color: "#ffb340", kind: "neon", real: false, sign: "ЗОЛОТО ЗАРОВ" },
  { id: "fake_platform_strip", pos: [37, 7.2, -50], color: "#cfe0d8", kind: "fluorescent", real: false, flicker: true },
  { id: "fake_gatehouse", pos: [8, 2.5, -52.5], color: "#ffc88a", kind: "interior", real: false },
];

// Ground paint zones for wave-2 materials (metres; kind drives the PBR set)
const ROADS = [
  { id: "r_quay", kind: "concrete_quay", min: [-58, 42], max: [58, 54] },
  { id: "r_alley", kind: "asphalt_worn", min: [-58, -30], max: [-41, 42] },
  { id: "r_cs1", kind: "asphalt_worn", min: [-41, -28], max: [-12.5, -18] },
  { id: "r_street", kind: "asphalt", min: [-12.5, -41], max: [0, -18] },
  { id: "r_plaza", kind: "plaza_cobble", min: [-25, -18], max: [15, 18] },
  { id: "r_ramp", kind: "asphalt", min: [-14, 18], max: [-6, 42] },
  { id: "r_gallery", kind: "concrete_interior", min: [15.5, -34], max: [24.5, 14] },
  { id: "r_cut", kind: "asphalt_worn", min: [13, -22], max: [28, -18] },
  { id: "r_blvd", kind: "asphalt_tram", min: [28, -41], max: [46, 42] },
  { id: "r_cye", kind: "asphalt_worn", min: [24, -44], max: [46, -39] },
  { id: "r_customs", kind: "concrete_yard", min: [-18, -58], max: [24, -40] },
  { id: "r_arcade", kind: "tile_interior", min: [-39, -19], max: [-26, 5] },
];

// Hero puddle group (LD §4.2/§5.4 — the planar-reflection zone) + terrain
const TERRAIN = {
  base: 0,
  canal: { zMin: 54, y: -1.5 }, // water, non-playable
  heroPuddles: [
    { pos: [-4, 6], r: 3.4 }, { pos: [3, 10], r: 2.6 }, { pos: [-1, 12.5], r: 2.0 },
  ],
};

// ------------------------------------------------- placements (LD §4.1)
// THREE-free ground-contact layer shared by props.js (renders it verbatim)
// and tools/probe_props.mjs (gates it): every prop Y comes from an analytic
// "raycast" against the ground (terrain + solid box tops), then sinks 1.5 cm.
// The probe fails any corner gap > 0 mm or penetration > 3 cm and requires a
// base decal on every ground prop with footprint > 0.3 m² (wall mounts get a
// rust-streak decal; ceiling mounts are exempt — no ground contact exists).
const SINK = 0.015;

function decalKindFor(kind) {
  if (/car|van|truck|dumpster|kiosk|shelter|hut|phone_booth/.test(kind)) return "grime_ring";
  if (/barrier/.test(kind)) return "edge_chip";
  if (/tower|transformer|scaffold|bollard|post|fence|gate/.test(kind)) return "rust_ring";
  if (/sandbags|planter/.test(kind)) return "dirt_ring";
  if (/vent/.test(kind)) return "scorch_ring";
  return "ao_blob";
}

export function computePlacements(layout) {
  // The same solid set colliders.js exports — rebuilt here from the same
  // source data so layout.js stays import-cycle-free.
  const solids = [];
  for (const b of layout.buildings) {
    if (b.box) solids.push({ id: b.id, min: b.box.min, max: b.box.max });
  }
  for (const w of layout.walls) solids.push({ id: w.id, min: w.min, max: w.max });
  for (const p of layout.props) {
    if (p.solid && p.aabb) solids.push({ id: p.id, min: p.aabb.min, max: p.aabb.max, prop: p.id });
  }
  const canal = layout.terrain.canal;
  const groundAt = (x, z) => (z >= canal.zMin ? canal.y : layout.terrain.base);

  const placements = [];
  for (const p of layout.props) {
    const mount = p.flags && p.flags.wallMount ? "wall"
      : p.kind === "ceiling_fan" ? "ceiling" : "ground";
    const c = Math.cos(p.rot), s = Math.sin(p.rot);
    const hx = p.size[0] / 2, hz = p.size[2] / 2;
    const corners = [[hx, hz], [hx, -hz], [-hx, hz], [-hx, -hz]].map(([dx, dz]) => [
      p.pos[0] + dx * c - dz * s,
      p.pos[2] + dx * s + dz * c,
    ]);
    const baseY = p.pos[1]; // authored y0 (0, 4.2 slab, 4.5 deck)
    // per-corner support: highest solid top at/below the step budget, else terrain
    const supports = corners.map(([x, z]) => {
      let y = groundAt(x, z);
      for (const b of solids) {
        if (b.prop === p.id) continue; // never self-support
        if (x >= b.min[0] - 1e-6 && x <= b.max[0] + 1e-6 &&
            z >= b.min[2] - 1e-6 && z <= b.max[2] + 1e-6) {
          const top = b.max[1];
          if (top <= baseY + 0.35 + 1e-6 && top > y) y = top;
        }
      }
      return y;
    });
    const support = Math.max(...supports);
    const y = mount === "ground" ? support - SINK : baseY;
    const area = p.size[0] * p.size[2];
    const needsDecal = area > 0.3 && mount !== "ceiling";
    placements.push({
      id: p.id, kind: p.kind, rot: p.rot, size: p.size.slice(),
      surface: p.surface, matClass: p.matClass, solid: p.solid,
      flags: p.flags || null,
      mount, pos: [p.pos[0], y, p.pos[2]],
      corners, supports, sink: SINK, area,
      baseDecal: needsDecal
        ? { kind: mount === "wall" ? "rust_streak" : decalKindFor(p.kind),
            r: Math.max(hx, hz) * 1.6 }
        : null,
    });
  }
  return placements;
}

// ---------------------------------------------------------------- export
export function buildLayout(seed = 1) {
  const buildings = makeBuildings();
  const walls = makeWalls();
  const props = makeProps();
  return {
    buildings,
    walls,
    props,
    roads: ROADS,
    terrain: TERRAIN,
    zones: ZONES,
    lightPoles: LIGHT_POLES,
    // private extras (probes / colliders / nav):
    nodes: NODES,
    refSpawns: REF_SPAWNS,
    walkRects: WALK_RECTS,
    bounds: BOUNDS,
    seed,
  };
}
