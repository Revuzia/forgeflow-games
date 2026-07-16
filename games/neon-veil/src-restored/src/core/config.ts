import type { MapDef, Settings, WeaponDef } from './types';

export const TITLE = 'Neon Veil';
export const TAGLINE = 'NEON SKIES · OUTLAW HUNTS · DOGFIGHTS';

export const DEFAULT_SETTINGS: Settings = {
  mouseSens: 1.0,
  volume: 0.6,
  invertY: false,
  mute: false,
};

export const WEAPONS: Record<string, WeaponDef> = {
  plasma: {
    id: 'plasma',
    name: 'PLASMA',
    damage: 18,
    fireRate: 6,
    projectileSpeed: 220,
    splashRadius: 0,
    ammo: -1,
    heatPerShot: 0,
    selfDamageScale: 0,
    color: 0x00f0ff,
    trailColor: 0x66ffff,
  },
  rocket: {
    id: 'rocket',
    name: 'ROCKET',
    damage: 72,
    fireRate: 0.55,
    projectileSpeed: 78,
    splashRadius: 16,
    ammo: 4, // scarce heat-seekers
    heatPerShot: 0,
    selfDamageScale: 0.45,
    color: 0xff6b2b,
    trailColor: 0xffaa44,
  },
  rail: {
    id: 'rail',
    name: 'RAIL',
    damage: 95,
    fireRate: 0.55,
    projectileSpeed: 0,
    splashRadius: 0,
    ammo: 8,
    heatPerShot: 0,
    selfDamageScale: 0,
    color: 0xff2bd6,
    trailColor: 0xff66ee,
  },
  laser: {
    id: 'laser',
    name: 'LASER',
    damage: 9,
    fireRate: 14,
    projectileSpeed: 0,
    splashRadius: 0,
    ammo: 80,
    heatPerShot: 0,
    selfDamageScale: 0,
    color: 0x39ff88,
    trailColor: 0x88ffaa,
  },
  torpedo: {
    id: 'torpedo',
    name: 'TORPEDO',
    damage: 110,
    fireRate: 0.45,
    projectileSpeed: 55,
    splashRadius: 22,
    ammo: 4,
    heatPerShot: 0,
    selfDamageScale: 0.7,
    color: 0xff3311,
    trailColor: 0xff8844,
  },
  scatter: {
    id: 'scatter',
    name: 'SCATTER',
    damage: 11,
    fireRate: 2.2,
    projectileSpeed: 160,
    splashRadius: 0,
    ammo: 24,
    heatPerShot: 0,
    selfDamageScale: 0,
    color: 0xffe566,
    trailColor: 0xfff0aa,
  },
};

export const FLIGHT = {
  maxSpeed: 95,
  afterburnerMax: 155,
  accel: 55,
  strafeAccel: 42,
  verticalAccel: 48,
  drag: 1.8,
  afterburnerDrag: 0.9,
  mouseYaw: 1.8,
  mousePitch: 1.5,
  rollFromYaw: 0.35,
  energyMax: 100,
  energyDrain: 28,
  energyRegen: 12,
  fovNormal: 70,
  fovBoost: 88,
  collisionDamage: 25,
  bounceRestitution: 0.45,
};

export const COMBAT = {
  maxHealth: 100,
  maxShield: 100,
  shieldRegenDelay: 3.2,
  shieldRegenRate: 18,
  shieldDeployCost: 100,
  shieldDeployDuration: 3.5,
  shieldAbsorb: 1.0,
  respawnDelay: 2.5,
  hitMarkerMs: 120,
  /**
   * Hit spheres — slight bump over bare mesh (~2.4) so lead shots register,
   * not giant aim-magnet blobs.
   */
  enemyHitRadius: 2.85,
  enemyHitscanRadius: 2.7,
  localHitRadius: 2.35,
  projectileHitRadius: 0.55,
  /** Very mild aim pull — skill still required. */
  aimAssist: 0.032,
  aimAssistRange: 110,
  aimAssistCone: 0.12,
};

/** Rocket heat-seek requires a full lock latch before fire. */
export const MISSILE_LOCK = {
  /** Seconds holding aim on target to latch. */
  acquireSec: 1.15,
  /** How fast lock decays when aim leaves target. */
  decaySec: 0.45,
  maxRange: 165,
  /** Min aim·toTarget (cos) — ~22° cone. */
  coneDot: 0.92,
  /** Require LOS through city (no lock through towers). */
  requireLos: true,
};

