// core/level/maps/saltmarket.js [PVP arena #2 — the covered market district]
// SALTMARKET — "the Saltmarket Halls": a night market under a leaking roof.
// ELEVEN rooms cut out of one 98 x 76 m shed by two gantry walls and four
// cross walls: a great hall in the middle, a shuttered salt store and weigh
// house on the flanks, and eight market bays and open yards around them.
// Authored STANDALONE (no meridian_ward import) per _design/pvp/arena.md
// Part 5.1's second option.
//
// Coordinate convention unchanged: +X east, +Z south, Y up, metres.
// Arena bounds: X in [-55, +45], Z in [-41, +37]  (100 x 78 gross).
//
// ---------------------------------------------------------------------------
// GEN-2 (2026-09-16) — THE ELEVEN-ROOM REBUILD, AND THE THREE MEASUREMENTS
// THAT FORCED IT
//
// Pass 1 doubled the floor (2488 -> 5878 m2) and cleared G-A, G-B and G-HUB
// but kept the gen-1 IDIOM — nested rings of 12 m streets and 8 m bands around
// one big hall — and failed G-C outright:
//
//     G-C  <6 m 42.9% (25-45 ok)  <15 m 76.9% (needs 50-70)  15-40 m 20.8%
//                                                            (needs >=28)
//
// MEASUREMENT 1 — CORRIDORS CANNOT CARRY THE MID BAND. Sampling the ray
// profile per region on the pass-1 build gave HALL (46 x 40) 15-40 m 39.3%
// against STREET 12.7%, DOCK 13.5%, SERVICE YARD 12.8%. One room passed G-C on
// its own and every corridor failed it. The arithmetic: in a lane of clear
// width W a ray at angle th off the lane axis dies at (W/2)/sin(th), so the
// share of directions reaching 15 m is about 4*asin(W/30)/2pi — 18% at W = 8.4
// and 26% at W = 12. Lengthening a lane only feeds the few near-axial
// directions, and those spill past 40 m into G-D's tails. Only WIDTH moves the
// band, so the map had to become rooms.
//
// MEASUREMENT 2 — CLUTTER, NOT ROOM SIZE, DECIDES G-C. The first room build
// (nine rooms, ~80 props above the 1.7 m sightline band) measured <6 m 46.7% /
// 15-40 m 18.2% — WORSE than the ring it replaced. A prop only blocks sight if
// it reaches 1.7 m, and a region's mean free path is pi*A / (total blocking
// perimeter); ~800 m of prop perimeter against ~1250 m of wall pulled the whole
// map to a 9 m mean free path. Stripping the tall props to ~30 took the same
// geometry to <6 m 32.1% / <15 m 65.6% / 15-40 m 31.4%. Hence the rule this
// file is built on: ONE tall prop per room, and everything else below 1.7 m —
// still blocking movement, still carrying a cover node, still eating the floor
// area G-A caps, and costing the sightline gates nothing.
//
// MEASUREMENT 3 — ROOM COUNT, NOT ROOM CLUTTER, DECIDES G-E. Stripping those
// props took P(>=1 of 9 in LOS) from 60.4% to 71.1% against a 60% ceiling, a
// measured exchange rate of 1.27 LOS points per point of mid band. At that
// rate the nine-room plan could not reach mid 28 and LOS 60 together from
// either end. What breaks the deadlock is that for rooms that are convex and
// mutually blind, pairwise visibility is decided by AREA alone:
//
//     P(>=1 of 9) = SUM_i f_i * (1 - (1 - f_i)^9)
//
// (the check on the nine-room build: that formula predicts 72.5% against 71.1%
// measured, so the doors leak almost nothing). The band mix, by contrast, is
// decided by SHAPE: integrating the ray length over an empty rectangle gives
// 15-40 m = 48.6% at 38 x 30, 34.9% at 29 x 22, 32.9% at 24 x 24 and 21.7% at
// 40 x 14 — the SQUAREST room wins at a given area, and a long thin one loses
// badly. So the design that satisfies both is MANY ROOMS, EACH AS SQUARE AND AS
// EMPTY AS POSSIBLE. Eleven rooms of 560-700 m2 predicts 57.7% LOS and 33.7%
// mid before a single prop is placed, which is the budget this file then spends
// on cover.
//
// THE PLAN, in local metres (add ORIGIN for world):
//
//     X:  [-49,-26]   [-24,-1]   [1,24]   [26,49]
//   Z
//   [-38,-13]   NW YARD   NORTH-WEST   NORTH-EAST   NE YARD
//                          MARKET       MARKET
//   [-11, 11]   SALT STORE PRECINCT  |  GREAT HALL  |  WEIGH HOUSE PRECINCT
//                    X[-49,-17]         X[-15,15]      X[17,49]
//   [ 13, 38]   SW YARD   SOUTH-WEST   SOUTH-EAST   SE YARD
//                          MARKET       MARKET
//
// Two GANTRY walls (gw_n at Z[-13,-11] and its mirror) run the arena's whole
// 98 m width; four CROSS walls (vn_w, vn_c, vn_e in the outer rows, vc_w in
// the middle row, plus mirrors) run north-south. Every wall is 2 m thick.
//
// DOOR WIDTH IS 3 m AND THAT IS A HARD FLOOR, not a style. G-HUB measures the
// largest 4-connected region of cells at least 1.5 m from any blocker and wants
// 40% of the floor in ONE of them; on the probe's 0.5 m grid a 3 m void puts
// its middle cells exactly 1.5 m from the wall, so a 3 m door carries the open
// region by a single cell column and a 2.5 m door severs it. Measured: at 3 m
// the region is 60.5% of the floor, and the run that sealed one door without
// compensating dropped it to 27.7%. The two flag rooms' doors are 3.5 m.
//
// DOOR COUNT IS THE MAP'S CHEAPEST LEVER, and the reason the gantry carries
// three doors rather than five. Measured on this geometry: dropping the gantry
// from five doors to three moved P(>=1 of 9 in LOS) 62.9% -> 60.2% while the
// 15-40 m band only fell 29.4% -> 29.0% — 1.35 points of G-E per door against
// 0.2 points of G-C, where CLUTTER trades at 1.27 to 1. Sealing vn_c outright
// (the outer rows' middle cross wall) bought another 3.4 points for 0.5. So
// gw_n has three doors, vn_w and vn_e one each, vn_c none, and vc_w one.
//
// THE DOOR-AXIS RULE. A wall and its own 180-degree mirror are the two walls a
// straight line has to thread to cross the map, so each wall's void set D is
// chosen with D disjoint from -D. On midpoints m_i and half-widths h_i that is
// |m_i + m_j| >= h_i + h_j for every pair including i = j, which is how
// GW_GAPS and VC_GAPS below were picked (they touch at endpoints and nowhere
// else). vn_w and vn_e are not each other's mirrors — vn_w maps onto the south
// row's EAST wall — so the rule that binds them is that their door sets are
// PAIRWISE DISJOINT in Z, and no east-west line threads both.
//
// ---------------------------------------------------------------------------
// MEASURED, 2026-09-16 (tools/probe_arena.mjs --map=saltmarket --gen=2, PASS):
//
//   G-A  walkable ground 6175 m2 (5500-6300), disconnected stray 0
//   G-B  per-actor 641 m2 (560-700, incl. the 235 m2 gallery ring)
//   G-C  <6 m 33.3% (25-45) - <15 m 69.3% (50-70) - 15-40 m 29.8% (>=28)
//   G-D  >=78 m 0.000% - >=55 m 0.06% - >=40 m 0.87% - longest ray 63.8 m (<=95)
//   G-E  nearest-of-9 p10 5.2 m (>=5) - median 14.2 m - p90 27.5 m
//        P(>=1 of 9 in LOS) 58.9% (35-60)
//   G-HUB largest open region 3734 m2 = 60.5% of floor, 373x the second
//   G-G  94 spawn points placed, 7 clusters, no rejections
//
// ---------------------------------------------------------------------------
// THE ONE MEASUREMENT THAT SHAPED THIS MAP FROM THE START (still binding —
// probe_arena.mjs's G-HUB clause cites these lines)
//
// A market of narrow stall rows is trivially easy on the sightline gates and
// brutal on the occupancy gate. The FIRST build of this arena was a pure
// lattice of aisles — four aisles, shuttered terraces, a 22 x 26 hall — and it
// measured:
//
//     G-C  band mix <6 m 69.0%   (gen-1 needed >=40)  <- enormous margin
//     G-D  rays >=40 m 0.00%     (allowed 1.5%)       <- enormous margin
//     G-E  P(>=1 of 9 actors in LOS) 36.1%            <- DEAD
//
// Ten actors in a warren never see each other. The fix is not more cover, it is
// ROOMS YOU CAN SEE ACROSS: the mutual-visibility probability between two
// random points scales with the SQUARE of the largest open region's share of
// the floor. G-HUB gates that directly (largest 4-connected region of cells
// >=1.5 m from any blocker, >=40% of the floor, >=2x the second).
//
// G-E is also the one gate whose reading is NOISY: it is a 1500-trial Monte
// Carlo, so its standard error is ~1.2 points. A map that measures 35.1 or 59.9
// is not a map that passes — it is a map whose true value might be outside the
// band. This one is tuned to sit near the MIDDLE of 35-60, not near an edge.
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
// (-5, -2) and floods its walkable grid from the cell nearest the arena centre.
// Putting SALTMARKET's centre of rotation on that exact point makes P3
// near-symmetric and drops the flood seed in the middle of the great hall. It
// is also why the centre of the hall is kept WALKABLE: P3 snaps its sample to
// the nearest reachable cell, so a solid centrepiece would let the snap land
// off-axis and manufacture an asymmetry out of a symmetric map. ORIGIN below is
// that offset; every authored number in this file is LOCAL (centre-relative)
// and only crosses into world coordinates through
// wbox() / prop() / pt() / rect() / zone() / road() / LP().
//
// Where the rotation would make the place read as two copies of itself, the
// variation is carried by what the gates do not measure: prop KIND (the
// north-west yard is dressed in dumpsters, containers and chain-link, the
// north-east in crates, racking and empty pallets; the two north market bays in
// shipping steel and scaffold board), the lighting profile and the ground
// paint. Four of the eleven rooms — the corner yards — have no roof over them
// at all, and the rain is audible in them.
//
// THREE-free, data only.

