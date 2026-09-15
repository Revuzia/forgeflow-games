// core/level/maps/saltmarket.js [PVP arena #2 — the covered market district]
// SALTMARKET — "the Saltmarket Halls": a night market under a leaking roof.
// A great covered hall with an upper gallery ring, wrapped by narrow rows of
// shuttered stalls, with an open-air loading dock and a shuttered flag room
// at each end. Authored STANDALONE (no meridian_ward import) per
// _design/pvp/arena.md Part 5.1's second option — the ward transform is
// lanternwalk's construction and reusing it here would have produced a third
// dockside carve, not a different place.
//
// Coordinate convention unchanged: +X east, +Z south, Y up, metres.
// Arena bounds: X in [-38, +28], Z in [-27, +23]  (66 x 50 gross).
//
// ---------------------------------------------------------------------------
// THE ONE MEASUREMENT THAT SHAPED THIS MAP
//
// A market of narrow stall rows is trivially easy on the sightline gates and
// brutal on the occupancy gate. The first build of this arena was a pure
// lattice - four aisles, shuttered terraces, a 22 x 26 hall - and it measured:
//
//     G-C  band mix <6 m 69.0%   (needs >=40)   <- enormous margin
//     G-D  rays >=40 m 0.00%     (allows 1.5%)  <- enormous margin
//     G-E  P(>=1 of 9 actors in LOS) 36.1%      (needs >=70)  <- FAIL
//
// Ten actors in a warren never see each other. The fix is not more cover, it is
// one DOMINANT OPEN ROOM: the mutual-visibility probability between two random
// points scales with the SQUARE of the largest open region's share of the
// floor, and lanternwalk clears the gate because its plaza is 49% of the map.
// So the market rows here wrap a 38 x 38 m covered hall that is 53.8% of the
// walkable floor (1339 of 2488 m2 measured), and the density G-C wants lives in
// the aisles, the bands and the docks around it. Every "why is this here"
// comment below is really an answer to one of those two pressures, and the two
// pull opposite ways: the last four edits before ship were +1 hall door
// (G-E +3.2 pts, G-D +0.67 pts), 8 -> 12 hall islands (G-D -0.3 pts, G-E -0.2),
// and moving 1 m of band into the hall (G-E +1.5 pts).
//
// G-E is also the one gate whose reading is NOISY: it is a 1500-trial Monte
// Carlo, so its standard error is ~1.2 points. A map that measures 70.1 is not
// a map that passes - it is a map whose true value might be 68.9. This one was
// tuned against a 20000-trial read (72.45% +/- 0.32) so that the gate's own
// 1500-trial sample (72.9%) has somewhere to land.
//
// ---------------------------------------------------------------------------
// WHY THIS MAP IS BUILT AS A 180 DEGREE ROTATION OF ITS OWN WEST HALF
//
// Every piece of geometry is authored ONCE, in LOCAL coordinates whose origin
// is the arena centre, and emitted twice: as authored, and rotated 180 degrees
// about that centre. Two gates make that the cheap construction rather than a
// stylistic one:
//
//   - G-I (CTF parity) measures mid->flag path delta, attacker->enemy-flag path
//     delta, longest-sightline-into-site delta and cover count per flag. Under
//     an exact rotation with the two stands at mirrored positions, three of the
//     four are identically zero - and no later prop edit can unbalance one side,
//     because every edit lands on both halves at once.
//   - G-J (TDM parity) measures each team's home centroid -> walkable centroid.
//     The walkable centroid of a rotationally symmetric region IS the centre of
//     rotation, and mirrored home clusters are equidistant from it.
//
// The centre of rotation is (-5, -2) in WORLD metres, not the origin. That is
// deliberate: tools/probe_arena.mjs takes its "mid" sample for G-I P3 at world
// (-5, -2) and floods its walkable grid from the cell nearest (-5, 0)
// (lanternwalk's plaza centre). Putting SALTMARKET's centre of rotation on that
// exact point makes P3 near-symmetric and drops the flood seed in the middle of
// the great hall. It is also why the centre of the hall is kept WALKABLE: P3
// snaps its sample to the nearest reachable cell, so a solid centrepiece would
// let the snap land off-axis and manufacture an asymmetry out of a symmetric
// map. ORIGIN below is that offset; every authored number in this file is LOCAL
// (centre-relative) and only crosses into world coordinates through
// wbox() / prop() / pt() / rect() / zone() / road() / LP().
//
// Where the rotation would make the place read as two copies of itself, the
// variation is carried by what the gates do not measure: prop KIND (the
// north-west dock is dressed in dumpsters, pallets and chain-link, the
// south-west store in crates, racking and empty pallets), the lighting profile
// and the ground paint. The stall rows are deliberately NOT mirrored within an
// aisle - each aisle alternates which side carries the stalls, so a run down
// any aisle is a zig-zag even though the map as a whole is symmetric.
//
// ---------------------------------------------------------------------------
// WHAT THE SPACE IS, WEST TO EAST (local X; add ORIGIN for world):
//
//   [-32,-26]  loading dock (open air, no roof) + THE SALT STORE (flag room)
//   [-26,-25]  terrace wall, five door voids - the dock/market membrane
//   [-25,-20]  AISLE A1, stalls alternating sides (mixed 1.8 / 2.6 m depth)
//   [-20,-19]  the hall's west wall, two 6 m doors
//   [-19, 19]  THE GREAT HALL, 38 x 38, gallery ring at y 2.8, twelve stall
//              islands - north and south of it the BANDS (4 m of stall rows),
//              with the ice house / auction annex (X[-5,5]) as their E-W plug
//   [ 19, 32]  the 180 degree rotation of everything above
//
// The three long-line risks and their answers (G-D):
//   - 64 m E-W across the whole map   -> the hall walls plug |Z| <= 20 and the
//                                        ice house / annex plug |Z| >= 20
//   - 48 m N-S down an aisle          -> alternating-side stalls, deep ones
//                                        plugging the mid-strip; longest clear
//                                        aisle run ~17 m
//   - 54 m corner-to-corner in the    -> twelve stall islands at ~1 per 110 m2
//     hall, and the door chains that     plus the eight gallery columns; the
//     run band -> hall -> aisle -> dock  two islands at local (0,-5.5) and
//                                        (0,-17) were placed off a long-ray
//                                        dump, not by eye
//
// RESIDUAL, accepted by the same ruling as arena.md's R3 (lanternwalk ships
// twelve 55-67 m keyholes): 156 rays out of 716,544 on the full 0.5 m grid
// still reach 55 m or more - 0.022%, against G-D's 0.05% bar - and the longest
// is 65.8 m. They are ONE azimuth family (az 40 / 220 degrees), running
// north-west to south-east along the door chain above, and none of them
// originates at a spawn point: G-D's third clause measures zero spawns with a
// ray >= 40 m. Killing the family outright costs one more hall island, which
// measured -1.9 points of G-E - the wrong trade at this margin.
//
// THREE-free, data only.

// --------------------------------------------------------------- constants
// Centre of rotation, in WORLD metres. See the header: this is probe_arena's
// hardcoded mid sample. Changing it re-bases the whole map.
const ORIGIN = [-5, -2];
const OX = ORIGIN[0], OZ = ORIGIN[1];

