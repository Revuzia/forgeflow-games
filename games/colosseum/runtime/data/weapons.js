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
 *
 * TIMING IS ANCHORED TO MEASURED HUMAN MOTION, not invented. The old table ran
 * full swing cycles of 0.41-0.86 s — seven blows in three seconds, which is
 * exactly the "rapid flailing" a real fight never shows. Re-derived 2026-07-27
 * from the sourced analogues (no direct measurement of these weapons exists;
 * ordering and ratios are evidence, absolutes tuned to a 1.5-2.5 s cycle band):
 *   - boxing jab delivery 405 +/- 150 ms; hooks 586-657 ms (arcs beat lines)
 *   - fencing lunge movement time 568 +/- 39 ms
 *   - kendo men strike (8th-dan, VICON 250 Hz) 759 +/- 73 ms onset-to-impact
 *   - instrumented two-hand spear thrust: 4.65 m/s mean impact velocity
 *   - competition axe chop: ~15% of the cycle is the downswing, ~85% recovery
 *   - real inter-attack interval in striking sports: one committed attack per
 *     ~2.9-3.4 s (elite boxing punch rate; Muay Thai high-intensity phasing)
 * Windup+active for each weapon sits on its analogue's measured delivery time;
 * recovery carries the cycle's majority share, as in every measured swing.
 */
