// Deterministic wave builder for the Stronghold campaign.
// Groups carry a roadIdx so pressure arrives from multiple directions.
import { makeRng } from './rng.js';
import { enemyDef } from '../data/enemies.js';
import { worldDef } from '../data/worlds.js';

function threatCost(id) {
  const d = enemyDef(id);
  let c = d.hp / 12 + d.speed * 1.6;
  if (d.flying) c += 6;
  if (d.hp >= 300) c += d.hp / 30;
  if (d.shield) c += d.shield * 2;
  if ((d.traits || []).includes('detonator')) c += 10;
  if ((d.traits || []).includes('splitter')) c += 8;
  return c;
}

export function waveCount(wi, li) {
  let n = 8 + Math.round(li * 1.1);
  if (isFinale(li)) n += 1;
  return n;
}
export function isFinale(li) { return li === 2 || li === 5 || li === 8; }

function hpScale(wi, li, wv) {
  return (1 + li * 0.1 + wi * 0.06) * (1 + wv * 0.0265);
}
function bountyScale(wi, li, wv) {
  return Math.sqrt(hpScale(wi, li, wv));
}

const PATTERNS = ['rush', 'mixed', 'swarm', 'flyers', 'heavy', 'mixed'];

export function buildWaves(wi, li, nRoads) {
  const world = worldDef(wi);
  const rng = makeRng((wi * 1069 + li * 149 + 11) >>> 0);
  const total = waveCount(wi, li);
  const waves = [];
  const pool = world.pool.slice();
  if (world.pool2 && li >= 4) pool.push(...world.pool2);
  const flyers = pool.filter((id) => enemyDef(id).flying);
  const grounders = pool.filter((id) => !enemyDef(id).flying);
  const swarmers = pool.filter((id) => (enemyDef(id).traits || []).includes('swarm'));
  const heavies = pool.filter((id) => enemyDef(id).hp >= 250);

  const roadFor = (i) => (rng.int(0, nRoads - 1) + i) % nRoads;

  for (let wv = 0; wv < total; wv++) {
    const finaleBossWave = isFinale(li) && wv === total - 1;
    const miniBossWave = !finaleBossWave && wv > 0 && (wv + 1) % 5 === 0;
    const hMul = hpScale(wi, li, wv);
    const bMul = bountyScale(wi, li, wv);
    const groups = [];
    let label = '';

    if (finaleBossWave) {
      const empowered = li === 8;
      const bossMul = Math.sqrt(hMul) * (empowered ? 1.22 : 1);
      groups.push({
        type: world.boss, count: 1, gap: 0, delay: 2, roadIdx: 0,
        hpMul: bossMul, bountyMul: bMul * (empowered ? 1.5 : 1), empowered,
      });
      const escort = rng.pick(grounders.length ? grounders : pool);
      for (let r = 0; r < nRoads; r++) {
        groups.push({ type: escort, count: 3 + Math.floor(li / 2), gap: 3.2, delay: 8 + r * 2, roadIdx: r, hpMul: hMul, bountyMul: bMul });
      }
      label = (empowered ? 'EMPOWERED ' : '') + 'BOSS';
      waves.push({ groups, label, isBoss: true });
      continue;
    }

    let budget = 66 * (1 + wi * 0.38) * (1 + li * 0.115) * Math.pow(1.115, wv);
    if (wv === 0) budget *= 0.55;
    else if (wv === 1) budget *= 0.72;
    else if (wv === 2) budget *= 0.88;
    if (wi === 0 && li === 0) budget *= 0.6;

    if (miniBossWave) {
      const n = wv >= 12 ? 2 : 1;
      groups.push({
        type: world.elite, count: n, gap: 4, delay: 3, roadIdx: roadFor(0),
        hpMul: hMul, bountyMul: bMul, eliteFlag: true,
      });
      budget *= 0.55;
      label = 'ELITE';
    }

    const pattern = miniBossWave ? 'mixed' : PATTERNS[(wv + li) % PATTERNS.length];
    let picks;
    if (pattern === 'rush') picks = [rng.pick(grounders.length ? grounders : pool)];
    else if (pattern === 'swarm' && swarmers.length) picks = swarmers.slice(0, 2);
    else if (pattern === 'flyers' && flyers.length && wv >= 2) picks = [rng.pick(flyers), rng.pick(grounders.length ? grounders : pool)];
    else if (pattern === 'heavy' && heavies.length && wv >= 3) {
      const h = rng.pick(heavies);
      const others = (swarmers.length ? swarmers : grounders).filter((x) => x !== h);
      picks = others.length ? [h, rng.pick(others)] : [h];
    } else {
      const shuffled = rng.shuffle(pool);
      picks = shuffled.slice(0, Math.min(2 + (wv > 5 ? 1 : 0), shuffled.length));
    }

    const per = budget / picks.length;
    picks.forEach((id, gi) => {
      const cost = threatCost(id);
      const d = enemyDef(id);
      let count = Math.max(1, Math.round(per / cost));
      const isSwarm = (d.traits || []).includes('swarm');
      const isFast = d.speed > 4;
      const isDet = (d.traits || []).includes('detonator');
      const isSplit = (d.traits || []).includes('splitter');
      count = Math.min(count, isDet ? 5 : isSplit ? 7 : isSwarm ? 20 : d.flying ? 10 : isFast ? 10 : 14);
      // split large groups across two roads for surround pressure
      const roads = count >= 6 && nRoads > 1 ? 2 : 1;
      for (let r = 0; r < roads; r++) {
        groups.push({
          type: id, count: Math.ceil(count / roads),
          gap: isSwarm ? 0.55 : isFast ? 0.85 : 1.45,
          delay: gi * 3.2 + r * 1.6 + (miniBossWave ? 6 : 0),
          roadIdx: roadFor(gi + r),
          hpMul: hMul, bountyMul: bMul,
        });
      }
    });

    waves.push({ groups, label, isBoss: false });
  }
  return waves;
}