// Local playable rectangle is X,Z ∈ [−32,32] × [−24,24]; the perimeter wall
// band takes it out to ±33 / ±25, and that band is the arena AABB (G-H samples
// the AABB edge and needs geometry there — the perimeter IS that geometry).
const BOUNDS = { min: [-33 + OX, -2, -25 + OZ], max: [33 + OX, 14, 25 + OZ] };

// ---------------------------------------------------------------- helpers
// wbox/prop are the same constructors meridian_ward.js and lanternwalk.js use,
// with one addition: they take LOCAL coordinates and are converted to WORLD on
// emit, so the mirror below is a plain negation.
function wbox(id, kind, x0, x1, y0, y1, z0, z1, surface = "concrete", matClass = "hard") {
  return {
    id, kind,
    min: [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)],
    max: [Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)],
    surface, matClass,
  };
}

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

// Stair runs: solid step columns, riser 0.28. Same shape as meridian_ward's
// arc_stair_* (riser 0.3 / tread 0.223) — inside moveCapsule's step-up budget,
// which is why the cadence is copied rather than invented.
function steps(list, idp, x0, x1, zFrom, zTo, n, riser, yBase = 0) {
  const tread = (zTo - zFrom) / n;
  for (let i = 0; i < n; i++) {
    const za = zFrom + tread * i;
    const zb = zFrom + tread * (i + 1);
    list.push(wbox(`${idp}_${i}`, "step", x0, x1, 0, yBase + riser * (i + 1), za, zb, "concrete", "hard"));
  }
}

// A wall RUN with door voids punched out of it, emitted as the surviving
// pieces. Used instead of boolean subtraction (lanternwalk's `subtract`)
// because this map is authored, not carved: the voids are known up front.
function runZ(list, idp, x0, x1, y0, y1, z0, z1, gaps, surface, matClass) {
  let z = z0, i = 0;
  for (const [ga, gb] of gaps) {
    if (ga > z + 1e-6) list.push(wbox(`${idp}_${i++}`, "wall", x0, x1, y0, y1, z, ga, surface, matClass));
    z = gb;
  }
  if (z1 > z + 1e-6) list.push(wbox(`${idp}_${i++}`, "wall", x0, x1, y0, y1, z, z1, surface, matClass));
}
function runX(list, idp, z0, z1, y0, y1, x0, x1, gaps, surface, matClass) {
  let x = x0, i = 0;
  for (const [ga, gb] of gaps) {
    if (ga > x + 1e-6) list.push(wbox(`${idp}_${i++}`, "wall", x, ga, y0, y1, z0, z1, surface, matClass));
    x = gb;
  }
  if (x1 > x + 1e-6) list.push(wbox(`${idp}_${i++}`, "wall", x, x1, y0, y1, z0, z1, surface, matClass));
}

// 180° rotation about the local origin; and local → world.
const mirrorBox = (b) => ({
  id: `m_${b.id}`, kind: b.kind,
  min: [-b.max[0], b.min[1], -b.max[2]],
  max: [-b.min[0], b.max[1], -b.min[2]],
  surface: b.surface, matClass: b.matClass,
});
const worldBox = (b) => ({
  id: b.id, kind: b.kind,
  min: [b.min[0] + OX, b.min[1], b.min[2] + OZ],
  max: [b.max[0] + OX, b.max[1], b.max[2] + OZ],
  surface: b.surface, matClass: b.matClass,
});
const pt = (x, y, z) => [x + OX, y, z + OZ];
const rect = (id, x0, z0, x1, z1, y = 0) =>
  ({ id, min: [x0 + OX, z0 + OZ], max: [x1 + OX, z1 + OZ], y });
const zone = (x0, z0, x1, z1) =>
  ({ min: [x0 + OX, z0 + OZ], max: [x1 + OX, z1 + OZ] });

// ------------------------------------------------------- authored geometry
// Heights. The market's structure is deliberately shorter than lanternwalk's
// (4.2–5.8 m against 8.2 m) so the roof reads as a shed over stalls, and
// deliberately taller than the 1.7 m LOS band everywhere it matters — a 1.2 m
// counter blocks movement but not sightlines, which is the wrong trade for G-C.
const H_PERIM = 7.5;   // outer shell
const H_TERR = 4.8;    // terrace / dock membrane walls
const H_ANNEX = 4.6;   // ice house + south annex
const H_HALL = 5.8;    // great hall walls (clerestory above the doors)
const Y_DOOR = 2.4;    // every door void is 2.4 m; headers fill above it
const Y_GAL = 2.8;     // gallery deck — the map's only verticality

// tw_* door voids, west run: two dock doors north, the SALT STORE's own east
// door (D1), two dock doors south. The dock is the arena's west flank and needs
// more than one throat or the flag room becomes a cul-de-sac (carve rule 2).
const TW_GAPS = [[-21, -18], [-11, -8], [-4.5, -1], [8, 11], [18, 21]];

// ---- stall rows -----------------------------------------------------------
// A stall is authored 2.4 m of frontage by 1.8 or 2.6 m of depth and rotated
// ±π/2 in the aisles, so its world footprint is depth along X (from the wall it
// backs onto) and frontage along Z (down the aisle).
//
// The TWO depths are a measured compromise between two gates that pull opposite
// ways, not a look:
//   • at 2.6 m a stall reaches 0.1 m past the 5 m aisle's mid-line, so with the
//     two sides interleaved in Z there is no un-plugged strip down the middle.
//     That matters because a strip narrower than a player is still a keyhole to
//     G-D: the ray grid samples x ≡ 0.25 (mod 0.5) and casts due north, and a
//     0.6 m gap between two 2.2 m rows measured as a 48 m line.
//   • at 2.6 m everywhere the walking band is 2.4 m, which puts the whole of
//     both aisles under the probe's 1.5 m spawn-clearance bar — no spawn in the
//     rows can ever be placed, and two of the seven clusters live there.
// So most stalls are the shallow 1.8 m lock-up (3.2 m band, 1.6 m clearance,
// spawnable) and every third or so is a deep 2.6 m corner shop that plugs the
// mid-strip. Deep stalls alternate sides roughly every 10 m: longest clear run
// down the mid-strip ≈ 17 m, well inside G-D's 40 m cap.
const STALL_W = 2.4, STALL_D = 2.6, STALL_H = 2.4;
const SHALLOW_D = 1.8;              // the ordinary lock-up: 1.8 m of counter
const SHOP_W = 2.4, SHOP_D = 1.6;   // free-standing island variant
const FACE_E = Math.PI / 2, FACE_W = -Math.PI / 2;

// Aisle A1 (X[−25,−20]): the west row backs onto tw_w, the east row onto the
// hall's west wall. Entries are [z, deep]. The Z values dodge tw_w's five door
// voids and the hall's two west doors — a stall parked across a throat is how a
// market map grows a 1 m chokepoint — and the two sides never share a Z
// interval, because where they do the aisle closes to nothing.
const A1_W = [[-15.5, false], [-12.5, true], [-5.5, false], [5.5, true], [12.5, false], [15.5, false]];
const A1_E = [[-21, false], [-9.5, true], [-2.5, false], [2, true], [21, false]];

