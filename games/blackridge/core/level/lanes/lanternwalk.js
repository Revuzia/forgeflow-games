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
//
// ===========================================================================
// GEN-2 REWRITE (2026-09-16) — THE GRAPH FOLLOWS THE FENCE LINE
// ===========================================================================
// The gen-1 graph was authored for the 73 × 49 m carve: 13 junctions and 22
// lanes, all of them inside the plaza / arcade / gallery / artery core. The
// gen-2 expansion more than doubled the floor (2570 → 6268 m²) and annexed
// six districts that the old graph did not name at all — Kirov Boulevard, the
// customs yard, the CYE gate lane, the widened Tannery Alley and its south
// dog-leg, the S1 loading hall and the plaza ramp. Bots patrol the graph, so
// until this file named those districts they were floor the AI never walked:
// the map would have played as the gen-1 arena with 3700 m² of scenery.
//
// What changed:
//   • 35 junctions (was 13). The 13 core ones keep their meaning; J_PLAZA_N,
//     J_ALLEY_N/S and J_GALLERY_N moved a few metres onto floor the new
//     geometry actually leaves walkable (the old J_GALLERY_N at (20,−19) is
//     now inside the gallery's cut-mouth screen).
//   • 50 through-going lanes (was 21) + the frozen balcony post.
//   • The boulevard lanes DOG-LEG through the staggered container breaks
//     rather than crossing them: the tram-stop pair (X[28,39] @Z+6.5 and
//     X[36,46] @Z+14.5) and the awning/yard pairs are LOS seals with movement
//     gaps on alternating sides, so L_BLVD_NM and L_BLVD_ES weave between
//     them the way a player has to. A straight two-waypoint lane down Kirov
//     would have told the commander the street is one 86 m run; it is not.
//   • `approaches` gains L_EXH_CUSTOMS: the Exchange House stand now has a
//     fourth way in (down the market street into the customs yard), which is
//     the reason the east flag is not a three-door hold any more.
// ===========================================================================

export const junctions = {
  // ---- the core (gen-1 names kept) ---------------------------------------
  J_PLAZA_S:   [-5, 0, 10],      // plaza south, by the hoarding line
  J_PLAZA_N:   [-8, 0, -12],     // plaza north, west of pk_container
  J_PLAZA_W:   [-20, 0, -2],     // plaza west, off the arcade east doors
  J_PLAZA_E:   [10, 0, 0],       // plaza east, off the gallery mid door
  J_ARCADE_G:  [-32, 0, -7],     // arcade lightwell (ground)
  J_ARC_N:     [-37, 0, -15],    // arcade north-west, at the L3 alley door
  J_CROSS:     [-26, 0, -23],    // cs1a/cs1b seam on the artery
  J_STREET:    [-10, 0, -25],    // market-street pocket
  J_CORR:      [4, 0, -22],      // L1 service corridor, west of the piers
  J_CUT:       [14, 0, -20],     // NE cut mouth / corridor east end
  J_GALLERY_N: [20, 0, -25],     // gallery north, clear of the P5 screen
  J_GALLERY_M: [20, 0, -4],      // gallery at the L2 mid door
  J_GALLERY_S: [20, 0, 10],      // gallery south, by the plaza door
  J_ALLEY_N:   [-45, 0, -26],    // alley north, at cs1a's mouth
  J_ALLEY_S:   [-45, 0, 3],      // alley south, east lane
  J_LY:        [-33.5, 0, 12],   // Lantern Yard (FLAG_WEST stand)
  J_EXH:       [6.5, 0, -30],    // Exchange House (FLAG_EAST stand)

  // ---- GEN-2: the annexed districts ---------------------------------------
  J_ALLEY_M:   [-50, 0, -10],    // the alley's new WEST lane, mid run
  J_ALLEY_W:   [-52, 0, 20],     // west lane south, north of the aw_cont stack
  J_ALLEY_SS:  [-47, 0, 27],     // alley south dog-leg, at the S1 west door
  J_ALLEY_Q:   [-45, 0, 38],     // alley south end, against the quay hoarding
  J_S1:        [-25, 0, 29],     // the S1 loading hall
  J_RAMP:      [-9, 0, 30],      // the widened plaza ramp
  J_RAMP_N:    [-10, 0, 22],     // the ramp's mouth onto the plaza
  J_CS1_N:     [-36, 0, -30],    // the deepened CS1, north bay
  J_CUSTOMS_W: [-4, 0, -45],     // customs yard, west end
  J_CUSTOMS_M: [1, 0, -47],      // customs yard, the gatehouse line
  J_CUSTOMS_E: [21, 0, -40],     // customs yard, east end at the CYE mouth
  J_CYE:       [31, 0, -42],     // the CYE gate lane, boulevard end
  J_BLVD_N:    [33, 0, -38],     // Kirov Boulevard, north under the tram deck
  J_BLVD_M:    [33, 0, -8],      // Kirov Boulevard, mid (the GE strip mouth)
  J_BLVD_E:    [41, 0, 4],       // Kirov Boulevard, east kerb by the shelter
  J_BLVD_S:    [34, 0, 30],      // Kirov Boulevard, south past the skip line
  J_GE:        [26, 0, -2],      // the GE strip, between gallery and street
  J_S3:        [19, 0, 16],      // the S3 market passage, plaza end
};

