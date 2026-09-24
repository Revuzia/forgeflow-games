// BLOCKTOOTH — biome definitions (CONTRACT.md §1, §6.2, §7.1, §13). THREE-FREE data.
// Owner: city-sim lane. Views read `palette` (hex strings, sRGB, NeutralToneMapping),
// the mesh kit builds archetypes BY SHAPE (ids are internal), citygen reads the rest.
//
// Tier-band arrays are [lot/plaza, tier1, tier2, tier3, tier4]: index 0 is the weight of a
// parcel becoming an open lot (plaza / yard / container apron) instead of a building.

import type { BiomeDef, BiomeId, BuildingArchetype } from '../core/types.ts';

// ─────────────────────────────── GRID-EAST ───────────────────────────────
const GRID_EAST_ARCH: BuildingArchetype[] = [
  // tier 1 — street-level shops, a baby titan's first wall
  { id: 'ge_shopfront', shape: 'box', tier: 1, floorH: 4, floors: [1, 2], footprint: [8, 16], weight: 1.0, body: 'bodyA', trim: 'trimA', roof: 'roofA', signage: true },
  { id: 'ge_cafe', shape: 'box', tier: 1, floorH: 4, floors: [1, 2], footprint: [8, 14], weight: 0.7, body: 'bodyC', trim: 'trimB', roof: 'roofB', signage: true },
  // tier 2 — walk-ups and apartment mid-rises
  { id: 'ge_walkup', shape: 'box', tier: 2, floorH: 3.5, floors: [4, 7], footprint: [12, 20], weight: 1.0, body: 'bodyB', trim: 'trimA', roof: 'roofA', signage: false },
  { id: 'ge_apartment', shape: 'box', tier: 2, floorH: 3.5, floors: [5, 8], footprint: [14, 22], weight: 0.8, body: 'bodyA', trim: 'trimB', roof: 'roofB', signage: false },
  // tier 3 — offices and hotels
  { id: 'ge_office', shape: 'box', tier: 3, floorH: 3.6, floors: [10, 18], footprint: [16, 26], weight: 1.0, body: 'bodyC', trim: 'trimB', roof: 'roofB', signage: true },
  { id: 'ge_hotel', shape: 'box', tier: 3, floorH: 3.6, floors: [12, 18], footprint: [16, 24], weight: 0.6, body: 'bodyB', trim: 'trimA', roof: 'roofA', signage: true },
  // tier 4 — podium megatower (the skyline)
  { id: 'ge_megatower', shape: 'podium', tier: 4, floorH: 3.6, floors: [24, 36], footprint: [22, 30], weight: 1.0, body: 'bodyC', trim: 'trimB', roof: 'roofB', signage: true },
];

// ─────────────────────────────── WHITE STACKS ───────────────────────────────
const WHITE_STACKS_ARCH: BuildingArchetype[] = [
  // tier 1 — sheds and gatehouses
  { id: 'ws_shed', shape: 'shed', tier: 1, floorH: 5, floors: [1, 2], footprint: [10, 18], weight: 1.0, body: 'bodyC', trim: 'trimA', roof: 'roofA', signage: false },
  { id: 'ws_gatehouse', shape: 'box', tier: 1, floorH: 3.5, floors: [1, 2], footprint: [8, 12], weight: 0.5, body: 'bodyA', trim: 'trimA', roof: 'roofA', signage: true },
  // tier 2 — warehouses, tanks, dishes
  { id: 'ws_warehouse', shape: 'shed', tier: 2, floorH: 5, floors: [3, 4], footprint: [16, 26], weight: 1.0, body: 'bodyB', trim: 'trimA', roof: 'roofB', signage: true },
  { id: 'ws_tank', shape: 'cylinder', tier: 2, floorH: 3, floors: [4, 7], footprint: [10, 16], weight: 0.9, body: 'bodyC', trim: 'trimB', roof: 'roofA', signage: false },
  { id: 'ws_dish', shape: 'dish', tier: 2, floorH: 3, floors: [3, 5], footprint: [10, 14], weight: 0.5, body: 'bodyC', trim: 'trimA', roof: 'roofA', signage: false },
  // tier 3 — brick factories and smoke stacks
  { id: 'ws_factory', shape: 'box', tier: 3, floorH: 4.5, floors: [6, 10], footprint: [14, 26], weight: 1.0, body: 'bodyA', trim: 'trimA', roof: 'roofB', signage: true },
  { id: 'ws_chimney', shape: 'chimney', tier: 3, floorH: 3.5, floors: [12, 20], footprint: [6, 8], weight: 0.3, body: 'bodyB', trim: 'trimA', roof: 'roofA', signage: false },
  // tier 4 — cooling towers
  { id: 'ws_cooling', shape: 'cylinder', tier: 4, floorH: 4, floors: [18, 26], footprint: [22, 32], weight: 1.0, body: 'bodyC', trim: 'trimB', roof: 'roofA', signage: false },
];

