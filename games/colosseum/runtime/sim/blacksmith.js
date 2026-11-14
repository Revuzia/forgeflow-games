// Colosseum — the blacksmith: condition, repair and reinforcement.
//
// Built from what the reference games actually got right and wrong:
//
//  * Colosseum: Road to Freedom was reviewed as "a slave to the grind" — you
//    fight the same battle a hundred times for items that let you fight more of
//    the same. Its worse sin was a reward function that PUNISHED competent play:
//    the crowd paid for evasion and long combos but not for winning decisively.
//    So nothing here rewards dragging a fight out.
//  * Gladiator Begins let you REINFORCE gear, and combining pieces could REDUCE
//    WEIGHT — upgrades traded against an encumbrance budget instead of being
//    strictly better. That is the model used here.
//  * We Who Are About To Die keeps training, gear and MEDICAL CARE competing for
//    one purse, so spending is a real budget decision under injury pressure.
//    Repair costs here are deliberately sized to bite against training costs.
//
// THE RULE: no upgrade may be strictly better. Every reinforcement path trades
// one axis against another, so "should I?" is a real question at every tier.

import { WEAPONS, SHIELDS, ARMOUR } from "../data/weapons.js";
import { clamp } from "../core/util.js";

/** Condition bands. Gear does not break outright — it degrades and tells you. */
export const CONDITION = [
  { id: "pristine", min: 0.90, name: "Pristine", mult: 1.00, note: "As the smith made it." },
  { id: "keen", min: 0.70, name: "Keen", mult: 0.97, note: "Well used, well kept." },
  { id: "worn", min: 0.45, name: "Worn", mult: 0.90, note: "Notched. It still bites." },
  { id: "battered", min: 0.20, name: "Battered", mult: 0.78, note: "Bent and blunted. You feel it." },
  { id: "ruined", min: 0.00, name: "Ruined", mult: 0.58, note: "Barely a weapon. Fix it before you die holding it." },
];

export function conditionOf(frac) {
  for (const c of CONDITION) if (frac >= c.min) return c;
  return CONDITION[CONDITION.length - 1];
}

/**
 * Reinforcement paths. Each ADDS something and COSTS something else — this is
 * the whole design. `tiers` is how many times a path may be applied.
 */
export const REINFORCEMENTS = {
  weighted: {
    id: "weighted", name: "Weighted Core", kinds: ["weapon"],
    desc: "The smith packs the tang and thickens the spine. It hits harder and it drags.",
    tiers: 3, cost: 140, costGrowth: 1.6,
    effect: { damage: +0.09, weight: +0.35, windup: +0.04 },
    blurb: "+9% damage · +0.35 kg · +4% slower to swing",
  },
  balanced: {
    id: "balanced", name: "Rebalanced", kinds: ["weapon"],
    desc: "Metal comes off the blade and goes into the pommel. Faster, and it bites less.",
    tiers: 3, cost: 120, costGrowth: 1.55,
    effect: { damage: -0.05, weight: -0.18, windup: -0.07 },
    blurb: "-5% damage · -0.18 kg · 7% faster to swing",
  },
  honed: {
    id: "honed", name: "Honed Edge", kinds: ["weapon"],
    desc: "A finer edge that finds the gaps in armour — and dulls faster for it.",
    tiers: 2, cost: 190, costGrowth: 1.7,
    effect: { pierce: +0.10, wearRate: +0.45 },
    blurb: "+10% armour pierce · wears 45% faster",
  },
  faced: {
    id: "faced", name: "Faced with Iron", kinds: ["shield"],
    desc: "An iron facing over the boards. It survives more and it hangs heavier.",
    tiers: 3, cost: 130, costGrowth: 1.6,
    effect: { integrity: +0.22, weight: +0.5 },
    blurb: "+22% shield integrity · +0.5 kg",
  },
  lightened: {
    id: "lightened", name: "Lightened", kinds: ["shield", "armour"],
    desc: "Thinner plate, drilled and pared back. You move — and you cover less.",
    tiers: 2, cost: 165, costGrowth: 1.7,
    effect: { weight: -0.9, protection: -0.07, integrity: -0.12 },
    blurb: "-0.9 kg · 7% less protection",
  },
  hardened: {
    id: "hardened", name: "Case-Hardened", kinds: ["armour"],
    desc: "Quenched and case-hardened. It turns more, and it is heavier for it.",
    tiers: 3, cost: 175, costGrowth: 1.65,
    effect: { protection: +0.10, weight: +0.7 },
    blurb: "+10% protection · +0.7 kg",
  },
};

