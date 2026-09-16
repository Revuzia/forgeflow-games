// core/level/lanes/switchyard.js [multi-arena wave — the SWITCHYARD lane graph]
// Route-choice data ABOVE the pathfinder (PVP_BUILD_PLAN Part 3.9 / C9;
// bot_ai.md Part 5): nav.findPath string-pulls, so a raw path to a distant
// goal is by construction the shortest and most exposed line. Bots path
// waypoint-to-waypoint down a lane instead; which lane is the commander's
// choice (W7's routeScore).
//
// Contract (Part 3.9, gate-checked by tools/probe_arena.mjs):
//   • every waypoint is on walkable nav;
//   • every lane's endpoints are junctions;
//   • consecutive waypoints ≤ 12 m apart and mutually reachable;
//   • the graph contains at least one cycle;
//   • every botTraversable/throughGoing pair is honest against V8 (bots
//     cannot mantle or jump). Nothing here needs an exception: the only
//     vertical route is the boarding platform, and its 0.3 m risers are
//     inside the sim capsule's step-up budget, so L_PLAT_* is a genuine
//     through-route rather than an overlook.
//
// THE MAP IS A 180° ROTATION about (−5, −2) (see maps/switchyard.js), so this
// graph is authored ONCE for the west/north half and mirrored. Every junction
// has a twin — J_SHED_C is its own — which means the two teams' route trees
// are identical by construction, not by inspection. `mirrorLane` below is the
// whole east/south half; hand-transcribing 12 mirrored waypoint chains is
// exactly the class of work that produced the C7b spawn regression.
//
// exposure/cover are authored 0..1 against the measured sightline audit:
// the running shed's roads are open and long (its 32 m interior is the
// arena's DMR band), the west/east margin lanes and the signals-hut crossing
// are tight and covered, the yards are in between.
// band is the engagement band [min,max] metres a fight on the lane produces.
//
// ── GEN-2: THE ANNEXED TERRITORY ──────────────────────────────────────────
// The 2× expansion added four regions and this graph covered NONE of them:
// the two outer stabling roads (Z[−44,−27] and its mirror), the two
// locomotive works (X[−55,−42] and its mirror), the two transfer-table yard
// corners and the two 1.2 m loading banks. 3 500 m² — more than HALF the
// arena's floor — had no junction, no lane and therefore no patrol, so bots
// kept crowding the old depot and a doubled map played smaller than its
// gen-1 self. Fourteen junctions and eleven lane pairs are added below.
//
// The new half-graph is a RING, not a set of spurs: works → outer road →
// transfer-table corner → back into the works, with three separate ties into
// the old depot (the yard's west gate, the yard's east gate and the west
// margin lane). A bot rotating from the flag hall to the far corner now has
// two routes of comparable length instead of one, which is the property the
// commander's routeScore needs to have a choice at all.
//
// The only DEAD END in the graph is L_BANK_NW/SE, the spur onto the corner
// loading bank, and it is marked throughGoing:false. Its deck waypoints carry
// y = 1.2 and the stair waypoint y = 0.6: the probe skips the ground-nav test
// for anything above 0.5 m, which is correct here — those points are not on
// the ground grid at all, they are on the slab above it. The 0.3 m risers are
// inside the sim capsule's step-up budget, so it stays botTraversable.

const MX = -10, MZ = -4;                       // x' = MX − x, z' = MZ − z
const mp = (p) => [MX - p[0], p[1], MZ - p[2]];