// ─────────────────────────────── LOCKWATER ───────────────────────────────
const LOCKWATER_ARCH: BuildingArchetype[] = [
  // tier 1 — low container stacks and bait shacks
  { id: 'lw_stack_low', shape: 'containers', tier: 1, floorH: 2.6, floors: [1, 2], footprint: [6, 13], weight: 1.0, body: 'bodyC', trim: 'trimA', roof: 'bodyB', signage: false },
  { id: 'lw_shack', shape: 'shed', tier: 1, floorH: 3.5, floors: [1, 2], footprint: [8, 12], weight: 0.6, body: 'bodyA', trim: 'trimA', roof: 'roofA', signage: true },
  // tier 2 — tall stacks and harbour warehouses
  { id: 'lw_stack_high', shape: 'containers', tier: 2, floorH: 2.6, floors: [3, 6], footprint: [6, 13], weight: 1.0, body: 'bodyA', trim: 'trimA', roof: 'bodyC', signage: false },
  { id: 'lw_warehouse', shape: 'shed', tier: 2, floorH: 5, floors: [2, 4], footprint: [14, 24], weight: 0.8, body: 'bodyB', trim: 'trimB', roof: 'roofA', signage: true },
  // tier 3 — neon offices and dock gantries
  { id: 'lw_neon_office', shape: 'box', tier: 3, floorH: 3.5, floors: [8, 14], footprint: [14, 22], weight: 1.0, body: 'bodyB', trim: 'trimA', roof: 'roofA', signage: true },
  { id: 'lw_gantry', shape: 'gantry', tier: 3, floorH: 4, floors: [10, 14], footprint: [18, 26], weight: 0.35, body: 'bodyC', trim: 'trimA', roof: 'roofB', signage: false },
  // tier 4 — harbour tower
  { id: 'lw_harbour_tower', shape: 'podium', tier: 4, floorH: 3.6, floors: [20, 30], footprint: [20, 28], weight: 1.0, body: 'bodyB', trim: 'trimB', roof: 'roofA', signage: true },
];

