// Level definitions: 5 biomes x 9 levels. Deterministic from (bi, li).
import { EDGE_MODES, generatePath, buildRoute, pickBlockedCells } from '../sim/path.js';
import { buildWaves, waveCount } from '../sim/waves.js';
import { biomeDef, LEVELS_PER_BIOME } from './biomes.js';

const LEVEL_NAMES = [
  ['Mossy Crossing', 'Bramble Run', 'Heart of the Hollow', 'Wolfpack Trail', 'Spider Gulch',
   'Old Oak Bend', 'Beelight Glade', 'Thicket Maze', 'The King’s Grove'],
  ['Ashfall Road', 'Cracked Basin', 'Dragon’s Doorstep', 'Slagfield', 'Vent Alley',
   'The Charred Mile', 'Imp Parade', 'Obsidian Bends', 'Caldera Throne'],
  ['First Frost', 'Whiteout Pass', 'Behemoth’s Shadow', 'Hare Hill', 'Frozen Fork',
   'Aurora Flats', 'Windchill Run', 'Glacier Teeth', 'The Frozen Throne'],
  ['Broken Causeway', 'Gravemarch', 'Lich’s Antechamber', 'Sunken Court', 'Bonefield',
   'Wraithwalk', 'The Silent Colonnade', 'Necropolis Gate', 'Throne of Echoes'],
  ['Shattered Shelf', 'Nebula Steps', 'Wyrm’s Approach', 'Voidlight Span', 'Crystal Scar',
   'Riftwater Edge', 'Starwell Loop', 'The Last Bridge', 'Edge of Everything'],
];

const cache = new Map();

const GOLD_BONUS = { '4:2': 140, '4:5': 220, '4:6': 200 };

export function levelDef(bi, li) {
  const key = bi + ':' + li;
  if (cache.has(key)) return cache.get(key);

  const biome = biomeDef(bi);
  // per-level seed salt: re-rolls a specific level's map when a layout proves
  // unwinnable in balance testing, without touching any other level
  const SEED_SALT = { '4:3': 17 };
  const seed = (1000003 * (bi + 1) + 7919 * (li + 1) + (SEED_SALT[bi + ':' + li] || 0)) >>> 0;
  const mode = EDGE_MODES[(bi * 3 + li * 5 + bi * li) % EDGE_MODES.length];
  const minLen = 32 + bi * 2 + li;            // later biomes/levels wind meaningfully longer
  const gen = generatePath(seed, mode, minLen, 6 + Math.min(4, Math.floor(li / 2)));
  const route = buildRoute(gen.cells);
  const blocked = pickBlockedCells(seed, gen.cells, 4 + (li % 3) + (bi === 4 ? 2 : 0));
  const waves = buildWaves(bi, li);

  const def = {
    bi, li, biome,
    id: biome.id + '-' + (li + 1),
    name: LEVEL_NAMES[bi][li],
    seed, edgeMode: mode,
    cells: gen.cells, route, blocked,
    waves, waveTotal: waves.length,
    startGold: 360 + bi * 130 + li * 40 + (GOLD_BONUS[bi + ':' + li] || 0),
    lives: 20,
    prepTime: 20,
    hazard: biome.hazard,
  };
  cache.set(key, def);
  return def;
}

export function allLevels() {
  const out = [];
  for (let bi = 0; bi < 5; bi++) for (let li = 0; li < LEVELS_PER_BIOME; li++) out.push(levelDef(bi, li));
  return out;
}
