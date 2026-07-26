// Colosseum — weapon and armour data.
//
// Data-driven so balance is one table, not scattered constants, and so the
// armoury UI, the AI's range logic and the combat resolver all read the same
// numbers. Every field is in real units: metres, seconds, kilograms.
//
// THE CENTRAL TRADE-OFF the brief asks for is mobility vs protection, and it is
// expressed here as `weight`. Weight is not flavour text: it feeds directly
// into move speed, stamina drain and recovery in combat.js, so buying the
// heaviest armour in the shop makes you measurably slower in a way the player
// feels within one bout.

/** Attack direction. Blocks only stop what they cover. */
export const DIR = { HIGH: "high", LEFT: "left", RIGHT: "right", THRUST: "thrust" };

/**
 * Weapon classes. Reach and windup are the two numbers that decide how a
 * matchup feels: a trident out-ranges a gladius by 1.3 m, so the retiarius
 * wins the spacing game unless the murmillo closes.
 */
export const WEAPONS = {
  gladius: {
    id: "gladius", name: "Gladius", kind: "sword", hands: 1,
    reach: 1.35, damage: 26, weight: 1.2,
    windup: 0.20, active: 0.11, recover: 0.30,   // seconds
    stamina: 12, poise: 14,
    dirs: [DIR.HIGH, DIR.LEFT, DIR.RIGHT, DIR.THRUST],
    // Thrusts beat armour; cuts are better against unarmoured flesh.
    armourPierce: { [DIR.THRUST]: 0.55, [DIR.HIGH]: 0.2, [DIR.LEFT]: 0.2, [DIR.RIGHT]: 0.2 },
    price: 0, tier: 0,
    desc: "The legionary short sword. Fast, forgiving, murderous in close.",
  },
  spatha: {
    id: "spatha", name: "Spatha", kind: "sword", hands: 1,
    reach: 1.62, damage: 32, weight: 1.8,
    windup: 0.27, active: 0.13, recover: 0.38,
    stamina: 16, poise: 18,
    dirs: [DIR.HIGH, DIR.LEFT, DIR.RIGHT, DIR.THRUST],
    armourPierce: { [DIR.THRUST]: 0.45, [DIR.HIGH]: 0.25, [DIR.LEFT]: 0.25, [DIR.RIGHT]: 0.25 },
    price: 320, tier: 1,
    desc: "A cavalry longsword. More reach than a gladius, slower to recover.",
  },
  sica: {
    id: "sica", name: "Sica", kind: "curved", hands: 1,
    reach: 1.18, damage: 23, weight: 0.9,
    windup: 0.16, active: 0.10, recover: 0.24,
    stamina: 9, poise: 10,
    dirs: [DIR.HIGH, DIR.LEFT, DIR.RIGHT],
    // The thraex's curved blade is made to reach AROUND a shield.
    shieldBypass: 0.35,
    armourPierce: { [DIR.HIGH]: 0.15, [DIR.LEFT]: 0.15, [DIR.RIGHT]: 0.15 },
    price: 260, tier: 1,
    desc: "The Thracian curve. Hooks past a shield rim to open the arm behind it.",
  },
  trident: {
    id: "trident", name: "Fuscina", kind: "polearm", hands: 2,
    reach: 2.65, damage: 30, weight: 2.4,
    windup: 0.30, active: 0.14, recover: 0.42,
    stamina: 15, poise: 22,
    dirs: [DIR.THRUST, DIR.HIGH, DIR.LEFT, DIR.RIGHT],
    armourPierce: { [DIR.THRUST]: 0.6, [DIR.HIGH]: 0.2, [DIR.LEFT]: 0.2, [DIR.RIGHT]: 0.2 },
    price: 380, tier: 2,
    desc: "The netman's trident. Enormous reach; helpless once you are inside it.",
  },
  hasta: {
    id: "hasta", name: "Hasta", kind: "polearm", hands: 2,
    reach: 2.35, damage: 27, weight: 2.0,
    windup: 0.26, active: 0.12, recover: 0.36,
    stamina: 13, poise: 19,
    dirs: [DIR.THRUST, DIR.HIGH],
    armourPierce: { [DIR.THRUST]: 0.65, [DIR.HIGH]: 0.15 },
    price: 300, tier: 2,
    desc: "A spear. One purpose, executed better than anything else can.",
  },
  dimachaerus: {
    id: "dimachaerus", name: "Paired Blades", kind: "dual", hands: 2,
    reach: 1.25, damage: 17, weight: 1.6,
    windup: 0.13, active: 0.09, recover: 0.19,
    stamina: 8, poise: 8,
    dirs: [DIR.HIGH, DIR.LEFT, DIR.RIGHT, DIR.THRUST],
    // Two blades means a follow-up lands inside the enemy's recovery window.
    comboBonus: 0.45,
    armourPierce: { [DIR.THRUST]: 0.3, [DIR.HIGH]: 0.1, [DIR.LEFT]: 0.1, [DIR.RIGHT]: 0.1 },
    price: 540, tier: 3,
    desc: "Two swords, no shield. Relentless, and nothing between you and a mistake.",
  },
};

