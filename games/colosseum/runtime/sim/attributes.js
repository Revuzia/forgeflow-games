// Colosseum — attributes, training and fatigue.
//
// DESIGN RULE: no attribute may be cosmetic. Every point of every stat modifies
// a number that combat.js or weapons.js already uses, so "I trained Strength"
// has to be visible in the next bout or the system is a spreadsheet.
//
// DESIGN RULE 2: training must be a DECISION, not a grind. The failure mode in
// this genre is a menu you click twenty times between fights. So:
//   * you get a small, fixed number of training slots between matches
//   * every regimen costs gold AND fatigue, and fatigue follows you onto the
//     sand — over-train and you fight worse than if you had rested
//   * gains have hard diminishing returns and a rank-gated ceiling, so you
//     cannot farm a Tiro into a Legend by repeating the cheapest bout
// The interesting question is therefore never "should I train?" but "which
// two of these five, and can I afford the fatigue before a champion bout?"

import { clamp } from "../core/util.js";

/** The four attributes. `desc` is what the player is told; `effect` is the truth. */
export const ATTRIBUTES = {
  strength: {
    id: "strength", name: "Strength", latin: "Vis",
    desc: "Raw power. Heavier blows, and armour weighs on you less.",
    effect: "+3.2% damage per point; carried weight counts ~4% less per point",
  },
  endurance: {
    id: "endurance", name: "Endurance", latin: "Robur",
    desc: "Wind and toughness. More life, more stamina, faster recovery.",
    effect: "+2.5% max HP, +2.2% stamina pool and +3% stamina regen per point",
  },
  agility: {
    id: "agility", name: "Agility", latin: "Celeritas",
    desc: "Footwork. You move, turn and dodge faster, and dodge further.",
    effect: "+1.8% move speed, +2.5% dodge distance, +2% turn rate per point",
  },
  skill: {
    id: "skill", name: "Skill", latin: "Ars",
    desc: "Craft. Your blade comes round sooner and your guard reads truer.",
    effect: "-1.6% attack windup, +3% parry window, +2% chance to strike a weak point per point",
  },
};

export const ATTR_IDS = Object.keys(ATTRIBUTES);

export const ATTR_MIN = 5;
export const ATTR_MAX = 25;

/**
 * Rank-gated ceiling. A Tiro cannot train himself into a Legend by grinding the
 * easiest bout — the ladder has to be climbed for the ceiling to rise.
 */
export const RANK_CAP = {
  tiro: 9, gregarius: 12, veteranus: 15, primus: 18, champion: 21, legend: ATTR_MAX,
};

/**
 * XP needed to go from `level` to `level+1`. Superlinear, so early points are
 * cheap and the last few are a genuine investment.
 */
export function xpForNext(level) {
  return Math.round(40 + Math.pow(Math.max(0, level - ATTR_MIN), 1.55) * 26);
}

// ---------------------------------------------------------------------------
// Training regimens
// ---------------------------------------------------------------------------

/**
 * `fatigue` is the real cost. `xp` is split across `gives`, so cross-training
 * regimens are efficient in total but slower to raise any single stat.
 */
