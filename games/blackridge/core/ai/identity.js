// core/ai/identity.js [identity lane] — the ONE install point that turns a PVP
// sim's nine combatants into nine distinct operators. runtime/boot.js calls
// these two functions around createSim; headless selftests never do, so
// `sim.identity` stays unset there and botfsm / kits are byte-identical.
//
//   identityEmit(getSim, emit)  wraps the sim's outbound emit: on
//       "match:start" (the roster exists, nobody has spawned yet) it re-deals
//       roles inside each team by personality (personality.assignRoles).
//   installIdentity(sim, {seed, tier, weapons})  fixes the match's hidden
//       operator tier (core/ai/adaptive.js) on sim.identity and hooks the
//       opponent-class kit (personality.personalClass over classes.js
//       opponentClass — the hook parameter, classes.js itself is untouched).
//
// Both are fixed at match start from (seed, callsign, saved estimate):
// nothing here changes during a tick.

import { opponentClass, resolveKit } from "../sim/classes.js";
import { assignRoles, personalityOf, personalClass } from "./personality.js";
import { EXPERT_TIER } from "./adaptive.js";

export function identityEmit(getSim, emit) {
  return (type, d) => {
    if (type === "match:start") {
      try {
        const s = getSim();
        if (s && s.identity && s.state && s.state.match) assignRoles(s.state.match.actors);
      } catch (_) { /* identity never blocks a match */ }
    }
    emit(type, d);
  };
}

export function installIdentity(sim, o = {}) {
  if (!sim) return null;
  const tier = Number.isInteger(o.tier) ? o.tier : EXPERT_TIER;
  sim.identity = { tier };
  const orig = sim.kitForActor;
  if (typeof orig === "function" && o.weapons) {
    const seed = (o.seed | 0) >>> 0;
    sim.kitForActor = (actor) => {
      const k = orig.call(sim, actor);
      if (!k || !actor || !actor.name) return k;
      try {
        const base = opponentClass(seed, actor.actorId | 0, actor.archetype);
        return resolveKit(personalClass(base, personalityOf(actor.name), actor.archetype), { weapons: o.weapons, classId: "op" });
      } catch (_) { return k; }
    };
  }
  return sim.identity;
}
