// The five worlds of the Stronghold campaign.
export const WORLDS = [
  {
    id: 'colosseum', name: 'Ancient Colosseum', tagline: 'The crowd howls for the fall of your keep',
    music: 'colosseum', groundTex: 'ground_colosseum',
    palette: {
      ground: 0xc8a86a, road: 0x9a7844, roadEdge: 0x6f5530, plaza: 0xd8ceb4,
      sky: 0xe8c890, fog: 0xdcb888, fogDensity: 0.006, sun: 0xffe8c0, sunIntensity: 1.2, ambient: 0xb09878,
      accent: 0xb03a2a,
    },
    surroundings: 'colosseum',
    particles: 'sandmotes',
    hazard: {
      id: 'gateRelease', name: 'Arena Gates',
      desc: 'The arena gates periodically release a bonus squad onto a random road!',
      interval: [26, 34],
    },
    pool: ['legionnaire', 'arena_hound', 'phalanx', 'laurel_wisp'],
    elite: 'chariot', boss: 'colossus_boss',
    bossIntro: 'Colossus Aurelius enters the arena — his rally cry hastens the horde and his shield wall soaks your shots!',
    bastion: 'colosseumKeep',
  },
  {
    id: 'gothic', name: 'Gothic Castle', tagline: 'A midnight siege under a broken moon',
    music: 'gothic', groundTex: 'ground_gothic',
    palette: {
      ground: 0x59616c, road: 0x3e454f, roadEdge: 0x2a2f38, plaza: 0x6b7684,
      sky: 0x222a40, fog: 0x323c56, fogDensity: 0.0072, sun: 0xaec2e8, sunIntensity: 1.05, ambient: 0x8494b0,
      accent: 0x8a2a3a,
    },
    surroundings: 'crags',
    particles: 'rain',
    hazard: {
      id: 'lightning', name: 'Storm Lightning',
      desc: 'Lightning strikes stun a random tower for 2.5s.',
      interval: [18, 26], stun: 2.5,
    },
    pool: ['ram', 'plague_swarm', 'cursed_knight', 'gargoyle'],
    elite: 'trebuchet', boss: 'siege_titan_boss',
    bossIntro: 'The Siege Titan lumbers forth — spawning battering rams and bolting on iron plates!',
    bastion: 'gothicKeep',
  },
  {
    id: 'sky', name: 'Floating Sky Citadel', tagline: 'Hold the last rock above the endless clouds',
    music: 'sky', groundTex: 'ground_sky',
    palette: {
      ground: 0xd8e2ea, road: 0xaab8c8, roadEdge: 0x8494a8, plaza: 0xecf2f6,
      sky: 0x9fc8ea, fog: 0xc2dcf0, fogDensity: 0.006, sun: 0xfff4dc, sunIntensity: 1.15, ambient: 0x9cb4cc,
      accent: 0x3a78b0,
    },
    surroundings: 'skyisles',
    particles: 'cloudwisps',
    hazard: {
      id: 'tailwind', name: 'Tailwinds',
      desc: 'Gusts periodically hasten ALL enemies for 4s.',
      interval: [22, 30], haste: 0.45, duration: 4,
    },
    pool: ['wind_wisp', 'sky_skiff', 'cloud_ray', 'zephyr_twin'],
    elite: 'storm_herald', boss: 'leviathan_boss',
    bossIntro: 'The Gale Leviathan rises — a FLYING terror. Cauldrons and road traps cannot touch it!',
    bastion: 'skySpire',
  },
  {
    id: 'crystal', name: 'Crystal Fortress', tagline: 'Every shard sings — and hungers',
    music: 'crystal', groundTex: 'ground_crystal',
    palette: {
      ground: 0x5a4a8a, road: 0x42356a, roadEdge: 0x2e2450, plaza: 0x7a68b0,
      sky: 0x2a2050, fog: 0x3c3064, fogDensity: 0.007, sun: 0xe0d0ff, sunIntensity: 1.15, ambient: 0xa090cc,
      accent: 0xc86ae0,
    },
    surroundings: 'cavern',
    particles: 'sparkles',
    hazard: {
      id: 'resonance', name: 'Crystal Resonance',
      desc: 'Resonance zones: towers inside fire 25% faster, but enemies inside move 25% faster.',
      zones: 2, radius: 3.4, rateBonus: 0.25, hasteBonus: 0.25,
    },
    pool: ['skitterer', 'prism_golem', 'light_moth', 'zephyr_twin'],
    pool2: ['refractor'],
    elite: 'geode_brute', boss: 'prism_boss',
    bossIntro: 'The Prime Prism awakens — cycling immunity to physical and magic. Strike with BOTH!',
    bastion: 'crystalPalace',
  },
  {
    id: 'dwarven', name: 'Dwarven Mountain Hold', tagline: 'The forges never cool. Neither do the wars',
    music: 'dwarven', groundTex: 'ground_dwarven',
    palette: {
      ground: 0x54423a, road: 0x3c2e28, roadEdge: 0x2a201c, plaza: 0x6a544a,
      sky: 0x33221a, fog: 0x4c2e20, fogDensity: 0.0075, sun: 0xffc08a, sunIntensity: 1.1, ambient: 0xa06a50,
      accent: 0xe07828,
    },
    surroundings: 'forgehall',
    particles: 'embers',
    hazard: {
      id: 'minecarts', name: 'Mine Carts',
      desc: 'Runaway carts periodically barrel across the roads, crushing enemies in their way!',
      interval: [20, 28], dmg: 60,
    },
    pool: ['drill_crawler', 'keg_runner', 'ore_golem', 'gyrocopter'],
    pool2: ['forge_sentinel'],
    elite: 'forge_sentinel', boss: 'forge_engine_boss',
    bossIntro: 'The Magma Forge Engine rolls out — overdriving, deploying powder kegs, bolting on plating!',
    bastion: 'forgeHold',
  },
];

export const LEVELS_PER_WORLD = 9;

export function worldDef(wi) {
  const w = WORLDS[wi];
  if (!w) throw new Error('unknown world ' + wi);
  return w;
}
