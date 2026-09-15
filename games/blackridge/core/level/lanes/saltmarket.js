// core/level/lanes/saltmarket.js [the SALTMARKET lane graph]
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
//   • every botTraversable/throughGoing pair is honest against V8
//     (bots cannot mantle or jump).
//
// WHY THE JUNCTIONS SIT WHERE THEY DO. Saltmarket is a ring of narrow stall
// rows around one big covered hall, and the failure mode that shape produces is
// a bot string-pulling diagonally into a stall corner and grinding on it. So
// every junction here is a REAL throat — a terrace-wall door, a hall door, the
// mouth of an aisle, the head of a gallery stair — and never a point in open
// floor that a straight line happens to cross. Inside the rows the waypoints
// are spaced 3–6 m, closer than anywhere else in the graph, because that is
// where the string-pull has corners available to cut.
//
// The graph is a double ring: an OUTER one through the two docks, the two
// aisles and the two bands, and an INNER one across the hall floor, laced
// together at the six hall doors. A losing team always has a way round that is
// not the way it just died on — that is the whole reason the bands exist.
//
// Coordinates are WORLD metres. The map's local authoring origin is offset by
// (−5, −2) (see core/level/maps/saltmarket.js), so the stand the map file
// calls local (−29, 1.5) is world (−34, −0.5) here.
//
// exposure/cover are authored 0..1 against the sightline audit: the hall floor
// is the map's bright open ground (median ray ~13 m across it), the aisles and
// the bands are the covered, 4–8 m half of the fight.

export const junctions = {
  // --- the two flag stands
  J_SALT: [-34, 0, -0.5],       // the Salt Store, FLAG_WEST
  J_WEIGH: [24, 0, -3.5],       // the Weigh House, FLAG_EAST
  // --- the open-air loading docks (the map's two lungs)
  J_DOCK_NW: [-34, 0, -16],
  J_DOCK_SW: [-34, 0, 12],
  J_DOCK_NE: [24, 0, -16],
  J_DOCK_SE: [24, 0, 12],
  // --- terrace-wall doors: the dock/market membrane
  J_TW_NW: [-30.5, 0, -21.5],
  J_TW_SW: [-30.5, 0, 17.5],
  J_TW_NE: [20.5, 0, -21.5],
  J_TW_SE: [20.5, 0, 17.5],
  J_D1_W: [-30.5, 0, -4.75],    // the Salt Store's own east door
  J_D1_E: [20.5, 0, 0.75],      // the Weigh House's own west door
  // --- the stall aisles, at their three usable widths
  J_A1_N: [-27.5, 0, -18],
  J_A1_M: [-27.5, 0, -7],
  J_A1_S: [-27.5, 0, 14],
  J_A1E_N: [17.5, 0, -18],
  J_A1E_M: [17.5, 0, 3],
  J_A1E_S: [17.5, 0, 14],
  // --- the bands behind the hall, either side of the ice house / annex
  J_BAND_NW: [-17, 0, -23],
  J_BAND_NE: [7, 0, -23],
  J_BAND_SW: [-17, 0, 19],
  J_BAND_SE: [7, 0, 19],
  // --- the hall's four corners, its centre and its two side aisles
  J_HALL_NW: [-17, 0, -15],
  J_HALL_NE: [7, 0, -15],
  J_HALL_SW: [-17, 0, 11],
  J_HALL_SE: [7, 0, 11],
  J_HALL_C: [-5, 0, -2],
  J_HALL_W: [-21, 0, -2],
  J_HALL_E: [11, 0, -2],
  // --- the gallery deck (y 2.8), one junction per stair head
  J_GAL_S: [1, 2.8, 15.8],
  J_GAL_N: [-11, 2.8, -19.8],
};

