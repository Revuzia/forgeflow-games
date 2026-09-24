// BLOCKTOOTH — the sim hub: world construction + THE fixed-tick step order.
// THREE-FREE. Every import below is a CONTRACT (CONTRACT.md §5): the owning lane must
// export exactly these names with exactly these signatures.

import type { RunOptions, TitanInput, World } from './types.ts';
import { SIM_DT } from './config.ts';
import { makeStreams } from './rng.ts';

import { TITANS } from '../data/titans.ts';
import { BIOMES } from '../data/biomes.ts';

import { generateCity } from '../city/citygen.ts';
import { stepCity } from '../city/citysim.ts';
import { createTitan, stepTitan } from '../titans/titansim.ts';
import { rebuildEnemyGrid } from '../combat/spatial.ts';
import { stepProjectiles } from '../combat/projectiles.ts';
import { stepTelegraphs } from '../combat/telegraphs.ts';
import { stepHazards } from '../combat/hazards.ts';
import { stepPickups } from '../combat/pickups.ts';
import { createDirector, stepDirector } from '../ai/director.ts';
import { stepEnemies } from '../ai/enemies.ts';
import { stepBoss } from '../ai/bosses/index.ts';
import { createUpgradeState, recomputeStats } from '../upgrades/stats.ts';
import { stepUpgrades, processTriggers } from '../upgrades/engine.ts';

export const NO_INPUT: TitanInput = { mx: 0, mz: 0, ability: false, abilityHeld: false, dash: false };

/** Monotonic entity id. Every spawned thing (enemy, projectile, telegraph, hazard, pickup) takes one. */
export function newId(w: World): number { return w.nextId++; }

export function createWorld(opts: RunOptions): World {
  const biome = BIOMES[opts.biome];
  const def = TITANS[opts.titan];
  const rng = makeStreams(opts.seed);
  const city = generateCity(biome, opts.seed, rng.city);
  const w: World = {
    seed: opts.seed,
    titanId: opts.titan,
    biomeId: opts.biome,
    tick: 0,
    t: 0,
    dt: SIM_DT,
    rng,
    city,
    titan: createTitan(def, city.spawn),
    enemies: [],
    projectiles: [],
    telegraphs: [],
    hazards: [],
    pickups: [],
    boss: null,
    director: createDirector(),
    upgrades: createUpgradeState(),
    run: { phase: 'intro', endT: -1, result: null, tonnage: 0, blocksLeveled: 0, peakRank: 0 },
    events: [],
    input: { ...NO_INPUT },
    cheats: { god: false, noSpawns: false },
    nextId: 1,
  };
  recomputeStats(w);
  w.titan.hp = w.titan.maxHp;
  return w;
}

function snapshotPrev(w: World): void {
  const T = w.titan;
  T.px = T.x; T.pz = T.z; T.pheading = T.heading;
  for (const e of w.enemies) { e.px = e.x; e.pz = e.z; e.py = e.y; e.pheading = e.heading; }
  for (const p of w.projectiles) { p.px = p.x; p.pz = p.z; p.py = p.y; }
  for (const p of w.pickups) { p.px = p.x; p.pz = p.z; p.py = p.y; }
  for (const p of w.city.props) if (p.lane >= 0) { p.px = p.x; p.pz = p.z; p.pheading = p.heading; }
  if (w.boss) { w.boss.px = w.boss.x; w.boss.pz = w.boss.z; w.boss.pheading = w.boss.heading; }
}

/** Drop dead pooled entities so arrays stay short. Views track entities by id, never by index. */
function compact(w: World): void {
  const keep = <T extends { alive: boolean }>(a: T[]) => { let j = 0; for (let i = 0; i < a.length; i++) if (a[i].alive) a[j++] = a[i]; a.length = j; };
  keep(w.enemies); keep(w.projectiles); keep(w.telegraphs); keep(w.hazards); keep(w.pickups);
}

function checkRunEnd(w: World): void {
  if (w.run.result) return;
  if (!w.titan.alive) {
    w.run.result = 'dead'; w.run.phase = 'dead'; w.run.endT = w.t;
    w.events.push({ type: 'runEnd', result: 'dead' });
  } else if (w.director.bossSpawned && w.boss && !w.boss.alive) {
    w.run.result = 'clear'; w.run.phase = 'clear'; w.run.endT = w.t;
    w.events.push({ type: 'runEnd', result: 'clear' });
  }
}

/**
 * Advance the simulation exactly one fixed tick. The app never calls this while a draft,
 * pause, slate or run-end screen owns the game (the sim is frozen, not slowed).
 * ORDER IS CONTRACT — see CONTRACT.md §5.2.
 */
export function stepWorld(w: World, input: TitanInput): void {
  if (w.run.result) return;
  w.events.length = 0;
  w.input = input;
  snapshotPrev(w);
  w.tick++;
  w.t += w.dt;
  if (w.run.phase === 'intro') w.run.phase = 'waves';

  stepCity(w);            // traffic, scared cars, blocks-leveled bookkeeping
  rebuildEnemyGrid(w);    // broadphase for the titan's attacks
  stepTitan(w);           // move, dash, leash, collide, contact smash/crush, footsteps, regen, kit (auto + hook)
  stepDirector(w);        // waves, elite, boss scheduling + run.phase transitions
  stepEnemies(w);         // AI, movement, firing (spawns projectiles/telegraphs)
  stepBoss(w);            // boss AI + part colliders
  rebuildEnemyGrid(w);    // enemies moved — projectiles/hazards/telegraphs test current positions
  stepProjectiles(w);
  stepTelegraphs(w);
  stepHazards(w);
  stepPickups(w);         // magnet + collect → gainXp / gainMass (level/rank ups)
  stepUpgrades(w);        // buff timers, trigger icds, 'interval' triggers
  processTriggers(w);     // upgrade triggers fired by THIS tick's events
  if (w.titan.rank > w.run.peakRank) w.run.peakRank = w.titan.rank;
  checkRunEnd(w);
  if (w.tick % 30 === 0) compact(w);
}

/** Convenience for probes/tests: advance n ticks with a constant input. */
export function stepN(w: World, n: number, input: TitanInput = NO_INPUT): void {
  for (let i = 0; i < n && !w.run.result; i++) stepWorld(w, input);
}
