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
};

// The twin of every junction (the map's own 180° symmetry, by name). Written
// once per pair and closed symmetrically below — a one-way table silently
// mirrors a lane onto the junction it started from, which is a 40 m waypoint
// gap the probe catches but a reader does not.
const TWIN_PAIRS = {
  J_HALL_W: "J_HALL_E", J_LANE_W: "J_LANE_E", J_APRON_W: "J_APRON_E",
  J_PLAT_W: "J_PLAT_E", J_YARD_NW: "J_YARD_SE", J_YARD_SW: "J_YARD_NE",
  J_HUT_S: "J_HUT_N", J_SHED_W: "J_SHED_E", J_SHED_N: "J_SHED_S",
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
];

function mirrorLane(l) {
  return {
    id: l.twin, a: TWIN[l.a] || l.a, b: TWIN[l.b] || l.b,
    wp: l.wp.map(mp),
    band: l.band.slice(), exposure: l.exposure, cover: l.cover,
    vertical: !!l.vertical, botTraversable: true, throughGoing: true,
  };
}
function westLane(l) {
  return {
    id: l.id, a: l.a, b: l.b, wp: l.wp.map((p) => p.slice()),
    band: l.band.slice(), exposure: l.exposure, cover: l.cover,
    vertical: !!l.vertical, botTraversable: true, throughGoing: true,
  };
}

export const lanes = [...WEST.map(westLane), ...WEST.map(mirrorLane)];

export const approaches = {
  A_STAND: ["L_HALL_W_APRON", "L_HALL_W_YARD", "L_HALL_W_LANE", "L_PLAT_W"], // FLAG_WEST (AMBER)
  B_STAND: ["L_HALL_E_APRON", "L_HALL_E_YARD", "L_HALL_E_LANE", "L_PLAT_E"], // FLAG_EAST (SLATE)
};

export default { junctions, lanes, approaches };
