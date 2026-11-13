// core/rng.js [A0] — deterministic RNG streams (architecture §3.2).
// One mulberry32 stream per system so replaying any one system from a seed
// never depends on how often another system rolled (doctrine §4/§6).
// THREE-free, Node-safe (sim selftests import this).

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Independent streams derived from one seed with fixed offsets — creating a
// stream never advances another. `spread` = weapon spread/recoil rolls,
// `ai` = every bot decision, `mission` = spawn/wave rolls (retained — the
// campaign driver uses it; PVP_BUILD_PLAN C26), `fx` = view-side cosmetic
// randomness (may NEVER feed back into sim state).
//
// PVP additions (PVP_BUILD_PLAN C26 / Part 3.10f — same mulberry32
// construction, fixed offsets, so creating them never advances an existing
// stream and every pre-PVP seeded battery replays bit-identically):
//   `match` = match-driver rolls (mode modules draw ONLY from this; callsign
//             draw per modes.md §1.1 uses it),
//   `spawn` = spawn-director scoring noise (C8's +6 × rng.spawn() term),
//   `obj`   = the objective layer (W7). Load-bearing: a shared stream would
//             shift downstream reaction/jitter rolls and make the AC-32
//             monotonicity assertion impossible to write.
export function makeStreams(seed) {
  const s = seed >>> 0;
  return {
    spread: mulberry32(s ^ 0x9e3779b9),
    ai: mulberry32(s ^ 0x85ebca6b),
    mission: mulberry32(s ^ 0xc2b2ae35),
    fx: mulberry32(s ^ 0x27d4eb2f),
    match: mulberry32(s ^ 0x165667b1),
    spawn: mulberry32(s ^ 0xd3a2646c),
    obj: mulberry32(s ^ 0xfd7046c5),
  };
}