export const WEAPONS = {
  gladius: {
    id: "gladius", name: "Gladius", kind: "sword", hands: 1,
    reach: 1.35, damage: 26, weight: 1.2,
    // Fencing-lunge class: windup+active 0.57 s ~= the measured 0.568 s lunge.
    windup: 0.45, active: 0.12, recover: 0.95,   // 1.52 s cycle
    stamina: 12, poise: 14,
    dirs: [DIR.HIGH, DIR.LEFT, DIR.RIGHT, DIR.THRUST],
    // Thrusts beat armour; cuts are better against unarmoured flesh.
    armourPierce: { [DIR.THRUST]: 0.55, [DIR.HIGH]: 0.2, [DIR.LEFT]: 0.2, [DIR.RIGHT]: 0.2 },
    price: 0, tier: 0,
    desc: "The legionary short sword. Fast, forgiving, murderous in close.",
  },
  rudis: {
    id: "rudis", name: "Rudis", kind: "sword", hands: 1,
    // The wooden practice sword. Same shape and timing as a gladius so the
    // tutorial teaches the real weapon's rhythm, but blunt: it bruises rather
    // than opens, and it will not defeat armour.
    reach: 1.30, damage: 13, weight: 1.1,
    // Identical rhythm to the gladius — the rudis exists to train it.
    windup: 0.45, active: 0.12, recover: 0.95,
    stamina: 10, poise: 12,
    dirs: [DIR.HIGH, DIR.LEFT, DIR.RIGHT, DIR.THRUST],
    // No pierce worth the name — a stick does not find a gap in a manica.
    armourPierce: { [DIR.THRUST]: 0.10, [DIR.HIGH]: 0.05, [DIR.LEFT]: 0.05, [DIR.RIGHT]: 0.05 },
    price: 0, tier: 0, issued: true,
    desc: "A blunt oak sword, the weight of a gladius. What the ludus trains with, and what the summa rudis carries.",
  },
  spatha: {
    id: "spatha", name: "Spatha", kind: "sword", hands: 1,
    reach: 1.62, damage: 32, weight: 1.8,
    // Kendo men-strike class: windup+active 0.80 s vs measured 0.759 +/- 0.073.
    windup: 0.62, active: 0.18, recover: 1.10,   // 1.90 s cycle
    stamina: 16, poise: 18,
    dirs: [DIR.HIGH, DIR.LEFT, DIR.RIGHT, DIR.THRUST],
    armourPierce: { [DIR.THRUST]: 0.45, [DIR.HIGH]: 0.25, [DIR.LEFT]: 0.25, [DIR.RIGHT]: 0.25 },
    // CLEAVE. A long blade swung in a wide arc takes everyone standing in it.
    //
    // `arc` is the half-angle of the swing cone in radians; the default is
    // 0.62 (a 71-degree cone). At 1.15 the spatha sweeps 132 degrees, so a
    // side cut genuinely catches two men who have closed on you at once, and
    // `cleaveFalloff` means the second and third take less than the first —
    // a blade slows as it passes through.
    //
    // This is the weapon answer to being outnumbered. The measured problem
    // with N-vs-1 was never scheduling or positioning, it was OUTPUT: the
    // player deals enough for one opponent and half of what two require. A
    // cleaving weapon is how a fighter converts being surrounded from a death
    // sentence into an opportunity — which is exactly what the arena's
    // reputation is built on.
    arc: 1.15,
    cleave: 3,
    cleaveFalloff: 0.62,
    price: 320, tier: 1,
    desc: "A cavalry longsword. More reach than a gladius, and a swing wide enough to take two men at once.",
  },
  sica: {
    id: "sica", name: "Sica", kind: "curved", hands: 1,
    reach: 1.18, damage: 23, weight: 0.9,
    // Hook-punch class: short-radius arc, windup+active 0.60 s vs 0.586 measured.
    windup: 0.42, active: 0.18, recover: 0.95,   // 1.55 s cycle
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
    // Spear-thrust class (4.65 m/s measured) + the heaviest head in the set.
    windup: 0.72, active: 0.26, recover: 1.27,   // 2.25 s cycle
    stamina: 15, poise: 22,
    dirs: [DIR.THRUST, DIR.HIGH, DIR.LEFT, DIR.RIGHT],
    armourPierce: { [DIR.THRUST]: 0.6, [DIR.HIGH]: 0.2, [DIR.LEFT]: 0.2, [DIR.RIGHT]: 0.2 },
    price: 380, tier: 2,
    desc: "The netman's trident. Enormous reach; helpless once you are inside it.",
  },
  hasta: {
    id: "hasta", name: "Hasta", kind: "polearm", hands: 2,
    reach: 2.35, damage: 27, weight: 2.0,
    // Spear-thrust class: the point covers ~1 m at the measured 4.65 m/s.
    windup: 0.58, active: 0.22, recover: 1.15,   // 1.95 s cycle
    stamina: 13, poise: 19,
    dirs: [DIR.THRUST, DIR.HIGH],
    armourPierce: { [DIR.THRUST]: 0.65, [DIR.HIGH]: 0.15 },
    price: 300, tier: 2,
    desc: "A spear. One purpose, executed better than anything else can.",
  },
  contus: {
    id: "contus", name: "Contus", kind: "lance", hands: 1,
    // The cavalry lance, couched for the tilt. Joust-only: issued with the
    // mount, never shopped, and the joust sim owns its numbers (reach and
    // timing live in sim/joust.js) — this entry exists so the HUD, armoury
    // and loadout code can resolve the id like any other weapon.
    reach: 3.2, damage: 34, weight: 2.8,
    windup: 0.6, active: 0.2, recover: 1.3,
    stamina: 14, poise: 24,
    dirs: [DIR.THRUST],
    armourPierce: { [DIR.THRUST]: 0.5 },
    price: 0, tier: 0, issued: true,
    desc: "A horseman's lance. Useless on foot; decisive at the gallop.",
  },
  dimachaerus: {
    id: "dimachaerus", name: "Paired Blades", kind: "dual", hands: 2,
    reach: 1.25, damage: 17, weight: 1.6,
    // Lightest blades in the set; comboBonus cuts recovery on follow-ups, so
    // the in-burst rhythm is the fast edge of the band by design.
    windup: 0.40, active: 0.12, recover: 0.78,   // 1.30 s cycle
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
  paegniarius: {
    id: "paegniarius", name: "Paegniarius",
    // The midday clown-fighter: blunt stick, no shield, no armour, nobody dies.
    // He exists so the FIRST bout is a fair duel. It used to field a full
    // murmillo — scutum at 120 integrity plus galea, manica and ocreae —
    // against a player who starts with a gladius, no shield and no armour at
    // all. A same-skill player won 30% of the time, in a bout whose own
    // description reads "Blunted weapons... Nobody dies. Learn the guard."
    weapon: "rudis", shield: "none", armour: [],
    hp: 96, style: "flanker",
    desc: "Blunted wood and no armour. The interval act, and the only fair fight on the card.",
  },
  provocator: {
    id: "provocator", name: "Provocator",
    weapon: "gladius", shield: "scutum", armour: ["galea", "manica", "ocreae"],
    // The one type that fought only its own kind, so this number is only ever
    // read against itself. The cardiophylax — a breastplate no other armatura
    // wears — is worth the five points over a murmillo's 115; it is not a
    // purchasable piece, so it lives here rather than in the armour list.
    hp: 120, style: "pressure", bulk: 1.8,
    desc: "The closest thing to a legionary duel. Breastplate, big shield, and no asymmetry to exploit.",
  },
  crupellarius: {
    id: "crupellarius", name: "Crupellarius",
    weapon: "gladius", shield: "none", armour: ["galea", "manica", "ocreae", "lorica"],
    // The tankiest thing on the sand, and the Champion-rank boss "Iron Gaul".
    // He carried thraex's 100 hp until now because he had no block at all.
    //
    // The 9 kg of bulk is the iron shell Tacitus describes. Without it he
    // totals 16.8 kg against a secutor's 23.5 and would be the FASTER of the
    // two — the exact opposite of "no agility whatsoever". With it he is the
    // heaviest fighter in the game and pays for 145 hp in speed and stamina.
    hp: 145, style: "pressure", bulk: 9.0,
    desc: "Gaulish, encased head to foot in iron. An immovable object that wins by outlasting.",
  },
};

/** Hit zones, with the vertical band each occupies as a fraction of height. */
export const ZONES = {
  head: { lo: 0.86, hi: 1.00, crit: 2.1 },
  torso: { lo: 0.48, hi: 0.86, crit: 1.0 },
  arms: { lo: 0.55, hi: 0.82, crit: 0.8 },
  legs: { lo: 0.00, hi: 0.48, crit: 0.75 },
};

/**
 * Total carried weight for a loadout.
 *
 * `bulk` is extra kilos an armatura carries that are NOT one of the five
 * purchasable pieces — currently only the crupellarius, whose sources describe
 * a full iron encasement rather than a set of straps. Without it he carries
 * less than a secutor (no shield) and would move FASTER than the man he is
 * supposed to out-lumber, which makes "no agility whatsoever" a lie.
 * Defaults to 0, so every existing loadout weighs exactly what it always did.
 */
export function loadoutWeight({ weapon, shield, armour = [], bulk = 0 }) {
  let w = bulk;
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
