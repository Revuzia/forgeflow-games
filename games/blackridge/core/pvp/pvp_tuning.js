// core/pvp/pvp_tuning.js [W1] — the PVP balance seam (PVP_BUILD_PLAN C25).
// THREE-free, Node-safe, data only.
//
// createSim({tuning:'sp'|'pvp'}) resolves one of these tables onto sim.tuning;
// sim.js / damage.js read the table instead of their old inline constants.
//
// ⚠ THE 'pvp' SET IS DELIBERATELY AN IDENTITY COPY OF 'sp' IN WAVE 1 (C25):
// the concurrent aim wave is taking before/after measurements against the
// live weapon/health constants, and changing them mid-investigation would
// confound two investigations at once. The real deltas — 110 HP, regen
// 5.0 s @ 28 HP/s, steadyMult 0.55→1.00, the four recoil-jitter cuts,
// Corvus adsTime 340→380 ms + settle 0.35 s, scoped flinch ×2, scope glint,
// tac-sprint 4.0→2.5 s, grenades 2→1 — land in WAVE 5 (lane W11) as a DATA
// FLIP in this file, not a refactor. sim.selftest.cjs --pvp asserts the
// identity holds until then.
//
// Fields consumed today (sim.js / damage.js):
//   maxHp            — every actor, human and bot alike (no HP inflation
//                      between actors, ever — AC-38; the VALUE may change
//                      in wave 5, the equality across actors may not)
//   regenDelayS      — player regen delay from last damage
//   regenPerS        — player regen rate
//   botRetreatRegenMult — bots regen only in 'retreat', at this × regenPerS
//   grenades         — loadout default when content doesn't author one
//   weaponDeltas     — per-weapon-id shallow overrides (EMPTY until wave 5;
//                      W11 applies them where WEAPONS is consumed)

const SP = {
  id: "sp",
  maxHp: 100,
  regenDelayS: 4.5,
  regenPerS: 35,
  botRetreatRegenMult: 0.7,
  grenades: 2,
  weaponDeltas: {},
};

// IDENTITY delta set (C25). Wave 5 flips the data here — nothing else moves.
const PVP = {
  ...SP,
  id: "pvp",
  weaponDeltas: {},
};

export const TUNINGS = { sp: SP, pvp: PVP };

export function getTuning(id) {
  return TUNINGS[id === "pvp" ? "pvp" : "sp"];
}