export const REGIMENS = {
  palus: {
    id: "palus", name: "The Palus", latin: "Ad palum",
    desc: "Hours against the wooden post with a weighted sword. The oldest drill there is.",
    gives: { strength: 0.7, skill: 0.3 }, xp: 58, gold: 25, fatigue: 22,
  },
  sandbag: {
    id: "sandbag", name: "Weighted Sacks", latin: "Sacci",
    desc: "Lifting and carrying sand until your arms shake. Nobody enjoys it.",
    gives: { strength: 1.0 }, xp: 62, gold: 20, fatigue: 28,
  },
  running: {
    id: "running", name: "The Long Run", latin: "Cursus",
    desc: "Circuits of the ludus yard in full kit until the breath comes even.",
    gives: { endurance: 0.75, agility: 0.25 }, xp: 55, gold: 15, fatigue: 20,
  },
  breathing: {
    id: "breathing", name: "Wind Work", latin: "Anhelitus",
    desc: "Held breath, slow lifts, the doctor's regimen for a gladiator who gasses out.",
    gives: { endurance: 1.0 }, xp: 60, gold: 30, fatigue: 16,
  },
  footwork: {
    id: "footwork", name: "Footwork Drill", latin: "Gradus",
    desc: "Chalk lines on the sand and a lanista who shouts when you cross them.",
    gives: { agility: 1.0 }, xp: 60, gold: 25, fatigue: 18,
  },
  sparring: {
    id: "sparring", name: "Sparring", latin: "Lusio",
    desc: "Blunted blades against a fellow of the school. The closest thing to the real sand.",
    gives: { skill: 0.6, agility: 0.2, endurance: 0.2 }, xp: 70, gold: 45, fatigue: 30,
  },
  forms: {
    id: "forms", name: "Forms and Guards", latin: "Disciplina",
    desc: "Slow repetition of the guards until the body stops asking the mind.",
    gives: { skill: 1.0 }, xp: 58, gold: 35, fatigue: 14,
  },
  rest: {
    id: "rest", name: "Rest", latin: "Quies",
    desc: "Oil, the baths, and a day off the sand. Sometimes the wisest training there is.",
    gives: {}, xp: 0, gold: 0, fatigue: -45,
  },
  massage: {
    id: "massage", name: "The Physician", latin: "Medicus",
    desc: "The ludus doctor works the knots out. Expensive, and worth it before a champion.",
    gives: {}, xp: 0, gold: 55, fatigue: -80,
  },
};

/** Training slots available between matches. Small on purpose. */
export const SLOTS_PER_MATCH = 3;

/** Fatigue above this starts to bite. */
export const FATIGUE_SOFT = 40;
export const FATIGUE_MAX = 100;

// ---------------------------------------------------------------------------
// Attributes model
// ---------------------------------------------------------------------------

export class Attributes {
  constructor(data = null) {
    this.levels = {};
    this.xp = {};
    for (const id of ATTR_IDS) { this.levels[id] = ATTR_MIN; this.xp[id] = 0; }
    this.fatigue = 0;
    this.slots = SLOTS_PER_MATCH;
    this.history = [];
    if (data) this.load(data);
  }

  cap(rankId) { return RANK_CAP[rankId] || RANK_CAP.tiro; }

  /**
   * Effective level after fatigue. Fatigue does NOT reduce the stat you trained
   * — it reduces what you can bring to the sand today, which is the whole point
   * of making it a cost.
   */
  effective(id) {
    const base = this.levels[id] || ATTR_MIN;
    if (this.fatigue <= FATIGUE_SOFT) return base;
    const over = (this.fatigue - FATIGUE_SOFT) / (FATIGUE_MAX - FATIGUE_SOFT);
    // At maximum fatigue a fighter performs as though he had trained nothing.
    return Math.max(ATTR_MIN, base - (base - ATTR_MIN) * clamp(over, 0, 1) - over * 2.5);
  }

  /** All four effective levels, for the combat layer. */
  effectiveAll() {
    const o = {};
    for (const id of ATTR_IDS) o[id] = this.effective(id);
    return o;
  }