export const junctions = {
  // ---- west / south-west (the AMBER half) --------------------------------
  J_HALL_W:  [-34, 0, 13.5],    // car hall A, beside the FLAG_WEST stand
  J_LANE_W:  [-38.5, 0, -2],    // west margin lane, outboard of the platform
  J_APRON_W: [-31, 0, -10],     // west apron, north of the platform
  J_PLAT_W:  [-31, 1.2, -4],    // west platform deck (+1.2 m)
  J_YARD_NW: [-31, 0, -21],     // north yard, west cell
  J_YARD_SW: [-9, 0, 14],       // south yard, west cell
  J_HUT_S:   [1, 0, 17.5],      // inside the south signals hut
  // ---- the middle --------------------------------------------------------
  J_SHED_W:  [-19, 0, -2],      // running shed, west road
  J_SHED_N:  [-10, 0, -10.5],   // running shed, north roller door
  J_SHED_C:  [-5, 0, -2],       // running shed, middle road (its own mirror)
  J_SHED_S:  [0, 0, 6.5],       // running shed, south roller door
  J_SHED_E:  [9, 0, -2],        // running shed, east road
  // ---- east / north-east (the SLATE half) --------------------------------
  J_HALL_E:  [24, 0, -17.5],    // car hall B, beside the FLAG_EAST stand
  J_LANE_E:  [28.5, 0, -2],
  J_APRON_E: [21, 0, 6],
  J_PLAT_E:  [21, 1.2, 0],
  J_YARD_SE: [21, 0, 17],
  J_YARD_NE: [-1, 0, -18],
  J_HUT_N:   [-11, 0, -21.5],   // inside the north signals hut
  // ---- GEN-2 annexed territory, west/south half -------------------------
  J_WORKS_NW: [-48, 0, -20],    // west works, north end (open, 13 m wide)
  J_WORKS_SW: [-44, 0, 19],     // west works, south end, east of the goods bank
  J_ROAD_SW:  [-34, 0, 31],     // south outer stabling road, west cell
  J_ROAD_SC:  [6, 0, 33],       // south outer road, centre (past the shop pair)
  J_ROAD_SE:  [26, 0, 27],      // south outer road, east cell
  J_TT_SW:    [-52, 0, 27],     // south-west transfer-table corner
  J_BANK_SE:  [34, 1.2, 32],    // the SE loading bank deck (+1.2 m)
  // ---- their 180° twins, north/east half --------------------------------
  J_WORKS_SE: [38, 0, 16],
  J_WORKS_NE: [34, 0, -23],
  J_ROAD_NE:  [24, 0, -35],
  J_ROAD_NC:  [-16, 0, -37],
  J_ROAD_NW:  [-36, 0, -31],
  J_TT_NE:    [42, 0, -31],
  J_BANK_NW:  [-44, 1.2, -36],
};

// The twin of every junction (the map's own 180° symmetry, by name). Written
// once per pair and closed symmetrically below — a one-way table silently
// mirrors a lane onto the junction it started from, which is a 40 m waypoint
// gap the probe catches but a reader does not.
const TWIN_PAIRS = {
  J_HALL_W: "J_HALL_E", J_LANE_W: "J_LANE_E", J_APRON_W: "J_APRON_E",
  J_PLAT_W: "J_PLAT_E", J_YARD_NW: "J_YARD_SE", J_YARD_SW: "J_YARD_NE",
  J_HUT_S: "J_HUT_N", J_SHED_W: "J_SHED_E", J_SHED_N: "J_SHED_S",
  // gen-2 annexed territory
  J_WORKS_NW: "J_WORKS_SE", J_WORKS_SW: "J_WORKS_NE",
  J_ROAD_NW: "J_ROAD_SE", J_ROAD_NC: "J_ROAD_SC", J_ROAD_NE: "J_ROAD_SW",
  J_TT_NE: "J_TT_SW", J_BANK_NW: "J_BANK_SE",
};
const TWIN = { J_SHED_C: "J_SHED_C" };
for (const [a, b] of Object.entries(TWIN_PAIRS)) { TWIN[a] = b; TWIN[b] = a; }

