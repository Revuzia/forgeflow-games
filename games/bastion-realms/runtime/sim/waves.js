// Deterministic wave builder. Pure module.
// A wave = { groups:[{type,count,gap,delay,hpMul,bountyMul,eliteFlag}], label, isBoss }
import { makeRng } from './rng.js';
import { ENEMIES, enemyDef } from '../data/enemies.js';
import { biomeDef, LEVELS_PER_BIOME } from '../data/biomes.js';

// Threat cost of one enemy — how much wave budget it consumes.
function threatCost(id) {
  const d = enemyDef(id);
  let c = d.hp / 12 + d.speed * 1.6;
  if (d.flying) c += 5;
  if ((d.traits || []).includes('heavy')) c += d.hp / 30;
  if (d.regen) c += d.regen * 1.5;
  if (d.shield) c += d.shield * 2;
  return c;
}

export function waveCount(bi, li) {
  let n = 8 + Math.round(li * 1.1);           // 8..17
  if (isFinale(li)) n += 1;                    // finales get the boss wave on top
  return n;
}
export function isFinale(li) { return li === 2 || li === 5 || li === 8; }

function hpScale(bi, li, wi) {
  return (1 + li * 0.1 + bi * 0.07) * (1 + wi * 0.03);
}
function bountyScale(bi, li, wi) {
  return Math.sqrt(hpScale(bi, li, wi));
}

const PATTERNS = ['rush', 'mixed', 'swarm', 'flyers', 'heavy', 'mixed'];

export function buildWaves(bi, li) {
  const biome = biomeDef(bi);
  const rng = makeRng((bi * 977 + li * 131 + 7) >>> 0);
  const total = waveCount(bi, li);
  const waves = [];
  const pool = biome.pool.slice();
  const flyers = pool.filter((id) => enemyDef(id).flying);
  const grounders = pool.filter((id) => !enemyDef(id).flying);
  const swarmers = pool.filter((id) => (enemyDef(id).traits || []).includes('swarm'));
  const heavies = pool.filter((id) => (enemyDef(id).traits || []).includes('heavy') || enemyDef(id).hp >= 200);

  for (let wi = 0; wi < total; wi++) {
    const finaleBossWave = isFinale(li) && wi === total - 1;
    const miniBossWave = !finaleBossWave && wi > 0 && (wi + 1) % 5 === 0;
    const hMul = hpScale(bi, li, wi);
    const bMul = bountyScale(bi, li, wi);
    const groups = [];
    let label = '';

    if (finaleBossWave) {
      const empowered = li === 8;
      // bosses already carry huge base HP — dampen the wave multiplier stack
      const bossMul = Math.sqrt(hMul) * (empowered ? 1.3 : 1);
      groups.push({
        type: biome.boss, count: 1, gap: 0, delay: 2,
        hpMul: bossMul, bountyMul: bMul * (empowered ? 1.5 : 1),
        empowered,
      });
      // escort trickle behind the boss
      const escort = rng.pick(grounders.length ? grounders : pool);
      groups.push({ type: escort, count: 6 + li, gap: 2.6, delay: 8, hpMul: hMul, bountyMul: bMul });
      label = (empowered ? 'EMPOWERED ' : '') + 'BOSS';
      waves.push({ groups, label, isBoss: true });
      continue;
    }

    // budget for this wave
    let budget = 62 * (1 + bi * 0.45) * (1 + li * 0.12) * Math.pow(1.12, wi);
    if (wi === 0) budget *= 0.55;             // gentle opener taper
    else if (wi === 1) budget *= 0.72;
    else if (wi === 2) budget *= 0.88;
    if (bi === 0 && li === 0) budget *= 0.62; // tutorial level extra gentle

    if (miniBossWave) {
      const elite = (wi >= 9 && biome.elite2) ? biome.elite2 : biome.elite;
      const n = wi >= 12 ? 2 : 1;
      groups.push({
        type: elite, count: n, gap: 4, delay: 3,
        hpMul: hMul, bountyMul: bMul, eliteFlag: true,
      });
      budget *= 0.55; // rest of the budget becomes escort
      label = 'ELITE';
    }

    const pattern = miniBossWave ? 'mixed' : PATTERNS[(wi + li) % PATTERNS.length];
    let picks;
    if (pattern === 'rush') picks = [rng.pick(grounders.length ? grounders : pool)];
    else if (pattern === 'swarm' && swarmers.length) picks = swarmers.slice(0, 2);
    else if (pattern === 'flyers' && flyers.length && wi >= 2) picks = [rng.pick(flyers), rng.pick(grounders.length ? grounders : pool)];
    else if (pattern === 'heavy' && heavies.length && wi >= 3) {
      const h = rng.pick(heavies);
      const others = (swarmers.length ? swarmers : grounders).filter((x) => x !== h);
      picks = others.length ? [h, rng.pick(others)] : [h];
    }
    else {
      const shuffled = rng.shuffle(pool);
      picks = shuffled.slice(0, Math.min(2 + (wi > 5 ? 1 : 0), shuffled.length));
    }

    const per = budget / picks.length;
    picks.forEach((id, gi) => {
      const cost = threatCost(id);
      let count = Math.max(1, Math.round(per / cost));
      const isSwarm = (enemyDef(id).traits || []).includes('swarm');
      const isFast = enemyDef(id).speed > 4;
      count = Math.min(count, isSwarm ? 22 : enemyDef(id).flying ? 10 : isFast ? 10 : 14);
      const fast = enemyDef(id).speed > 4;
      groups.push({
        type: id, count,
        gap: (enemyDef(id).traits || []).includes('swarm') ? 0.5 : fast ? 0.8 : 1.4,
        delay: gi * 3.2 + (miniBossWave ? 6 : 0),
        hpMul: hMul, bountyMul: bMul,
      });
    });

    waves.push({ groups, label, isBoss: false });
  }
  return waves;
}

