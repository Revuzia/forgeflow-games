// core/pvp/pvp_tuning.js [W1 seam · W11 data] — the PVP balance seam
// (PVP_BUILD_PLAN C25). THREE-free, Node-safe, data only.
//
// createSim({tuning:'sp'|'pvp'}) resolves one of these tables onto sim.tuning;
// sim.js / damage.js read the table instead of their old inline constants,
// and sim.js resolves applyTuning(weapons, tun) so per-weapon deltas ride the
// sim's own weapons table (ballistics/player read sim.weapons entries).
//
// W11 (wave 5, aim wave verified green): THE DATA FLIP LANDED. The 'pvp' set
// is no longer an identity copy — it carries the C25 deltas, sourced from
// pvp_design.md PART 4 / modes.md §1.6:
//   maxHp 100 → 110          — kills exactly the two sub-reaction TTKs
//                              (Vesper 200 ms melt → 267 ms; Pike 158 ms
//                              two-headshot → 316 ms); Warden/Corvus rows
//                              unchanged (§4.1 table)
//   regen 4.5 s @ 35 → 5.0 s @ 28 HP/s — the punish window (§4.2)
//   botRetreatRegenMult 0.7 → 0.875    — bot retreat regen stays 24.5 HP/s
//                              (§4.2 "unchanged": 28 × 0.875 = 24.5)
//   steadyMult 0.55 → 1.00   — the camping subsidy is removed (§4.3 B1);
//                              consumed by ballistics.effectiveSpread via
//                              the spread-state builders
//   recoil jitter cuts (§4.3 B2): warden .12→.08, vesper .18→.12,
//                              corvus .10→.06, pike .15→.10 — the pattern
//                              stays hard, it stops being random
//   Corvus adsTime 340→380 ms (§4.3 B3) — the DMR loses the peek-and-tap win
//   Corvus adsSettleS 0.35   — DATA ONLY for now: FEEL.adsSettleS is consumed
//                              view-side (viewmodel.js) with no per-weapon or
//                              per-mode seam; wiring it is flagged in the W11
//                              lane report, not silently absorbed
//   grenades 2 → 1 (§4.4 B13) — loadout default when content doesn't author
//
// NOT in this table, per the W11 lane brief (named remaining work, owners in
// the lane report): scoped flinch ×2 (§4.3 B5, damage/view seam), scope glint
// (§4.3 B6, fx), tac-sprint 2.5 s (§4.4 B9, player.js MOVE constants).
//
// Fields consumed today (sim.js / damage.js):
//   maxHp            — every actor, human and bot alike (no HP inflation
//                      between actors, ever — AC-38; the VALUE changed in
//                      wave 5, the equality across actors did not)
//   regenDelayS      — player regen delay from last damage
//   regenPerS        — player regen rate
//   botRetreatRegenMult — bots regen only in 'retreat', at this × regenPerS
//   steadyMult       — stationary-accuracy multiplier (1.0 = no bonus);
//                      ballistics spread-state builders read it
//   grenades         — loadout default when content doesn't author one
//   weaponDeltas     — per-weapon-id overrides, applied by applyTuning()
//                      (sim.js resolves the merged table at createSim)

const SP = {
  id: "sp",
  maxHp: 100,
  regenDelayS: 4.5,
  regenPerS: 35,
  botRetreatRegenMult: 0.7,
  steadyMult: 0.55,
  grenades: 2,
  weaponDeltas: {},
};

// The C25 delta set (wave 5 — W11). Numbers per pvp_design §4.1–4.4.
const PVP = {
  ...SP,
  id: "pvp",
  maxHp: 110,
  regenDelayS: 5.0,
  regenPerS: 28,
  botRetreatRegenMult: 0.875, // 28 × 0.875 = 24.5 HP/s — §4.2 "unchanged"
  steadyMult: 1.0,
  grenades: 1,
  weaponDeltas: {
    warden: { recoil: { jitter: 0.08 } },
    vesper: { recoil: { jitter: 0.12 } },
    corvus: { recoil: { jitter: 0.06 }, adsTime: 0.380, adsSettleS: 0.35 },
    pike: { recoil: { jitter: 0.10 } },
  },
};

export const TUNINGS = { sp: SP, pvp: PVP };

export function getTuning(id) {
  return TUNINGS[id === "pvp" ? "pvp" : "sp"];
}

// ---------------------------------------------------------------- applyTuning
// pvp_design §4.0: ONE fork point, not a forked table. Returns the weapons
// table with tuning.weaponDeltas merged one level deep (top-level scalar
// fields replace; object fields shallow-merge). CONTRACT:
//   - NO deltas → returns the INPUT REFERENCE untouched, so the campaign
//     ('sp') path is bit-identical to the untuned WEAPONS export (§4.5's
//     honesty assertion) and no probe sees a copy where it held a reference.
//   - deltas → a NEW table; the input is never mutated. Un-overridden weapon
//     entries keep their original references (patterns, view blocks shared).
export function applyTuning(weapons, tuning) {
  const deltas = tuning && tuning.weaponDeltas;
  if (!deltas || !Object.keys(deltas).length) return weapons;
  const out = { ...weapons };
  for (const id of Object.keys(deltas)) {
    const base = weapons[id];
    if (!base) continue; // contract gate owns unknown-weapon errors, not here
    const d = deltas[id];
    const merged = { ...base };
    for (const k of Object.keys(d)) {
      const v = d[k];
      merged[k] = (v && typeof v === "object" && !Array.isArray(v) &&
                   base[k] && typeof base[k] === "object" && !Array.isArray(base[k]))
        ? { ...base[k], ...v }
        : v;
    }
    out[id] = merged;
  }
  return out;
}