// ---- the authored half (west / north) -------------------------------------
const WEST = [
  // ===== approaches to FLAG_WEST ==========================================
  // Through door D2 and down the apron's east side: the direct route, and
  // the one that has to squeeze between the stabled apron car and the shed
  // wall — 2 m of pinch that makes it the loud way in.
  { id: "L_HALL_W_APRON", a: "J_HALL_W", b: "J_APRON_W", twin: "L_HALL_E_APRON",
    wp: [[-34, 0, 13.5], [-32, 0, 11.5], [-30.5, 0, 9.5], [-30, 0, 5.5], [-28.5, 0, 2],
      [-26.5, 0, -1], [-23.5, 0, -4.5], [-23, 0, -9], [-23, 0, -12.3], [-27, 0, -12.8], [-31, 0, -10]],
    band: [5, 16], exposure: 0.45, cover: 0.55 },
  // Through door D3 into the south yard: the flank, and the only approach a
  // defender in the hall cannot see coming until it is in the doorway.
  { id: "L_HALL_W_YARD", a: "J_HALL_W", b: "J_YARD_SW", twin: "L_HALL_E_YARD",
    wp: [[-34, 0, 13.5], [-31.5, 0, 15.5], [-29.5, 0, 16.8], [-27, 0, 17.5], [-22, 0, 17.8],
      [-18, 0, 17.5], [-14, 0, 15.5], [-12, 0, 14]],
    band: [6, 22], exposure: 0.55, cover: 0.5 },
  // Through door D1 and round the wheel-lathe shed onto the west margin:
  // the quiet route, 4–13 m the whole way.
  { id: "L_HALL_W_LANE", a: "J_HALL_W", b: "J_LANE_W", twin: "L_HALL_E_LANE",
    wp: [[-34, 0, 13.5], [-35.5, 0, 11.5], [-36, 0, 9.5], [-36.3, 0, 8.3], [-36, 0, 5],
      [-36, 0, 1.5], [-39, 0, 0.5], [-38.5, 0, -2]],
    band: [4, 13], exposure: 0.25, cover: 0.6 },
  // The platform route: up the north steps, along the deck, down the south
  // steps into door D2. 1.2 m of height for two thirds of its length — the
  // deck sees over the apron's low cover, and is seen from the whole apron.
  { id: "L_PLAT_W", a: "J_APRON_W", b: "J_HALL_W", twin: "L_PLAT_E",
    wp: [[-31, 0, -9], [-30.5, 0, -7.4], [-30.5, 1.2, -5.5], [-31, 1.2, -4], [-34, 1.2, -2],
      [-33.5, 1.2, -0.5], [-32.5, 0, 3.2], [-31, 0, 5.5], [-30.5, 0, 9.5], [-31.5, 0, 11.5]],
    band: [6, 18], exposure: 0.65, cover: 0.4, vertical: true },

  // ===== the west flank ====================================================
  { id: "L_LANE_W_APRON", a: "J_LANE_W", b: "J_APRON_W", twin: "L_LANE_E_APRON",
    wp: [[-38.5, 0, -2], [-39, 0, -6], [-38, 0, -9.5], [-35, 0, -10.5], [-31, 0, -10]],
    band: [4, 14], exposure: 0.3, cover: 0.6 },
  { id: "L_APRON_W_YARD", a: "J_APRON_W", b: "J_YARD_NW", twin: "L_APRON_E_YARD",
    wp: [[-31, 0, -10], [-31, 0, -13.5], [-30.5, 0, -17], [-31, 0, -21]],
    band: [8, 24], exposure: 0.6, cover: 0.45 },
  { id: "L_SHED_W_APRON", a: "J_SHED_W", b: "J_APRON_W", twin: "L_SHED_E_APRON",
    wp: [[-19, 0, -2], [-21.5, 0, -3.5], [-23, 0, -6], [-23, 0, -9.5], [-23, 0, -12.8],
      [-27, 0, -12.8], [-31, 0, -10.5]],
    band: [6, 19], exposure: 0.5, cover: 0.5 },

  // ===== the stabling yard =================================================
  // Across the west cell to the signals hut's west door.
  { id: "L_YARD_NW_HUT", a: "J_YARD_NW", b: "J_HUT_N", twin: "L_YARD_SE_HUT",
    wp: [[-31, 0, -21], [-27, 0, -23], [-22, 0, -23.5], [-16, 0, -23], [-13.5, 0, -22.5], [-11, 0, -21.5]],
    band: [5, 21], exposure: 0.5, cover: 0.55 },
  // Through the hut and out its east door — the doors are offset in Z, so
  // this is the one crossing of the yard nothing can shoot down end to end.
  { id: "L_HUT_N_YARD_NE", a: "J_HUT_N", b: "J_YARD_NE", twin: "L_HUT_S_YARD_SW",
    wp: [[-11, 0, -21.5], [-10, 0, -19.8], [-8.5, 0, -19.8], [-6, 0, -19.3], [-3.5, 0, -18.6], [-1, 0, -18]],
    band: [3, 12], exposure: 0.2, cover: 0.65 },
  { id: "L_YARD_NE_SHED", a: "J_YARD_NE", b: "J_SHED_N", twin: "L_YARD_SW_SHED",
    wp: [[-1, 0, -18], [-3, 0, -16], [-5, 0, -14], [-7, 0, -12.5], [-10, 0, -10.5]],
    band: [7, 22], exposure: 0.55, cover: 0.5 },

  // ===== the running shed ==================================================
  { id: "L_SHED_N_C", a: "J_SHED_N", b: "J_SHED_C", twin: "L_SHED_C_S",
    wp: [[-10, 0, -10.5], [-10.9, 0, -8], [-9.5, 0, -5], [-7, 0, -3], [-5, 0, -2]],
    band: [5, 18], exposure: 0.5, cover: 0.5 },
  // The pit roads: the arena's long band. 32 m of clear interior means the
  // marksman rifles have a home here and nowhere else on the map.
  { id: "L_SHED_W_C", a: "J_SHED_W", b: "J_SHED_C", twin: "L_SHED_C_E",
    wp: [[-19, 0, -2], [-17, 0, 0.5], [-15, 0, 2], [-11, 0, 1.5], [-8, 0, 0], [-5, 0, -2]],
    band: [8, 32], exposure: 0.6, cover: 0.45 },

  // ===== GEN-2: the locomotive works ======================================
  // The works is 13 m wide and runs 45 m from the loading bank to the goods
  // bank, and the shop-screen pair (maps/switchyard.js §5c) makes the run an
  // S-bend rather than a corridor: east of the erecting screen at Z≈0, west
  // of the fitting screen at Z≈4, then back east into the 3.5 m aisle that
  // squeezes between the goods-bank deck and the retaining wall. The dog-leg
  // is the reason this lane is worth choosing — nothing can be shot down it
  // end to end, so it is the quiet north–south route on the whole west flank.
  { id: "L_WORKS_SPINE", a: "J_WORKS_NW", b: "J_WORKS_SW", twin: "L_WORKS_SPINE_E",
    wp: [[-48, 0, -20], [-45, 0, -12], [-45, 0, -4], [-45, 0, 0], [-51, 0, 2],
      [-51, 0, 6], [-48, 0, 6], [-44, 0, 8], [-44, 0, 14], [-44, 0, 19]],
    band: [6, 24], exposure: 0.3, cover: 0.6 },
  // Into the yard's west cell through the retaining wall's north gate.
  { id: "L_WORKS_YARD", a: "J_WORKS_NW", b: "J_YARD_NW", twin: "L_WORKS_YARD_E",
    wp: [[-48, 0, -20], [-44, 0, -20], [-38, 0, -20], [-33, 0, -20.5], [-31, 0, -21]],
    band: [8, 26], exposure: 0.55, cover: 0.45 },
  // Into the west margin lane through the gate at Z[−13,−2]: the works' tie
  // into the old depot's flank, and the shortest works→flag route there is.
  { id: "L_WORKS_LANE", a: "J_WORKS_NW", b: "J_LANE_W", twin: "L_WORKS_LANE_E",
    wp: [[-48, 0, -20], [-45, 0, -14], [-45, 0, -8], [-43, 0, -6], [-40, 0, -4], [-38.5, 0, -2]],
    band: [6, 20], exposure: 0.35, cover: 0.55 },

  // ===== GEN-2: the outer stabling road ===================================
  // 86 m long, 17 m deep, two cells split by the sand/wash shop pair. It is
  // the arena's most open ground — the 15–40 m band lives here — so both road
  // lanes are authored high-exposure and low-cover: a commander that sends a
  // bot down one is choosing speed over safety, which is exactly the trade
  // the route layer exists to make.
  { id: "L_ROAD_W", a: "J_ROAD_NW", b: "J_ROAD_NC", twin: "L_ROAD_E",
    wp: [[-36, 0, -31], [-30, 0, -33], [-24, 0, -35], [-20, 0, -37], [-16, 0, -37]],
    band: [12, 35], exposure: 0.75, cover: 0.3 },
  // Threads the shop pair: south of the sand house, through the 2 m slot at
  // X[−1,+1], then north of the wash house. The one place on the road where a
  // fight is forced to short range.
  { id: "L_ROAD_C", a: "J_ROAD_NC", b: "J_ROAD_NE", twin: "L_ROAD_C_S",
    wp: [[-16, 0, -37], [-12, 0, -33], [-4, 0, -31], [0, 0, -33], [0, 0, -38],
      [4, 0, -40], [12, 0, -38], [18, 0, -36], [24, 0, -35]],
    band: [8, 30], exposure: 0.6, cover: 0.45 },
  // The road's two ties into the yard, one per gate in the retaining wall.
  { id: "L_ROAD_YARD_W", a: "J_ROAD_NW", b: "J_YARD_NW", twin: "L_ROAD_YARD_E",
    wp: [[-36, 0, -31], [-35, 0, -28], [-33, 0, -25], [-32, 0, -23], [-31, 0, -21]],
    band: [8, 28], exposure: 0.6, cover: 0.4 },
  { id: "L_ROAD_YARD_N", a: "J_ROAD_NE", b: "J_YARD_NE", twin: "L_ROAD_YARD_S",
    wp: [[24, 0, -35], [18, 0, -32], [12, 0, -30], [12, 0, -27], [10, 0, -24],
      [5, 0, -22], [0, 0, -20], [-1, 0, -18]],
    band: [10, 31], exposure: 0.65, cover: 0.4 },

  // ===== GEN-2: the transfer-table corner =================================
  // The open corner that turns the road and the works from two dead limbs
  // into one ring (maps/switchyard.js §5d). Diagonal, never a full loop.
  { id: "L_ROAD_TT", a: "J_ROAD_NE", b: "J_TT_NE", twin: "L_ROAD_TT_S",
    wp: [[24, 0, -35], [30, 0, -33], [34, 0, -30], [38, 0, -26], [42, 0, -28], [42, 0, -31]],
    band: [8, 26], exposure: 0.5, cover: 0.5 },
  { id: "L_TT_WORKS", a: "J_TT_SW", b: "J_WORKS_SW", twin: "L_TT_WORKS_N",
    wp: [[-52, 0, 27], [-50, 0, 22], [-46, 0, 20], [-44, 0, 19]],
    band: [6, 22], exposure: 0.4, cover: 0.55 },
  // Works ↔ road, closing the ring at its southern end.
  { id: "L_WORKS_ROAD", a: "J_WORKS_SW", b: "J_ROAD_SW", twin: "L_WORKS_ROAD_N",
    wp: [[-44, 0, 19], [-44, 0, 24], [-40, 0, 27], [-36, 0, 29], [-34, 0, 31]],
    band: [8, 28], exposure: 0.55, cover: 0.45 },

  // ===== GEN-2: the loading bank ==========================================
  // The one dead end in the graph, and the only vertical route outside the
  // boarding platforms. The bank is a 1.2 m slab — BELOW the 1.6 m eye height
  // every sightline gate measures at — so standing on it is a firing step
  // over the outer road, not a sniper deck. throughGoing:false because the
  // stair is its only way on or off.
  { id: "L_BANK", a: "J_WORKS_NW", b: "J_BANK_NW", twin: "L_BANK_SE",
    wp: [[-48, 0, -20], [-46, 0, -22.5], [-44.5, 0.6, -24.5], [-44.5, 1.2, -27],
      [-44, 1.2, -31], [-44, 1.2, -36]],
    band: [6, 25], exposure: 0.7, cover: 0.3, vertical: true, throughGoing: false },
];