export const MAPS: Record<string, MapDef> = {
  'sky-city': {
    id: 'sky-city',
    name: 'SKY CITY',
    bounds: 840,
    minAlt: 8,
    maxAlt: 220,
    fogColor: 0x3a0a48,
    fogDensity: 0.0009,
    ambient: 0x3a2260,
    sunColor: 0xff7744,
    sunIntensity: 1.35,
    skyTop: 0x140428,
    skyBottom: 0xff3a88,
    style: 'open',
    hasGround: true,
    spawnPoints: [
      [0, 40, 80],
      [60, 50, -40],
      [-70, 45, 30],
      [40, 60, 100],
      [-50, 55, -90],
      [100, 40, 20],
      [-90, 70, 60],
      [20, 35, -120],
    ],
  },
  'the-pit': {
    id: 'the-pit',
    name: 'THE PIT',
    bounds: 400,
    minAlt: 6,
    maxAlt: 140,
    fogColor: 0x2a1040,
    fogDensity: 0.0018,
    ambient: 0x221133,
    sunColor: 0xaa66ff,
    sunIntensity: 0.9,
    skyTop: 0x0a0418,
    skyBottom: 0x661144,
    style: 'pit',
    hasGround: true,
    spawnPoints: [
      [0, 30, 40],
      [35, 25, -30],
      [-40, 35, 10],
      [20, 50, -50],
      [-25, 40, 55],
      [50, 28, 20],
    ],
  },
  'cloud-sea': {
    id: 'cloud-sea',
    name: 'CLOUD SEA',
    bounds: 960,
    minAlt: 20,
    maxAlt: 200,
    fogColor: 0x8ab4d8,
    fogDensity: 0.0010,
    ambient: 0x88aacc,
    sunColor: 0xfff0c8,
    sunIntensity: 1.8,
    skyTop: 0x5a9ad0,
    skyBottom: 0xe8f0ff,
    style: 'clouds',
    hasGround: true,
    spawnPoints: [
      [0, 70, 60],
      [80, 85, -50],
      [-90, 75, 40],
      [40, 95, 100],
      [-60, 80, -80],
    ],
  },
  'upper-atmo': {
    id: 'upper-atmo',
    name: 'UPPER ATMO',
    bounds: 1000,
    minAlt: 10,
    maxAlt: 280,
    fogColor: 0x0a1838,
    fogDensity: 0.0004,
    ambient: 0x334466,
    sunColor: 0xffe8cc,
    sunIntensity: 1.35,
    skyTop: 0x020510,
    skyBottom: 0x1a4080,
    style: 'atmo',
    hasGround: false,
    spawnPoints: [
      [0, 80, 50],
      [100, 100, -40],
      [-80, 90, 70],
      [50, 120, -90],
    ],
  },
  'deep-space': {
    id: 'deep-space',
    name: 'DEEP SPACE',
    bounds: 1040,
    minAlt: -180,
    maxAlt: 220,
    fogColor: 0x050510,
    fogDensity: 0.00022,
    ambient: 0x110822,
    sunColor: 0x8866ff,
    sunIntensity: 0.55,
    skyTop: 0x020208,
    skyBottom: 0x0a0418,
    style: 'space',
    hasGround: false,
    spawnPoints: [
      [0, 20, 40],
      [70, -20, -50],
      [-60, 40, 30],
      [30, 10, -80],
    ],
  },
};

export const OUTLAW = {
  rounds: 4,
  targetsPerRound: [3, 4, 5, 6],
  roundTime: 90,
  lives: 3,
  killScore: 100,
  timeBonusPerSec: 2,
};

export const MULTIPLAYER = {
  /**
   * Rivals per sector in FFA. Maps are 2× size — keep count modest so you
   * rarely get 3–4 dogs on you at once.
   */
  botCount: 6,
  matchTime: 300,
  ffa: true,
};

/** Ambient rivals in Free Roam (per sector instance). */
export const FREEROAM = {
  rivalCount: 5,
};

export const PICKUPS = {
  collectRadius: 5.5,
  mapCount: 24,
  /** Seconds before a collected crate reappears for anyone. */
  respawnSec: 20,
  rocketPickupAmmo: 2,
};