/** How fast each kind wears, per point of damage dealt or taken. */
const WEAR = { weapon: 0.00055, shield: 0.00120, armour: 0.00070 };

// ---------------------------------------------------------------------------

export class Smithy {
  /**
   * @param {object} data persisted condition/reinforcement state
   */
  constructor(data = null) {
    this.condition = {};      // itemId -> 0..1
    this.reinforce = {};      // itemId -> { pathId: tier }
    if (data) this.load(data);
  }

  _kindOf(id) {
    if (WEAPONS[id]) return "weapon";
    if (SHIELDS[id]) return "shield";
    if (ARMOUR[id]) return "armour";
    return null;
  }

  _def(id) { return WEAPONS[id] || SHIELDS[id] || ARMOUR[id] || null; }

  /** Condition of an item, defaulting to pristine for anything never used. */
  cond(id) {
    return this.condition[id] === undefined ? 1 : clamp(this.condition[id], 0, 1);
  }

  tiersOn(id, pathId) { return (this.reinforce[id] || {})[pathId] || 0; }

  /**
   * The net stat modifiers for one item: reinforcement effects, then condition.
   * Condition multiplies the OUTPUT, so a ruined masterwork is still worse than
   * a pristine plain blade — maintenance is never optional.
   */
  modifiersFor(id) {
    const kind = this._kindOf(id);
    if (!kind) return null;
    const m = { damage: 1, weight: 0, windup: 1, pierce: 0, protection: 1, integrity: 1, wearRate: 1 };
    const paths = this.reinforce[id] || {};
    for (const [pathId, tier] of Object.entries(paths)) {
      const p = REINFORCEMENTS[pathId];
      if (!p) continue;
      for (let t = 0; t < tier; t++) {
        const e = p.effect;
        if (e.damage) m.damage += e.damage;
        if (e.weight) m.weight += e.weight;
        if (e.windup) m.windup += e.windup;
        if (e.pierce) m.pierce += e.pierce;
        if (e.protection) m.protection += e.protection;
        if (e.integrity) m.integrity += e.integrity;
        if (e.wearRate) m.wearRate += e.wearRate;
      }
    }
    // Condition degrades the business end, not the weight — a battered shield is
    // just as heavy.
    const c = conditionOf(this.cond(id)).mult;
    m.damage *= c;
    m.protection = 1 - (1 - m.protection) * 1;      // protection is a multiplier on zone values
    m.integrity *= c;
    m.conditionMult = c;
    return m;
  }

  /** Effective weight of a loadout after reinforcement. */
  weightDelta(loadout) {
    let d = 0;
    for (const id of [loadout.weapon, loadout.shield, ...(loadout.armour || [])]) {
      if (!id || id === "none") continue;
      const m = this.modifiersFor(id);
      if (m) d += m.weight;
    }
    return +d.toFixed(2);
  }

  // -- wear ----------------------------------------------------------------

  /**
   * Apply a bout's worth of wear. Called once at settlement with the totals the
   * match already tracks, so nothing new has to be measured during combat.
   */
  wearFromMatch(loadout, { damageDealt = 0, damageTaken = 0, blocks = 0 } = {}) {
    const worn = {};
    const apply = (id, amount) => {
      if (!id || id === "none") return;
      const m = this.modifiersFor(id);
      const rate = m ? m.wearRate : 1;
      const before = this.cond(id);
      this.condition[id] = clamp(before - amount * rate, 0, 1);
      worn[id] = +(before - this.condition[id]).toFixed(4);
    };
    apply(loadout.weapon, damageDealt * WEAR.weapon);
    // A shield eats the blows it stops — it wears fastest, which is what makes
    // the smith a recurring cost rather than a one-off shop.
    apply(loadout.shield, blocks * WEAR.shield * 12 + damageTaken * WEAR.shield * 0.4);
    for (const a of loadout.armour || []) apply(a, damageTaken * WEAR.armour);
    return worn;
  }

