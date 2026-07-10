// Thronedrift — data-driven ability definitions.
// Every kit is 1 spamable basic + 3 specials. The sim (sim/game.js) implements
// a small set of behavior primitives ("type"); everything else is data.
//
// Warrior has TWO full kits (weapon modes). Mode swap keeps SEPARATE cooldown
// tracks per mode — swapping never resets or refunds timers (readable + fair).
//
// anim: Meshy clip name (C_ prefix added by the actor), animScale: timeScale.

// SHIFT movement skills — every class gets a signature dash
export const DASHES = {
  warrior: { type: "lunge", cd: 5, dist: 5.5, dur: 0.22, dmg: 14, callout: "LUNGE!", icon: "⤞" },
  archer: { type: "roll", cd: 4, dist: 4.8, dur: 0.3, callout: null, icon: "↷" },
  mage: { type: "blink", cd: 6, dist: 7, callout: "BLINK!", icon: "✦" },
};

export const CLASSES = {
  warrior: {
    name: "Warrior", color: 0xff4d3a, uiColor: "#ff6a4a",
    portrait: "⚔️", desc: "Two kits in one: colossal two-hander or sword & shield with a true Block.",
    speed: 5.9, hearts: 7,   // melee eats hits the ranged classes never take — extra hearts
    modes: ["twohand", "sworboard"],
    kits: {
      twohand: {
        label: "Two-Handed", icon: "🗡", model: "barbarian",
        // anim note: barbarian slash1 is a 7.7s charged chop — unusable for spam;
        // finisher (1.87s hammer swing) + slash2 read as real chops when rate-fitted
        // FULL frontal cone swing — slower, heavier, whole clip plays (owner: "it's
        // a 2H sword, it should be a full swing with the swipe on it")
        basic: { id: "heavy_slash", name: "Heavy Slash", type: "melee", dmg: 18, arc: 2.6, range: 3.1,
                 rate: 0.9, anim: ["finisher", "slash2"], animScale: 1.5, sfx: "swing_big", trail: 0xff5a3a },
        abilities: [
          { id: "whirlwind", name: "Whirlwind", callout: "WHIRLWIND!", icon: "🌪", cd: 6,
            type: "spin", dmg: 9, radius: 3.6, ticks: 5, duration: 1.1,
            anim: "finisher", animScale: 1.2, sfx: "swing_big", shake: 0.35 },
          { id: "ground_slam", name: "Ground Slam", callout: "GROUND SLAM!", icon: "💥", cd: 8,
            type: "slam", dmg: 26, radius: 4.6, knockback: 9, stagger: 0.4,
            anim: "slash1", animScale: 1.1, sfx: "slam", shake: 0.8, hitstop: 0.09 },
          { id: "earthsplitter", name: "Earthsplitter", callout: "EARTHSPLITTER!", icon: "⛰", cd: 10,
            type: "rupture", dmg: 34, length: 11, width: 2.6, stagger: 0.7,
            anim: "slash2", animScale: 1.0, sfx: "slam", shake: 0.6, hitstop: 0.08 },
        ],
      },
      sworboard: {
        label: "Sword & Shield", icon: "🛡", model: "knight",
        basic: { id: "sword_strike", name: "Sword Strike", type: "melee", dmg: 8, arc: 1.6, range: 2.5,
                 rate: 0.36, anim: ["slash1", "slash2"], animScale: 1.7, sfx: "swing", trail: 0xffd24a },
        abilities: [
          { id: "frontal_swipe", name: "Frontal Swipe", callout: "SWIPE!", icon: "🌀", cd: 5,
            type: "melee", dmg: 16, arc: 2.9, range: 3.4,
            anim: "finisher", animScale: 1.3, sfx: "swing_big", shake: 0.25 },
          { id: "shield_bash", name: "Shield Bash", callout: "BASH!", icon: "🔨", cd: 7,
            type: "bash", dmg: 12, arc: 1.5, range: 2.4, shock: 1.6, knockback: 5,
            anim: "slash1", animScale: 1.4, sfx: "block", shake: 0.45, hitstop: 0.07 },
          { id: "bulwark", name: "Bulwark", callout: "BULWARK!", icon: "🛡", cd: 6, hold: true,
            type: "block", dr: 0.8, maxHold: 2.6, perfectWindow: 0.25,
            perfectPulse: { dmg: 6, shock: 1.2, arc: 2.4, range: 3.0 },
            anim: "parry", animScale: 0.9, sfx: "block" },
        ],
      },
    },
  },

  archer: {
    name: "Archer", color: 0xffa03a, uiColor: "#ffb050",
    portrait: "🏹", desc: "Ranged zoning: fast arrows, explosive fire, and a rain of death.",
    speed: 6.3, hearts: 4, model: "rogue",
    kits: {
      base: {
        label: "Bow", icon: "🏹", model: "rogue",
        basic: { id: "single_arrow", name: "Single Arrow", type: "shot", dmg: 7, count: 1,
                 speed: 22, rate: 0.30, range: 18, anim: ["slash1", "slash2"], animScale: 2.0, sfx: "shot", tint: 0xffc060 },
        abilities: [
          { id: "fan_shot", name: "Fan Shot", callout: "FAN SHOT!", icon: "⫸", cd: 5,
            type: "shot", dmg: 8, count: 7, spread: 1.15, speed: 20, range: 15,
            anim: "finisher", animScale: 1.6, sfx: "shot", tint: 0xffc060 },
          { id: "fire_arrow", name: "Fire Arrow", callout: "FIRE ARROW!", icon: "🔥", cd: 8,
            type: "bomb", dmg: 20, speed: 19, radius: 3.2, range: 17,
            residual: { kind: "fire", radius: 2.8, life: 4, dps: 8 }, status: { burn: 3 },
            anim: "slash1", animScale: 1.6, sfx: "shot", tint: 0xff6a20 },
          { id: "arrow_rain", name: "Rain of Arrows", callout: "RAIN OF ARROWS!", icon: "🎯", cd: 12,
            type: "rain", dmg: 12, radius: 4.4, delay: 0.9, volleys: 3, volleyGap: 0.35, range: 14,
            anim: "slash2", animScale: 1.4, sfx: "rain", shake: 0.4 },
        ],
      },
    },
  },

  mage: {
    name: "Mage", color: 0x9a5dff, uiColor: "#b07aff",
    portrait: "🔮", desc: "Elemental control: fire, frost, and an arcane ward.",
    speed: 6.1, hearts: 4, model: "sorceress",
    kits: {
      base: {
        label: "Staff", icon: "🔮", model: "sorceress",
        basic: { id: "arcane_bolt", name: "Arcane Bolt", type: "shot", dmg: 9, count: 1,
                 speed: 18, rate: 0.42, range: 15, anim: ["cast1", "cast2"], animScale: 1.8, sfx: "bolt", tint: 0xb47aff },
        abilities: [
          { id: "fireball", name: "Fireball", callout: "FIREBALL!", icon: "🔥", cd: 7,
            type: "bomb", dmg: 30, speed: 15, radius: 3.8, range: 16,
            residual: { kind: "fire", radius: 3.0, life: 4.5, dps: 9 }, status: { burn: 3 },
            anim: "cast1", animScale: 1.4, sfx: "explode", shake: 0.5, hitstop: 0.06, tint: 0xff7a2a },
          { id: "frost_orb", name: "Frost Orb", callout: "FROST ORB!", icon: "❄", cd: 9,
            type: "bomb", dmg: 18, speed: 12, radius: 4.2, range: 15,
            residual: { kind: "frost", radius: 3.6, life: 5, slow: 0.55 }, status: { frost: 3 },
            anim: "cast2", animScale: 1.4, sfx: "frost", tint: 0x6ad8ff },
          { id: "arcane_ward", name: "Arcane Ward", callout: "ARCANE WARD!", icon: "🫧", cd: 14,
            type: "ward", absorb: 4, duration: 6,
            anim: "melee", animScale: 1.2, sfx: "ward", tint: 0xb47aff },
        ],
      },
    },
  },
};

// combo multiplier tiers: hits → multiplier (display uses the big pop text)
export const COMBO_TIERS = [
  { hits: 0, mult: 1 }, { hits: 4, mult: 2 }, { hits: 10, mult: 4 },
  { hits: 18, mult: 8 }, { hits: 30, mult: 16 }, { hits: 48, mult: 32 },
];
export const COMBO_WINDOW = 2.6; // seconds between hits before the chain drops
