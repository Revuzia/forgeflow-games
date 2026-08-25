// core/level/lanes/lanternwalk.js [W4 — the LANTERNWALK lane graph]
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
//     (bots cannot mantle or jump). The arcade balcony lane is
//     throughGoing:false — an overlook, not a route.
//
// exposure/cover are authored 0..1 against the measured sightline audit
// (arena.md Part 4): plaza lanes bright and long, artery tight and covered.
// band is the engagement band [min,max] metres a fight on the lane produces.

export const junctions = {
  J_PLAZA_S:   [-5, 0, 10],     // plaza south, by the hoarding line
  J_PLAZA_N:   [-8, 0, -12],    // plaza north, west of pk_container
  J_ARCADE_G:  [-32, 0, -7],    // arcade lightwell (ground)
  J_CROSS:     [-26, 0, -23],   // cs1a/cs1b seam on the artery
  J_STREET:    [-10, 0, -25],   // market-street pocket
  J_CUT:       [14, 0, -20],    // NE cut mouth / corridor east end
  J_GALLERY_N: [20, 0, -19],    // gallery at the cut crossing
  J_GALLERY_M: [20, 0, -4],     // gallery at the L2 mid door
  J_GALLERY_S: [20, 0, 6],      // gallery south, by the plaza door
  J_ALLEY_N:   [-44, 0, -24],   // alley north, at cs1a's mouth
  J_ALLEY_S:   [-46, 0, 2],     // alley south, west of a_container_2
  J_LY:        [-33.5, 0, 12],  // Lantern Yard (FLAG_WEST stand)
  J_EXH:       [6.5, 0, -30],   // Exchange House (FLAG_EAST stand)
};

