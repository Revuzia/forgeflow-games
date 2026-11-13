// city-kit scratch fixtures: self-contained BiomeDefs carrying the CONTRACT §6.2 palettes and a
// representative archetype list per shape (so the preview never depends on data/biomes.ts).
import type { BiomeDef, BiomeId, BiomePalette, BuildingArchetype } from '../../../src/core/types.ts';

const A = (id: string, shape: BuildingArchetype['shape'], tier: BuildingArchetype['tier'], floorH: number,
  floors: [number, number], footprint: [number, number], body: keyof BiomePalette, trim: keyof BiomePalette,
  roof: keyof BiomePalette, signage: boolean): BuildingArchetype =>
  ({ id, shape, tier, floorH, floors, footprint, weight: 1, body, trim, roof, signage });

const GE: BiomePalette = {
  sky: '#9fd8f0', skyHorizon: '#fbe9d2', fog: '#f4e6d4',
  ground: '#c9d8b2', road: '#2f7f86', roadLine: '#f4ecd8', sidewalk: '#d9d2c3', curb: '#b9b2a3', crosswalk: '#f6f0e0',
  bodyA: '#f1e4c8', bodyB: '#e8d5b0', bodyC: '#cfe3df', trimA: '#a8876a', trimB: '#6f8f8c',
  roofA: '#c9b79a', roofB: '#8fa7a3', glass: '#5f9fb3', glassLit: '#fff1c9', sign: '#ff6f5e', signB: '#ffd166',
  foliage: '#f7a8c4', foliageB: '#e98bb0', water: '#4fb3c4', waterGlow: '#9fe3ea',
  sun: '#fff1dc', ambient: '#9ec9d9', rim: '#ffd6e6', telegraph: '#ff4fa0',
};
const WS: BiomePalette = {
  sky: '#c9d3dc', skyHorizon: '#eef2f5', fog: '#e2e8ee',
  ground: '#eef2f6', road: '#5d6670', roadLine: '#e8d36a', sidewalk: '#d3dae1', curb: '#a9b2bb', crosswalk: '#f3f5f7',
  bodyA: '#8e4a3a', bodyB: '#a65a44', bodyC: '#9aa4ad', trimA: '#3f454c', trimB: '#5b636b',
  roofA: '#f4f6f8', roofB: '#dfe6ec', glass: '#7d93a6', glassLit: '#ffd9a0', sign: '#ffb347', signB: '#e84a3c',
  foliage: '#5c7a6b', foliageB: '#486659', water: '#6f8797', waterGlow: '#a9bccb',
  sun: '#e9f1ff', ambient: '#b8c6d4', rim: '#dfe8ff', telegraph: '#ff4fa0',
};
const LW: BiomePalette = {
  sky: '#0b1022', skyHorizon: '#1c2140', fog: '#151b34',
  ground: '#1a2230', road: '#0d1a26', roadLine: '#3ff0ff', sidewalk: '#2a2f3a', curb: '#3a404c', crosswalk: '#a9b8c6',
  bodyA: '#9c4a2c', bodyB: '#3b6e8f', bodyC: '#c7a13a', trimA: '#1e242e', trimB: '#2c3440',
  roofA: '#39404d', roofB: '#2e3440', glass: '#1b2a3a', glassLit: '#ffcf7a', sign: '#ff3fa4', signB: '#3ff0ff',
  foliage: '#2f4a3f', foliageB: '#24392f', water: '#0d1a26', waterGlow: '#1f4a66',
  sun: '#8fa8ff', ambient: '#2a3558', rim: '#ff3fa4', telegraph: '#ff4fa0',
};