export const lanes = [
  // ======================= WEST: the Salt Store's three throats ============
  // Three ways into the stand, mirrored piece for piece on the east side. Three
  // is the number that stops two defenders holding a base by looking one way.
  { id: "L_SALT_DOCKN", a: "J_SALT", b: "J_DOCK_NW",
    wp: [[-34, 0, -0.5], [-36, 0, -5], [-36, 0, -9], [-35, 0, -13], [-34, 0, -16]],
    band: [4, 12], exposure: 0.3, cover: 0.6, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_SALT_DOCKS", a: "J_SALT", b: "J_DOCK_SW",
    wp: [[-34, 0, -0.5], [-32.5, 0, 1.5], [-32, 0, 5], [-33, 0, 9], [-34, 0, 12]],
    band: [4, 12], exposure: 0.3, cover: 0.6, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_SALT_D1", a: "J_SALT", b: "J_D1_W",
    wp: [[-34, 0, -0.5], [-33, 0, -3], [-31.5, 0, -4.75], [-30.5, 0, -4.75]],
    band: [3, 9], exposure: 0.2, cover: 0.7, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_D1_A1", a: "J_D1_W", b: "J_A1_M",
    wp: [[-30.5, 0, -4.75], [-29, 0, -5], [-27.5, 0, -7]],
    band: [3, 9], exposure: 0.25, cover: 0.65, vertical: false,
    botTraversable: true, throughGoing: true },

  // ======================= WEST: aisle A1, the stall rows =================
  { id: "L_A1_NM", a: "J_A1_N", b: "J_A1_M",
    wp: [[-27.5, 0, -18], [-26.5, 0, -14], [-28, 0, -9], [-27.5, 0, -7]],
    band: [3, 10], exposure: 0.2, cover: 0.75, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_A1_MS", a: "J_A1_M", b: "J_A1_S",
    wp: [[-27.5, 0, -7], [-27.5, 0, -2], [-26.5, 0, 3], [-27.5, 0, 8], [-27.5, 0, 14]],
    band: [3, 10], exposure: 0.2, cover: 0.75, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_A1_N_TW", a: "J_A1_N", b: "J_TW_NW",
    wp: [[-27.5, 0, -18], [-28.5, 0, -21], [-30.5, 0, -21.5]],
    band: [3, 9], exposure: 0.25, cover: 0.7, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_A1_S_TW", a: "J_A1_S", b: "J_TW_SW",
    wp: [[-27.5, 0, 14], [-28.5, 0, 17], [-30.5, 0, 17.5]],
    band: [3, 9], exposure: 0.25, cover: 0.7, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_TWN_DOCK_W", a: "J_TW_NW", b: "J_DOCK_NW",
    wp: [[-30.5, 0, -21.5], [-32, 0, -20], [-34, 0, -18], [-34, 0, -16]],
    band: [4, 14], exposure: 0.45, cover: 0.5, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_TWS_DOCK_W", a: "J_TW_SW", b: "J_DOCK_SW",
    wp: [[-30.5, 0, 17.5], [-32, 0, 16], [-34, 0, 14], [-34, 0, 12]],
    band: [4, 14], exposure: 0.45, cover: 0.5, vertical: false,
    botTraversable: true, throughGoing: true },

  // ======================= WEST: the bands (the rotation route) ============
  // Behind the hall, past the ice house. This is the lane a losing team takes
  // to come out on the far flank without crossing the hall's open floor.
  { id: "L_A1_N_BAND", a: "J_A1_N", b: "J_BAND_NW",
    wp: [[-27.5, 0, -18], [-28, 0, -21.5], [-24.5, 0, -23.5], [-20, 0, -24.5], [-17, 0, -23]],
    band: [4, 12], exposure: 0.3, cover: 0.65, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_A1_S_BAND", a: "J_A1_S", b: "J_BAND_SW",
    wp: [[-27.5, 0, 14], [-28, 0, 17.5], [-24.5, 0, 19.5], [-20, 0, 20.5], [-17, 0, 19]],
    band: [4, 12], exposure: 0.3, cover: 0.65, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_BAND_NW_HALL", a: "J_BAND_NW", b: "J_HALL_NW",
    wp: [[-17, 0, -23], [-17, 0, -21.5], [-17, 0, -18], [-17, 0, -15]],
    band: [4, 12], exposure: 0.4, cover: 0.55, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_BAND_SW_HALL", a: "J_BAND_SW", b: "J_HALL_SW",
    wp: [[-17, 0, 19], [-17, 0, 17.5], [-17, 0, 14], [-17, 0, 11]],
    band: [4, 12], exposure: 0.4, cover: 0.55, vertical: false,
    botTraversable: true, throughGoing: true },

  // ======================= THE HALL: the inner ring ========================
  { id: "L_HALL_N", a: "J_HALL_NW", b: "J_HALL_NE",
    wp: [[-17, 0, -15], [-11, 0, -14], [-5, 0, -13], [1, 0, -14], [7, 0, -15]],
    band: [8, 26], exposure: 0.7, cover: 0.4, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_HALL_S", a: "J_HALL_SW", b: "J_HALL_SE",
    wp: [[-17, 0, 11], [-11, 0, 10], [-5, 0, 9], [1, 0, 10], [7, 0, 11]],
    band: [8, 26], exposure: 0.7, cover: 0.4, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_HALL_NW_W", a: "J_HALL_NW", b: "J_HALL_W",
    wp: [[-17, 0, -15], [-20, 0, -11], [-21, 0, -6], [-21, 0, -2]],
    band: [6, 20], exposure: 0.55, cover: 0.5, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_HALL_SW_W", a: "J_HALL_SW", b: "J_HALL_W",
    wp: [[-17, 0, 11], [-20, 0, 7], [-21, 0, 2], [-21, 0, -2]],
    band: [6, 20], exposure: 0.55, cover: 0.5, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_HALL_NE_E", a: "J_HALL_NE", b: "J_HALL_E",
    wp: [[7, 0, -15], [10, 0, -11], [11, 0, -6], [11, 0, -2]],
    band: [6, 20], exposure: 0.55, cover: 0.5, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_HALL_SE_E", a: "J_HALL_SE", b: "J_HALL_E",
    wp: [[7, 0, 11], [10, 0, 7], [11, 0, 2], [11, 0, -2]],
    band: [6, 20], exposure: 0.55, cover: 0.5, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_HALL_WC", a: "J_HALL_W", b: "J_HALL_C",
    wp: [[-21, 0, -2], [-16, 0, -2], [-11, 0, -3], [-5, 0, -2]],
    band: [8, 28], exposure: 0.75, cover: 0.35, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_HALL_CE", a: "J_HALL_C", b: "J_HALL_E",
    wp: [[-5, 0, -2], [1, 0, -1], [6, 0, -2], [11, 0, -2]],
    band: [8, 28], exposure: 0.75, cover: 0.35, vertical: false,
    botTraversable: true, throughGoing: true },

  // ======================= HALL ⇄ ROWS: the six door laces =================
  { id: "L_HALL_W_A1N", a: "J_HALL_W", b: "J_A1_N",
    wp: [[-21, 0, -2], [-22, 0, -7], [-24.5, 0, -15], [-27, 0, -16], [-27.5, 0, -18]],
    band: [5, 16], exposure: 0.45, cover: 0.55, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_HALL_W_A1S", a: "J_HALL_W", b: "J_A1_S",
    wp: [[-21, 0, -2], [-22, 0, 3], [-24.5, 0, 6], [-27, 0, 9], [-27.5, 0, 14]],
    band: [5, 16], exposure: 0.45, cover: 0.55, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_HALL_E_A1N", a: "J_HALL_E", b: "J_A1E_N",
    wp: [[11, 0, -2], [12, 0, -7], [14.5, 0, -10], [17, 0, -13], [17.5, 0, -18]],
    band: [5, 16], exposure: 0.45, cover: 0.55, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_HALL_E_A1S", a: "J_HALL_E", b: "J_A1E_S",
    wp: [[11, 0, -2], [12, 0, 3], [14.5, 0, 11], [17, 0, 12], [17.5, 0, 14]],
    band: [5, 16], exposure: 0.45, cover: 0.55, vertical: false,
    botTraversable: true, throughGoing: true },

  // ======================= THE GALLERY (verticality) ======================
  // A 2.5 m deck at y 2.8 running right round the hall, with a stair at the
  // south-west and another at the north-east, so it is a ROUTE across the room
  // rather than a perch you climb into and sit on. It cannot hold a sniper: the
  // hall's six door voids stop at 2.4 m, so from 2.8 m there is no line out of
  // the hall at all — everything the deck overlooks is inside the room it is
  // part of. botTraversable stays true because the stairs are real 0.28 m
  // risers, inside moveCapsule's step-up budget: no mantling anywhere on it.
  { id: "L_GAL_UP_S", a: "J_HALL_SW", b: "J_GAL_S",
    wp: [[-17, 0, 11], [-22.5, 0, 9], [-22.5, 2.8, 13.5], [-16, 2.8, 15.8], [-7, 2.8, 15.8], [1, 2.8, 15.8]],
    band: [5, 20], exposure: 0.4, cover: 0.45, vertical: true,
    botTraversable: true, throughGoing: true },
  { id: "L_GAL_RING", a: "J_GAL_S", b: "J_GAL_N",
    wp: [[1, 2.8, 15.8], [9, 2.8, 15.8], [12.1, 2.8, 10], [12.1, 2.8, 1], [12.1, 2.8, -8],
      [9, 2.8, -19.8], [1, 2.8, -19.8], [-11, 2.8, -19.8]],
    band: [5, 22], exposure: 0.35, cover: 0.45, vertical: true,
    botTraversable: true, throughGoing: true },
  { id: "L_GAL_DOWN_N", a: "J_GAL_N", b: "J_HALL_NE",
    wp: [[-11, 2.8, -19.8], [-3, 2.8, -19.8], [4, 2.8, -19.8], [12.5, 2.8, -17.5], [12.5, 0, -13], [7, 0, -15]],
    band: [5, 20], exposure: 0.4, cover: 0.45, vertical: true,
    botTraversable: true, throughGoing: true },

  // ======================= EAST: the 180° mirror of the west set ===========
  { id: "L_WEIGH_DOCKS", a: "J_WEIGH", b: "J_DOCK_SE",
    wp: [[24, 0, -3.5], [26, 0, 1], [26, 0, 5], [25, 0, 9], [24, 0, 12]],
    band: [4, 12], exposure: 0.3, cover: 0.6, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_WEIGH_DOCKN", a: "J_WEIGH", b: "J_DOCK_NE",
    wp: [[24, 0, -3.5], [22.5, 0, -5.5], [22, 0, -9], [23, 0, -13], [24, 0, -16]],
    band: [4, 12], exposure: 0.3, cover: 0.6, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_WEIGH_D1", a: "J_WEIGH", b: "J_D1_E",
    wp: [[24, 0, -3.5], [23, 0, -1], [21.5, 0, 0.75], [20.5, 0, 0.75]],
    band: [3, 9], exposure: 0.2, cover: 0.7, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_D1_A1E", a: "J_D1_E", b: "J_A1E_M",
    wp: [[20.5, 0, 0.75], [19, 0, 1], [17.5, 0, 3]],
    band: [3, 9], exposure: 0.25, cover: 0.65, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_A1E_SM", a: "J_A1E_S", b: "J_A1E_M",
    wp: [[17.5, 0, 14], [16.5, 0, 10], [18, 0, 5], [17.5, 0, 3]],
    band: [3, 10], exposure: 0.2, cover: 0.75, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_A1E_MN", a: "J_A1E_M", b: "J_A1E_N",
    wp: [[17.5, 0, 3], [17.5, 0, -2], [16.5, 0, -7], [17.5, 0, -12], [17.5, 0, -18]],
    band: [3, 10], exposure: 0.2, cover: 0.75, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_A1E_S_TW", a: "J_A1E_S", b: "J_TW_SE",
    wp: [[17.5, 0, 14], [18.5, 0, 17], [20.5, 0, 17.5]],
    band: [3, 9], exposure: 0.25, cover: 0.7, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_A1E_N_TW", a: "J_A1E_N", b: "J_TW_NE",
    wp: [[17.5, 0, -18], [18.5, 0, -21], [20.5, 0, -21.5]],
    band: [3, 9], exposure: 0.25, cover: 0.7, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_TWS_DOCK_E", a: "J_TW_SE", b: "J_DOCK_SE",
    wp: [[20.5, 0, 17.5], [22, 0, 16], [24, 0, 14], [24, 0, 12]],
    band: [4, 14], exposure: 0.45, cover: 0.5, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_TWN_DOCK_E", a: "J_TW_NE", b: "J_DOCK_NE",
    wp: [[20.5, 0, -21.5], [22, 0, -20], [24, 0, -18], [24, 0, -16]],
    band: [4, 14], exposure: 0.45, cover: 0.5, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_A1E_S_BAND", a: "J_A1E_S", b: "J_BAND_SE",
    wp: [[17.5, 0, 14], [18, 0, 17.5], [14.5, 0, 19.5], [10, 0, 20.5], [7, 0, 19]],
    band: [4, 12], exposure: 0.3, cover: 0.65, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_A1E_N_BAND", a: "J_A1E_N", b: "J_BAND_NE",
    wp: [[17.5, 0, -18], [18, 0, -21.5], [14.5, 0, -23.5], [10, 0, -24.5], [7, 0, -23]],
    band: [4, 12], exposure: 0.3, cover: 0.65, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_BAND_SE_HALL", a: "J_BAND_SE", b: "J_HALL_SE",
    wp: [[7, 0, 19], [7, 0, 17.5], [7, 0, 14], [7, 0, 11]],
    band: [4, 12], exposure: 0.4, cover: 0.55, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_BAND_NE_HALL", a: "J_BAND_NE", b: "J_HALL_NE",
    wp: [[7, 0, -23], [7, 0, -21.5], [7, 0, -18], [7, 0, -15]],
    band: [4, 12], exposure: 0.4, cover: 0.55, vertical: false,
    botTraversable: true, throughGoing: true },
];

export const approaches = {
  A_STAND: ["L_SALT_D1", "L_SALT_DOCKN", "L_SALT_DOCKS"],      // FLAG_WEST
  B_STAND: ["L_WEIGH_D1", "L_WEIGH_DOCKN", "L_WEIGH_DOCKS"],   // FLAG_EAST
};

export default { junctions, lanes, approaches };