export const lanes = [
  // ---- the plaza (centre) ------------------------------------------------
  { id: "L_CENTRE", a: "J_PLAZA_S", b: "J_PLAZA_N",
    wp: [[-5, 0, 10], [-8, 0, 0], [-8, 0, -12]],
    band: [10, 37], exposure: 0.85, cover: 0.8, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_WEST_G", a: "J_PLAZA_N", b: "J_ARCADE_G",
    wp: [[-8, 0, -12], [-18, 0, -11], [-25.5, 0, -12], [-28, 0, -10], [-32, 0, -7]],
    band: [5, 14], exposure: 0.35, cover: 0.6, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_CUT_PLAZA", a: "J_CUT", b: "J_PLAZA_N",
    wp: [[14, 0, -20], [10, 0, -16], [2, 0, -10], [-4, 0, -10], [-8, 0, -12]],
    band: [12, 22], exposure: 0.6, cover: 0.5, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_MID_DOOR", a: "J_PLAZA_N", b: "J_GALLERY_M",
    wp: [[-8, 0, -12], [0, 0, -8], [6, 0, -6], [11, 0, -5], [15.8, 0, -4], [19, 0, -4], [20, 0, -4]],
    band: [8, 20], exposure: 0.6, cover: 0.5, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_GAL_S_PLAZA", a: "J_GALLERY_S", b: "J_PLAZA_S",
    wp: [[20, 0, 6], [19, 0, 10], [16, 0, 10], [10, 0, 11], [4, 0, 12], [-5, 0, 10]],
    band: [8, 18], exposure: 0.55, cover: 0.5, vertical: false,
    botTraversable: true, throughGoing: true },

  // ---- the north artery (rotation route) ---------------------------------
  { id: "L_ARTERY_W", a: "J_ALLEY_N", b: "J_CROSS",
    wp: [[-44, 0, -24], [-41, 0, -25.5], [-37, 0, -26.5], [-31, 0, -24], [-26, 0, -23]],
    band: [4, 12], exposure: 0.3, cover: 0.7, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_CROSS", a: "J_CROSS", b: "J_PLAZA_N",
    wp: [[-26, 0, -23], [-21.5, 0, -19.5], [-14, 0, -16], [-8, 0, -12]],
    band: [7, 16], exposure: 0.55, cover: 0.6, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_STREET", a: "J_CROSS", b: "J_STREET",
    wp: [[-26, 0, -23], [-19, 0, -25], [-13, 0, -24], [-10, 0, -25]],
    band: [4, 12], exposure: 0.35, cover: 0.7, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_CORRIDOR", a: "J_STREET", b: "J_CUT",
    wp: [[-10, 0, -25], [-6.5, 0, -21.5], [1, 0, -22.5], [4, 0, -21], [7, 0, -23.5], [11, 0, -21], [14, 0, -20]],
    band: [3, 10], exposure: 0.15, cover: 0.3, vertical: false,
    botTraversable: true, throughGoing: true },

  // ---- the gallery (long band) -------------------------------------------
  { id: "L_CUT_GAL", a: "J_CUT", b: "J_GALLERY_N",
    wp: [[14, 0, -20], [18, 0, -20], [20, 0, -19]],
    band: [5, 14], exposure: 0.4, cover: 0.5, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_EAST_N", a: "J_GALLERY_N", b: "J_GALLERY_M",
    wp: [[20, 0, -19], [21.5, 0, -14], [20, 0, -8], [20, 0, -4]],
    band: [8, 46], exposure: 0.3, cover: 0.5, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_EAST_S", a: "J_GALLERY_M", b: "J_GALLERY_S",
    wp: [[20, 0, -4], [19.5, 0, 1], [20, 0, 6]],
    band: [8, 46], exposure: 0.3, cover: 0.5, vertical: false,
    botTraversable: true, throughGoing: true },

  // ---- the alley (west flank) --------------------------------------------
  { id: "L_ALLEY", a: "J_ALLEY_S", b: "J_ALLEY_N",
    wp: [[-46, 0, 2], [-46, 0, -1], [-43, 0, -6], [-43, 0, -10], [-45, 0, -14.5], [-44, 0, -20], [-44, 0, -24]],
    band: [5, 14], exposure: 0.35, cover: 0.5, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_ARC_ALLEY_N", a: "J_ARCADE_G", b: "J_ALLEY_N",
    wp: [[-32, 0, -7], [-35, 0, -11], [-38, 0, -14], [-40, 0, -15], [-44, 0, -18], [-44, 0, -24]],
    band: [5, 14], exposure: 0.3, cover: 0.6, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_ARC_ALLEY_S", a: "J_ARCADE_G", b: "J_ALLEY_S",
    wp: [[-32, 0, -7], [-34, 0, -3], [-38, 0, -2], [-40, 0, -2], [-43, 0, -1], [-46, 0, 2]],
    band: [5, 14], exposure: 0.3, cover: 0.6, vertical: false,
    botTraversable: true, throughGoing: true },

  // ---- flag-room approaches ----------------------------------------------
  { id: "L_LY_PLAZA", a: "J_LY", b: "J_PLAZA_S",
    wp: [[-33.5, 0, 12], [-27, 0, 13], [-24.5, 0, 10.5], [-18, 0, 12.5], [-13, 0, 11], [-5, 0, 10]],
    band: [6, 16], exposure: 0.55, cover: 0.6, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_LY_ARC", a: "J_LY", b: "J_ARCADE_G",
    wp: [[-33.5, 0, 12], [-32, 0, 6.5], [-33, 0, 1], [-36.8, 0, -1], [-37.2, 0, -5], [-34, 0, -8], [-32, 0, -7]],
    band: [4, 12], exposure: 0.25, cover: 0.6, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_LY_ALLEY", a: "J_LY", b: "J_ALLEY_S",
    wp: [[-33.5, 0, 12], [-40, 0, 11], [-45, 0, 9], [-46, 0, 2]],
    band: [4, 12], exposure: 0.25, cover: 0.6, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_EXH_COR", a: "J_EXH", b: "J_CUT",
    wp: [[6.5, 0, -30], [4.5, 0, -25.5], [4, 0, -21], [7, 0, -23.5], [11, 0, -21], [14, 0, -20]],
    band: [3, 10], exposure: 0.15, cover: 0.4, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_EXH_ST", a: "J_EXH", b: "J_STREET",
    wp: [[6.5, 0, -30], [3, 0, -31.5], [0.7, 0, -29.7], [-3, 0, -28], [-7, 0, -26], [-10, 0, -25]],
    band: [4, 12], exposure: 0.3, cover: 0.6, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_EXH_GAL", a: "J_EXH", b: "J_GALLERY_N",
    wp: [[6.5, 0, -30], [10.8, 0, -29], [14, 0, -29], [18, 0, -29], [20, 0, -24], [20, 0, -19]],
    band: [4, 12], exposure: 0.25, cover: 0.5, vertical: false,
    botTraversable: true, throughGoing: true },

  // ---- the balcony (overlook, NOT a route — Part 3.9, frozen) ------------
  { id: "L_BALCONY", a: "J_ARCADE_G", b: "J_ARCADE_G",
    wp: [[-33, 4.2, -14]],
    band: [9, 31], exposure: 0.45, cover: 0.4, vertical: true,
    botTraversable: true, throughGoing: false,
    note: "V8 — bots cannot mantle/jump; a lane whose exit is its entrance is a post, not a route" },
];

export const approaches = {
  A_STAND: ["L_LY_PLAZA", "L_LY_ARC", "L_LY_ALLEY"],   // FLAG_WEST (AMBER)
  B_STAND: ["L_EXH_COR", "L_EXH_ST", "L_EXH_GAL"],     // FLAG_EAST (SLATE)
};

export default { junctions, lanes, approaches };