// `throughGoing` is carried through both constructors rather than hardcoded
// true: the gen-2 loading-bank spur is a genuine dead end, and a mirror that
// silently re-declared it through-going would be a lie the probe cannot catch
// (it only force-checks self-loops and the named L_BALCONY).
function mirrorLane(l) {
  return {
    id: l.twin, a: TWIN[l.a] || l.a, b: TWIN[l.b] || l.b,
    wp: l.wp.map(mp),
    band: l.band.slice(), exposure: l.exposure, cover: l.cover,
    vertical: !!l.vertical, botTraversable: true,
    throughGoing: l.throughGoing !== false,
  };
}
function westLane(l) {
  return {
    id: l.id, a: l.a, b: l.b, wp: l.wp.map((p) => p.slice()),
    band: l.band.slice(), exposure: l.exposure, cover: l.cover,
    vertical: !!l.vertical, botTraversable: true,
    throughGoing: l.throughGoing !== false,
  };
}

export const lanes = [...WEST.map(westLane), ...WEST.map(mirrorLane)];

export const approaches = {
  A_STAND: ["L_HALL_W_APRON", "L_HALL_W_YARD", "L_HALL_W_LANE", "L_PLAT_W"], // FLAG_WEST (AMBER)
  B_STAND: ["L_HALL_E_APRON", "L_HALL_E_YARD", "L_HALL_E_LANE", "L_PLAT_E"], // FLAG_EAST (SLATE)
};

export default { junctions, lanes, approaches };