// ---------------------------------------------------------------- export
export function buildLayout(seed = 1) {
  // Half-map authoring buffers. HALF is emitted twice (as-is + rotated); SOLO
  // is emitted once and must therefore be self-symmetric.
  const HW = [];   // half walls (local)
  const SW = [];   // solo walls (local, self-symmetric)
  const HP = [];   // half props (arg tuples, local)

  const w = (...a) => HW.push(wbox(...a));
  const p = (...a) => HP.push(a);

  // ======================================================== 1. THE SHELL
  // Perimeter: closed rectangle, 7.5 m. G-H raycasts the AABB edge every 2 m
  // and needs a renderable within 0.5 m at every sample; a closed box of wall
  // boxes ON the AABB satisfies it by construction, and there is no invisible
  // wall anywhere in the map. The four runs are authored as two (west + north)
  // and mirrored; they meet at faces, never interpenetrate (probe_props gate 3
  // fails a 2 mm overlap).
  w("per_w", "wall", -33, -32, 0, H_PERIM, -25, 25);
  w("per_n", "wall", -32, 32, 0, H_PERIM, -25, -24);

  // Shed roofs. Pure dressing for the collider set (min y 6.4 is far above the
  // 1.7 m LOS band) but load-bearing for the fiction: the market is COVERED and
  // the two loading docks (X beyond ±25) are not — rain falls on the docks and
  // drums on the roof over the rows.
  w("roof_rows_w", "roof", -26, -20, 6.4, 6.8, -24, 24);
  w("roof_band_n", "roof", -20, 20, 6.4, 6.8, -24, -20);
  SW.push(wbox("roof_hall", "roof", -20, 20, 7.0, 7.4, -20, 20, "metal", "metal_thin"));

  // ================================================ 2. THE TERRACE MEMBRANE
  // tw_w separates the open dock from the covered rows. Five voids, headers
  // above each so the wall reads as a colonnade of loading doors rather than a
  // fence with holes.
  runZ(HW, "tw_w", -26, -25, 0, H_TERR, -24, 24, TW_GAPS, "concrete", "hard");
  for (let i = 0; i < TW_GAPS.length; i++) {
    w(`hdr_tw_w_${i}`, "wall", -26, -25, Y_DOOR, H_TERR, TW_GAPS[i][0], TW_GAPS[i][1]);
  }

  // ==================================================== 3. THE SALT STORE
  // The west flag room: 6 × 10 m of brick salt store with three doors — north
  // to the dock, south to the dock, east (D1, in tw_w) to the rows. The stand
  // at local (−29, +1.5) sits on NONE of the three door axes:
  //   N void X[−32,−30], S void X[−28,−26], D1 void Z[−4.5,−1]
  // so no attacker gets a free line onto the stand from outside the room, and
  // the measured longest sightline INTO the site is 12.8 m on both sides. That
  // is G-I's P5 clause solved by placement instead of by prop screening
  // (lanternwalk needed R1's extra stall for exactly this), and it is why the
  // three voids are 2 m rather than the 4 m the campaign map uses: a 6 m-wide
  // room cannot hold two 4 m doors AND a wall segment wide enough to put a
  // stand behind.
  runX(HW, "sr_n", -6, -5, 0, H_TERR, -32, -26, [[-32, -30]], "concrete", "hard");
  runX(HW, "sr_s", 5, 6, 0, H_TERR, -32, -26, [[-28, -26]], "concrete", "hard");
  w("hdr_sr_n", "wall", -32, -30, Y_DOOR, H_TERR, -6, -5);
  w("hdr_sr_s", "wall", -28, -26, Y_DOOR, H_TERR, 5, 6);

  // ================================================ 4. THE ICE HOUSE PLUG
  // X[−4,4] Z[−24,−16], solid. This is the piece that makes the north band a
  // pair of 20 m rooms instead of a 48 m shooting gallery: without it every
  // E–W ray north of the hall runs the arena's full width. Its mirror is the
  // south annex (the auction room).
  w("icehouse", "wall", -5, 5, 0, H_ANNEX, -24, -20);

  // ==================================================== 5. THE GREAT HALL
  // 38 × 38 m interior and 53.8% of the walkable floor. TEN doors — three in
  // each of the north and south walls, two in each of the east and west — all
  // 6 m, none facing another across the floor. They are wide and numerous on
  // purpose: a point in the hall has to be able to see a point in the band or
  // the aisle through them, and that cross-room visibility is worth about three
  // points of G-E on its own (measured: adding the third north/south door took
  // P(≥1 in LOS) from 68.8% to 72.0%).
  runX(HW, "hall_n", -20, -19, 0, H_HALL, -20, 20, [[-15, -9], [-3, 3], [9, 15]], "concrete", "hard");
  w("hdr_hall_n1", "wall", -15, -9, Y_DOOR, H_HALL, -20, -19);
  w("hdr_hall_n2", "wall", -3, 3, Y_DOOR, H_HALL, -20, -19);
  w("hdr_hall_n3", "wall", 9, 15, Y_DOOR, H_HALL, -20, -19);
  runZ(HW, "hall_w", -20, -19, 0, H_HALL, -19, 19, [[-16, -10], [5, 11]], "concrete", "hard");
  w("hdr_hall_w1", "wall", -20, -19, Y_DOOR, H_HALL, -16, -10);
  w("hdr_hall_w2", "wall", -20, -19, Y_DOOR, H_HALL, 5, 11);

  // ---- the gallery ring (verticality, y 2.8) --------------------------------
  // A 2.5 m deck (343 m² of it) around the hall's inner wall, open over a
  // 33 × 33 m void, reached by two stairs at opposite corners — so it is a
  // ROUTE across the hall, not a perch. It cannot be a sniper nest: all ten
  // hall door voids stop at 2.4 m, so from a 2.8 m deck there is no line out of
  // the hall at all. Everything it overlooks is inside the room it is part of,
  // and the storage stacks below break each leg so it cannot cover its own
  // length.
  w("gal_n", "slab", -19, 19, 2.55, Y_GAL, -19, -16.5);
  w("gal_w", "slab", -19, -16.5, 2.55, Y_GAL, -16.5, 14);
  // Stair: 1 landing riser + 9 risers, topping out at 2.8 exactly where the
  // south deck begins (Z = 12.5). Its mirror is the north-east stair.
  steps(HW, "gal_stair_sw_L", -19, -16.5, 13, 14, 1, 0.28);
  steps(HW, "gal_stair_sw", -19, -16.5, 14, 16.5, 9, 0.28, 0.28);
  // Deck edge rails (metal, thin — penetrable per combat_spec §3.2).
  w("gal_rail_n", "rail", -16.5, 16.5, Y_GAL, 3.9, -16.6, -16.5, "metal", "metal_thin");
  w("gal_rail_w", "rail", -16.6, -16.5, Y_GAL, 3.9, -16.5, 16.5, "metal", "metal_thin");
  // Storage stacks ON the deck (see 6.7): they break the deck's 38 m legs so
  // nobody holds one from end to end, but they hug the outer edge and leave
  // 1.3 m of walkway, so the ring stays a connected route. A full-width
  // hoarding was the first attempt and it severed the ring into two arcs with
  // one stair each — i.e. two dead-end overlooks, which is the thing the two
  // stairs exist to avoid.
  // Deck columns. These are the gallery's real contribution at ground level:
  // eight 0.5 m posts. They hug the wall rather than standing under the deck's
  // inner edge: a column line out in the floor cost ~3 points of G-E for no
  // gain the gates could see, since the islands already carry the ≥40 m work.
  for (const cz of [-10, 6]) {
    w(`gal_col_w${cz}`.replace(/[.-]/g, "_"), "wall", -18.9, -18.4, 0, 2.55, cz - 0.25, cz + 0.25);
  }
  for (const cx of [-10, 5]) {
    w(`gal_col_n${cx}`.replace(/[.-]/g, "_"), "wall", cx - 0.25, cx + 0.25, 0, 2.55, -18.9, -18.4);
  }

  // ============================================================== 6. PROPS
  const E = { dir: [1, 0, 0] }, Wd = { dir: [-1, 0, 0] };
  const N = { dir: [0, 0, -1] }, S = { dir: [0, 0, 1] };

  // ---- 6.1 aisle stall rows ------------------------------------------------
  // The signature of the place. Each run backs onto a wall face and projects
  // 2.6 m into its 5 m aisle; cover nodes point ALONG the aisle (N/S), because
  // a stall against a wall only protects you from something coming down the row.
  A1_W.forEach(([z, deep], i) => p(`a1w_${i}`, "stall", deep ? -23.7 : -24.1, z, FACE_E,
    STALL_W, deep ? STALL_D : SHALLOW_D, STALL_H, "wood", "soft",
    i % 2 ? { cover: { ...S, height: "high" } } : { cover: { ...N, height: "high" } }));
  A1_E.forEach(([z, deep], i) => p(`a1e_${i}`, "stall", deep ? -21.3 : -20.9, z, FACE_W,
    STALL_W, deep ? STALL_D : SHALLOW_D, STALL_H, "wood", "soft",
    i % 2 ? { cover: { ...N, height: "high" } } : { cover: { ...S, height: "high" } }));

  // ---- 6.2 the great hall floor -------------------------------------------
  // Twelve stall islands (six authored + six mirrors), spread so that no
  // corner-to-corner diagonal of the 38 × 38 room runs clear. One per ~110 m²
  // is deliberately SPARSER than lanternwalk's plaza (65 m² per piece): this
  // room has to carry G-E, so it is cover-poor by design and the rows around it
  // carry the <6 m band instead. The last two — local (0,−5.5) and (0,−17) —
  // were placed off the long-ray dump rather than by eye: they sit on the one
  // azimuth family that can thread a band door, the hall and an east door in a
  // single line, and they took rays ≥40 m from 1.73% to 1.03%.
  p("h_kiosk_1", "kiosk", -13, -11, 0, 2.6, 2.6, 2.3, "wood", "soft",
    { cover: { ...E, height: "high" } });
  p("h_stall_1", "stall", -5, -14, FACE_E, SHOP_W, SHOP_D, STALL_H, "wood", "soft",
    { cover: { ...S, height: "high" } });
  p("h_shelf_1", "shelving", -14, 6, 0, 2.6, 0.7, 1.95, "metal", "metal_thin",
    { cover: { ...N, height: "high" } });
  p("h_shelf_2", "shelving", -6, 2, FACE_E, 2.6, 0.7, 1.95, "metal", "metal_thin",
    { cover: { ...E, height: "high" } });
  // These two sit ON the hall's north-west/south-east diagonal, which is the
  // only azimuth family that can thread a north-band door, the hall, an east
  // door, aisle A1e and a terrace door in one line. They were placed from the
  // long-ray dump, not by eye: without them rays ≥ 40 m measured 1.73% against
  // a 1.5% cap, with them 1.1%.
  p("h_kiosk_2", "kiosk", 0, -5.5, 0, 2.6, 2.6, 2.3, "wood", "soft",
    { cover: { ...S, height: "high" } });
  p("h_kiosk_3", "kiosk", 0, -17, 0, 2.6, 2.6, 2.3, "wood", "soft",
    { cover: { ...S, height: "high" } });
  // Hall dressing. None of it reaches the 1.7 m LOS band: the hall's job is to
  // be SEEN ACROSS (G-E), so everything on its floor that is not one of the
  // twelve islands above is deliberately knee-high.
  p("h_table_1", "table", -15.5, 12, 0, 1.6, 0.9, 0.78, "wood", "soft");
  p("h_chairs_1", "chairs", -14.0, 12.8, 0.4, 0.55, 0.55, 1.1, "wood", "soft");
  p("h_bench_1", "bench", -17.9, -6.5, 0, 1.8, 0.6, 0.85, "wood", "soft");
  p("h_planter_1", "planter", -2.5, -17.5, 0, 2.0, 0.8, 0.9, "concrete", "hard",
    { cover: { ...S, height: "low" } });
  p("h_mop_1", "mop_bucket", -1.5, 1.5, 0, 0.45, 0.45, 0.5, "metal", "metal_thin",
    { solid: false });
  p("h_fan_1", "ceiling_fan", -7, -5, 0, 1.6, 1.6, 0.5, "wood", "soft",
    { solid: false, y0: 5.8 });
  p("h_fan_2", "ceiling_fan", -7, 5, 0, 1.6, 1.6, 0.5, "wood", "soft",
    { solid: false, y0: 5.8 });
  p("h_booth_1", "phone_booth", -15, -6.5, 0, 1.0, 1.0, 2.4, "metal", "metal_thin",
    { cover: { ...S, height: "high" } });
  p("h_rope_1", "rope", -18.2, 3.5, 0.3, 0.8, 0.8, 0.3, "wood", "soft", { solid: false });

  // ---- 6.7 the gallery deck (y 2.8) ---------------------------------------
  p("gal_crate_n", "crate", 0, -18.2, 0, 1.2, 1.2, 1.4, "wood", "soft", { y0: Y_GAL });
  p("gal_crate_w", "crate", -18.4, 0, 0, 1.2, 1.2, 1.4, "wood", "soft", { y0: Y_GAL });

  // ---- 6.3 the north band (stall rows) -------------------------------------
  // X[−20,20] × Z[−24,−20], 4 m deep: one row of shallow stalls flush against
  // the hall's north wall and low racking and crates against the perimeter,
  // with a 2.2 m service lane between them. Authored for BOTH bands (the
  // rotation sends a south-band prop into the north band's east half), which is
  // how each 20 m room ends up reading differently while the pair stays exactly
  // balanced. The band lost a metre to the hall late on — it was the cheapest
  // 1.5 points of G-E available, and a service lane is the one place in a
  // market where 2.2 m is the right width anyway.
  p("bn_stall_1", "stall", -16, -20.9, Math.PI, STALL_W, SHALLOW_D, STALL_H, "wood", "soft",
    { cover: { ...S, height: "high" } });
  p("bn_stall_2", "stall", -8, -20.9, Math.PI, STALL_W, SHALLOW_D, STALL_H, "wood", "soft",
    { cover: { ...S, height: "high" } });
  p("bn_shelf_1", "shelving", -11.5, -23.7, 0, 2.6, 0.6, 1.9, "metal", "metal_thin",
    { cover: { ...N, height: "high" } });
  p("bn_crate_1", "crate", -18.5, -23.2, 0.25, 1.4, 1.2, 1.25, "wood", "soft",
    { cover: { ...N, height: "low" } });
  p("bn_bin_1", "bin", -6.2, -23.6, 0, 0.6, 0.6, 0.9, "metal", "metal_thin");
  p("bn_news_1", "newsbox", -18, -21.5, 0, 0.8, 0.5, 1.1, "metal", "metal_thin");
  p("bn_vent_1", "steam_vent", -14, -23.6, 0, 0.6, 0.6, 0.1, "metal", "hard",
    { solid: false, flags: { steam: true } });

  p("bs_stall_1", "stall", -16, 20.9, 0, STALL_W, SHALLOW_D, STALL_H, "wood", "soft",
    { cover: { ...N, height: "high" } });
  p("bs_stall_2", "stall", -8, 20.9, 0, STALL_W, SHALLOW_D, STALL_H, "wood", "soft",
    { cover: { ...N, height: "high" } });
  p("bs_shelf_1", "shelving", -11.5, 23.7, 0, 2.6, 0.6, 1.9, "metal", "metal_thin",
    { cover: { ...S, height: "high" } });
  p("bs_crate_1", "crate", -18.5, 23.2, -0.25, 1.4, 1.2, 1.25, "wood", "soft",
    { cover: { ...S, height: "low" } });
  p("bs_pallet_1", "pallet", -6.2, 23.4, 0, 1.2, 1.0, 1.1, "wood", "soft",
    { cover: { ...S, height: "low" } });
  p("bs_trash_1", "trash_bags", -14, 23.2, 0.5, 1.0, 1.0, 0.6, "wood", "soft",
    { solid: false });

  // ---- 6.4 the north-west LOADING DOCK ------------------------------------
  // Open air, wet asphalt, the only part of the map with no roof over it.
  // Dressed in dumpsters, pallets and chain-link; its mirror is the south-east
  // dock, and 6.5's south-west store uses crates and shelving instead so the
  // two dock pairs do not read as one prop set copied twice.
  p("dk_dump_1", "dumpster", -31.0, -23.0, 0.1, 1.7, 1.1, 1.25, "metal", "metal_thin",
    { cover: { ...N, height: "high" } });
  p("dk_bin_1", "bin", -26.6, -22.5, 0, 0.6, 0.6, 0.9, "metal", "metal_thin");
  p("dk_fence_1", "fence", -30.5, -18.0, 0, 3.0, 0.15, 2.1, "metal", "metal_thin",
    { cover: { ...N, height: "high" } });
  p("dk_kiosk_1", "kiosk", -30.4, -9.5, 0, 2.6, 2.6, 2.3, "wood", "soft",
    { cover: { ...N, height: "high" } });
  p("dk_crate_1", "crate", -26.9, -16.5, 0.2, 1.4, 1.2, 1.25, "wood", "soft",
    { cover: { ...E, height: "low" } });
  p("dk_barrier_1", "barrier", -30.5, -12.5, 0, 2.0, 0.6, 1.1, "concrete", "hard",
    { cover: { ...N, height: "low" } });
  p("dk_trash_1", "trash_bags", -29.0, -23.1, 0.4, 1.0, 1.0, 0.6, "wood", "soft",
    { solid: false });
  p("dk_vent_1", "steam_vent", -29, -20.5, 0, 0.6, 0.6, 0.1, "metal", "hard",
    { solid: false, flags: { steam: true } });
  p("dk_ac_1", "ac_unit", -26.27, -13.0, 0, 0.8, 0.5, 0.6, "metal", "metal_thin",
    { solid: false, y0: 2.9, flags: { wallMount: true, n: [-1, 0] } });
  p("dk_breaker_1", "breaker_box", -26.4, -19.0, 0, 0.5, 0.25, 0.7, "metal", "metal_thin",
    { solid: false, y0: 1.2, flags: { wallMount: true, n: [-1, 0] } });

  // ---- 6.5 the south-west STORE -------------------------------------------
  // Same footprint as the dock, different trade: empty crates, shelving racks
  // and a stack of pallets waiting for Monday.
  p("st_shelf_1", "shelving", -31.7, 10.5, 0, 0.6, 2.6, 1.9, "metal", "metal_thin",
    { cover: { ...Wd, height: "high" } });
  p("st_crate_1", "crate", -26.9, 12.5, 0.2, 1.4, 1.2, 1.25, "wood", "soft",
    { cover: { ...E, height: "low" } });
  p("st_kiosk_1", "kiosk", -30.4, 16.5, 0, 2.6, 2.6, 2.3, "wood", "soft",
    { cover: { ...S, height: "high" } });
  p("st_fence_1", "fence", -30.0, 20.5, 0, 3.0, 0.15, 2.1, "metal", "metal_thin",
    { cover: { ...S, height: "high" } });
  p("st_pallet_2", "pallet", -26.9, 22.5, -0.2, 1.2, 1.0, 1.1, "wood", "soft",
    { cover: { ...S, height: "low" } });
  p("st_rope_1", "rope", -26.8, 18.0, 0.6, 0.8, 0.8, 0.3, "wood", "soft", { solid: false });
  p("st_trash_1", "trash_bags", -31.2, 6.8, 0.9, 1.0, 1.0, 0.6, "wood", "soft",
    { solid: false });

  // ---- 6.6 the SALT STORE interior (flag room) -----------------------------
  // Six pieces, all hugging a wall so the stand sits in an open middle: the
  // room is a fight you can move inside rather than a cupboard full of
  // furniture, and the 1.5 m spawn-clearance bar stays satisfiable in a 6 × 10
  // room. Because the whole map is a rotation these are ALSO the east flag's
  // cover, so G-I's P2 clause (identical cover count within 5.5 m of each
  // stand) cannot drift.
  p("ss_shelf_1", "shelving", -30.5, 4.35, 0, 2.6, 0.6, 1.9, "metal", "metal_thin",
    { cover: { ...S, height: "high" } });
  p("ss_crate_1", "crate", -31.3, 1.0, 0, 1.4, 1.2, 1.25, "wood", "soft",
    { cover: { ...Wd, height: "low" } });
  p("ss_crate_2", "crate", -31.3, -1.6, 0, 1.4, 1.2, 1.25, "wood", "soft",
    { cover: { ...Wd, height: "low" } });
  p("ss_crate_3", "crate", -26.7, 0.5, 0, 1.4, 1.2, 1.25, "wood", "soft",
    { cover: { ...E, height: "low" } });
  p("ss_pallet_1", "pallet", -27.6, 4.3, 0, 1.2, 1.0, 1.1, "wood", "soft",
    { cover: { ...Wd, height: "low" } });
  p("ss_table_1", "table", -30.5, -4.2, 0, 1.6, 0.9, 0.78, "wood", "soft");
  p("ss_bin_1", "bin", -27.0, -4.2, 0, 0.6, 0.6, 0.9, "metal", "metal_thin");
  p("ss_rope_1", "rope", -29.0, -4.4, 0.2, 0.8, 0.8, 0.3, "wood", "soft", { solid: false });

  // ================================================== 7. EMIT (half ×2)
  const localWalls = [];
  for (const b of SW) localWalls.push(b);
  for (const b of HW) { localWalls.push(b); localWalls.push(mirrorBox(b)); }
  const walls = localWalls.map(worldBox);

  const props = [];
  const emitProp = (a, mirror) => {
    const [id, kind, x, z, rot, sx, sz, h, surface, matClass, opts = {}] = a;
    if (!mirror) {
      props.push(prop(id, kind, x + OX, z + OZ, rot, sx, sz, h, surface, matClass, opts));
      return;
    }
    const mo = Object.assign({}, opts);
    if (opts.cover) {
      mo.cover = { dir: [-opts.cover.dir[0], 0, -opts.cover.dir[2]], height: opts.cover.height };
    }
    if (opts.flags && opts.flags.n) {
      mo.flags = Object.assign({}, opts.flags, { n: [-opts.flags.n[0], -opts.flags.n[1]] });
    }
    props.push(prop(`m_${id}`, kind, -x + OX, -z + OZ, rot + Math.PI, sx, sz, h, surface, matClass, mo));
  };
  for (const a of HP) { emitProp(a, false); emitProp(a, true); }

  // ============================================================== 8. DATA
  // Node set — 17 keys, the same count as lanternwalk's arena set. Every key is
  // a place a bot or an objective can be told to go: the two stands, the two
  // docks, the four aisle ends, the two bands, the hall (centre, both side
  // aisles, both ends) and both gallery legs.
  const NODES = {
    hall_center: pt(0, 0, 0),
    hall_north: pt(0, 0, -13),
    hall_south: pt(0, 0, 13),
    hall_west: pt(-17.8, 0, -1),
    hall_east: pt(17.8, 0, 1),
    gallery_north: pt(-6, Y_GAL, -17.8),
    gallery_south: pt(6, Y_GAL, 17.8),
    band_north: pt(-14, 0, -22.5),
    band_south: pt(14, 0, 22.5),
    rows_west_n: pt(-21.5, 0, -16),
    rows_west_s: pt(-21.5, 0, 16),
    rows_east_n: pt(21.5, 0, -16),
    rows_east_s: pt(21.5, 0, 16),
    dock_west: pt(-29, 0, -13.5),
    dock_east: pt(29, 0, 13.5),
    salt_store: pt(-29, 0, 1.5),
    weigh_house: pt(29, 0, -1.5),
  };

  // Reference spawn: the nav flood seed and the boot fallback. content.json's
  // arena block is the runtime source and is PROBE-EMITTED, never hand-copied.
  const REF_SPAWNS = {
    player: { pos: pt(-13, 0, 0), yaw: -Math.PI / 2 }, // hall, west of centre, faces east
  };

  // Walkable-region rectangles. Union semantics: a point is walkable when it is
  // inside ANY rect at that y and not inside a solid. Every door void has its
  // own rect — probe_arena's dead-end clause requires each ground rect to touch
  // ≥ 2 others, and a door rect is what connects a room to its neighbours
  // without the room rect having to overlap them through a wall.
  const WALK_RECTS = [
    rect("w_dock_nw", -32, -24, -26, -6),
    rect("w_dock_sw", -32, 6, -26, 24),
    rect("w_saltstore", -32, -5, -26, 5),
    rect("w_ss_dn", -32, -6, -30, -5),
    rect("w_ss_ds", -28, 5, -26, 6),
    rect("w_tw_d1", -26, -4.5, -25, -1),
    rect("w_tw_dn1", -26, -21, -25, -18),
    rect("w_tw_dn2", -26, -11, -25, -8),
    rect("w_tw_ds1", -26, 8, -25, 11),
    rect("w_tw_ds2", -26, 18, -25, 21),
    rect("w_aisle_w", -25, -24, -20, 24),
    rect("w_hall_dw1", -20, -16, -19, -10),
    rect("w_hall_dw2", -20, 5, -19, 11),
    rect("w_hall", -19, -19, 19, 19),
    rect("w_hall_dn1", -15, -20, -9, -19),
    rect("w_hall_dn2", -3, -20, 3, -19),
    rect("w_hall_dn3", 9, -20, 15, -19),
    rect("w_band_n", -25, -24, 25, -20),
    rect("w_band_s", -25, 20, 25, 24),
    // east half — the 180° rotation of the west set
    rect("w_dock_ne", 26, -24, 32, -6),
    rect("w_dock_se", 26, 6, 32, 24),
    rect("w_weighhouse", 26, -5, 32, 5),
    rect("w_wh_ds", 30, 5, 32, 6),
    rect("w_wh_dn", 26, -6, 28, -5),
    rect("w_tw_e_d1", 25, 1, 26, 4.5),
    rect("w_tw_e_ds1", 25, 18, 26, 21),
    rect("w_tw_e_ds2", 25, 8, 26, 11),
    rect("w_tw_e_dn1", 25, -11, 26, -8),
    rect("w_tw_e_dn2", 25, -21, 26, -18),
    rect("w_aisle_e", 20, -24, 25, 24),
    rect("w_hall_de1", 19, 10, 20, 16),
    rect("w_hall_de2", 19, -11, 20, -5),
    rect("w_hall_ds1", 9, 19, 15, 20),
    rect("w_hall_ds2", -3, 19, 3, 20),
    rect("w_hall_ds3", -15, 19, -9, 20),
    // the gallery deck (y 2.8) — excluded from the dead-end clause by its y
    rect("w_gal_n", -19, -19, 19, -16.5, Y_GAL),
    rect("w_gal_s", -19, 16.5, 19, 19, Y_GAL),
    rect("w_gal_w", -19, -16.5, -16.5, 14, Y_GAL),
    rect("w_gal_e", 16.5, -14, 19, 16.5, Y_GAL),
  ];

  // POI zones. Order matters: nav.js's light bake takes the FIRST zone that
  // contains a cell, so the specific rooms are listed before the docks.
  // NOTE (out of this module's scope): core/ai/nav.js ZONE_BASE has no entry
  // for these keys, so each falls through to its 0.1 default — dark, which is
  // right for a covered market at night, but the entries should be authored
  // explicitly when the map is registered.
  const ZONES = {
    poi_saltstore: zone(-32, -6, -26, 6),
    poi_weighhouse: zone(26, -6, 32, 6),
    poi_markethall: zone(-20, -20, 20, 20),
    poi_band_north: zone(-20, -24, 20, -20),
    poi_band_south: zone(-20, 20, 20, 24),
    poi_stallrows_w: zone(-26, -24, -20, 24),
    poi_stallrows_e: zone(20, -24, 26, 24),
    poi_dock_west: zone(-32, -24, -26, 24),
    poi_dock_east: zone(26, -24, 32, 24),
  };

  // Ground paint (drives the PBR sets). Authored as a non-overlapping tiling so
  // no two patches z-fight: wet asphalt on the open docks, worn tile down the
  // rows, cobble under the hall, concrete in the rooms and bands.
  const road = (id, kind, x0, z0, x1, z1) =>
    ({ id, kind, min: [x0 + OX, z0 + OZ], max: [x1 + OX, z1 + OZ] });
  const ROADS = [
    road("r_dock_nw", "asphalt_worn", -32, -24, -26, -6),
    road("r_dock_sw", "asphalt_worn", -32, 6, -26, 24),
    road("r_saltstore", "concrete_interior", -32, -6, -26, 6),
    road("r_dock_ne", "asphalt_worn", 26, -24, 32, -6),
    road("r_dock_se", "asphalt_worn", 26, 6, 32, 24),
    road("r_weighhouse", "concrete_interior", 26, -6, 32, 6),
    road("r_rows_w", "tile_interior", -26, -24, -20, 24),
    road("r_rows_e", "tile_interior", 20, -24, 26, 24),
    road("r_hall", "plaza_cobble", -20, -20, 20, 20),
    road("r_band_n", "concrete_interior", -20, -24, 20, -20),
    road("r_band_s", "concrete_interior", -20, 20, 20, 24),
  ];

  // Practicals. Five reals (the same lease count lanternwalk ships), the rest
  // emissive-only: strings of stall bulbs down the aisles, a clerestory shaft
  // into the hall, sodium over the two open docks, and shop neon on the hall's
  // outer faces. The palette is lanternwalk's unchanged — this is the same wet
  // night, four streets over.
  const LP = (id, x, y, z, color, kind, real, extra = {}) =>
    Object.assign({ id, pos: [x + OX, y, z + OZ], color, kind, real }, extra);
  const LIGHT_POLES = [
    LP("L_HALL_KEY", 0, 8.6, 0, "#c86ee0", "neon_bounce", true,
      { aim: [0 + OX, 0, 0 + OZ], cone: 85, blackout: { relight: "#4adcd6", level: 0.4 } }),
    LP("L_HALL_SKY", 0, 7.2, -8, "#7c8fb8", "skylight", true,
      { aim: [0 + OX, 0, -8 + OZ], cone: 35, godRay: true }),
    LP("L_DOCK_W", -29, 6.0, -14, "#ff9a3c", "sodium", true,
      { aim: [-29 + OX, 0, -14 + OZ], cone: 60, godRay: true }),
    LP("L_DOCK_E", 29, 6.0, 14, "#ff9a3c", "sodium", true,
      { aim: [29 + OX, 0, 14 + OZ], cone: 60, godRay: true }),
    LP("L_ROWS_W", -22.5, 4.4, -3, "#cfe0d8", "fluorescent", true,
      { aim: [-22.5 + OX, 0, -3 + OZ], cone: 70 }),
    // Fakes — emissive head + cone card + pool decal, zero real lights.
    LP("fake_a1_n", -22.5, 3.6, -19, "#ff9a3c", "sodium", false),
    LP("fake_a1_m", -22.5, 3.6, -9, "#ff9a3c", "sodium", false),
    LP("fake_a1_s", -22.5, 3.6, 12, "#ff9a3c", "sodium", false),
    LP("fake_a1e_n", 22.5, 3.6, -12, "#ff9a3c", "sodium", false),
    LP("fake_a1e_m", 22.5, 3.6, 9, "#ff9a3c", "sodium", false),
    LP("fake_a1e_s", 22.5, 3.6, 19, "#ff9a3c", "sodium", false),
    LP("fake_band_nw", -11, 4.2, -20, "#cfe0d8", "fluorescent", false, { flicker: true }),
    LP("fake_band_ne", 11, 4.2, -20, "#cfe0d8", "fluorescent", false),
    LP("fake_band_sw", -11, 4.2, 20, "#cfe0d8", "fluorescent", false),
    LP("fake_band_se", 11, 4.2, 20, "#cfe0d8", "fluorescent", false, { flicker: true }),
    LP("fake_hall_nw", -11, 5.2, -9, "#ffb46b", "sodium", false),
    LP("fake_hall_se", 11, 5.2, 9, "#ffb46b", "sodium", false),
    LP("fake_store_w", -29, 3.9, 0, "#ffc88a", "interior", false),
    LP("fake_store_e", 29, 3.9, 0, "#ffc88a", "interior", false),
    LP("fake_dock_w", -29, 5.2, -22.5, "#dce8ff", "flood", false,
      { aim: [-29 + OX, 0, -20 + OZ] }),
    LP("fake_dock_e", 29, 5.2, 22.5, "#dce8ff", "flood", false,
      { aim: [29 + OX, 0, 20 + OZ] }),
    // Shop neon on the hall's outer faces (the signage pass reads `sign`).
    LP("neon_salt", -20.2, 4.6, -3, "#38d8d0", "neon", false, { sign: "СОЛЬ" }),
    LP("neon_market", -20.2, 4.0, 11, "#ffb340", "neon", false, { sign: "РЫНОК 24" }),
    LP("neon_weigh", 20.2, 4.6, 3, "#e83ea8", "neon", false, { sign: "ВЕСЫ" }),
    LP("neon_spice", 20.2, 4.0, -11, "#3cff88", "neon", false, { sign: "СПЕЦИИ" }),
    LP("neon_ice", -26.2, 4.2, 14, "#ff4040", "neon", false, { sign: "ЛЁД" }),
    LP("neon_fish", 26.2, 4.2, -14, "#38d8d0", "neon", false, { sign: "РЫБА" }),
  ];

  // Terrain. No canal on this map; the field is kept (colliders.js's groundY
  // and computePlacements both read terrain.canal unconditionally) with zMin
  // pushed far outside the arena so the predicate is always false.
  const TERRAIN = {
    base: 0,
    canal: { zMin: 400, y: -1.5 },
    // Rain pools where the roof leaks and where the docks drain.
    heroPuddles: [
      { pos: [0 + OX, -4 + OZ], r: 3.2 },
      { pos: [-29 + OX, -18 + OZ], r: 2.6 },
      { pos: [29 + OX, 18 + OZ], r: 2.6 },
      { pos: [-8 + OX, 8 + OZ], r: 2.2 },
    ],
  };

  return {
    buildings: [],   // no facade massing: the market IS its shell (see header)
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
    mapId: "saltmarket",
  };
}

