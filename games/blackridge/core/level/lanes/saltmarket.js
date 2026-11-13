// core/level/lanes/saltmarket.js [the SALTMARKET lane graph]
// Route-choice data ABOVE the pathfinder (PVP_BUILD_PLAN Part 3.9 / C9;
// bot_ai.md Part 5): nav.findPath string-pulls, so a raw path to a distant
// goal is by construction the shortest and most exposed line. Bots path
// waypoint-to-waypoint down a lane instead; which lane is the commander's
// choice (W7's routeScore).
//
// Contract (Part 3.9, gate-checked by tools/probe_arena.mjs G-LANES):
//   • every ground waypoint is on walkable nav (a balcony waypoint, y > 0.5,
//     is exempt — the 0.5 m ground grid cannot judge it);
//   • every lane's endpoints are junctions;
//   • consecutive same-level waypoints ≤ 12 m apart;
//   • the graph contains at least one cycle (|edges| ≥ |junctions|);
//   • every botTraversable/throughGoing pair is honest against V8 (bots
//     cannot mantle or jump).
//
// ---------------------------------------------------------------------------
// REBUILT 2026-09-16 FOR THE ELEVEN-ROOM ARENA. The previous graph was written
// for the gen-1 ring map — stall aisles at X ≈ ±27.5, a terrace wall at ±30.5,
// hall walls at ±21 — and after the gen-2 rebuild 62 of its waypoints sat
// inside solid geometry. Nothing of it survives except the schema.
//
// WHY THE JUNCTIONS SIT WHERE THEY DO. Saltmarket is now ELEVEN ROOMS cut out
// of one shed by two gantry walls and four cross walls (see
// core/level/maps/saltmarket.js). Every room is 23–32 m across and every link
// between two rooms is a single 3 m door, so the map's route structure IS its
// door list: there is exactly one junction per door throat, one per room, and
// one per objective. A junction in open floor that a straight line merely
// happens to cross would tell the commander nothing the pathfinder does not
// already know; a junction in a 3 m throat is a decision.
//
//   18 door junctions   J_GW1..J_GW6 (the six gantry doors), J_VN1..J_VN4 (the
//                       four cross-wall doors in the outer rows), J_VC_W /
//                       J_VC_E (the hall's two flank doors), and the three
//                       doors of each flag room.
//   11 room junctions   one per room — four corner yards, four market bays,
//                       two flank precincts and the hall.
//    2 stands           J_SALT, J_WEIGH.
//    2 gallery legs     J_GAL_N, J_GAL_S, at y 2.8.
//
// WHY EVERY ROOM GETS A SWEEP LANE. The rebuild annexed the four corner yards
// and the four market bays — 62% of the floor is territory the old graph never
// mentioned, and a bot that never patrols it makes a 6200 m² map play like the
// 2500 m² one. Each outer room therefore carries TWO lanes between the same
// pair of junctions: the short one across its middle and a SWEEP that runs its
// far wall. A commander that wants the flank takes the sweep; one that wants
// the clock takes the short lane. Those pairs are also where the graph's
// cycles come from, on top of the room-level ring
// yard-NW → market-NW → gantry → precinct-W → yard-NW.
//
// THE MIRROR. The arena is authored as a 180° rotation of its own west half
// about world (−5, −2), so this file is too: WEST_JUNCTIONS and WEST_LANES are
// written once in LOCAL (centre-relative) metres and emitted twice, as authored
// and rotated. That is not tidiness — G-I measures attacker→enemy-flag path
// parity off this graph's geometry, and a hand-written east half would drift
// from the west one the first time a waypoint moved. J_HALL is the one
// junction that maps to itself and so is declared on its own.
//
// exposure/cover are authored 0..1 against the sightline audit: the hall floor
// and the two precinct crossings are the map's bright open ground (the hall
// measures a 14 m median free ray), the yards and market bays are the covered,
// 5–18 m half of the fight, and the flag rooms are the 3–9 m end of it.

// --------------------------------------------------------------- helpers
// The map's authoring origin. Local (0,0) is the arena centre in world metres.
const OX = -5, OZ = -2;
// local → world; `y` defaults to the ground plane.
const P = (x, z, y = 0) => [x + OX, y, z + OZ];
// 180° rotation about the arena centre, in world metres.
const M = (p) => [2 * OX - p[0], p[1], 2 * OZ - p[2]];

