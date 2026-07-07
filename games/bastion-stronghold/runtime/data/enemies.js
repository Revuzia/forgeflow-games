// Stronghold enemy constructs — all-original procedural models (see view/models.js).
// speed = units/sec. siegeDmg = Bastion HP lost on breach.
// traits: armor/warding resist %, flying (immune to Cauldron zones + road placeables),
// fast, shielded, swarm, siege, detonator, splitter (children spawn on death).

export const ENEMIES = {
  // ---- W1: Ancient Colosseum — bronze arena constructs
  legionnaire: {
    name: 'Bronze Legionnaire', model: 'legionnaire', scale: 1.0, radius: 0.55,
    hp: 52, speed: 2.9, bounty: 6, siegeDmg: 1, armor: 0.1, warding: 0,
  },
  arena_hound: {
    name: 'Arena Hound', model: 'hound', scale: 0.9, radius: 0.55,
    hp: 66, speed: 4.6, bounty: 8, siegeDmg: 1, armor: 0, warding: 0, traits: ['fast'],
  },
  phalanx: {
    name: 'Shield Phalanx', model: 'phalanx', scale: 1.05, radius: 0.65,
    hp: 150, speed: 2.2, bounty: 12, siegeDmg: 1, armor: 0.3, warding: 0, shield: 4, traits: ['shielded'],
  },
  laurel_wisp: {
    name: 'Laurel Wisp', model: 'wisp', scale: 0.85, radius: 0.5, tint: 0xd8c86a,
    hp: 60, speed: 3.5, bounty: 9, siegeDmg: 1, armor: 0, warding: 0.2, flying: true,
  },
  chariot: {
    name: 'Chariot Runner', model: 'chariot', scale: 1.05, radius: 0.75,
    hp: 210, speed: 3.8, bounty: 16, siegeDmg: 2, armor: 0.2, warding: 0, traits: ['fast', 'siege'],
  },
  colossus_boss: {
    name: 'Colossus Aurelius', model: 'colossus', scale: 2.3, radius: 1.25,
    hp: 3400, speed: 1.5, bounty: 280, siegeDmg: 5, armor: 0.25, warding: 0.15, boss: true,
    abilities: ['rallyCry', 'shieldWall'],
  },

  // ---- W2: Gothic Castle — siege engines + cursed iron
  ram: {
    name: 'Battering Ram', model: 'ram', scale: 1.15, radius: 0.8,
    hp: 320, speed: 1.9, bounty: 18, siegeDmg: 2, armor: 0.35, warding: 0, traits: ['siege'],
  },
  plague_swarm: {
    name: 'Plague Swarm', model: 'ratling', scale: 0.62, radius: 0.4,
    hp: 30, speed: 4.0, bounty: 4, siegeDmg: 1, armor: 0, warding: 0.1, traits: ['swarm', 'fast'],
  },
  cursed_knight: {
    name: 'Cursed Knight', model: 'knight', scale: 1.0, radius: 0.6,
    hp: 190, speed: 2.6, bounty: 13, siegeDmg: 1, armor: 0.4, warding: 0.1,
  },
  gargoyle: {
    name: 'Gargoyle', model: 'gargoyle', scale: 0.95, radius: 0.6,
    hp: 130, speed: 3.6, bounty: 13, siegeDmg: 1, armor: 0.1, warding: 0.4, flying: true,
  },
  trebuchet: {
    name: 'Trebuchet Crawler', model: 'trebuchet', scale: 1.2, radius: 0.85,
    hp: 520, speed: 1.6, bounty: 34, siegeDmg: 2, armor: 0.3, warding: 0.2, traits: ['siege'],
  },
  siege_titan_boss: {
    name: 'Siege Titan', model: 'siegetitan', scale: 2.4, radius: 1.3,
    hp: 5600, speed: 1.4, bounty: 380, siegeDmg: 5, armor: 0.4, warding: 0.2, boss: true,
    abilities: ['summonRams', 'ironPlates'],
  },

  // ---- W3: Floating Sky Citadel — storm spirits + airships
  wind_wisp: {
    name: 'Wind Wisp', model: 'wisp', scale: 0.8, radius: 0.5, tint: 0x9adcf0,
    hp: 95, speed: 4.8, bounty: 10, siegeDmg: 1, armor: 0, warding: 0.25, traits: ['fast'],
  },
  sky_skiff: {
    name: 'Sky Skiff', model: 'skiff', scale: 1.1, radius: 0.8,
    hp: 340, speed: 2.4, bounty: 22, siegeDmg: 2, armor: 0.2, warding: 0.2, flying: true, traits: ['siege'],
  },
  cloud_ray: {
    name: 'Cloud Ray', model: 'ray', scale: 1.0, radius: 0.65,
    hp: 150, speed: 3.6, bounty: 14, siegeDmg: 1, armor: 0, warding: 0.35, flying: true,
  },
  zephyr_twin: {
    name: 'Zephyr Twin', model: 'zephyr', scale: 0.95, radius: 0.55,
    hp: 170, speed: 3.2, bounty: 12, siegeDmg: 1, armor: 0, warding: 0.3,
    traits: ['splitter'], splitInto: { type: 'wind_wisp', count: 2 },
  },
  storm_herald: {
    name: 'Storm Herald', model: 'herald', scale: 1.1, radius: 0.7,
    hp: 460, speed: 2.4, bounty: 30, siegeDmg: 2, armor: 0.1, warding: 0.45,
  },
  leviathan_boss: {
    name: 'Gale Leviathan', model: 'leviathan', scale: 2.4, radius: 1.35,
    hp: 7800, speed: 1.7, bounty: 480, siegeDmg: 5, armor: 0.2, warding: 0.35, boss: true, flying: true,
    abilities: ['summonRays', 'windShield'],
  },

  // ---- W4: Crystal Fortress — living gems
  skitterer: {
    name: 'Shard Skitterer', model: 'skitterer', scale: 0.7, radius: 0.45,
    hp: 60, speed: 4.2, bounty: 6, siegeDmg: 1, armor: 0.1, warding: 0.2, traits: ['swarm', 'fast'],
  },
  shardling: {
    name: 'Shardling', model: 'skitterer', scale: 0.5, radius: 0.35, tint: 0xe0b8ff,
    hp: 26, speed: 4.6, bounty: 2, siegeDmg: 1, armor: 0, warding: 0.1, traits: ['swarm', 'fast'],
  },
  prism_golem: {
    name: 'Prism Golem', model: 'prismgolem', scale: 1.15, radius: 0.75,
    hp: 420, speed: 2.2, bounty: 26, siegeDmg: 2, armor: 0.35, warding: 0.35,
  },
  light_moth: {
    name: 'Light Moth', model: 'moth', scale: 0.9, radius: 0.55,
    hp: 190, speed: 3.8, bounty: 16, siegeDmg: 1, armor: 0, warding: 0.4, flying: true,
  },
  refractor: {
    name: 'Refractor Sentinel', model: 'refractor', scale: 1.1, radius: 0.7,
    hp: 520, speed: 2.5, bounty: 32, siegeDmg: 2, armor: 0.15, warding: 0.55,
  },
  geode_brute: {
    name: 'Geode Brute', model: 'geode', scale: 1.25, radius: 0.85,
    hp: 700, speed: 2.0, bounty: 40, siegeDmg: 2, armor: 0.3, warding: 0.3,
    traits: ['splitter'], splitInto: { type: 'skitterer', count: 3 },
  },
  prism_boss: {
    name: 'The Prime Prism', model: 'primeprism', scale: 2.2, radius: 1.25,
    hp: 10500, speed: 1.55, bounty: 600, siegeDmg: 5, armor: 0.25, warding: 0.25, boss: true,
    abilities: ['prismPhase', 'summonSkitterers'],
  },

  // ---- W5: Dwarven Mountain Hold — forge machines
  drill_crawler: {
    name: 'Drill Crawler', model: 'drill', scale: 1.0, radius: 0.65,
    hp: 380, speed: 2.7, bounty: 22, siegeDmg: 1, armor: 0.45, warding: 0.1,
  },
  keg_runner: {
    name: 'Powder Keg Runner', model: 'keg', scale: 0.85, radius: 0.5,
    hp: 90, speed: 5.0, bounty: 14, siegeDmg: 8, armor: 0, warding: 0.15,
    traits: ['fast', 'detonator'],
  },
  ore_golem: {
    name: 'Ore Golem', model: 'oregolem', scale: 1.3, radius: 0.9,
    hp: 900, speed: 1.9, bounty: 46, siegeDmg: 2, armor: 0.4, warding: 0.25,
  },
  gyrocopter: {
    name: 'Gyrocopter', model: 'gyro', scale: 0.95, radius: 0.6,
    hp: 300, speed: 3.9, bounty: 22, siegeDmg: 1, armor: 0.2, warding: 0.25, flying: true, traits: ['fast'],
  },
  forge_sentinel: {
    name: 'Forge Sentinel', model: 'sentinel', scale: 1.2, radius: 0.8,
    hp: 1500, speed: 2.1, bounty: 85, siegeDmg: 2, armor: 0.45, warding: 0.4,
  },
  forge_engine_boss: {
    name: 'Magma Forge Engine', model: 'forgeengine', scale: 2.5, radius: 1.4,
    hp: 15500, speed: 1.5, bounty: 750, siegeDmg: 5, armor: 0.4, warding: 0.3, boss: true,
    abilities: ['overdrive', 'deployKegs', 'platingShield'],
  },
};

export function enemyDef(id) {
  const d = ENEMIES[id];
  if (!d) throw new Error('unknown enemy ' + id);
  return d;
}