export function endlessWave(wi, wv, nRoads) {
  const world = worldDef(wi);
  const rng = makeRng((wi * 8069 + wv * 293 + 17) >>> 0);
  const hMul = (1.35 + wi * 0.1) * Math.pow(1.11, wv);
  const bMul = Math.sqrt(hMul) * 0.8;
  const groups = [];
  const pool = world.pool.slice();
  if (world.pool2) pool.push(...world.pool2);
  if ((wv + 1) % 10 === 0) {
    groups.push({ type: world.boss, count: 1 + Math.floor(wv / 30), gap: 6, delay: 2, roadIdx: 0, hpMul: Math.sqrt(hMul) * 1.1, bountyMul: bMul, empowered: wv >= 20 });
  } else if ((wv + 1) % 5 === 0) {
    groups.push({ type: world.elite, count: 1 + Math.floor(wv / 12), gap: 3.5, delay: 2, roadIdx: rng.int(0, nRoads - 1), hpMul: hMul, bountyMul: bMul, eliteFlag: true });
  }
  const picks = rng.shuffle(pool).slice(0, 2 + (wv % 2));
  const per = 130 * Math.pow(1.115, wv) / picks.length;
  picks.forEach((id, gi) => {
    const count = Math.min(22, Math.max(2, Math.round(per / threatCost(id))));
    groups.push({ type: id, count, gap: 0.7, delay: gi * 2.8 + 4, roadIdx: rng.int(0, nRoads - 1), hpMul: hMul, bountyMul: bMul });
  });
  return { groups, label: (wv + 1) % 10 === 0 ? 'BOSS' : (wv + 1) % 5 === 0 ? 'ELITE' : '', isBoss: (wv + 1) % 10 === 0 };
}

export function wavePreview(wave) {
  const seen = new Map();
  for (const g of wave.groups) seen.set(g.type, (seen.get(g.type) || 0) + g.count);
  return [...seen.entries()].map(([type, count]) => ({
    type, count, name: enemyDef(type).name,
    flying: !!enemyDef(type).flying, boss: !!enemyDef(type).boss,
    siegeDmg: enemyDef(type).siegeDmg,
  }));
}