// Endless mode: waves keep scaling; elites every 5, boss every 10.
export function endlessWave(bi, wi) {
  const biome = biomeDef(bi);
  const rng = makeRng((bi * 7919 + wi * 271 + 13) >>> 0);
  const hMul = (1.35 + bi * 0.1) * Math.pow(1.11, wi);
  const bMul = Math.sqrt(hMul) * 0.8;
  const groups = [];
  const pool = biome.pool.slice();
  if ((wi + 1) % 10 === 0) {
    groups.push({ type: biome.boss, count: 1 + Math.floor(wi / 30), gap: 6, delay: 2, hpMul: Math.sqrt(hMul) * 1.1, bountyMul: bMul, empowered: wi >= 20 });
  } else if ((wi + 1) % 5 === 0) {
    const elite = biome.elite2 && rng.chance(0.5) ? biome.elite2 : biome.elite;
    groups.push({ type: elite, count: 1 + Math.floor(wi / 12), gap: 3.5, delay: 2, hpMul: hMul, bountyMul: bMul, eliteFlag: true });
  }
  const picks = rng.shuffle(pool).slice(0, 2 + (wi % 2));
  let budget = 120 * Math.pow(1.115, wi);
  const per = budget / picks.length;
  picks.forEach((id, gi) => {
    const count = Math.min(24, Math.max(2, Math.round(per / threatCost(id))));
    groups.push({ type: id, count, gap: 0.7, delay: gi * 2.8 + 4, hpMul: hMul, bountyMul: bMul });
  });
  return { groups, label: (wi + 1) % 10 === 0 ? 'BOSS' : (wi + 1) % 5 === 0 ? 'ELITE' : '', isBoss: (wi + 1) % 10 === 0 };
}

// Preview chips for the HUD (which enemy types + rough counts next wave).
export function wavePreview(wave) {
  const seen = new Map();
  for (const g of wave.groups) {
    seen.set(g.type, (seen.get(g.type) || 0) + g.count);
  }
  return [...seen.entries()].map(([type, count]) => ({
    type, count, name: enemyDef(type).name,
    flying: !!enemyDef(type).flying, boss: !!enemyDef(type).boss,
  }));
}