// --------------------------------------------------------- west/north half
// Local metres. Read the map file's room table alongside this: X columns are
// [-49,-26] [-24,-1] [1,24] [26,49] in the outer rows and [-49,-17] [-15,15]
// [17,49] in the middle one; Z rows are [-38,-13] [-11,11] [13,38].
const WEST_JUNCTIONS = {
  // --- the west flag room and its three doors
  J_SALT: P(-44.5, 3),        // the stand (FLAG_WEST)
  J_SS_N: P(-47.25, -6.5),    // salt store, north door
  J_SS_S: P(-41.75, 6.5),     // salt store, south door
  J_SS_E: P(-39.5, -2.75),    // salt store, east door onto the precinct
  // --- the gantry doors, north wall (Z −13..−11)
  J_GW1: P(-44, -12),         // NW yard  ⇄ west precinct
  J_GW2: P(-22, -12),         // NW market ⇄ west precinct
  J_GW3: P(12, -12),          // NE market ⇄ the hall
  // --- the outer rows' cross-wall doors
  J_VN1: P(-25, -32),         // NW yard  ⇄ NW market
  J_VN2: P(25, -28),          // NE market ⇄ NE yard
  // --- the hall's west flank door
  J_VC_W: P(-16, -7.5),       // west precinct ⇄ the hall
  // --- one junction per room
  J_YARD_NW: P(-37, -25),
  J_MKT_NW: P(-8, -25),
  J_MKT_NE: P(10, -25),
  J_YARD_NE: P(30, -21),
  J_PREC_W: P(-22, 0),
  // --- the gallery's north leg (y 2.8)
  J_GAL_N: P(-5, -9.75, 2.8),
};

// Mirror names, west → east. Every entry is the 180° image of its key, so
// J_SS_N (the salt store's NORTH door) becomes J_WH_S (the weigh house's
// SOUTH door) and so on.
const MIRROR_J = {
  J_SALT: "J_WEIGH", J_SS_N: "J_WH_S", J_SS_S: "J_WH_N", J_SS_E: "J_WH_W",
  J_GW1: "J_GW4", J_GW2: "J_GW5", J_GW3: "J_GW6",
  J_VN1: "J_VN3", J_VN2: "J_VN4", J_VC_W: "J_VC_E",
  J_YARD_NW: "J_YARD_SE", J_MKT_NW: "J_MKT_SE", J_MKT_NE: "J_MKT_SW",
  J_YARD_NE: "J_YARD_SW", J_PREC_W: "J_PREC_E", J_GAL_N: "J_GAL_S",
};

// [westId, eastId, a, b, waypoints(local), band, exposure, cover, vertical]
// Waypoints EXCLUDE the endpoints — probe_arena prepends J[a] and appends J[b].
const WEST_LANES = [
  // ===================== the salt store: three ways onto the stand =========
  // Three throats, mirrored piece for piece on the east side. Three is the
  // number that stops two defenders holding a base by looking one way.
  ["L_SALT_N", "L_WEIGH_S", "J_SALT", "J_SS_N", [[-46, -1]], [3, 9], 0.2, 0.7],
  ["L_SALT_S", "L_WEIGH_N", "J_SALT", "J_SS_S", [[-43, 5]], [3, 9], 0.2, 0.7],
  ["L_SALT_E", "L_WEIGH_W", "J_SALT", "J_SS_E", [[-42, 0]], [3, 9], 0.25, 0.65],

  // ===================== the west precinct ================================
  // The room the flag room sits in: 32 × 22, the map's second-brightest floor.
  ["L_SSN_GW1", "L_WHS_GW4", "J_SS_N", "J_GW1", [[-45.5, -9.5]], [4, 12], 0.3, 0.6],
  ["L_SSE_PREC", "L_WHW_PREC", "J_SS_E", "J_PREC_W",
    [[-35, -2], [-28, -1]], [6, 20], 0.5, 0.5],
  ["L_SSS_PREC", "L_WHN_PREC", "J_SS_S", "J_PREC_W",
    [[-36, 7], [-29, 4]], [6, 20], 0.45, 0.5],
  ["L_PREC_GW1", "L_PREC_GW4", "J_PREC_W", "J_GW1",
    [[-28, -4], [-34, -8], [-40, -10.5]], [6, 22], 0.5, 0.45],
  ["L_GW2_PREC", "L_GW5_PREC", "J_GW2", "J_PREC_W", [[-22, -6]], [5, 16], 0.45, 0.5],
  ["L_PREC_VCW", "L_PREC_VCE", "J_PREC_W", "J_VC_W", [[-19, -4]], [5, 14], 0.4, 0.55],

  // ===================== the north-west yard ==============================
  // Open air, 23 × 25. The short lane crosses it; the sweep runs its far wall,
  // which is the only route that stays out of the gantry door's line.
  ["L_GW1_YARD", "L_GW4_YARD", "J_GW1", "J_YARD_NW",
    [[-44, -16], [-41, -21]], [5, 18], 0.45, 0.5],
  ["L_YARD_VN1", "L_YARD_VN3", "J_YARD_NW", "J_VN1",
    [[-32, -26], [-28, -29]], [5, 16], 0.4, 0.55],
  ["L_YARDNW_SWEEP", "L_YARDSE_SWEEP", "J_YARD_NW", "J_GW1",
    [[-33, -34], [-42, -36], [-46, -34], [-47, -25], [-46, -18]], [5, 20], 0.45, 0.5],

  // ===================== the north-west market ============================
  ["L_VN1_MKT", "L_VN3_MKT", "J_VN1", "J_MKT_NW",
    [[-20, -31], [-14, -28]], [5, 18], 0.4, 0.55],
  ["L_MKT_GW2", "L_MKT_GW5", "J_MKT_NW", "J_GW2",
    [[-13, -21], [-19, -16]], [5, 18], 0.45, 0.5],
  ["L_MKTNW_SWEEP", "L_MKTSE_SWEEP", "J_MKT_NW", "J_VN1",
    [[-4, -33], [-13, -36], [-21, -35], [-23, -28]], [5, 20], 0.45, 0.5],

  // ===================== the hall =========================================
  // 30 × 22 of open floor with a gallery ring over it. Both crossings are the
  // most exposed lanes on the map and are labelled as such.
  ["L_VCW_HALL", "L_VCE_HALL", "J_VC_W", "J_HALL",
    [[-11, -6], [-4, -1]], [8, 24], 0.7, 0.35],
  ["L_HALL_GW3", "L_HALL_GW6", "J_HALL", "J_GW3",
    [[5, -4], [10, -8]], [8, 24], 0.7, 0.35],

  // ===================== the north-east market ============================
  ["L_GW3_MKTNE", "L_GW6_MKTSW", "J_GW3", "J_MKT_NE",
    [[11, -17], [10, -21]], [5, 18], 0.45, 0.5],
  ["L_MKTNE_VN2", "L_MKTSW_VN4", "J_MKT_NE", "J_VN2",
    [[14, -26], [20, -27]], [5, 18], 0.4, 0.55],
  ["L_MKTNE_SWEEP", "L_MKTSW_SWEEP", "J_MKT_NE", "J_GW3",
    [[4, -31], [8, -36], [16, -35], [21, -31], [22, -22], [17, -19]], [5, 20], 0.45, 0.5],

  // ===================== the north-east yard ==============================
  ["L_VN2_YARDNE", "L_VN4_YARDSW", "J_VN2", "J_YARD_NE", [[28, -25]], [5, 16], 0.4, 0.55],
  ["L_YARDNE_SWEEP", "L_YARDSW_SWEEP", "J_YARD_NE", "J_VN2",
    [[35, -19], [42, -24], [40, -33], [32, -34], [27, -31]], [5, 20], 0.45, 0.5],

  // ===================== the gallery (verticality) ========================
  // The deck is a 2.5 m ring at y 2.8 reached by one stair per side, and the
  // stair lives INSIDE the ring's own footprint so it never blocks a hall door.
  // It cannot hold a sniper: every hall door void stops at 2.4 m, so from a
  // 2.8 m deck there is no line out of the hall at all. botTraversable stays
  // true because the stair is ten real 0.28 m risers, inside moveCapsule's
  // step-up budget — no mantling anywhere on it. The west stair tops out on
  // the ring's SOUTH arc, so this lane ends at J_GAL_S and its mirror (the east
  // stair) ends at J_GAL_N.
  ["L_GAL_W", "L_GAL_E", "J_HALL", "J_GAL_S",
    [[-9, -1], [-13.75, -5.5], [-13.75, -2, 2.8], [-13.75, 4, 2.8],
      [-13.75, 8, 2.8], [-8, 9.75, 2.8], [0, 9.75, 2.8]], [5, 20], 0.4, 0.45, true],
];