  // -- services ------------------------------------------------------------

  /** Cost to bring one item back to pristine. Scales with its value. */
  repairCost(id) {
    const def = this._def(id);
    if (!def) return 0;
    const missing = 1 - this.cond(id);
    if (missing <= 0.001) return 0;
    const base = Math.max(40, (def.price || 100) * 0.55);
    return Math.max(8, Math.round(base * missing));
  }

  repair(id, gold, spend = null) {
    const cost = this.repairCost(id);
    if (cost === 0) return { ok: false, reason: "already pristine" };
    if (gold < cost) return { ok: false, reason: "not enough gold", short: cost - gold };
    if (spend) spend(cost);
    this.condition[id] = 1;
    return { ok: true, cost, id };
  }

  /** Cost of the NEXT tier of a reinforcement path on an item. */
  reinforceCost(id, pathId) {
    const p = REINFORCEMENTS[pathId];
    if (!p) return 0;
    const tier = this.tiersOn(id, pathId);
    return Math.round(p.cost * Math.pow(p.costGrowth, tier));
  }

  /** Which paths are legal for this item, with cost and current tier. */
  optionsFor(id) {
    const kind = this._kindOf(id);
    if (!kind) return [];
    return Object.values(REINFORCEMENTS)
      .filter((p) => p.kinds.includes(kind))
      .map((p) => {
        const tier = this.tiersOn(id, p.id);
        return {
          id: p.id, name: p.name, desc: p.desc, blurb: p.blurb,
          tier, maxTier: p.tiers,
          cost: this.reinforceCost(id, p.id),
          maxed: tier >= p.tiers,
        };
      });
  }

  /**
   * Apply one tier of a reinforcement. Requires the item to be in decent
   * condition — a smith will not put good work into a ruined piece.
   */
  applyReinforcement(id, pathId, gold, spend = null) {
    const p = REINFORCEMENTS[pathId];
    if (!p) return { ok: false, reason: "no such reinforcement" };
    const kind = this._kindOf(id);
    if (!kind || !p.kinds.includes(kind)) return { ok: false, reason: `cannot be applied to ${kind || "that"}` };
    const tier = this.tiersOn(id, pathId);
    if (tier >= p.tiers) return { ok: false, reason: "already at its limit" };
    if (this.cond(id) < 0.45) return { ok: false, reason: "too damaged — repair it first" };
    const cost = this.reinforceCost(id, pathId);
    if (gold < cost) return { ok: false, reason: "not enough gold", short: cost - gold };

    if (spend) spend(cost);
    this.reinforce[id] = this.reinforce[id] || {};
    this.reinforce[id][pathId] = tier + 1;
    // Reworking metal takes something out of it.
    this.condition[id] = clamp(this.cond(id) - 0.08, 0, 1);
    return { ok: true, cost, tier: tier + 1, id, path: pathId };
  }

  /** A one-line summary for the UI. */
  describe(id) {
    const c = conditionOf(this.cond(id));
    const paths = Object.entries(this.reinforce[id] || {})
      .map(([pid, t]) => `${REINFORCEMENTS[pid]?.name || pid} ${"I".repeat(t)}`);
    return {
      condition: c.name, conditionNote: c.note, frac: +this.cond(id).toFixed(3),
      repairCost: this.repairCost(id),
      reinforcements: paths,
    };
  }

  toJSON() { return { condition: { ...this.condition }, reinforce: JSON.parse(JSON.stringify(this.reinforce)) }; }

  load(d) {
    if (!d) return;
    for (const [k, v] of Object.entries(d.condition || {})) {
      if (this._kindOf(k) && Number.isFinite(v)) this.condition[k] = clamp(v, 0, 1);
    }
    for (const [k, paths] of Object.entries(d.reinforce || {})) {
      if (!this._kindOf(k)) continue;                       // drop items that no longer exist
      const clean = {};
      for (const [pid, tier] of Object.entries(paths || {})) {
        const p = REINFORCEMENTS[pid];
        if (p && Number.isFinite(tier)) clean[pid] = clamp(Math.round(tier), 0, p.tiers);
      }
      if (Object.keys(clean).length) this.reinforce[k] = clean;
    }
  }
}