export const lanes = [
  // =========================================================================
  // THE PLAZA (centre)
  // =========================================================================
  { id: "L_CENTRE", a: "J_PLAZA_S", b: "J_PLAZA_N",
    wp: [[-5, 0, 10], [-6, 0, 2], [-8, 0, -6], [-8, 0, -12]],
    band: [10, 37], exposure: 0.85, cover: 0.8, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_PLAZA_W", a: "J_PLAZA_W", b: "J_PLAZA_S",
    wp: [[-20, 0, -2], [-18, 0, 6], [-14, 0, 8], [-8, 0, 10], [-5, 0, 10]],
    band: [8, 24], exposure: 0.7, cover: 0.6, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_PLAZA_N_W", a: "J_PLAZA_W", b: "J_PLAZA_N",
    wp: [[-20, 0, -2], [-16, 0, -8], [-13, 0, -11], [-8, 0, -12]],
    band: [8, 22], exposure: 0.7, cover: 0.6, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_PLAZA_E", a: "J_PLAZA_N", b: "J_PLAZA_E",
    wp: [[-8, 0, -12], [-2, 0, -9], [4, 0, -5], [10, 0, 0]],
    band: [10, 28], exposure: 0.8, cover: 0.55, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_PLAZA_SE", a: "J_PLAZA_E", b: "J_PLAZA_S",
    wp: [[10, 0, 0], [8, 0, 6], [0, 0, 10], [-5, 0, 10]],
    band: [8, 24], exposure: 0.75, cover: 0.55, vertical: false,
    botTraversable: true, throughGoing: true },

  // =========================================================================
  // THE WEST FLANK — arcade, Lantern Yard, the widened Tannery Alley
  // =========================================================================
  { id: "L_ARC_SPINE", a: "J_ARC_N", b: "J_ARCADE_G",
    wp: [[-37, 0, -15], [-35, 0, -11], [-32, 0, -7]],
    band: [4, 14], exposure: 0.3, cover: 0.65, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_ARC_PLAZA", a: "J_ARCADE_G", b: "J_PLAZA_W",
    wp: [[-32, 0, -7], [-30, 0, -11], [-27, 0, -12], [-25.5, 0, -12], [-23, 0, -12], [-20, 0, -8], [-20, 0, -2]],
    band: [5, 16], exposure: 0.4, cover: 0.6, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_ARC_PLAZA_N", a: "J_ARC_N", b: "J_CROSS",
    wp: [[-37, 0, -15], [-36, 0, -18], [-31, 0, -18.5], [-28, 0, -21], [-26, 0, -23]],
    band: [5, 16], exposure: 0.4, cover: 0.6, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_ARC_ALLEY_N", a: "J_ARC_N", b: "J_ALLEY_N",
    wp: [[-37, 0, -15], [-40, 0, -15], [-43, 0, -18], [-45, 0, -22], [-45, 0, -26]],
    band: [4, 14], exposure: 0.3, cover: 0.6, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_ARC_ALLEY_S", a: "J_ARCADE_G", b: "J_ALLEY_S",
    wp: [[-32, 0, -7], [-36, 0, -3], [-40, 0, -2], [-43, 0, -1], [-45, 0, 3]],
    band: [4, 14], exposure: 0.3, cover: 0.6, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_LY_ARC", a: "J_LY", b: "J_ARCADE_G",
    wp: [[-33.5, 0, 12], [-32, 0, 7], [-33, 0, 2], [-35, 0, -2], [-34, 0, -6], [-32, 0, -7]],
    band: [4, 12], exposure: 0.25, cover: 0.6, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_LY_PLAZA", a: "J_LY", b: "J_PLAZA_S",
    wp: [[-33.5, 0, 12], [-27, 0, 13], [-22, 0, 12], [-16, 0, 13], [-10, 0, 11], [-5, 0, 10]],
    band: [6, 18], exposure: 0.55, cover: 0.6, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_LY_ALLEY", a: "J_LY", b: "J_ALLEY_S",
    wp: [[-33.5, 0, 12], [-38, 0, 11], [-40, 0, 11], [-43, 0, 8], [-45, 0, 3]],
    band: [4, 12], exposure: 0.25, cover: 0.6, vertical: false,
    botTraversable: true, throughGoing: true },

  // ---- the alley itself: TWO lanes now, not one 7 m artery ---------------
  { id: "L_ALLEY_N", a: "J_ALLEY_N", b: "J_ALLEY_M",
    wp: [[-45, 0, -26], [-47, 0, -21], [-54, 0, -16], [-50, 0, -10]],
    band: [6, 20], exposure: 0.35, cover: 0.55, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_ALLEY_S", a: "J_ALLEY_M", b: "J_ALLEY_S",
    wp: [[-50, 0, -10], [-51, 0, -4], [-48, 0, 0], [-45, 0, 3]],
    band: [6, 20], exposure: 0.35, cover: 0.55, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_ALLEY_SW", a: "J_ALLEY_S", b: "J_ALLEY_W",
    wp: [[-45, 0, 3], [-49, 0, 8], [-52, 0, 14], [-52, 0, 20]],
    band: [6, 20], exposure: 0.35, cover: 0.5, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_ALLEY_SS", a: "J_ALLEY_W", b: "J_ALLEY_SS",
    wp: [[-52, 0, 20], [-48, 0, 22], [-47, 0, 27]],
    band: [5, 16], exposure: 0.3, cover: 0.6, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_ALLEY_Q", a: "J_ALLEY_SS", b: "J_ALLEY_Q",
    wp: [[-47, 0, 27], [-46, 0, 32], [-45, 0, 38]],
    band: [5, 16], exposure: 0.3, cover: 0.55, vertical: false,
    botTraversable: true, throughGoing: true },

  // =========================================================================
  // THE NORTH ARTERY, THE DEEPENED CS1 AND THE CUSTOMS YARD
  // =========================================================================
  { id: "L_CROSS", a: "J_CROSS", b: "J_PLAZA_W",
    wp: [[-26, 0, -23], [-24, 0, -19], [-22, 0, -14], [-21, 0, -8], [-20, 0, -2]],
    band: [7, 18], exposure: 0.55, cover: 0.6, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_STREET_N", a: "J_CROSS", b: "J_STREET",
    wp: [[-26, 0, -23], [-20, 0, -24], [-15, 0, -24], [-10, 0, -25]],
    band: [5, 16], exposure: 0.4, cover: 0.7, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_STREET_PLAZA", a: "J_STREET", b: "J_PLAZA_N",
    wp: [[-10, 0, -25], [-9, 0, -21], [-10, 0, -17], [-9, 0, -14], [-8, 0, -12]],
    band: [5, 16], exposure: 0.45, cover: 0.6, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_CS1_DEEP", a: "J_CS1_N", b: "J_CROSS",
    wp: [[-36, 0, -30], [-32, 0, -29], [-28, 0, -26], [-26, 0, -23]],
    band: [5, 16], exposure: 0.3, cover: 0.7, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_CS1_ALLEY", a: "J_CS1_N", b: "J_ALLEY_N",
    wp: [[-36, 0, -30], [-39, 0, -28], [-42, 0, -26], [-45, 0, -26]],
    band: [4, 14], exposure: 0.25, cover: 0.7, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_CUSTOMS_ST", a: "J_STREET", b: "J_CUSTOMS_W",
    wp: [[-10, 0, -25], [-9, 0, -30], [-8, 0, -35], [-6, 0, -40], [-4, 0, -45]],
    band: [6, 20], exposure: 0.45, cover: 0.55, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_CUSTOMS_W", a: "J_CUSTOMS_W", b: "J_CUSTOMS_M",
    wp: [[-4, 0, -45], [-1, 0, -46], [1, 0, -47]],
    band: [8, 26], exposure: 0.6, cover: 0.5, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_CUSTOMS_E", a: "J_CUSTOMS_M", b: "J_CUSTOMS_E",
    wp: [[1, 0, -47], [7, 0, -46], [13, 0, -44], [19, 0, -42], [21, 0, -40]],
    band: [8, 26], exposure: 0.6, cover: 0.5, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_CYE", a: "J_CUSTOMS_E", b: "J_CYE",
    wp: [[21, 0, -40], [23, 0, -41], [28, 0, -42], [31, 0, -42]],
    band: [5, 18], exposure: 0.35, cover: 0.6, vertical: false,
    botTraversable: true, throughGoing: true },

  // =========================================================================
  // THE CORRIDOR, THE EXCHANGE HOUSE AND THE NE CUT
  // =========================================================================
  { id: "L_CORRIDOR", a: "J_STREET", b: "J_CORR",
    wp: [[-10, 0, -25], [-6, 0, -23], [-1, 0, -22.5], [4, 0, -22]],
    band: [3, 12], exposure: 0.15, cover: 0.35, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_CORR_CUT", a: "J_CORR", b: "J_CUT",
    wp: [[4, 0, -22], [8, 0, -22], [11, 0, -21], [14, 0, -20]],
    band: [3, 12], exposure: 0.15, cover: 0.3, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_EXH_COR", a: "J_EXH", b: "J_CORR",
    wp: [[6.5, 0, -30], [5, 0, -27], [4.5, 0, -25.5], [4, 0, -22]],
    band: [3, 10], exposure: 0.15, cover: 0.4, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_EXH_ST", a: "J_EXH", b: "J_STREET",
    wp: [[6.5, 0, -30], [2, 0, -31], [-1, 0, -31], [-5, 0, -28], [-10, 0, -25]],
    band: [4, 14], exposure: 0.3, cover: 0.6, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_EXH_GAL", a: "J_EXH", b: "J_GALLERY_N",
    wp: [[6.5, 0, -30], [11, 0, -29], [14, 0, -29], [18, 0, -28], [20, 0, -25]],
    band: [4, 14], exposure: 0.25, cover: 0.5, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_EXH_CUSTOMS", a: "J_EXH", b: "J_CUSTOMS_M",
    wp: [[6.5, 0, -30], [2, 0, -32], [1, 0, -36], [1, 0, -41], [1, 0, -47]],
    band: [6, 22], exposure: 0.4, cover: 0.5, vertical: false,
    botTraversable: true, throughGoing: true },

  // =========================================================================
  // THE GALLERY, THE GE STRIP AND THE S3 MARKET PASSAGE
  // =========================================================================
  { id: "L_CUT_GAL", a: "J_CUT", b: "J_GALLERY_N",
    wp: [[14, 0, -20], [17, 0, -21], [20, 0, -22], [20, 0, -25]],
    band: [5, 16], exposure: 0.4, cover: 0.5, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_GAL_N", a: "J_GALLERY_N", b: "J_GALLERY_M",
    wp: [[20, 0, -25], [21, 0, -18], [20, 0, -12], [20, 0, -4]],
    band: [8, 30], exposure: 0.35, cover: 0.5, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_GAL_S", a: "J_GALLERY_M", b: "J_GALLERY_S",
    wp: [[20, 0, -4], [20, 0, 3], [20, 0, 10]],
    band: [8, 30], exposure: 0.35, cover: 0.5, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_GAL_PLAZA_M", a: "J_GALLERY_M", b: "J_PLAZA_E",
    wp: [[20, 0, -4], [16, 0, -4], [13, 0, -2], [10, 0, 0]],
    band: [6, 20], exposure: 0.5, cover: 0.5, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_GAL_PLAZA_S", a: "J_GALLERY_S", b: "J_PLAZA_S",
    wp: [[20, 0, 10], [16, 0, 10], [10, 0, 11], [4, 0, 11], [-5, 0, 10]],
    band: [8, 22], exposure: 0.55, cover: 0.5, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_GE", a: "J_GALLERY_M", b: "J_GE",
    wp: [[20, 0, -4], [24, 0, -3], [26, 0, -2]],
    band: [6, 26], exposure: 0.5, cover: 0.45, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_GE_BLVD", a: "J_GE", b: "J_BLVD_M",
    wp: [[26, 0, -2], [29, 0, -4], [33, 0, -8]],
    band: [8, 26], exposure: 0.6, cover: 0.45, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_S3", a: "J_GALLERY_S", b: "J_S3",
    wp: [[20, 0, 10], [19, 0, 13], [19, 0, 16]],
    band: [4, 12], exposure: 0.2, cover: 0.5, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_S3_BLVD", a: "J_S3", b: "J_BLVD_S",
    wp: [[19, 0, 16], [24, 0, 17], [27, 0, 19], [31, 0, 24], [34, 0, 30]],
    band: [4, 16], exposure: 0.25, cover: 0.6, vertical: false,
    botTraversable: true, throughGoing: true },

  // =========================================================================
  // KIROV BOULEVARD — the lanes DOG-LEG through the container breaks
  // =========================================================================
  { id: "L_BLVD_N", a: "J_CYE", b: "J_BLVD_N",
    wp: [[31, 0, -42], [32, 0, -40], [33, 0, -38]],
    band: [6, 20], exposure: 0.4, cover: 0.55, vertical: false,
    botTraversable: true, throughGoing: true },
  // north half: crosses the yard break (X[36,46] @Z−36) on the WEST side and
  // the awning break (X[28,39] @Z−31) on the EAST side — the weave is the lane.
  { id: "L_BLVD_NM", a: "J_BLVD_N", b: "J_BLVD_M",
    wp: [[33, 0, -38], [33, 0, -34], [37, 0, -33], [41, 0, -32], [42, 0, -28],
         [40, 0, -24], [33, 0, -20], [34, 0, -14], [33, 0, -8]],
    band: [10, 34], exposure: 0.7, cover: 0.5, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_BLVD_MS", a: "J_BLVD_M", b: "J_BLVD_E",
    wp: [[33, 0, -8], [36, 0, -4], [39, 0, 0], [41, 0, 4]],
    band: [10, 30], exposure: 0.7, cover: 0.45, vertical: false,
    botTraversable: true, throughGoing: true },
  // south half: the tram-stop sealed pair — east of X39 at Z+6.5, west of X36
  // at Z+14.5. A straight line down this stretch does not exist.
  { id: "L_BLVD_ES", a: "J_BLVD_E", b: "J_BLVD_S",
    wp: [[41, 0, 4], [36, 0, 5], [32, 0, 6], [32, 0, 11], [38, 0, 12], [42, 0, 17], [38, 0, 22], [34, 0, 30]],
    band: [10, 30], exposure: 0.65, cover: 0.5, vertical: false,
    botTraversable: true, throughGoing: true },

  // =========================================================================
  // THE SOUTH ROTATION — plaza ramp, S1 loading hall, alley dog-leg
  // =========================================================================
  { id: "L_RAMP_PLAZA", a: "J_RAMP_N", b: "J_PLAZA_S",
    wp: [[-10, 0, 22], [-11, 0, 18], [-13, 0, 15], [-11, 0, 12], [-8, 0, 11], [-5, 0, 10]],
    band: [5, 18], exposure: 0.4, cover: 0.6, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_RAMP", a: "J_RAMP_N", b: "J_RAMP",
    wp: [[-10, 0, 22], [-10, 0, 26], [-9, 0, 30]],
    band: [6, 22], exposure: 0.45, cover: 0.55, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_RAMP_S1", a: "J_RAMP", b: "J_S1",
    wp: [[-9, 0, 30], [-12, 0, 29], [-16, 0, 29], [-20, 0, 30], [-25, 0, 29]],
    band: [4, 16], exposure: 0.2, cover: 0.65, vertical: false,
    botTraversable: true, throughGoing: true },
  { id: "L_S1_ALLEY", a: "J_S1", b: "J_ALLEY_SS",
    wp: [[-25, 0, 29], [-30, 0, 28], [-34, 0, 26], [-38, 0, 26], [-43, 0, 26], [-47, 0, 27]],
    band: [5, 18], exposure: 0.25, cover: 0.65, vertical: false,
    botTraversable: true, throughGoing: true },

  // ---- the balcony (overlook, NOT a route — Part 3.9, frozen) ------------
  { id: "L_BALCONY", a: "J_ARCADE_G", b: "J_ARCADE_G",
    wp: [[-33, 4.2, -14]],
    band: [9, 31], exposure: 0.45, cover: 0.4, vertical: true,
    botTraversable: true, throughGoing: false,
    note: "V8 — bots cannot mantle/jump; a lane whose exit is its entrance is a post, not a route" },
];

export const approaches = {
  // FLAG_WEST (AMBER) — the Lantern Yard's three doors: D1 onto the plaza,
  // D2 into the arcade, D3 into the alley.
  A_STAND: ["L_LY_PLAZA", "L_LY_ARC", "L_LY_ALLEY"],
  // FLAG_EAST (SLATE) — D1 into the corridor, D2 onto the market street, the
  // D3 tunnel into the gallery, and (gen-2) the street run into the customs
  // yard, which is what stops the stand being a three-door hold.
  B_STAND: ["L_EXH_COR", "L_EXH_ST", "L_EXH_GAL", "L_EXH_CUSTOMS"],
};

export default { junctions, lanes, approaches };