export const BIOMES: Record<BiomeId, BiomeDef> = {
  grideast: {
    id: 'grideast',
    name: 'GRID-EAST',
    subtitle: 'daytime commercial blocks',
    lore: [
      'Fourteen blocks by fourteen of cafés, walk-ups and glass towers, zoned for commerce and light foot traffic.',
      'Blossom season. Parking enforcement at full strength.',
      'The Planning Office rates local structures "adequate for ordinary weather". Nobody defined ordinary.',
    ],
    slate: 'UNIDENTIFIED MASS — DOWNTOWN GRID',
    time: 'day',
    weather: 'none',
    blocks: [14, 14],
    flooded: false,
    palette: {
      sky: '#9fd8f0', skyHorizon: '#fbe9d2', fog: '#f4e6d4',
      ground: '#c9d8b2', road: '#2f7f86', roadLine: '#f4ecd8', sidewalk: '#d9d2c3', curb: '#b9b2a3', crosswalk: '#f6f0e0',
      bodyA: '#f1e4c8', bodyB: '#e8d5b0', bodyC: '#cfe3df',
      trimA: '#a8876a', trimB: '#6f8f8c',
      roofA: '#c9b79a', roofB: '#8fa7a3',
      glass: '#5f9fb3', glassLit: '#fff1c9',
      sign: '#ff6f5e', signB: '#ffd166',
      foliage: '#f7a8c4', foliageB: '#e98bb0',
      water: '#4fb3c4', waterGlow: '#9fe3ea',
      sun: '#fff1dc', ambient: '#9ec9d9', rim: '#ffd6e6',
      telegraph: '#ff4fa0',
    },
    archetypes: GRID_EAST_ARCH,
    tierCentre: [0.03, 0.08, 0.22, 0.37, 0.30],
    tierEdge: [0.10, 0.62, 0.24, 0.04, 0.0],
    props: [
      { kind: 'lamp', perBlock: 6 }, { kind: 'hydrant', perBlock: 2 }, { kind: 'tree', perBlock: 5 },
      { kind: 'bench', perBlock: 2 }, { kind: 'kiosk', perBlock: 1 }, { kind: 'vending', perBlock: 1.5 },
      { kind: 'signpost', perBlock: 2 }, { kind: 'bollard', perBlock: 2 },
      // parked along the curbs
      { kind: 'car', perBlock: 5 }, { kind: 'taxi', perBlock: 2 }, { kind: 'van', perBlock: 1 },
      { kind: 'truck', perBlock: 0.3 }, { kind: 'bus', perBlock: 0.25 },
    ],
    trafficPerLane: 3,
    boss: 'caisson4',
    enemyBias: { android: 1.2, squad: 1.1, buggy: 1.0, drone: 0.9, tank: 0.9, walker: 0.9 },
    music: { bpm: 118, root: 51, scale: 'major', mood: 'city-pop funk, bright brass stabs, slap bass, sunny and oblivious' },
    // low afternoon sun, 30° elevation, from screen-RIGHT (a touch behind the camera). The camera
    // sits at +X+Z, so it sees the +X (lower-right) and +Z (lower-left) facades: +X is sunlit, +Z
    // sits in form shadow, and the long shadows stream screen-left across the streets.
    sunDir: [0.778, 0.5, -0.38],
  },

  whitestacks: {
    id: 'whitestacks',
    name: 'WHITE STACKS',
    subtitle: 'snowed industrial park',
    lore: [
      'Twelve blocks by twelve of tanks, dishes and cooling towers under a permanent grey lid.',
      'Snow clearance is scheduled for spring. Spring is under review.',
      'Residents are reminded that the chimneys are load-bearing for morale.',
    ],
    slate: 'UNIDENTIFIED MASS — WHITE STACKS',
    time: 'overcast',
    weather: 'snow',
    blocks: [12, 12],
    flooded: false,
    palette: {
      sky: '#c9d3dc', skyHorizon: '#eef2f5', fog: '#e2e8ee',
      ground: '#eef2f6', road: '#5d6670', roadLine: '#e8d36a', sidewalk: '#d3dae1', curb: '#a9b2bb', crosswalk: '#f3f5f7',
      bodyA: '#8e4a3a', bodyB: '#a65a44', bodyC: '#9aa4ad',
      trimA: '#3f454c', trimB: '#5b636b',
      roofA: '#f4f6f8', roofB: '#dfe6ec',
      glass: '#7d93a6', glassLit: '#ffd9a0',
      sign: '#ffb347', signB: '#e84a3c',
      foliage: '#5c7a6b', foliageB: '#486659',
      water: '#6f8797', waterGlow: '#a9bccb',
      sun: '#e9f1ff', ambient: '#b8c6d4', rim: '#dfe8ff',
      telegraph: '#ff4fa0',
    },
    archetypes: WHITE_STACKS_ARCH,
    tierCentre: [0.05, 0.10, 0.25, 0.35, 0.25],
    tierEdge: [0.16, 0.44, 0.32, 0.08, 0.0],
    props: [
      { kind: 'lamp', perBlock: 4 }, { kind: 'hydrant', perBlock: 1.5 }, { kind: 'tree', perBlock: 2 },
      { kind: 'signpost', perBlock: 1.5 }, { kind: 'snowbank', perBlock: 4 }, { kind: 'barrier', perBlock: 2 },
      { kind: 'drum', perBlock: 3 }, { kind: 'forklift', perBlock: 0.8 }, { kind: 'pylon', perBlock: 1.2 },
      { kind: 'container', perBlock: 0.8 }, { kind: 'vending', perBlock: 0.5 }, { kind: 'kiosk', perBlock: 0.5 },
      { kind: 'bench', perBlock: 0.5 },
      // parked along the curbs
      { kind: 'car', perBlock: 2 }, { kind: 'van', perBlock: 1.5 }, { kind: 'truck', perBlock: 1 },
    ],
    trafficPerLane: 1,
    boss: 'irongully',
    enemyBias: { tank: 1.6, walker: 1.5, apc: 1.25, drone: 0.7, buggy: 0.85 },
    music: { bpm: 96, root: 45, scale: 'minor', mood: 'industrial minor, metallic percussion, cold pads, steam hiss' },
    // flat overcast light, low and cool (28° elevation) from screen-LEFT: the +Z facades take the
    // light, +X falls into shade, shadows drift screen-right over the snow
    sunDir: [-0.4, 0.469, 0.787],
  },

  lockwater: {
    id: 'lockwater',
    name: 'LOCKWATER',
    subtitle: 'flooded container port at night',
    lore: [
      'Twelve blocks by fourteen of stacked freight, most of it now standing in the tide.',
      'The harbour authority has closed the streets to cars and reopened them to boats.',
      'Night shift reported a large shape moving between the containers. Night shift has been sent home.',
    ],
    slate: 'UNIDENTIFIED MASS — LOCKWATER',
    time: 'night',
    weather: 'rain',
    blocks: [12, 14],
    flooded: true,
    palette: {
      sky: '#0b1022', skyHorizon: '#1c2140', fog: '#151b34',
      ground: '#1a2230', road: '#0d1a26', roadLine: '#3ff0ff', sidewalk: '#2a2f3a', curb: '#3a404c', crosswalk: '#a9b8c6',
      bodyA: '#9c4a2c', bodyB: '#3b6e8f', bodyC: '#c7a13a',
      trimA: '#1e242e', trimB: '#2c3440',
      roofA: '#39404d', roofB: '#2e3440',
      glass: '#1b2a3a', glassLit: '#ffcf7a',
      sign: '#ff3fa4', signB: '#3ff0ff',
      foliage: '#2f4a3f', foliageB: '#24392f',
      water: '#0d1a26', waterGlow: '#1f4a66',
      sun: '#8fa8ff', ambient: '#2a3558', rim: '#ff3fa4',
      telegraph: '#ff4fa0',
    },
    archetypes: LOCKWATER_ARCH,
    tierCentre: [0.03, 0.08, 0.20, 0.37, 0.32],
    tierEdge: [0.14, 0.46, 0.32, 0.08, 0.0],
    props: [
      { kind: 'lamp', perBlock: 4 }, { kind: 'bollard', perBlock: 4 }, { kind: 'drum', perBlock: 3 },
      { kind: 'container', perBlock: 1.5 }, { kind: 'forklift', perBlock: 0.8 }, { kind: 'barrier', perBlock: 1.5 },
      { kind: 'signpost', perBlock: 1 }, { kind: 'kiosk', perBlock: 0.6 }, { kind: 'vending', perBlock: 1 },
      { kind: 'hydrant', perBlock: 1 }, { kind: 'tree', perBlock: 0.5 },
      // moored along the flooded curbs + a few stranded cars
      { kind: 'boat', perBlock: 1.5 }, { kind: 'car', perBlock: 1.2 }, { kind: 'van', perBlock: 0.8 },
      { kind: 'truck', perBlock: 0.3 },
    ],
    trafficPerLane: 1,               // boats, not cars (flooded streets)
    boss: 'caisson4',
    enemyBias: { drone: 1.7, buggy: 1.5, android: 1.0, tank: 0.7, walker: 0.8 },
    music: { bpm: 104, root: 50, scale: 'phrygian', mood: 'night synthwave, rain bed, low arpeggios, neon hum' },
    // low cold moon (32° elevation) hanging over the harbour (−Z) at screen-right: +X facades catch
    // the moonlight, +Z stays dark for the neon to read against, shadows fall screen-left
    sunDir: [0.509, 0.53, -0.678],
  },
};
