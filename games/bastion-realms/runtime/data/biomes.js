// Biome definitions: visual palette, decor prop sets, hazards, enemy pools, boss.
// Pure data. Colors are hex ints for three.js; css strings derived in UI.

export const BIOMES = [
  {
    id: 'forest', name: 'Verdant Hollow', tagline: 'Where the wild woods bite back',
    music: 'forest',
    ground: { base: 0x3d7a35, dark: 0x2c5c28, light: 0x55934a, path: 0x8a6b42, pathEdge: 0x6b5233 },
    sky: 0x87b5d6, fogColor: 0x9cc4dd, fogDensity: 0.006, sun: 0xfff2d8, sunIntensity: 1.15,
    ambient: 0x88a08c,
    decor: [
      { model: 'f_pine', scale: [3.0, 4.4], weight: 4 },
      { model: 'f_birch', scale: [2.6, 3.8], weight: 3 },
      { model: 'f_bush', scale: [0.8, 1.3], weight: 2 },
      { model: 'f_mushroom', scale: [0.7, 1.1], weight: 1 },
      { model: 'f_stump', scale: [0.5, 0.8], weight: 1 },
      { model: 'f_fern', scale: [0.5, 0.9], weight: 2 },
      { model: 'f_flower', scale: [0.4, 0.7], weight: 1 },
    ],
    particles: 'fireflies',
    hazard: null,
    pool: ['goblin', 'wolf', 'spider', 'armabee', 'mushnub'],
    elite: 'ent_elder', boss: 'mushroom_king',
    bossIntro: 'The Mushroom King awakens. He heals his kin and summons Mushnubs — burst him down!',
  },
  {
    id: 'volcanic', name: 'Cinder Wastes', tagline: 'The mountain’s fury never sleeps',
    music: 'volcanic',
    ground: { base: 0x4a3532, dark: 0x33211f, light: 0x62443c, path: 0x2b2320, pathEdge: 0x542e1c },
    sky: 0x3b2020, fogColor: 0x54281c, fogDensity: 0.0085, sun: 0xffb37a, sunIntensity: 0.95,
    ambient: 0x7a4438,
    decor: [
      { model: 'v_deadtrees', scale: [2.4, 3.6], weight: 3 },
      { model: 'v_rockform', scale: [1.4, 2.6], weight: 3 },
      { model: 'v_boulder', scale: [0.9, 1.7], weight: 2 },
      { model: 'v_volcano', scale: [4.5, 6.0], weight: 1, fringeOnly: true },
    ],
    particles: 'embers',
    hazard: {
      id: 'lavaVent', name: 'Lava Vents',
      desc: 'Vents erupt on marked cells, stunning towers built there for 3s.',
      interval: [14, 20], stun: 3, telegraph: 2.2,
    },
    pool: ['fire_imp', 'lava_slug', 'ash_bat', 'cinder_whelp'],
    elite: 'blue_demon', boss: 'magma_dragon',
    bossIntro: 'The Magma Dragon descends. Wing gusts speed up his brood and embers rain on your towers!',
  },
  {
    id: 'tundra', name: 'Frostmaw Expanse', tagline: 'The cold hunts alongside the beasts',
    music: 'tundra',
    ground: { base: 0xd8e4ec, dark: 0xb4c6d4, light: 0xf0f7fb, path: 0x8fa8b8, pathEdge: 0x7391a4 },
    sky: 0xbfd9e8, fogColor: 0xcfe3ee, fogDensity: 0.007, sun: 0xeaf4ff, sunIntensity: 1.05,
    ambient: 0x9fb4c4,
    decor: [
      { model: 't_pinesnow', scale: [3.0, 4.4], weight: 4 },
      { model: 't_birchsnow', scale: [2.6, 3.8], weight: 3 },
      { model: 't_deadsnow', scale: [2.2, 3.2], weight: 2 },
      { model: 't_snowtrees', scale: [2.6, 3.8], weight: 2 },
      { model: 't_iceberg', scale: [2.0, 3.4], weight: 1, fringeOnly: true },
    ],
    particles: 'snow',
    hazard: {
      id: 'blizzard', name: 'Blizzards',
      desc: 'Gusts periodically chill ALL towers: -15% fire rate for 10s.',
      interval: [22, 30], duration: 10, ratePenalty: 0.15, telegraph: 3,
    },
    pool: ['ice_troll', 'frost_wolf', 'hywirl', 'snow_hare'],
    elite: 'yeti_brute', boss: 'frost_behemoth',
    bossIntro: 'The Frost Behemoth stirs. Ice shields soak your shots — Storm Coils shred them!',
  },
  {
    id: 'ruins', name: 'Sunken Ruins', tagline: 'The dead defend what the living lost',
    music: 'ruins',
    ground: { base: 0x4e5548, dark: 0x393f35, light: 0x646c5b, path: 0x6e6a58, pathEdge: 0x504d40 },
    sky: 0x2c332e, fogColor: 0x44514a, fogDensity: 0.011, sun: 0xb8d4a8, sunIntensity: 0.8,
    ambient: 0x5f7263,
    decor: [
      { model: 'r_pillars', scale: [2.0, 2.8], weight: 2 },
      { model: 'r_pillar', scale: [1.8, 2.6], weight: 2 },
      { model: 'r_column', scale: [1.8, 2.4], weight: 2 },
      { model: 'r_archgate', scale: [2.6, 3.2], weight: 1 },
      { model: 'r_statue', scale: [1.7, 2.2], weight: 1 },
      { model: 'r_gravestone_cross', scale: [0.8, 1.2], weight: 2 },
      { model: 'r_gravestone_round', scale: [0.8, 1.2], weight: 2 },
      { model: 'r_gravestone_broken', scale: [0.7, 1.0], weight: 1 },
      { model: 'r_pillar_obelisk', scale: [1.6, 2.2], weight: 1 },
      { model: 'r_crypt_small', scale: [2.0, 2.6], weight: 1, fringeOnly: true },
      { model: 'r_lantern_glass', scale: [0.9, 1.2], weight: 1 },
    ],
    particles: 'ghostlights',
    hazard: {
      id: 'fogbank', name: 'Grave Fog',
      desc: 'Cursed fog banks drift over marked zones: towers inside lose 20% range.',
      zones: 2, radius: 3.2, rangePenalty: 0.2,
    },
    pool: ['skeleton', 'zombie', 'wraith'],
    elite: 'necromancer', boss: 'lich_skull',
    bossIntro: 'The Lich Skull rises — summoning skeletons and phasing beyond physical harm. Magic prevails!',
  },
  {
    id: 'astral', name: 'Astral Isles', tagline: 'Reality frays at the world’s edge',
    music: 'astral',
    ground: { base: 0x3a3358, dark: 0x272144, light: 0x4d4470, path: 0x8578b8, pathEdge: 0x5f5590 },
    sky: 0x0d0a24, fogColor: 0x1d1740, fogDensity: 0.008, sun: 0xc4b2ff, sunIntensity: 1.1,
    ambient: 0x8a7cc0,
    decor: [
      { model: 'a_crystal', scale: [1.2, 2.4], weight: 4, glow: true },
      { model: 'a_crystalrock', scale: [1.2, 2.2], weight: 3, glow: true },
      { model: 'a_gemblue', scale: [0.7, 1.4], weight: 2, glow: true },
      { model: 'a_gemgreen', scale: [0.7, 1.4], weight: 2, glow: true },
      { model: 'a_shrine', scale: [1.8, 2.4], weight: 1 },
    ],
    particles: 'stardust',
    hazard: {
      id: 'manaSurge', name: 'Mana Surges',
      desc: 'Wild magic surges through a random tower: +50% fire rate for 8s.',
      interval: [15, 22], duration: 8, rateBonus: 0.5,
    },
    pool: ['glub', 'goleling', 'squidle', 'alien_strider'],
    elite: 'goleling_evolved', elite2: 'glub_evolved', boss: 'astral_wyrm',
    bossIntro: 'The Astral Wyrm breaches reality — star shields, rift hops, and sprite swarms. Hold the line!',
  },
];

export const LEVELS_PER_BIOME = 9;

export function biomeDef(bi) {
  const b = BIOMES[bi];
  if (!b) throw new Error('unknown biome ' + bi);
  return b;
}