/**
 * Shields. `coverage` lists the directions the shield can actually stop —
 * a buckler cannot cover a high cut the way a scutum can.
 */
export const SHIELDS = {
  none: {
    id: "none", name: "No Shield", weight: 0, block: 0, stability: 0,
    coverage: [], integrity: 0, price: 0, tier: 0,
    desc: "Nothing on your arm. Faster, and every mistake is fatal.",
  },
  parmula: {
    id: "parmula", name: "Parmula", weight: 2.2, block: 0.55, stability: 0.5,
    coverage: [DIR.HIGH, DIR.LEFT, DIR.RIGHT], integrity: 55,
    price: 180, tier: 1,
    desc: "The thraex's small round shield. Light, quick, unforgiving of a late block.",
  },
  scutum: {
    id: "scutum", name: "Scutum", weight: 5.5, block: 0.82, stability: 1.0,
    coverage: [DIR.HIGH, DIR.LEFT, DIR.RIGHT, DIR.THRUST], integrity: 120,
    price: 420, tier: 1,
    desc: "The great curved body shield. A wall you carry, and it weighs like one.",
  },
};

/**
 * Armour. `coverage` is a per-zone damage multiplier — this is what makes
 * WEAK POINTS real: a murmillo in a full galea takes almost nothing to the head
 * but the same as anyone to the legs, which are bare by design.
 */
export const ARMOUR = {
  subligaculum: {
    id: "subligaculum", name: "Subligaculum", weight: 0.4, price: 0, tier: 0,
    zones: { head: 1.0, torso: 1.0, arms: 1.0, legs: 1.0 },
    desc: "A loincloth. The crowd can see everything, including the wounds.",
  },
  manica: {
    id: "manica", name: "Manica", weight: 2.1, price: 150, tier: 1,
    zones: { head: 1.0, torso: 1.0, arms: 0.42, legs: 1.0 },
    desc: "Segmented sleeve for the sword arm. The arm you keep extending.",
  },
  ocreae: {
    id: "ocreae", name: "Ocreae", weight: 3.0, price: 190, tier: 1,
    zones: { head: 1.0, torso: 1.0, arms: 1.0, legs: 0.40 },
    desc: "Bronze greaves. Beast fights are won and lost at shin height.",
  },
  galea: {
    id: "galea", name: "Galea", weight: 4.2, price: 340, tier: 2,
    zones: { head: 0.22, torso: 1.0, arms: 1.0, legs: 1.0 },
    // A closed helm is a coffin for your peripheral vision.
    visionPenalty: 0.25,
    desc: "The great crested helm. Near-blind, and nearly invulnerable above the neck.",
  },
  lorica: {
    id: "lorica", name: "Lorica Squamata", weight: 7.5, price: 620, tier: 3,
    zones: { head: 1.0, torso: 0.38, arms: 0.85, legs: 1.0 },
    desc: "Scale over the body. Turns a killing thrust into a bruise, and you into a slow target.",
  },
};

/**
 * The classical armaturae — the matched fighting styles the games were built
 * around. Each is a loadout plus an AI personality.
 */