  /**
   * Train one regimen.
   * @returns {{ok, reason?, gained?, fatigue?, levelUps?}}
   */
  train(regimenId, { gold = 0, rankId = "tiro", spend = null } = {}) {
    const r = REGIMENS[regimenId];
    if (!r) return { ok: false, reason: "no such regimen" };
    if (this.slots <= 0) return { ok: false, reason: "no training slots left before the next bout" };
    if (r.gold > gold) return { ok: false, reason: "not enough gold", short: r.gold - gold };

    if (spend) spend(r.gold);
    this.slots--;
    this.fatigue = clamp(this.fatigue + r.fatigue, 0, FATIGUE_MAX);

    const cap = this.cap(rankId);
    const gained = {};
    const levelUps = [];
    for (const [attr, share] of Object.entries(r.gives)) {
      if (this.levels[attr] >= cap) { gained[attr] = 0; continue; }
      const amount = Math.round(r.xp * share);
      this.xp[attr] += amount;
      gained[attr] = amount;
      // Spend accumulated XP into levels, respecting the rank ceiling.
      while (this.levels[attr] < cap && this.xp[attr] >= xpForNext(this.levels[attr])) {
        this.xp[attr] -= xpForNext(this.levels[attr]);
        this.levels[attr]++;
        levelUps.push(attr);
      }
      if (this.levels[attr] >= cap) this.xp[attr] = 0;   // no banking past the cap
    }

    this.history.push({ regimen: regimenId, gained, fatigue: this.fatigue });
    if (this.history.length > 60) this.history.shift();
    return { ok: true, gained, levelUps, fatigue: this.fatigue, slots: this.slots, cost: r.gold };
  }

  /** Called when a match is settled: refresh slots, bleed some fatigue. */
  onMatchComplete() {
    this.slots = SLOTS_PER_MATCH;
    this.fatigue = clamp(this.fatigue - 18, 0, FATIGUE_MAX);
  }

  /** A bout is exhausting in its own right. */
  addMatchFatigue(amount = 22) {
    this.fatigue = clamp(this.fatigue + amount, 0, FATIGUE_MAX);
  }

  /** Progress toward the next point, for the UI. */
  progress(id) {
    const need = xpForNext(this.levels[id]);
    return { xp: this.xp[id], need, frac: clamp(this.xp[id] / need, 0, 1) };
  }

  toJSON() {
    return { levels: { ...this.levels }, xp: { ...this.xp }, fatigue: this.fatigue, slots: this.slots };
  }

  load(d) {
    if (!d) return;
    for (const id of ATTR_IDS) {
      const lv = d.levels && d.levels[id];
      this.levels[id] = Number.isFinite(lv) ? clamp(Math.round(lv), ATTR_MIN, ATTR_MAX) : ATTR_MIN;
      const x = d.xp && d.xp[id];
      this.xp[id] = Number.isFinite(x) && x >= 0 ? x : 0;
    }
    this.fatigue = Number.isFinite(d.fatigue) ? clamp(d.fatigue, 0, FATIGUE_MAX) : 0;
    this.slots = Number.isFinite(d.slots) ? clamp(d.slots, 0, SLOTS_PER_MATCH) : SLOTS_PER_MATCH;
  }
}

// ---------------------------------------------------------------------------
// The modifiers — where attributes actually touch the fight
// ---------------------------------------------------------------------------

/**
 * Turn effective attribute levels into multipliers applied on top of the
 * weight-derived mobility profile.
 *
 * Everything is expressed relative to ATTR_MIN, so a fresh fighter with 5 in
 * everything gets exactly the numbers the game had before attributes existed —
 * which is what keeps the existing balance and probes valid.
 */
export function modifiers(effLevels) {
  const d = (id) => Math.max(0, (effLevels[id] || ATTR_MIN) - ATTR_MIN);
  return {
    damage: 1 + d("strength") * 0.032,
    // Strength makes your kit feel lighter without making it weigh less — the
    // trade-off stays, it just moves.
    weightRelief: 1 - Math.min(0.55, d("strength") * 0.04),
    maxHp: 1 + d("endurance") * 0.025,
    staminaMax: 1 + d("endurance") * 0.022,
    staminaRegen: 1 + d("endurance") * 0.030,
    moveSpeed: 1 + d("agility") * 0.018,
    dodgeDistance: 1 + d("agility") * 0.025,
    turnRate: 1 + d("agility") * 0.020,
    windup: 1 - Math.min(0.42, d("skill") * 0.016),
    parryWindow: 1 + d("skill") * 0.030,
    weakPoint: d("skill") * 0.02,
  };
}

/** Neutral modifiers — used wherever a fighter has no attributes (AI, tests). */
export function neutralModifiers() {
  const base = {};
  for (const id of ATTR_IDS) base[id] = ATTR_MIN;
  return modifiers(base);
}