// ===========================================================================
// ARENA_SPEC — the spawn/objective half of the map, consumed by
// tools/probe_arena.mjs (which REPAIRS, re-yaws and EMITS it into content.json;
// the numbers below are seeds, not the shipped set).
// ===========================================================================
const sp = (id, x, z, cluster, modes = null) => [id, x + OX, z + OZ, cluster, modes];

export const ARENA_SPEC = {
  id: "saltmarket",

  // Seven clusters, three per side plus the hall. The two corner clusters face
  // DIAGONALLY inward (∓3π/4 and ∓π/4) rather than straight across the map, and
  // that is a measured decision, not a stylistic one: their points live in the
  // aisles and the bands, where a due-east look walks straight into the hall's
  // west wall two metres away and the probe's "≥ 8 m forward view inside a ±60°
  // inward cone" bar is unsatisfiable. Facing the corner diagonally puts the
  // aisle itself inside the cone. Sides are the rotation's two
  // halves, so SC_SALT/SC_WEIGH, SC_DOCK_W/SC_DOCK_E and SC_ROWS_W/SC_ROWS_E
  // are exact mirrors of each other and every parity metric is identically
  // balanced. inward yaw uses forward = (−sin yaw, −cos yaw):
  //   +X → −π/2 ·· −X → +π/2 ·· +Z(south) → π ·· −Z(north) → 0
  clusterMeta: {
    SC_SALT: { inward: -Math.PI / 2, node: "salt_store", side: "west" },
    SC_DOCK_W: { inward: -3 * Math.PI / 4, node: "dock_west", side: "west" },
    SC_ROWS_W: { inward: -Math.PI / 4, node: "rows_west_s", side: "west" },
    SC_WEIGH: { inward: Math.PI / 2, node: "weigh_house", side: "east" },
    SC_DOCK_E: { inward: Math.PI / 4, node: "dock_east", side: "east" },
    SC_ROWS_E: { inward: 3 * Math.PI / 4, node: "rows_east_n", side: "east" },
    SC_HALL: { inward: null, node: "hall_center", side: "mid", modes: ["ffa"] },
  },

  // 50 seeds. The rule that shapes the set: a CTF-eligible point may not sit
  // inside its own flag room or stare into it (the probe's V8/V9 clauses), so
  // each base cluster carries four room/room-mouth points marked ["tdm","ffa"]
  // and six approach points outside the room that carry all three modes. That
  // is lanternwalk's sp_l1/l2/l3 pattern applied at authoring time instead of
  // being discovered by a failing gate.
  spawnSeeds: [
    // ---- SC_SALT — the salt store itself (a CTF spawn may not sit inside its
    //      own flag room, so the two room points are TDM/FFA) plus the dock
    //      spine that serves it
    sp("sp_ss1", -28, -2.5, "SC_SALT", ["tdm", "ffa"]),
    sp("sp_ss2", -29.5, 2.5, "SC_SALT", ["tdm", "ffa"]),
    sp("sp_ss3", -27, 20, "SC_SALT"),
    sp("sp_ss4", -28, -19.5, "SC_SALT"),
    sp("sp_ss5", -29.5, 12, "SC_SALT"),
    sp("sp_ss6", -27.5, -11, "SC_SALT"),
    sp("sp_ss7", -30.5, -15, "SC_SALT"),
    sp("sp_ss8", -27.5, 15.5, "SC_SALT"),

    // ---- SC_DOCK_W — the north-west quarter: dock mouth, aisle A1 north, the
    //      north band and the hall's north-west corner
    sp("sp_dw1", -4, -9, "SC_DOCK_W"),
    sp("sp_dw2", -15.5, -15, "SC_DOCK_W"),
    sp("sp_dw3", -7.5, -10.5, "SC_DOCK_W"),
    sp("sp_dw4", -4.5, -17.5, "SC_DOCK_W"),
    sp("sp_dw5", -21.5, -6.5, "SC_DOCK_W"),
    sp("sp_dw6", -22, -17.5, "SC_DOCK_W"),
    sp("sp_dw7", -23, -22.5, "SC_DOCK_W"),

    // ---- SC_ROWS_W — the south-west quarter (SC_DOCK_W's Z-mirror region)
    sp("sp_rw1", -12.5, 9.5, "SC_ROWS_W"),
    sp("sp_rw2", -4.5, 15, "SC_ROWS_W"),
    sp("sp_rw3", -21.5, 18.5, "SC_ROWS_W"),
    sp("sp_rw4", -16.5, 9.5, "SC_ROWS_W"),
    sp("sp_rw5", -9.5, 11, "SC_ROWS_W"),
    sp("sp_rw6", -4, 11.5, "SC_ROWS_W"),
    sp("sp_rw7", -21.5, 13.5, "SC_ROWS_W"),

    // ---- SC_WEIGH / SC_DOCK_E / SC_ROWS_E — the exact 180° mirrors. Every
    //      east seed is (−x, −z) of a west one, which is what makes G-I's
    //      attacker→enemy-flag parity and G-J's home-centroid parity exact
    //      rather than tuned.
    sp("sp_wh1", 28, 2.5, "SC_WEIGH", ["tdm", "ffa"]),
    sp("sp_wh2", 29.5, -2.5, "SC_WEIGH", ["tdm", "ffa"]),
    sp("sp_wh3", 27, -20, "SC_WEIGH"),
    sp("sp_wh4", 28, 19.5, "SC_WEIGH"),
    sp("sp_wh5", 29.5, -12, "SC_WEIGH"),
    sp("sp_wh6", 27.5, 11, "SC_WEIGH"),
    sp("sp_wh7", 30.5, 15, "SC_WEIGH"),
    sp("sp_wh8", 27.5, -15.5, "SC_WEIGH"),

    sp("sp_de1", 4, 9, "SC_DOCK_E"),
    sp("sp_de2", 15.5, 15, "SC_DOCK_E"),
    sp("sp_de3", 7.5, 10.5, "SC_DOCK_E"),
    sp("sp_de4", 4.5, 17.5, "SC_DOCK_E"),
    sp("sp_de5", 21.5, 6.5, "SC_DOCK_E"),
    sp("sp_de6", 22, 17.5, "SC_DOCK_E"),
    sp("sp_de7", 23, 22.5, "SC_DOCK_E"),

    sp("sp_re1", 12.5, -9.5, "SC_ROWS_E"),
    sp("sp_re2", 4.5, -15, "SC_ROWS_E"),
    sp("sp_re3", 21.5, -18.5, "SC_ROWS_E"),
    sp("sp_re4", 16.5, -9.5, "SC_ROWS_E"),
    sp("sp_re5", 9.5, -11, "SC_ROWS_E"),
    sp("sp_re6", 4, -11.5, "SC_ROWS_E"),
    sp("sp_re7", 21.5, -13.5, "SC_ROWS_E"),

    // ---- SC_HALL — FFA only, the great hall floor. This is the one cluster
    //      that is NOT authored as mirror pairs: it is excluded from both
    //      parity gates (side:"mid"), and letting it take the six best-spread
    //      points on the floor beats forcing symmetry it is not measured on.
    sp("sp_h1", -12, -1, "SC_HALL", ["ffa"]),
    sp("sp_h2", 12, 1, "SC_HALL", ["ffa"]),
    sp("sp_h3", -1, 0.5, "SC_HALL", ["ffa"]),
    sp("sp_h4", 5.5, 2.5, "SC_HALL", ["ffa"]),
    sp("sp_h5", -6, -3, "SC_HALL", ["ffa"]),
    sp("sp_h6", -9.5, 4.5, "SC_HALL", ["ffa"]),
  ],

  // The two stands. Rotational mirrors of each other about the arena centre,
  // each inside its own room and off all three of that room's door axes.
  flagWest: [-29 + OX, 0, 1.5 + OZ],
  flagEast: [29 + OX, 0, -1.5 + OZ],

  // Same reasoning as lanternwalk's overrides (arena.md §2.4): this arena's
  // measured engagement band is well under 15 m, so pvp_design's 22 m / 60 m /
  // 40 m veto discs would veto the whole map on every spawn.
  vetoOverrides: { v1M: 12.0, v2LosM: 25.0, v3ConeM: 20.0 },
  // G-B counts ELEVATED playable surface alongside the ground area. This map carries a
  // real gallery deck at y 2.8 (w_gal_n/s/w/e = 95+95+76+76). Leaving it undeclared read
  // as 0 m² of balcony and failed G-B at 249 m² against a 250 bar, despite the deck being
  // walkable, stair-served and fought over. Measured from walkRects, not estimated.
  gates: { balconyAreaM2: 343 },
};

export default { buildLayout, ARENA_SPEC };