function def(id: BiomeId, time: BiomeDef['time'], weather: BiomeDef['weather'], palette: BiomePalette,
  archetypes: BuildingArchetype[], sunDir: [number, number, number]): BiomeDef {
  return {
    id, name: id.toUpperCase(), subtitle: 'fixture', lore: [], slate: 'FIXTURE', time, weather,
    blocks: [2, 2], flooded: id === 'lockwater', palette, archetypes,
    tierCentre: [0, 0, 0, 0, 1], tierEdge: [1, 0, 0, 0, 0], props: [], trafficPerLane: 0, boss: 'caisson4',
    enemyBias: {}, music: { bpm: 100, root: 50, scale: 'major', mood: 'fixture' }, sunDir,
  };
}

export const FIXTURES: Record<BiomeId, BiomeDef> = {
  grideast: def('grideast', 'day', 'none', GE, [
    A('ge_shopfront', 'box', 1, 4, [1, 2], [8, 16], 'bodyA', 'trimA', 'roofA', true),
    A('ge_cafe', 'box', 1, 4, [1, 2], [8, 14], 'bodyC', 'trimB', 'roofB', true),
    A('ge_walkup', 'box', 2, 3.5, [4, 7], [12, 20], 'bodyB', 'trimA', 'roofA', false),
    A('ge_apartment', 'box', 2, 3.5, [5, 8], [14, 22], 'bodyA', 'trimB', 'roofB', false),
    A('ge_office', 'box', 3, 3.6, [10, 18], [16, 26], 'bodyC', 'trimB', 'roofB', true),
    A('ge_hotel', 'box', 3, 3.6, [12, 18], [16, 24], 'bodyB', 'trimA', 'roofA', true),
    A('ge_megatower', 'podium', 4, 3.6, [24, 36], [22, 30], 'bodyC', 'trimB', 'roofB', true),
  ], [0.778, 0.5, -0.38]),
  whitestacks: def('whitestacks', 'overcast', 'snow', WS, [
    A('ws_shed', 'shed', 1, 5, [1, 2], [10, 18], 'bodyC', 'trimA', 'roofA', false),
    A('ws_gatehouse', 'box', 1, 3.5, [1, 2], [8, 12], 'bodyA', 'trimA', 'roofA', true),
    A('ws_warehouse', 'shed', 2, 5, [3, 4], [16, 26], 'bodyB', 'trimA', 'roofB', true),
    A('ws_tank', 'cylinder', 2, 3, [4, 7], [10, 16], 'bodyC', 'trimB', 'roofA', false),
    A('ws_dish', 'dish', 2, 3, [3, 5], [10, 14], 'bodyC', 'trimA', 'roofA', false),
    A('ws_factory', 'box', 3, 4.5, [6, 10], [14, 26], 'bodyA', 'trimA', 'roofB', true),
    A('ws_chimney', 'chimney', 3, 3.5, [12, 20], [6, 8], 'bodyB', 'trimA', 'roofA', false),
    A('ws_cooling', 'cylinder', 4, 4, [18, 26], [22, 32], 'bodyC', 'trimB', 'roofA', false),
  ], [0.62, 0.42, -0.66]),
  lockwater: def('lockwater', 'night', 'rain', LW, [
    A('lw_stack_low', 'containers', 1, 2.6, [1, 2], [6, 13], 'bodyC', 'trimA', 'bodyB', false),
    A('lw_shack', 'shed', 1, 3.5, [1, 2], [8, 12], 'bodyA', 'trimA', 'roofA', true),
    A('lw_stack_high', 'containers', 2, 2.6, [3, 6], [6, 13], 'bodyA', 'trimA', 'bodyC', false),
    A('lw_warehouse', 'shed', 2, 5, [2, 4], [14, 24], 'bodyB', 'trimB', 'roofA', true),
    A('lw_neon_office', 'box', 3, 3.5, [8, 14], [14, 22], 'bodyB', 'trimA', 'roofA', true),
    A('lw_gantry', 'gantry', 3, 4, [10, 14], [18, 26], 'bodyC', 'trimA', 'roofB', false),
    A('lw_harbour_tower', 'podium', 4, 3.6, [20, 30], [20, 28], 'bodyB', 'trimB', 'roofA', true),
  ], [0.509, 0.53, -0.678]),
};
