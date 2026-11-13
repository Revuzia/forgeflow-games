// core/sim/perks.js — perk effects that need their own hook, THREE-free.
// Most perks are a one-line read at the point they modify (see PERK_FX in
// classes.js for every number and the list of read sites):
//   flak        grenades.js explode()         explosive damage taken ×0.6
//   doubleTime  player.js tac drain + crouch  tac 4 s → 8 s, crouch ×1.25 (bots: crouch)
//   fastHands   player.js stepActorWeapon     reload/swap clock runs ×1/0.75
//   deadsilence ai/perception.js footsteps    hearing radius ×0.35; step event quiet:true
//   ghost       streaks.js hostiles()         not a Signal Sweep contact
//   hardline    streaks.js onDeath            thresholds 3/5/7/10 → 2/4/6/9
//   quickfix    damage.js stepHealth          regen delay ×0.5; bot retreat regen ×1.5
//   scavenger   HERE (death hook, sim.emit)   ammo + lethal from every enemy kill
// Deterministic: no rng, only the death event and body state.

import { hasPerk, PERK_FX } from "./classes.js";

function bodyOf(sim, who) {
  if (who === "P") return sim.state.player;
  return sim.state.bots.find((b) => b.id === who) || null;
}

function enemies(sim, a, b) {
  if (a == null || b == null || a === b) return false;
  if (sim.match && typeof sim.match.sameTeam === "function") return !sim.match.sameTeam(a, b);
  const A = bodyOf(sim, a), B = bodyOf(sim, b);
  return !!(A && B && (A.team | 0) !== (B.team | 0));
}

// SALVAGER: the killer strips a magazine for every gun they carry (never past
// that gun's reserve+mag cap) and restocks one lethal (never past the kit's
// count). Emits the existing match "resupply" event — no new vocabulary.
export function scavenge(sim, body, who) {
  const fx = PERK_FX.scavenger;
  const weapons = sim.weapons || {};
  const w = body.weapon;
  let gained = 0;
  for (const id of body.slots || []) {
    if (!id) continue;
    const wt = weapons[id];
    if (!wt) continue;
    const store = w && w.id === id ? w : (body._slotAmmo && body._slotAmmo[id]);
    if (!store) continue;
    const cap = wt.reserve + wt.mag;
    const give = Math.max(0, Math.min(wt.mag * fx.mags, cap - store.reserve));
    if (give > 0) {
      store.reserve += give;
      gained += give;
      if (w && w.id === id && body._slotAmmo) body._slotAmmo[id] = { mag: w.mag, reserve: w.reserve };
    }
  }
  const maxL = body.kit ? body.kit.lethalCount | 0 : 0;
  let lethal = 0;
  if ((body.grenades | 0) < maxL) {
    lethal = Math.min(fx.lethal, maxL - (body.grenades | 0));
    body.grenades = (body.grenades | 0) + lethal;
  }
  if (gained > 0 || lethal > 0) {
    sim.emit("resupply", { who, mags: fx.mags, reason: "scavenger", rounds: gained, lethal });
    return true;
  }
  return false;
}

export function perksOnDeath(sim, d) {
  if (!d || d.attacker == null || d.victim == null || d.attacker === d.victim) return;
  if (!enemies(sim, d.attacker, d.victim)) return;
  const killer = bodyOf(sim, d.attacker);
  if (!killer || !killer.alive || !hasPerk(killer, "scavenger")) return;
  scavenge(sim, killer, d.attacker);
}