export const ARMATURAE = {
  murmillo: {
    id: "murmillo", name: "Murmillo",
    weapon: "gladius", shield: "scutum", armour: ["galea", "manica", "ocreae"],
    hp: 115, style: "pressure",
    desc: "Heavy shield, short sword. Walks you down behind a wall of wood.",
  },
  thraex: {
    id: "thraex", name: "Thraex",
    weapon: "sica", shield: "parmula", armour: ["galea", "manica", "ocreae"],
    hp: 100, style: "flanker",
    desc: "Small shield, curved blade. Works the angles and cuts around your guard.",
  },
  retiarius: {
    id: "retiarius", name: "Retiarius",
    weapon: "trident", shield: "none", armour: ["manica"],
    hp: 88, style: "spacer",
    desc: "Net and trident, almost no armour. Wins at range, dies up close.",
  },
  secutor: {
    id: "secutor", name: "Secutor",
    weapon: "gladius", shield: "scutum", armour: ["galea", "manica", "ocreae", "lorica"],
    hp: 130, style: "pressure",
    desc: "The retiarius-hunter: smooth helm, nothing for a net to catch. Slow and inevitable.",
  },
  hoplomachus: {
    id: "hoplomachus", name: "Hoplomachus",
    weapon: "hasta", shield: "parmula", armour: ["galea", "manica", "ocreae"],
    hp: 105, style: "spacer",
    desc: "Spear and small shield. Keeps you exactly one step too far away.",
  },
  dimachaerus: {
    id: "dimachaerus", name: "Dimachaerus",
    weapon: "dimachaerus", shield: "none", armour: ["manica", "ocreae"],
    hp: 92, style: "aggressor",
    desc: "Two blades and no guard. Overwhelms, or is overwhelmed.",
  },
};

/** Hit zones, with the vertical band each occupies as a fraction of height. */
export const ZONES = {
  head: { lo: 0.86, hi: 1.00, crit: 2.1 },
  torso: { lo: 0.48, hi: 0.86, crit: 1.0 },
  arms: { lo: 0.55, hi: 0.82, crit: 0.8 },
  legs: { lo: 0.00, hi: 0.48, crit: 0.75 },
};

/** Total carried weight for a loadout. */
export function loadoutWeight({ weapon, shield, armour = [] }) {
  let w = 0;
  if (weapon && WEAPONS[weapon]) w += WEAPONS[weapon].weight;
  if (shield && SHIELDS[shield]) w += SHIELDS[shield].weight;
  for (const a of armour) if (ARMOUR[a]) w += ARMOUR[a].weight;
  return +w.toFixed(2);
}

/**
 * Derived movement/stamina profile for a loadout. THIS is the mobility-vs-
 * protection trade-off made concrete.
 *
 * A naked fighter carries ~1.2 kg and moves at full speed. A fully armoured
 * secutor carries ~24 kg and gives up roughly a third of his speed and half
 * his stamina recovery for it.
 */
export function mobility(loadout, mods = null) {
  const w = loadoutWeight(loadout);
  // Strength does not make armour lighter — it makes you carry it better, so
  // the trade-off survives while training still pays.
  const effW = mods ? w * (mods.weightRelief ?? 1) : w;
  const t = Math.min(1, effW / 26);               // 0 = naked, 1 = maximum load
  const m = mods || {};
  return {
    weight: w,                                    // TRUE weight, for the UI
    effectiveWeight: +effW.toFixed(2),
    moveSpeed: +((4.4 - 1.55 * t) * (m.moveSpeed ?? 1)).toFixed(2),      // m/s
    dodgeDistance: +((3.6 - 1.5 * t) * (m.dodgeDistance ?? 1)).toFixed(2),
    staminaMax: +((100 - 18 * t) * (m.staminaMax ?? 1)).toFixed(1),
    staminaRegen: +((17 - 8.5 * t) * (m.staminaRegen ?? 1)).toFixed(2),   // per second
    turnRate: +((9.0 - 3.4 * t) * (m.turnRate ?? 1)).toFixed(2),          // rad/s
  };
}

/** Per-zone damage multiplier for a set of armour pieces (best piece wins). */
export function zoneMultiplier(armourIds, zone) {
  let m = 1;
  for (const id of armourIds || []) {
    const a = ARMOUR[id];
    if (a && a.zones && a.zones[zone] !== undefined) m = Math.min(m, a.zones[zone]);
  }
  return m;
}