// ------------------------------------------------------------- emit
export const junctions = (() => {
  const out = { J_HALL: P(0, 0) };   // the one self-mirrored junction
  for (const [k, v] of Object.entries(WEST_JUNCTIONS)) {
    out[k] = v;
    out[MIRROR_J[k]] = M(v);
  }
  return out;
})();

// The mirror map is authored west→east; the pairing is an involution, so the
// lookup has to work both ways — L_GAL_W ends on J_GAL_S (an EAST junction,
// because the west stair tops out on the ring's south arc) and its mirror has
// to resolve that back to J_GAL_N.
const MIRROR_BOTH = (() => {
  const m = { J_HALL: "J_HALL" };
  for (const [k, v] of Object.entries(MIRROR_J)) { m[k] = v; m[v] = k; }
  return m;
})();
const mirrorName = (id) => MIRROR_BOTH[id] || null;

export const lanes = (() => {
  const out = [];
  for (const [wid, eid, a, b, wp, band, exposure, cover, vertical] of WEST_LANES) {
    out.push({
      id: wid, a, b,
      wp: wp.map((p) => P(p[0], p[1], p.length > 2 ? p[2] : 0)),
      band: band.slice(), exposure, cover, vertical: !!vertical,
      botTraversable: true, throughGoing: true,
    });
    out.push({
      id: eid, a: mirrorName(a), b: mirrorName(b),
      wp: wp.map((p) => M(P(p[0], p[1], p.length > 2 ? p[2] : 0))),
      band: band.slice(), exposure, cover, vertical: !!vertical,
      botTraversable: true, throughGoing: true,
    });
  }
  return out;
})();

// The lanes that serve each flag stand. Three per side, one per door of the
// room — an attacker who is held on one can always try another, and a defender
// who commits to one has left two open.
export const approaches = {
  A_STAND: ["L_SALT_N", "L_SALT_S", "L_SALT_E"],      // FLAG_WEST  (the salt store)
  B_STAND: ["L_WEIGH_S", "L_WEIGH_N", "L_WEIGH_W"],   // FLAG_EAST  (the weigh house)
};

export default { junctions, lanes, approaches };
