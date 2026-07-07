// Level definitions: 5 worlds × 9 levels, deterministic.
import { generateMap } from '../sim/map.js';
import { buildWaves } from '../sim/waves.js';
import { worldDef, LEVELS_PER_WORLD } from './worlds.js';

const LEVEL_NAMES = [
  ['First Blood on Sand', 'The Emperor’s Box', 'Colossus Rising', 'Hounds of the Pit', 'The Phalanx Test',
   'Laurels and Ash', 'Chariot Thunder', 'The Crowd Turns', 'Aurelius Triumphant'],
  ['Night of Bells', 'Rain on Iron', 'The Titan’s Knock', 'Plague Roads', 'Gargoyle Eaves',
   'The Long Rampart', 'Trebuchet Row', 'Bells at Midnight', 'The Titan’s Return'],
  ['Above the Clouds', 'Wind Shear', 'Leviathan’s Shadow', 'The Split Sky', 'Corsair Lanes',
   'Herald’s Warning', 'The Gale Steps', 'Falling Light', 'Eye of the Storm'],
  ['Shardfall', 'The Singing Halls', 'Prism Ascendant', 'Skitterer Tide', 'Facets of War',
   'The Refractor Gate', 'Geode Hearts', 'Lightless Depths', 'The Prime Facet'],
  ['The First Seam', 'Powder and Stone', 'The Engine Stirs', 'Drill Lines', 'Gyro Squalls',
   'The Deep Forges', 'Sentinel Watch', 'Magma Channels', 'Engine of Ruin'],
];

// per-level tuning: seed salt re-rolls maps; gold bonus shores up levels the 2/4/8/12
// breach-damage model made unwinnable at base economy (2026-07-07 retune)
const SEED_SALT = { '3:8': 10, '4:8': 10, '1:5': 1, '2:6': 0, '2:8': 0, '4:5': 2, '4:6': 0, '4:7': 3 };

const GOLD_BONUS = { '2:6': 260, '3:8': 300, '4:5': 220, '4:6': 320, '4:7': 220, '4:8': 900 };
// extra seconds between assaults on levels whose pacing needs mercy
const GAP_BONUS = { '4:8': 8 };

const cache = new Map();

export function roadsFor(wi, li) {
  // ramp: world 1 = 2 roads, mid = 3, world 5 = 4; finales gain one (cap 4)
  let n = wi < 2 ? 2 : wi < 4 ? 3 : 4;
  if (li >= 6 && n < 4) n += 1;
  return n;
}

export function levelDef(wi, li) {
  const key = wi + ':' + li;
  if (cache.has(key)) return cache.get(key);
  const world = worldDef(wi);
  const seed = (2000003 * (wi + 1) + 7919 * (li + 1) + (SEED_SALT[key] || 0)) >>> 0;
  const nRoads = roadsFor(wi, li);
  const map = generateMap(seed, nRoads, 16 + Math.min(6, li));
  const waves = buildWaves(wi, li, nRoads);

  const def = {
    wi, li, world,
    id: world.id + '-' + (li + 1),
    name: LEVEL_NAMES[wi][li],
    seed, map, nRoads,
    waves, waveTotal: waves.length,
    startGold: 520 + wi * 225 + li * 62 + (GOLD_BONUS[wi + ':' + li] || 0),
    bastionHp: 100,
    prepTime: 20,
    assaultGapBonus: GAP_BONUS[wi + ':' + li] || 0,
    hazard: world.hazard,
  };
  cache.set(key, def);
  return def;
}

export function allLevels() {
  const out = [];
  for (let wi = 0; wi < 5; wi++) for (let li = 0; li < LEVELS_PER_WORLD; li++) out.push(levelDef(wi, li));
  return out;
}
