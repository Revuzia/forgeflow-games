// Enemy definitions. Pure data — no DOM/three.
// speed = world units/sec (1 cell = 2u). armor/warding = % resist vs phys/magic (0..0.8).
// flying: immune to Cannon splash + Venom targeting; visually airborne.
// float: visual hover only (still a ground unit for targeting rules).
// anim: hints resolved fuzzily against GLB clip names by the view layer.

export const ENEMIES = {
  // ---- Forest (Verdant Hollow)
  goblin: {
    name: 'Goblin', model: 'goblin', scale: 0.85, radius: 0.55,
    hp: 46, speed: 3.0, bounty: 6, leak: 1,
    armor: 0, warding: 0, anim: { move: 'Run', death: 'Death' },
  },
  wolf: {
    name: 'Timber Wolf', model: 'wolf', scale: 0.72, radius: 0.6,
    hp: 62, speed: 4.6, bounty: 8, leak: 1, traits: ['fast'],
    armor: 0, warding: 0, anim: { move: 'Gallop', death: 'Death' },
  },
  spider: {
    name: 'Sylvan Spider', model: 'spider', scale: 0.8, radius: 0.55,
    hp: 38, speed: 3.8, bounty: 6, leak: 1, traits: ['swarm'],
    armor: 0, warding: 0.15, anim: { move: 'Walk', death: 'Death' },
  },
  armabee: {
    name: 'Armabee', model: 'armabee', scale: 0.75, radius: 0.5,
    hp: 58, speed: 3.4, bounty: 9, leak: 1, flying: true,
    armor: 0, warding: 0, anim: { move: 'Flying', death: 'Death' },
  },
  mushnub: {
    name: 'Mushnub', model: 'mushnub', scale: 0.9, radius: 0.45,
    hp: 26, speed: 2.6, bounty: 4, leak: 1, traits: ['swarm'],
    armor: 0, warding: 0, anim: { move: 'Walk', death: 'Death' },
  },
  ent_elder: { // elite: reskinned mushroom king mini
    name: 'Elder Shroom', model: 'mushroom_king', scale: 0.85, radius: 0.8,
    hp: 520, speed: 2.0, bounty: 52, leak: 2, traits: ['heavy', 'regen'], regen: 4,
    armor: 0.15, warding: 0.15, anim: { move: 'Walk', death: 'Death' },
  },
  mushroom_king: {
    name: 'Mushroom King', model: 'mushroom_king', scale: 1.9, radius: 1.15,
    hp: 3200, speed: 1.5, bounty: 260, leak: 5, boss: true,
    armor: 0.2, warding: 0.2, anim: { move: 'Walk', death: 'Death' },
    abilities: ['sporeHeal', 'summonMushnubs'],
  },

  // ---- Volcanic (Cinder Wastes)
  fire_imp: {
    name: 'Fire Imp', model: 'demon', scale: 0.8, radius: 0.55,
    hp: 74, speed: 3.5, bounty: 9, leak: 1, float: true,
    armor: 0, warding: 0.35, anim: { move: 'Flying', death: 'Death' },
  },
  lava_slug: {
    name: 'Lava Slug', model: 'lava_slug', scale: 1.05, radius: 0.7, tint: 0xff5a2a,
    hp: 300, speed: 1.9, bounty: 22, leak: 2, traits: ['heavy'],
    armor: 0.35, warding: 0.2, anim: { move: 'Walk', death: 'Death' },
  },
  ash_bat: {
    name: 'Ash Bat', model: 'ash_bat', scale: 0.85, radius: 0.5,
    hp: 60, speed: 5.0, bounty: 10, leak: 1, flying: true, traits: ['fast'],
    armor: 0, warding: 0.1, anim: { move: 'Flying', death: 'Death' },
  },
  cinder_whelp: {
    name: 'Cinder Whelp', model: 'dragon', scale: 0.62, radius: 0.55, tint: 0xd94f1e,
    hp: 95, speed: 3.2, bounty: 14, leak: 1, flying: true,
    armor: 0, warding: 0.3, anim: { move: 'Flying', death: 'Death' },
  },
  blue_demon: {
    name: 'Ashlord', model: 'blue_demon', scale: 1.1, radius: 0.85,
    hp: 640, speed: 2.2, bounty: 60, leak: 2, traits: ['heavy'],
    armor: 0.25, warding: 0.4, anim: { move: 'Walk', death: 'Death' },
  },
  magma_dragon: {
    name: 'Magma Dragon', model: 'dragon', scale: 2.1, radius: 1.2, tint: 0xff3b14,
    hp: 5200, speed: 1.6, bounty: 340, leak: 5, boss: true, flying: false, float: true,
    armor: 0.25, warding: 0.35, anim: { move: 'Flying', death: 'Death' },
    abilities: ['wingGust', 'emberRain'],
  },

  // ---- Tundra (Frostmaw Expanse)
  ice_troll: {
    name: 'Ice Troll', model: 'ice_troll', scale: 1.0, radius: 0.75, tint: 0x9fd4e8,
    hp: 210, speed: 2.5, bounty: 18, leak: 1, traits: ['heavy'],
    armor: 0.35, warding: 0.1, anim: { move: 'Walk', death: 'Death' },
  },
  frost_wolf: {
    name: 'Frost Wolf', model: 'frost_wolf', scale: 0.78, radius: 0.6,
    hp: 105, speed: 4.8, bounty: 12, leak: 1, traits: ['fast'],
    armor: 0.1, warding: 0.15, anim: { move: 'Run', death: 'Death' },
  },
  hywirl: {
    name: 'Hywirl', model: 'hywirl', scale: 0.9, radius: 0.55,
    hp: 130, speed: 3.6, bounty: 16, leak: 1, flying: true,
    armor: 0, warding: 0.3, anim: { move: 'Flying', death: 'Death' },
  },
  snow_hare: {
    name: 'Snow Hare', model: 'snow_hare', scale: 0.62, radius: 0.4,
    hp: 44, speed: 4.2, bounty: 5, leak: 1, traits: ['swarm', 'fast'],
    armor: 0, warding: 0, anim: { move: 'Run', death: 'Death' },
  },
  yeti_brute: {
    name: 'Yeti Brute', model: 'yeti', scale: 1.25, radius: 0.85,
    hp: 700, speed: 2.0, bounty: 55, leak: 2, traits: ['heavy', 'regen'], regen: 9,
    armor: 0.3, warding: 0.2, anim: { move: 'Walk', death: 'Death' },
  },
  frost_behemoth: {
    name: 'Frost Behemoth', model: 'frost_behemoth', scale: 2.2, radius: 1.25,
    hp: 7800, speed: 1.45, bounty: 430, leak: 5, boss: true,
    armor: 0.35, warding: 0.25, anim: { move: 'Walk', death: 'Death' },
    abilities: ['iceShield', 'blizzard'],
  },

  // ---- Ruins (Sunken Ruins)
  skeleton: {
    name: 'Skeleton', model: 'skeleton', scale: 0.9, radius: 0.55,
    hp: 90, speed: 3.1, bounty: 10, leak: 1, traits: ['swarm'],
    armor: 0.35, warding: 0, anim: { move: 'Run', death: 'Death' },
  },
  zombie: {
    name: 'Rotwalker', model: 'zombie', scale: 0.95, radius: 0.6,
    hp: 260, speed: 2.1, bounty: 18, leak: 1, traits: ['regen'], regen: 7,
    armor: 0.1, warding: 0.2, anim: { move: 'Walk', death: 'Death' },
  },
  wraith: {
    name: 'Wraith', model: 'ghost', scale: 0.95, radius: 0.6,
    hp: 170, speed: 3.7, bounty: 17, leak: 1, flying: true,
    armor: 0.1, warding: 0.5, anim: { move: 'Flying', death: 'Death' },
  },
  necromancer: {
    name: 'Necromancer', model: 'wizard', scale: 1.1, radius: 0.7,
    hp: 800, speed: 2.2, bounty: 70, leak: 2, traits: ['heavy'],
    armor: 0.15, warding: 0.45, anim: { move: 'Walk', death: 'Death' },
    abilities: ['bonewall'], // periodically shields nearby allies
  },
  lich_skull: {
    name: 'Lich Skull', model: 'lich_skull', scale: 2.0, radius: 1.15,
    hp: 10200, speed: 1.5, bounty: 520, leak: 5, boss: true, flying: false, float: true,
    armor: 0.25, warding: 0.45, anim: { move: 'Flying', death: 'Death' },
    abilities: ['summonSkeletons', 'etherealPhase'],
  },

  // ---- Astral Isles
  glub: {
    name: 'Astral Sprite', model: 'glub', scale: 0.8, radius: 0.5, tint: 0x9d7bff,
    hp: 150, speed: 3.9, bounty: 16, leak: 1, flying: true,
    armor: 0, warding: 0.35, anim: { move: 'Flying', death: 'Death' },
  },
  goleling: {
    name: 'Star Goleling', model: 'goleling', scale: 0.95, radius: 0.65,
    hp: 380, speed: 2.6, bounty: 30, leak: 1, float: true,
    armor: 0.35, warding: 0.3, anim: { move: 'Flying', death: 'Death' },
  },
  squidle: {
    name: 'Void Squidle', model: 'squidle', scale: 0.95, radius: 0.6, tint: 0x6f5bd4,
    hp: 300, speed: 3.3, bounty: 24, leak: 1, float: true,
    armor: 0.1, warding: 0.55, anim: { move: 'Flying', death: 'Death' },
  },
  alien_strider: {
    name: 'Rift Strider', model: 'alien', scale: 0.95, radius: 0.6,
    hp: 240, speed: 4.6, bounty: 24, leak: 1, traits: ['fast'],
    armor: 0.2, warding: 0.2, anim: { move: 'Walk', death: 'Death' },
  },
  glub_evolved: {
    name: 'Sprite Matriarch', model: 'glub_evolved', scale: 1.15, radius: 0.8, tint: 0xb891ff,
    hp: 1150, speed: 2.6, bounty: 85, leak: 2, flying: true, traits: ['heavy'],
    armor: 0.1, warding: 0.5, anim: { move: 'Flying', death: 'Death' },
  },
  goleling_evolved: {
    name: 'Nova Golem', model: 'goleling_evolved', scale: 1.3, radius: 0.9,
    hp: 1500, speed: 2.0, bounty: 110, leak: 2, float: true, traits: ['heavy', 'shielded'], shield: 8,
    armor: 0.4, warding: 0.35, anim: { move: 'Flying', death: 'Death' },
  },
  astral_wyrm: {
    name: 'Astral Wyrm', model: 'astral_wyrm', scale: 2.2, radius: 1.25,
    hp: 14000, speed: 1.55, bounty: 700, leak: 5, boss: true, flying: false, float: true,
    armor: 0.3, warding: 0.4, anim: { move: 'Flying', death: 'Death' },
    abilities: ['starShield', 'riftHop', 'summonGlubs'],
  },
};

export function enemyDef(id) {
  const d = ENEMIES[id];
  if (!d) throw new Error('unknown enemy ' + id);
  return d;
}
