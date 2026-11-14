// core/level/lanes/_stub.js [W4 — PVP_BUILD_PLAN Part 4.2]
// Wave-1 LANE-GRAPH STUB: a four-junction ring on the un-carved plaza, so
// W7's objective layer can build and test against the real schema from day
// one. `objective.js` imports by `arena.id` with `_stub` as the fallback.
// Same export shape as lanternwalk.js — {junctions, lanes, approaches}.
// THREE-free, data only.

export const junctions = {
  J_S: [-5, 0, 10],
  J_W: [-20, 0, 0],
  J_N: [-5, 0, -14],
  J_E: [10, 0, 0],
};

export const lanes = [
  { id: "L_SW", a: "J_S", b: "J_W", wp: [[-5, 0, 10], [-13, 0, 6], [-20, 0, 0]],
    band: [8, 18], exposure: 0.6, cover: 0.5, vertical: false, botTraversable: true, throughGoing: true },
  { id: "L_WN", a: "J_W", b: "J_N", wp: [[-20, 0, 0], [-14, 0, -8], [-5, 0, -14]],
    band: [8, 18], exposure: 0.6, cover: 0.5, vertical: false, botTraversable: true, throughGoing: true },
  { id: "L_NE", a: "J_N", b: "J_E", wp: [[-5, 0, -14], [3, 0, -8], [10, 0, 0]],
    band: [8, 18], exposure: 0.6, cover: 0.5, vertical: false, botTraversable: true, throughGoing: true },
  { id: "L_ES", a: "J_E", b: "J_S", wp: [[10, 0, 0], [3, 0, 6], [-5, 0, 10]],
    band: [8, 18], exposure: 0.6, cover: 0.5, vertical: false, botTraversable: true, throughGoing: true },
];

export const approaches = {
  A_STAND: ["L_SW", "L_WN"],
  B_STAND: ["L_NE", "L_ES"],
};

export default { junctions, lanes, approaches };