// --------------------------------------------------------------- constants
// Centre of rotation, in WORLD metres. See the header: this is probe_arena's
// hardcoded mid sample. Changing it re-bases the whole map.
const ORIGIN = [-5, -2];
const OX = ORIGIN[0], OZ = ORIGIN[1];

// Local playable rectangle is X,Z ∈ [−49,49] × [−38,38]; the perimeter wall
// band takes it out to ±50 / ±39, and that band is the arena AABB (G-H samples
// the AABB edge and needs geometry there — the perimeter IS that geometry).
const BOUNDS = { min: [-50 + OX, -2, -39 + OZ], max: [50 + OX, 14, 39 + OZ] };

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
// which is why the cadence is copied rather than invented. stepsX climbs along
// X, PERPENDICULAR to the deck it serves, so it lands on the deck's inner edge
// and the gallery ring never has to be cut to make room for a stair.
function steps(list, idp, x0, x1, zFrom, zTo, n, riser, yBase = 0) {
  const tread = (zTo - zFrom) / n;
  for (let i = 0; i < n; i++) {
    const za = zFrom + tread * i;
    const zb = zFrom + tread * (i + 1);
    list.push(wbox(`${idp}_${i}`, "step", x0, x1, 0, yBase + riser * (i + 1), za, zb, "concrete", "hard"));
  }
}
function stepsX(list, idp, z0, z1, xFrom, xTo, n, riser, yBase = 0) {
  const tread = (xTo - xFrom) / n;
  for (let i = 0; i < n; i++) {
    const xa = xFrom + tread * i;
    const xb = xFrom + tread * (i + 1);
    list.push(wbox(`${idp}_${i}`, "step", xa, xb, 0, yBase + riser * (i + 1), z0, z1, "concrete", "hard"));
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
// (4.6–5.2 m against 8.2 m) so the roof reads as a shed over stalls, and
// deliberately taller than the 1.7 m LOS band everywhere it matters — a 1.2 m
// counter blocks movement but not sightlines, which is the wrong trade for G-C.
const H_PERIM = 7.5;   // outer shell
const H_GANT = 5.2;    // the gantry + cross walls that cut the eleven rooms
const H_ANNEX = 4.6;   // ice house, bonded store
const H_STORE = 4.8;   // the flag room's own shell
const Y_DOOR = 2.4;    // every door void is 2.4 m; headers fill above it
const Y_GAL = 2.8;     // gallery deck — the map's only verticality

// ---- the door-void sets --------------------------------------------------
// Read the DOOR-AXIS RULE in the header before touching any of these. All
// voids are 4 m (h = 2).
//
// gw_n — the gantry wall, Z[−13,−11], running the arena's whole 98 m width.
// Three 3 m doors, midpoints −44 −22 12. Every pair sum clears 3 in absolute
// value (the tightest is −22 + 12 = −10, the tightest self term 2 × 12 = 24),
// so D never meets −D. None of the voids straddles a cross wall. The −22 door
// is the one that gives the ROOM graph a cycle: without it the north-west
// market is a leaf and a losing team has no way round.
const GW_GAPS = [[-45.5, -42.5], [-23.5, -20.5], [10.5, 13.5]];
// The three cross walls of the NORTH row. They are not each other's mirrors
// (vn_w mirrors onto the south row's east wall), so the rule that matters here
// is that their door sets are PAIRWISE DISJOINT in Z: no east-west line
// threads two of them, and the perimeter stops the third. vn_c carries NO
// door — see the door-count note in the header; sealing it was worth 3.4
// points of G-E against 0.5 of G-C, and the rooms it separates are still
// joined through the gantry.
const VN_W_GAPS = [[-33.5, -30.5]];
const VN_C_GAPS = [];
const VN_E_GAPS = [[-29.5, -26.5]];
// vc_w — the middle row's cross wall, X[−17,−15], Z[−11,11]. ONE 3 m door at
// midpoint −7.5 (self term −15, clear of 3). It is deliberately NOT opposite
// the gallery stair: the first draft ran the stair across this throat and the
// hall fell out of G-HUB's open region entirely.
const VC_GAPS = [[-9, -6]];
// The salt store's three doors, 3.5 m each. The stand at (−44.5, 3) is off all
// three axes, which is what stops an attacker getting a free line onto it.
const SS_N_GAPS = [[-49, -45.5]];
const SS_S_GAPS = [[-43.5, -40]];
const SS_E_GAPS = [[-4.5, -1]];

// ---- the hall's stall islands --------------------------------------------
// ONE authored, two after the rotation — see MEASUREMENT 2 in the header. An
// EMPTY 30 x 22 hall integrates to <6 m ~27% / 15-40 m ~35%; nine islands plus
// twelve deck columns took the (larger) 38 x 30 hall to <6 m 43.3% / 15-40 m
// 23.3%. A 2.4 m stall in an open room is roughly ten metres of blocking
// perimeter against the room's own 104, so five of them halve its free path.
// The hall's cover is the 1.1 m counter run, the gallery ring and its own
// walls; only the island reaches the 1.7 m sightline plane.
//
// The authored island sits on x = −6, so its mirror sits on x = +6 and the hall
// keeps a 12 m clear spine through the centre of rotation — which is also the
// cell probe_arena floods its walkable grid from.
const HALL_ISLANDS = [
  ["h_stall_1", "stall", -6.0, -4.0, 2.4, 2.4, "wood", "soft"],
];

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
  w("per_w", "wall", -50, -49, 0, H_PERIM, -39, 39);
  w("per_n", "wall", -49, 49, 0, H_PERIM, -39, -38);

  // Shed roofs. Pure dressing for the collider set (min y 6.4 is far above the
  // 1.7 m LOS band) but load-bearing for the fiction: the hall, the two flank
  // precincts and the four inner market bays are COVERED; the four corner
  // yards are not, and the rain falls into them.
  SW.push(wbox("roof_hall", "roof", -15, 15, 7.0, 7.4, -11, 11, "metal", "metal_thin"));
  w("roof_prec_w", "roof", -49, -17, 6.4, 6.8, -11, 11);
  w("roof_mkt_nw", "roof", -24, -1, 6.4, 6.8, -38, -13);
  w("roof_mkt_ne", "roof", 1, 24, 6.4, 6.8, -38, -13);

  // ============================================ 2. THE GANTRY + CROSS WALLS
  // The six walls that make eleven rooms out of one shed. The cross walls are
  // authored as separate runs per row so they BUTT the gantry walls instead of
  // interpenetrating them (a 2 mm overlap fails probe_props gate 3).
  runX(HW, "gw_n", -13, -11, 0, H_GANT, -49, 49, GW_GAPS, "concrete", "hard");
  for (let i = 0; i < GW_GAPS.length; i++) {
    w(`hdr_gw_n${i}`, "wall", GW_GAPS[i][0], GW_GAPS[i][1], Y_DOOR, H_GANT, -13, -11);
  }
  runZ(HW, "vn_w", -26, -24, 0, H_GANT, -38, -13, VN_W_GAPS, "concrete", "hard");
  runZ(HW, "vn_c", -1, 1, 0, H_GANT, -38, -13, VN_C_GAPS, "concrete", "hard");
  runZ(HW, "vn_e", 24, 26, 0, H_GANT, -38, -13, VN_E_GAPS, "concrete", "hard");
  runZ(HW, "vc_w", -17, -15, 0, H_GANT, -11, 11, VC_GAPS, "concrete", "hard");
  w("hdr_vn_w", "wall", -26, -24, Y_DOOR, H_GANT, VN_W_GAPS[0][0], VN_W_GAPS[0][1]);
  w("hdr_vn_e", "wall", 24, 26, Y_DOOR, H_GANT, VN_E_GAPS[0][0], VN_E_GAPS[0][1]);
  for (const g of VC_GAPS) {
    w(`hdr_vc_w${g[0]}`.replace(/[.-]/g, "_"), "wall", -17, -15, Y_DOOR, H_GANT, g[0], g[1]);
  }

  // ==================================================== 3. THE SALT STORE
  // The west flag room: 10 x 14 m of brick salt store on the arena's west wall
  // inside the precinct, with three 3.5 m doors — north, south and east — and
  // the stand at local (−44.5, 3) on NONE of the three axes, so no attacker
  // gets a free line onto it from outside the room. The measured longest
  // sightline INTO the site is identical on both sides by construction: that is
  // G-I's P5 clause solved by placement rather than by prop screening
  // (lanternwalk needed R1's extra stall for exactly this).
  runX(HW, "ss_n", -7, -6, 0, H_STORE, -49, -40, SS_N_GAPS, "concrete", "hard");
  runX(HW, "ss_s", 6, 7, 0, H_STORE, -49, -40, SS_S_GAPS, "concrete", "hard");
  runZ(HW, "ss_e", -40, -39, 0, H_STORE, -7, 7, SS_E_GAPS, "concrete", "hard");
  w("hdr_ss_n", "wall", SS_N_GAPS[0][0], SS_N_GAPS[0][1], Y_DOOR, H_STORE, -7, -6);
  w("hdr_ss_s", "wall", SS_S_GAPS[0][0], SS_S_GAPS[0][1], Y_DOOR, H_STORE, 6, 7);
  w("hdr_ss_e", "wall", -40, -39, Y_DOOR, H_STORE, SS_E_GAPS[0][0], SS_E_GAPS[0][1]);

  // ==================== 4. THE INTERIOR BLOCKS: DELIBERATELY NONE ==========
  // The first room build put a 6 x 6 ice house and bonded store in the two
  // north market bays and a store in every corner yard, to plug the diagonals
  // that thread one gantry door and one cross door at once — the family that
  // produced the ring build's 100.3 m ray against a 95 m ceiling.
  //
  // MEASURED OUT, 2026-09-16. Once every door was 3 m and the gantry was down
  // to three of them, the longest sampled ray was 87.3 m and the >=78 m tail
  // 0.006% against an 0.05% allowance, so the diagonals no longer needed
  // plugging — while the two blocks were costing the market bays nine points
  // of their 15-40 m band (22.0%, against the 30.7% the unplugged yards of the
  // same 23 x 25 shape measure). Pulling them took the map from 15-40 m 25.4%
  // to 29.4%. Their floor-area job went to the low counter runs in section 6,
  // which eat the same square metres without touching the 1.6 m sightline
  // plane. The arena now measures a 63.8 m longest ray.

  // ==================================================== 5. THE GREAT HALL
  // 30 × 22 m interior — 660 m², about 11% of the walkable floor (the ring
  // build's hall was 29% of it and carried 24 of that map's 58.5 points of
  // P(>=1 in LOS) on its own). Its four walls are the gantry and cross walls
  // above: one 3 m door on each flank and one in each gantry, none facing its
  // own mirror across the room.

  // ---- the gallery ring (verticality, y 2.8) --------------------------------
  // A 2.5 m deck (235 m² of it) around the hall's inner wall, open over a
  // 25 × 17 m void. It cannot be a sniper nest: every hall door void stops at
  // 2.4 m, so from a 2.8 m deck there is no line out of the hall at all, and
  // everything it overlooks is inside the room it is part of. The deck starts
  // at y 2.55, well over the 1.7 m LOS band, so the ground beneath it stays
  // walkable and rays pass under it — the ring costs the hall's floor nothing.
  //
  // The ring is cut by its own two stairs into a north arc and a south arc,
  // each reached by one of them. That is the price of keeping the stairs INSIDE
  // the 2.5 m strip: the earlier draft ran them out across the hall floor,
  // where four of them plus four islands and twelve columns held the hall to
  // 15-40 m 22.5% against the 35% an empty room of its shape integrates to.
  w("gal_n", "slab", -15, 15, 2.55, Y_GAL, -11, -8.5);
  w("gal_w_n", "slab", -15, -12.5, 2.55, Y_GAL, -8.5, -5.5);
  w("gal_w_s", "slab", -15, -12.5, 2.55, Y_GAL, -2, 8.5);
  // One stair authored on the west leg and one mirrored onto the east, ten real
  // 0.28 m risers each — inside moveCapsule's step-up budget, so no mantling
  // anywhere on the ring. Each climbs ALONG its own leg, inside the strip the
  // deck already occupies, and tops out at 2.8 flush with the deck beside it.
  // The west stair is deliberately clear of vc_w's door at Z[−9,−6]: the draft
  // that parked it across that throat took the hall out of G-HUB's open region.
  steps(HW, "gal_stair_w", -15, -12.5, -5.5, -2, 10, 0.28);
  // Deck edge rails (metal, thin — penetrable per combat_spec §3.2). They run
  // unbroken now: the stairs climb along the deck rather than up through its
  // inner edge, so there is nothing for a rail void to let past.
  w("gal_rail_n", "rail", -12.5, 12.5, Y_GAL, 3.9, -8.6, -8.5, "metal", "metal_thin");
  w("gal_rail_w", "rail", -12.6, -12.5, Y_GAL, 3.9, -8.5, 8.5, "metal", "metal_thin");

  // ---- the low counter runs (market fixtures, 1.1 m) -----------------------
  // These are the file's area ballast AND the reason the rooms can stay empty
  // at eye level. G-A caps the floor at 6300 m2 and stripping the tall props
  // pushed it to 6388, so something had to eat ~250 m2 back. A 1.1 m counter
  // does it for free: probe_arena's walkable test rejects any box spanning
  // 0.42-1.7 m, so a counter removes floor, blocks movement and carries the
  // room's cover line — while its ray test samples at y 1.6, so the counter is
  // INVISIBLE to G-C and G-D. It also raises G-E's nearest-of-9 p10, which is
  // the one clause that wants LESS reachable area near any given stance.
  for (const [cid, x0, x1, z0, z1] of [
    ["ctr_yard_w", -36, -33, -31, -23],   // the north-west yard's loading kerb
    ["ctr_yard_e", 33, 36, -31, -23],     // the north-east yard's pallet run
    ["ctr_mkt_w", -19, -16, -30, -22],    // the north-west market's fish slabs
    ["ctr_mkt_e", 16, 19, -30, -22],      // the north-east market's spice bins
    ["ctr_prec_w", -33, -31, -4, 4],      // the salt precinct's weighing bench
    ["ctr_hall", -10, -8, -9, -2],        // the hall's long counter
  ]) w(cid, "wall", x0, x1, 0, 1.1, z0, z1, "wood", "soft");

  // ============================================================== 6. PROPS
  const E = { dir: [1, 0, 0] }, Wd = { dir: [-1, 0, 0] };
  const N = { dir: [0, 0, -1] }, S = { dir: [0, 0, 1] };

  // ---- 6.1 the great hall floor -------------------------------------------
  HALL_ISLANDS.forEach(([id, kind, x, z, sx, sz, surface, matClass], i) => {
    const dir = [N, E, S, Wd][i % 4];
    p(id, kind, x, z, 0, sx, sz, kind === "kiosk" ? 2.3 : 2.4, surface, matClass,
      { cover: { ...dir, height: "high" } });
  });
  // Hall dressing — all of it knee-to-waist high, all of it carrying cover.
  p("h_planter_1", "planter", -2.0, -7.0, 0, 2.0, 0.8, 0.9, "concrete", "hard",
    { cover: { ...S, height: "low" } });
  p("h_crate_1", "crate", -13.0, 1.0, 0.2, 1.4, 1.2, 1.25, "wood", "soft",
    { cover: { ...E, height: "low" } });
  p("h_bench_1", "bench", -5.0, 8.0, 0, 1.8, 0.6, 0.85, "wood", "soft",
    { cover: { ...N, height: "low" } });
  p("h_table_1", "table", 2.0, -3.0, 0, 1.6, 0.9, 0.78, "wood", "soft");
  p("h_pallet_1", "pallet", -6.0, -10.0, 0.3, 1.2, 1.0, 1.1, "wood", "soft",
    { cover: { ...E, height: "low" } });
  p("h_mop_1", "mop_bucket", 5.0, 1.5, 0, 0.45, 0.45, 0.5, "metal", "metal_thin",
    { solid: false });
  p("h_fan_1", "ceiling_fan", -4, -1, 0, 1.6, 1.6, 0.5, "wood", "soft",
    { solid: false, y0: 5.8 });
  p("h_rope_1", "rope", -11.0, 6.5, 0.3, 0.8, 0.8, 0.3, "wood", "soft", { solid: false });

  // ---- 6.2 the gallery deck (y 2.8) ---------------------------------------
  p("gal_crate_n", "crate", 0, -9.75, 0, 1.2, 1.2, 1.4, "wood", "soft", { y0: Y_GAL });
  p("gal_crate_w", "crate", -13.75, 0, 0, 1.2, 1.2, 1.4, "wood", "soft", { y0: Y_GAL });
  p("gal_pallet_w", "pallet", -13.75, -6, 0, 1.2, 1.0, 1.1, "wood", "soft", { y0: Y_GAL });

  // ---- 6.3 the SALT STORE precinct (X[-49,-17], Z[-11,11]) -----------------
  // 32 x 22 of covered market floor wrapped round the flag room. ONE tall
  // kiosk and eleven low pieces: this room's job in the gate set is the
  // 15-40 m band, and a second rank of 2.4 m stalls costs ~4 points of it for
  // one more piece of cover.
  p("sp_kiosk_1", "kiosk", -26.0, 0.0, 0, 2.6, 2.6, 2.3, "wood", "soft",
    { cover: { ...E, height: "high" } });
  p("sp_crate_1", "crate", -32.0, -8.0, 0.2, 1.4, 1.2, 1.25, "wood", "soft",
    { cover: { ...N, height: "low" } });
  p("sp_pallet_1", "pallet", -32.0, 8.0, -0.2, 1.2, 1.0, 1.1, "wood", "soft",
    { cover: { ...S, height: "low" } });
  p("sp_barrier_1", "barrier", -21.0, -8.0, 0, 2.0, 0.6, 1.1, "concrete", "hard",
    { cover: { ...N, height: "low" } });
  p("sp_drums_1", "fuel_drums", -21.0, 8.0, 0, 1.4, 1.4, 1.0, "metal", "metal_thin",
    { cover: { ...S, height: "low" } });
  p("sp_sand_1", "sandbags", -26.0, -9.5, 0, 2.2, 0.9, 1.05, "dirt", "soft",
    { cover: { ...S, height: "low" } });
  p("sp_dump_1", "dumpster", -26.0, 9.5, 0.1, 1.7, 1.1, 1.25, "metal", "metal_thin",
    { cover: { ...N, height: "low" } });
  p("sp_bin_1", "bin", -37.0, 0.0, 0, 0.6, 0.6, 0.9, "metal", "metal_thin");
  p("sp_news_1", "newsbox", -19.0, 0.0, 0, 0.8, 0.5, 1.1, "metal", "metal_thin");
  p("sp_table_1", "table", -41.0, -9.0, 0, 1.6, 0.9, 0.78, "wood", "soft");
  p("sp_crate_3", "crate", -41.0, 9.0, -0.2, 1.4, 1.2, 1.25, "wood", "soft",
    { cover: { ...N, height: "low" } });
  p("sp_vent_1", "steam_vent", -30.0, 4.0, 0, 0.6, 0.6, 0.1, "metal", "hard",
    { solid: false, flags: { steam: true } });
  p("sp_breaker_1", "breaker_box", -38.4, 3.0, 0, 0.5, 0.25, 0.7, "metal", "metal_thin",
    { solid: false, y0: 1.2, flags: { wallMount: true, n: [1, 0] } });

  // ---- 6.4 the SALT STORE interior (flag room) -----------------------------
  // Five pieces, all hugging a wall so the stand sits in an open middle. FOUR
  // of them put a cover node inside 5.5 m of the stand, which is G-I's P2
  // clause (>=4 per stand, equal on both sides); because the whole map is a
  // rotation, equality cannot drift and only the count has to be authored.
  p("ss_shelf_1", "shelving", -47.8, 3.0, 0, 0.6, 2.6, 1.9, "metal", "metal_thin",
    { cover: { ...E, height: "high" } });
  p("ss_crate_1", "crate", -41.5, 1.0, 0, 1.4, 1.2, 1.25, "wood", "soft",
    { cover: { ...Wd, height: "low" } });
  p("ss_crate_2", "crate", -46.0, 5.0, 0, 1.4, 1.2, 1.25, "wood", "soft",
    { cover: { ...S, height: "low" } });
  p("ss_pallet_1", "pallet", -44.5, -1.0, 0, 1.2, 1.0, 1.1, "wood", "soft",
    { cover: { ...S, height: "low" } });
  p("ss_table_1", "table", -42.5, -4.5, 0, 1.6, 0.9, 0.78, "wood", "soft");
  p("ss_rope_1", "rope", -47.5, -3.0, 0.2, 0.8, 0.8, 0.3, "wood", "soft", { solid: false });

  // ---- 6.5 the NORTH-WEST YARD (X[-49,-26], Z[-38,-13]) --------------------
  // Open air, wet asphalt, no roof. 23 x 25, dressed in dumpsters, containers
  // and chain-link; its mirror is the south-east yard, and the north-east yard
  // (6.8) uses crates, racking and empty pallets instead so the two yard pairs
  // do not read as one prop set copied twice.
  p("yw_cont_1", "container", -46.0, -30.0, 0, 2.5, 6.0, 2.6, "metal", "metal_thin",
    { cover: { ...E, height: "high" } });
  p("yw_dump_1", "dumpster", -40.0, -35.0, 0.1, 1.7, 1.1, 1.25, "metal", "metal_thin",
    { cover: { ...S, height: "low" } });
  p("yw_dump_2", "dumpster", -30.0, -35.0, 0.1, 1.7, 1.1, 1.25, "metal", "metal_thin",
    { cover: { ...S, height: "low" } });
  p("yw_drums_1", "fuel_drums", -46.0, -16.0, 0, 1.4, 1.4, 1.0, "metal", "metal_thin",
    { cover: { ...N, height: "low" } });
  p("yw_barrier_1", "barrier", -36.0, -16.0, 0, 2.0, 0.6, 1.1, "concrete", "hard",
    { cover: { ...N, height: "low" } });
  p("yw_sand_1", "sandbags", -29.0, -22.0, 0, 2.2, 0.9, 1.05, "dirt", "soft",
    { cover: { ...E, height: "low" } });
  p("yw_crate_1", "crate", -40.0, -20.0, 0.2, 1.4, 1.2, 1.25, "wood", "soft",
    { cover: { ...E, height: "low" } });
  p("yw_pallet_1", "pallet", -29.0, -28.0, 0.3, 1.2, 1.0, 1.1, "wood", "soft",
    { cover: { ...Wd, height: "low" } });
  p("yw_bin_1", "bin", -30.0, -31.0, 0, 0.6, 0.6, 0.9, "metal", "metal_thin");
  p("yw_trash_1", "trash_bags", -47.0, -20.0, 0.4, 1.0, 1.0, 0.6, "wood", "soft",
    { solid: false });
  p("yw_vent_1", "steam_vent", -30.0, -17.0, 0, 0.6, 0.6, 0.1, "metal", "hard",
    { solid: false, flags: { steam: true } });

  // ---- 6.6 the NORTH-WEST MARKET (X[-24,-1], Z[-38,-13]) -------------------
  // Covered, 23 x 25, with the ice house standing free in it.
  p("mn_kiosk_1", "kiosk", -5.0, -30.0, 0, 2.6, 2.6, 2.3, "wood", "soft",
    { cover: { ...N, height: "high" } });
  p("mn_crate_1", "crate", -22.0, -35.0, 0.25, 1.4, 1.2, 1.25, "wood", "soft",
    { cover: { ...S, height: "low" } });
  p("mn_barrier_1", "barrier", -9.0, -17.0, 0, 2.0, 0.6, 1.1, "concrete", "hard",
    { cover: { ...N, height: "low" } });
  p("mn_drums_1", "fuel_drums", -4.0, -22.0, 0, 1.4, 1.4, 1.0, "metal", "metal_thin",
    { cover: { ...Wd, height: "low" } });
  p("mn_sand_1", "sandbags", -22.0, -16.0, 0, 2.2, 0.9, 1.05, "dirt", "soft",
    { cover: { ...N, height: "low" } });
  p("mn_pallet_1", "pallet", -12.0, -35.0, 0.3, 1.2, 1.0, 1.1, "wood", "soft",
    { cover: { ...S, height: "low" } });
  p("mn_dump_1", "dumpster", -16.0, -17.0, 0.1, 1.7, 1.1, 1.25, "metal", "metal_thin",
    { cover: { ...N, height: "low" } });
  p("mn_news_1", "newsbox", -11.0, -24.0, 0, 0.8, 0.5, 1.1, "metal", "metal_thin");
  p("mn_vent_1", "steam_vent", -3.0, -35.0, 0, 0.6, 0.6, 0.1, "metal", "hard",
    { solid: false, flags: { steam: true } });
  p("mn_ac_1", "ac_unit", -23.4, -28.0, 0, 0.8, 0.5, 0.6, "metal", "metal_thin",
    { solid: false, y0: 2.9, flags: { wallMount: true, n: [1, 0] } });

  // ---- 6.7 the NORTH-EAST MARKET (X[1,24], Z[-38,-13]) ---------------------
  // Covered, 23 x 25, with the bonded store standing free in it. Authored (not
  // mirrored) so the two north bays carry different trades; its own mirror is
  // the SOUTH-WEST market.
  p("me_crate_4", "crate", 20.0, -20.0, 0, 1.4, 1.2, 1.25, "wood", "soft",
    { cover: { ...Wd, height: "low" } });
  p("me_crate_1", "crate", 4.0, -35.0, 0.2, 1.4, 1.2, 1.25, "wood", "soft",
    { cover: { ...S, height: "low" } });
  p("me_barrier_1", "barrier", 20.0, -34.0, 0, 2.0, 0.6, 1.1, "concrete", "hard",
    { cover: { ...S, height: "low" } });
  p("me_drums_1", "fuel_drums", 6.0, -22.0, 0, 1.4, 1.4, 1.0, "metal", "metal_thin",
    { cover: { ...E, height: "low" } });
  p("me_sand_1", "sandbags", 16.0, -17.0, 0, 2.2, 0.9, 1.05, "dirt", "soft",
    { cover: { ...N, height: "low" } });
  p("me_pallet_1", "pallet", 11.0, -36.0, 0.3, 1.2, 1.0, 1.1, "wood", "soft",
    { cover: { ...S, height: "low" } });
  p("me_bin_1", "bin", 4.0, -16.0, 0, 0.6, 0.6, 0.9, "metal", "metal_thin");
  p("me_trash_1", "trash_bags", 13.0, -22.0, 0.5, 1.0, 1.0, 0.6, "wood", "soft",
    { solid: false });

  // ---- 6.8 the NORTH-EAST YARD (X[26,49], Z[-38,-13]) ----------------------
  // Open air. Crates, racking and empty pallets; its mirror is the south-west
  // yard.
  p("ye_kiosk_1", "kiosk", 39.0, -30.0, 0, 2.6, 2.6, 2.3, "wood", "soft",
    { cover: { ...S, height: "high" } });
  p("ye_crate_1", "crate", 30.0, -35.0, 0.2, 1.4, 1.2, 1.25, "wood", "soft",
    { cover: { ...S, height: "low" } });
  p("ye_pallet_1", "pallet", 44.0, -35.0, -0.2, 1.2, 1.0, 1.1, "wood", "soft",
    { cover: { ...S, height: "low" } });
  p("ye_drums_1", "fuel_drums", 30.0, -17.0, 0, 1.4, 1.4, 1.0, "metal", "metal_thin",
    { cover: { ...N, height: "low" } });
  p("ye_sand_1", "sandbags", 44.0, -17.0, 0, 2.2, 0.9, 1.05, "dirt", "soft",
    { cover: { ...N, height: "low" } });
  p("ye_barrier_1", "barrier", 37.0, -21.0, 0, 2.0, 0.6, 1.1, "concrete", "hard",
    { cover: { ...N, height: "low" } });
  p("ye_dump_1", "dumpster", 30.0, -25.0, 0.1, 1.7, 1.1, 1.25, "metal", "metal_thin",
    { cover: { ...E, height: "low" } });
  p("ye_bin_1", "bin", 46.0, -25.0, 0, 0.6, 0.6, 0.9, "metal", "metal_thin");
  p("ye_trash_1", "trash_bags", 30.0, -31.0, 0.4, 1.0, 1.0, 0.6, "wood", "soft",
    { solid: false });
  p("ye_rope_1", "rope", 41.0, -24.0, 0.6, 0.8, 0.8, 0.3, "wood", "soft", { solid: false });

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

  // ============================================================= 8. DATA
  // Node set — 17 keys, FROZEN: tools/probe_props.mjs carries this exact list
  // for saltmarket and fails on a missing or extra key, so the rebuild moved
  // every node and added none. Every key is a place a bot or an objective can
  // be told to go: the two stands, the two outer yards, the four yard/market
  // mouths, the two inner market bays, the hall (centre, both ends, both side
  // aisles) and both gallery legs.
  const NODES = {
    hall_center: pt(0, 0, 0),
    hall_north: pt(0, 0, -6),
    hall_south: pt(0, 0, 6),
    hall_west: pt(-10, 0, -1),
    hall_east: pt(10, 0, 1),
    gallery_north: pt(-5, Y_GAL, -9.75),
    gallery_south: pt(5, Y_GAL, 9.75),
    band_north: pt(-12, 0, -25),
    band_south: pt(12, 0, 25),
    rows_west_n: pt(-37, 0, -25),
    rows_west_s: pt(-37, 0, 25),
    rows_east_n: pt(37, 0, -25),
    rows_east_s: pt(37, 0, 25),
    dock_west: pt(-30, 0, -2),
    dock_east: pt(30, 0, 2),
    salt_store: pt(-44.5, 0, 3),
    weigh_house: pt(44.5, 0, -3),
  };

  // Reference spawn: the nav flood seed and the boot fallback. content.json's
  // arena block is the runtime source and is PROBE-EMITTED, never hand-copied.
  const REF_SPAWNS = {
    player: { pos: pt(-2, 0, 0), yaw: -Math.PI / 2 }, // hall, west of centre, faces east
  };

  // Walkable-region rectangles. Union semantics: a point is walkable when it is
  // inside ANY rect at that y and not inside a solid. Six large OVERLAPPING
  // bands rather than one rect per room, because probe_arena's dead-end clause
  // asks that every ground rect touch ≥2 others and an overlapping band
  // satisfies that by construction rather than by bookkeeping. Solids carve the
  // rects, so a band that spans a wall is not a claim that the wall is walkable.
  const WALK_RECTS = [
    rect("w_north", -49, -38, 49, -11),
    rect("w_middle", -49, -13, 49, 13),
    rect("w_south", -49, 11, 49, 38),
    rect("w_west", -49, -38, -15, 38),
    rect("w_centre", -17, -38, 17, 38),
    rect("w_east", 15, -38, 49, 38),
    // the gallery deck (y 2.8) — excluded from the dead-end clause by its y
    rect("w_gal_n", -15, -11, 15, -8.5, Y_GAL),
    rect("w_gal_s", -15, 8.5, 15, 11, Y_GAL),
    rect("w_gal_w", -15, -8.5, -12.5, 8.5, Y_GAL),
    rect("w_gal_e", 12.5, -8.5, 15, 8.5, Y_GAL),
  ];

  // POI zones. Order matters: nav.js's light bake takes the FIRST zone that
  // contains a cell, so the specific rooms are listed before the yards.
  // NOTE (out of this module's scope): core/ai/nav.js ZONE_BASE has no entry
  // for these keys, so each falls through to its 0.1 default — dark, which is
  // right for a covered market at night, but the entries should be authored
  // explicitly when the map is registered.
  const ZONES = {
    poi_saltstore: zone(-49, -7, -39, 7),
    poi_weighhouse: zone(39, -7, 49, 7),
    poi_markethall: zone(-15, -11, 15, 11),
    poi_band_north: zone(-24, -38, 24, -13),
    poi_band_south: zone(-24, 13, 24, 38),
    poi_stallrows_w: zone(-49, -11, -17, 11),
    poi_stallrows_e: zone(17, -11, 49, 11),
    poi_dock_west: zone(-49, -38, -26, -13),
    poi_dock_east: zone(26, 13, 49, 38),
  };

  // Ground paint (drives the PBR sets). Authored as a non-overlapping tiling so
  // no two patches z-fight: wet asphalt on the four open yards, cobble under
  // the hall, worn tile in the four market bays and the two flank precincts,
  // concrete in the two flag rooms.
  const road = (id, kind, x0, z0, x1, z1) =>
    ({ id, kind, min: [x0 + OX, z0 + OZ], max: [x1 + OX, z1 + OZ] });
  const ROADS = [
    road("r_yard_nw", "asphalt_worn", -49, -38, -25, -12),
    road("r_mkt_nw", "tile_interior", -25, -38, 0, -12),
    road("r_mkt_ne", "tile_interior", 0, -38, 25, -12),
    road("r_yard_ne", "asphalt_worn", 25, -38, 49, -12),
    road("r_yard_sw", "asphalt_worn", -49, 12, -25, 38),
    road("r_mkt_sw", "tile_interior", -25, 12, 0, 38),
    road("r_mkt_se", "tile_interior", 0, 12, 25, 38),
    road("r_yard_se", "asphalt_worn", 25, 12, 49, 38),
    road("r_saltstore", "concrete_interior", -49, -7, -39, 7),
    road("r_prec_wn", "tile_interior", -49, -12, -39, -7),
    road("r_prec_ws", "tile_interior", -49, 7, -39, 12),
    road("r_prec_w", "tile_interior", -39, -12, -16, 12),
    road("r_hall", "plaza_cobble", -16, -12, 16, 12),
    road("r_prec_e", "tile_interior", 16, -12, 39, 12),
    road("r_weighhouse", "concrete_interior", 39, -7, 49, 7),
    road("r_prec_en", "tile_interior", 39, -12, 49, -7),
    road("r_prec_es", "tile_interior", 39, 7, 49, 12),
  ];

  // Practicals. Five reals (the same lease count lanternwalk ships), the rest
  // emissive-only: strings of stall bulbs through the market bays, a clerestory
  // shaft into the hall, sodium over the four open yards, and shop neon on the
  // hall's outer faces. The palette is lanternwalk's unchanged — this is the
  // same wet night, four streets over.
  const LP = (id, x, y, z, color, kind, real, extra = {}) =>
    Object.assign({ id, pos: [x + OX, y, z + OZ], color, kind, real }, extra);
  const LIGHT_POLES = [
    LP("L_HALL_KEY", 0, 8.6, 0, "#c86ee0", "neon_bounce", true,
      { aim: [0 + OX, 0, 0 + OZ], cone: 85, blackout: { relight: "#4adcd6", level: 0.4 } }),
    LP("L_HALL_SKY", 0, 7.2, -6, "#7c8fb8", "skylight", true,
      { aim: [0 + OX, 0, -6 + OZ], cone: 35, godRay: true }),
    LP("L_YARD_NW", -37, 6.0, -25, "#ff9a3c", "sodium", true,
      { aim: [-37 + OX, 0, -25 + OZ], cone: 60, godRay: true }),
    LP("L_YARD_SE", 37, 6.0, 25, "#ff9a3c", "sodium", true,
      { aim: [37 + OX, 0, 25 + OZ], cone: 60, godRay: true }),
    LP("L_PREC_W", -30, 4.4, 0, "#cfe0d8", "fluorescent", true,
      { aim: [-30 + OX, 0, 0 + OZ], cone: 70 }),
    // Fakes — emissive head + cone card + pool decal, zero real lights.
    LP("fake_prec_wn", -24, 3.6, -7, "#ff9a3c", "sodium", false),
    LP("fake_prec_ws", -24, 3.6, 7, "#ff9a3c", "sodium", false, { flicker: true }),
    LP("fake_prec_en", 24, 3.6, -7, "#ff9a3c", "sodium", false, { flicker: true }),
    LP("fake_prec_es", 24, 3.6, 7, "#ff9a3c", "sodium", false),
    LP("fake_prec_w2", -42, 3.6, -10, "#ffb46b", "sodium", false),
    LP("fake_prec_e2", 42, 3.6, 10, "#ffb46b", "sodium", false),
    LP("fake_store_w", -44, 3.9, 0, "#ffc88a", "interior", false),
    LP("fake_store_e", 44, 3.9, 0, "#ffc88a", "interior", false),
    LP("fake_mkt_nw", -12, 4.2, -32, "#cfe0d8", "fluorescent", false, { flicker: true }),
    LP("fake_mkt_nw2", -12, 4.2, -18, "#cfe0d8", "fluorescent", false),
    LP("fake_mkt_ne", 12, 4.2, -32, "#cfe0d8", "fluorescent", false),
    LP("fake_mkt_ne2", 12, 4.2, -18, "#cfe0d8", "fluorescent", false, { flicker: true }),
    LP("fake_mkt_sw", -12, 4.2, 18, "#cfe0d8", "fluorescent", false),
    LP("fake_mkt_sw2", -12, 4.2, 32, "#cfe0d8", "fluorescent", false, { flicker: true }),
    LP("fake_mkt_se", 12, 4.2, 18, "#cfe0d8", "fluorescent", false, { flicker: true }),
    LP("fake_mkt_se2", 12, 4.2, 32, "#cfe0d8", "fluorescent", false),
    LP("fake_hall_nw", -9, 5.2, -7, "#ffb46b", "sodium", false),
    LP("fake_hall_se", 9, 5.2, 7, "#ffb46b", "sodium", false),
    LP("fake_hall_ne", 9, 5.2, -7, "#ffb46b", "sodium", false),
    LP("fake_hall_sw", -9, 5.2, 7, "#ffb46b", "sodium", false),
    LP("fake_yard_nw2", -44, 5.2, -33, "#dce8ff", "flood", false,
      { aim: [-44 + OX, 0, -30 + OZ] }),
    LP("fake_yard_se2", 44, 5.2, 33, "#dce8ff", "flood", false,
      { aim: [44 + OX, 0, 30 + OZ] }),
    LP("fake_yard_ne", 40, 5.2, -33, "#dce8ff", "flood", false,
      { aim: [40 + OX, 0, -30 + OZ] }),
    LP("fake_yard_sw", -40, 5.2, 33, "#dce8ff", "flood", false,
      { aim: [-40 + OX, 0, 30 + OZ] }),
    // A flood needs an aim: level.js's "flood" case reads lp.aim[0]/[2] for its
    // ground pool. These two shipped without one and took the whole buildLevel
    // down. Aimed 3 m inward like the fake_yard_* floods above.
    LP("fake_gw_w", -33, 4.6, -12, "#dce8ff", "flood", false,
      { aim: [-33 + OX, 0, -9 + OZ] }),
    LP("fake_gw_e", 33, 4.6, 12, "#dce8ff", "flood", false,
      { aim: [33 + OX, 0, 9 + OZ] }),
    // Shop neon on the hall's outer faces (the signage pass reads `sign`).
    LP("neon_salt", -15.2, 4.6, -2, "#38d8d0", "neon", false, { sign: "СОЛЬ" }),
    LP("neon_market", -15.2, 4.0, 7, "#ffb340", "neon", false, { sign: "РЫНОК 24" }),
    LP("neon_weigh", 15.2, 4.6, 2, "#e83ea8", "neon", false, { sign: "ВЕСЫ" }),
    LP("neon_spice", 15.2, 4.0, -7, "#3cff88", "neon", false, { sign: "СПЕЦИИ" }),
    LP("neon_ice", -38.2, 4.2, 9, "#ff4040", "neon", false, { sign: "ЛЁД" }),
    LP("neon_fish", 38.2, 4.2, -9, "#38d8d0", "neon", false, { sign: "РЫБА" }),
    LP("neon_whse", -14.0, 4.2, -13.2, "#ffb340", "neon", false, { sign: "СКЛАД" }),
    LP("neon_whse_e", 14.0, 4.2, 13.2, "#ffb340", "neon", false, { sign: "СКЛАД 2" }),
  ];

  // Terrain. No canal on this map; the field is kept (colliders.js's groundY
  // and computePlacements both read terrain.canal unconditionally) with zMin
  // pushed far outside the arena so the predicate is always false.
  const TERRAIN = {
    base: 0,
    canal: { zMin: 400, y: -1.5 },
    // Rain pools where the roof leaks and where the yards drain.
    heroPuddles: [
      { pos: [0 + OX, -3 + OZ], r: 3.2 },
      { pos: [-37 + OX, -28 + OZ], r: 3.0 },
      { pos: [37 + OX, 28 + OZ], r: 3.0 },
      { pos: [-37 + OX, 28 + OZ], r: 2.6 },
      { pos: [37 + OX, -28 + OZ], r: 2.6 },
      { pos: [-28 + OX, 5 + OZ], r: 2.0 },
      { pos: [28 + OX, -5 + OZ], r: 2.0 },
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

  // Seven clusters over eleven rooms. The two corner clusters face DIAGONALLY
  // inward (∓3π/4 and ∓π/4) rather than straight across the map, and that is a
  // measured decision, not a stylistic one: their points live in the corner
  // yards and the market bays, where a due-east look walks into a cross wall
  // and the probe's "≥ 8 m forward view inside a ±60° inward cone" bar is
  // unsatisfiable. Facing the room's own diagonal puts 25 m of yard inside the
  // cone. Sides are the rotation's two halves, so SC_SALT/SC_WEIGH,
  // SC_DOCK_W/SC_DOCK_E and SC_ROWS_W/SC_ROWS_E are exact mirrors of each other
  // and every parity metric is identically balanced. inward yaw uses
  // forward = (−sin yaw, −cos yaw):
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

  // 94 seeds against gen-2's 70–100 band. Two rules shape the set, and both
  // exist because G-G fails on ANY unplaced seed (the ring build lost six to
  // the placer's 3 m dedupe):
  //   • every authored seed is ≥ 5 m from every other authored seed, so a
  //     nudged placement still clears the dedupe;
  //   • the four outer clusters take ROOMS rather than quadrants. SC_DOCK_W
  //     owns the north-west yard and the north-west market, so its mirror
  //     SC_DOCK_E owns the south-east pair and the two sets cannot collide at
  //     the map's waist. The ring build had sp_dw4 at (2,−34) whose mirror
  //     landed exactly on sp_rw3 at (−2,34).
  // No CTF-eligible seed sits inside its own flag room, and none is closer
  // than 9.5 m to its own stand (the probe's V8/V9 clauses).
  spawnSeeds: [
    // ---- SC_SALT — the west precinct, wrapped round the salt store.
    sp("sp_ss1", -35, -9, "SC_SALT"),
    sp("sp_ss2", -35, -3, "SC_SALT"),
    sp("sp_ss3", -35, 3, "SC_SALT"),
    sp("sp_ss4", -35, 9, "SC_SALT"),
    sp("sp_ss5", -29, -9, "SC_SALT"),
    sp("sp_ss6", -29, -3, "SC_SALT"),
    sp("sp_ss7", -29, 3, "SC_SALT"),
    sp("sp_ss8", -29, 9, "SC_SALT"),
    sp("sp_ss9", -23, -9, "SC_SALT"),
    sp("sp_ss10", -23, -3, "SC_SALT"),
    sp("sp_ss11", -23, 3, "SC_SALT"),
    sp("sp_ss12", -23, 9, "SC_SALT"),
    sp("sp_ss13", -19, -6, "SC_SALT"),
    sp("sp_ss14", -19, 6, "SC_SALT"),

    // ---- SC_DOCK_W — the north-west yard and the north-west market
    sp("sp_dw1", -45, -34, "SC_DOCK_W"),
    sp("sp_dw2", -45, -27, "SC_DOCK_W"),
    sp("sp_dw3", -45, -19, "SC_DOCK_W"),
    sp("sp_dw4", -38, -34, "SC_DOCK_W"),
    sp("sp_dw5", -38, -26, "SC_DOCK_W"),
    sp("sp_dw6", -38, -18, "SC_DOCK_W"),
    sp("sp_dw7", -31, -34, "SC_DOCK_W"),
    sp("sp_dw8", -31, -26, "SC_DOCK_W"),
    sp("sp_dw9", -20, -34, "SC_DOCK_W"),
    sp("sp_dw10", -22, -27, "SC_DOCK_W"),
    sp("sp_dw11", -13, -34, "SC_DOCK_W"),
    sp("sp_dw12", -13, -19, "SC_DOCK_W"),
    sp("sp_dw13", -6, -27, "SC_DOCK_W"),

    // ---- SC_ROWS_W — the south-west yard and the south-west market
    sp("sp_rw1", -45, 34, "SC_ROWS_W"),
    sp("sp_rw2", -45, 27, "SC_ROWS_W"),
    sp("sp_rw3", -45, 19, "SC_ROWS_W"),
    sp("sp_rw4", -38, 34, "SC_ROWS_W"),
    sp("sp_rw5", -38, 26, "SC_ROWS_W"),
    sp("sp_rw6", -38, 18, "SC_ROWS_W"),
    sp("sp_rw7", -31, 34, "SC_ROWS_W"),
    sp("sp_rw8", -31, 26, "SC_ROWS_W"),
    sp("sp_rw9", -20, 34, "SC_ROWS_W"),
    sp("sp_rw10", -22, 27, "SC_ROWS_W"),
    sp("sp_rw11", -13, 34, "SC_ROWS_W"),
    sp("sp_rw12", -13, 19, "SC_ROWS_W"),
    sp("sp_rw13", -6, 27, "SC_ROWS_W"),

    // ---- SC_WEIGH / SC_DOCK_E / SC_ROWS_E — the exact 180° mirrors. Every
    //      east seed is (−x, −z) of a west one, which is what makes G-I's
    //      attacker→enemy-flag parity and G-J's home-centroid parity exact
    //      rather than tuned.
    sp("sp_wh1", 35, 9, "SC_WEIGH"),
    sp("sp_wh2", 35, 3, "SC_WEIGH"),
    sp("sp_wh3", 35, -3, "SC_WEIGH"),
    sp("sp_wh4", 35, -9, "SC_WEIGH"),
    sp("sp_wh5", 29, 9, "SC_WEIGH"),
    sp("sp_wh6", 29, 3, "SC_WEIGH"),
    sp("sp_wh7", 29, -3, "SC_WEIGH"),
    sp("sp_wh8", 29, -9, "SC_WEIGH"),
    sp("sp_wh9", 23, 9, "SC_WEIGH"),
    sp("sp_wh10", 23, 3, "SC_WEIGH"),
    sp("sp_wh11", 23, -3, "SC_WEIGH"),
    sp("sp_wh12", 23, -9, "SC_WEIGH"),
    sp("sp_wh13", 19, 6, "SC_WEIGH"),
    sp("sp_wh14", 19, -6, "SC_WEIGH"),

    sp("sp_de1", 45, 34, "SC_DOCK_E"),
    sp("sp_de2", 45, 27, "SC_DOCK_E"),
    sp("sp_de3", 45, 19, "SC_DOCK_E"),
    sp("sp_de4", 38, 34, "SC_DOCK_E"),
    sp("sp_de5", 38, 26, "SC_DOCK_E"),
    sp("sp_de6", 38, 18, "SC_DOCK_E"),
    sp("sp_de7", 31, 34, "SC_DOCK_E"),
    sp("sp_de8", 31, 26, "SC_DOCK_E"),
    sp("sp_de9", 20, 34, "SC_DOCK_E"),
    sp("sp_de10", 22, 27, "SC_DOCK_E"),
    sp("sp_de11", 13, 34, "SC_DOCK_E"),
    sp("sp_de12", 13, 19, "SC_DOCK_E"),
    sp("sp_de13", 6, 27, "SC_DOCK_E"),

    sp("sp_re1", 45, -34, "SC_ROWS_E"),
    sp("sp_re2", 45, -27, "SC_ROWS_E"),
    sp("sp_re3", 45, -19, "SC_ROWS_E"),
    sp("sp_re4", 38, -34, "SC_ROWS_E"),
    sp("sp_re5", 38, -26, "SC_ROWS_E"),
    sp("sp_re6", 38, -18, "SC_ROWS_E"),
    sp("sp_re7", 31, -34, "SC_ROWS_E"),
    sp("sp_re8", 31, -26, "SC_ROWS_E"),
    sp("sp_re9", 20, -34, "SC_ROWS_E"),
    sp("sp_re10", 22, -27, "SC_ROWS_E"),
    sp("sp_re11", 13, -34, "SC_ROWS_E"),
    sp("sp_re12", 13, -19, "SC_ROWS_E"),
    sp("sp_re13", 6, -27, "SC_ROWS_E"),

    // ---- SC_HALL — FFA only, the great hall floor. This is the one cluster
    //      that is NOT authored as mirror pairs: it is excluded from both
    //      parity gates (side:"mid"), and letting it take the best-spread
    //      points on the floor beats forcing symmetry it is not measured on.
    sp("sp_h1", -12, -7.5, "SC_HALL", ["ffa"]),
    sp("sp_h2", -12, 0, "SC_HALL", ["ffa"]),
    sp("sp_h3", -12, 7.5, "SC_HALL", ["ffa"]),
    sp("sp_h4", -6, -7.5, "SC_HALL", ["ffa"]),
    sp("sp_h5", -6, 0, "SC_HALL", ["ffa"]),
    sp("sp_h6", -6, 7.5, "SC_HALL", ["ffa"]),
    sp("sp_h7", 0, -7.5, "SC_HALL", ["ffa"]),
    sp("sp_h8", 0, 7.5, "SC_HALL", ["ffa"]),
    sp("sp_h9", 6, -7.5, "SC_HALL", ["ffa"]),
    sp("sp_h10", 6, 0, "SC_HALL", ["ffa"]),
    sp("sp_h11", 6, 7.5, "SC_HALL", ["ffa"]),
    sp("sp_h12", 12, -7.5, "SC_HALL", ["ffa"]),
    sp("sp_h13", 12, 0, "SC_HALL", ["ffa"]),
    sp("sp_h14", 12, 7.5, "SC_HALL", ["ffa"]),
  ],

  // The two stands. Rotational mirrors of each other about the arena centre,
  // each inside its own room and off all three of that room's door axes.
  flagWest: [-44.5 + OX, 0, 3 + OZ],
  flagEast: [44.5 + OX, 0, -3 + OZ],

  // Same reasoning as lanternwalk's overrides (arena.md §2.4): this arena's
  // measured engagement band is well under pvp_design's 22 m / 60 m / 40 m veto
  // discs, which would otherwise veto the whole map on every spawn. Gen-2
  // scales them by the √2 the gate set uses for every map-size distance
  // (12→17, 25→35, 20→28), because the map's nearest-enemy median moved from
  // 8.9 m to ~14 m and a 12 m veto disc on a ~6000 m² map is a rounding error.
  vetoOverrides: { v1M: 17.0, v2LosM: 35.0, v3ConeM: 28.0 },
  // G-B counts ELEVATED playable surface alongside the ground area. This map
  // carries a real gallery deck at y 2.8; the rebuild's hall is 30 × 22, so the
  // closed ring measures 2 × (30 × 2.5) + 2 × (2.5 × 17) = 235 m². Measured
  // from walkRects, not estimated.
  gates: { balconyAreaM2: 235 },
};

export default { buildLayout, ARENA_SPEC };
