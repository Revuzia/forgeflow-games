// Bastion Realms headless selftest + balance harness.
// Usage:
//   node selftest.mjs            — structural checks (paths, waves, sim smoke)
//   node selftest.mjs --balance  — auto-plays ALL 45 levels with a greedy builder, prints results
//   node selftest.mjs --level 2 4 — auto-play one level (biome 2, level 4), verbose
import { allLevels, levelDef } from './runtime/data/levels.js';
import { GRID_W, GRID_H, cellToWorld, posAlong } from './runtime/sim/path.js';
import { createSim } from './runtime/sim/sim.js';
import { TOWER_ORDER, TOWERS, isTowerUnlocked, upgradeCost } from './runtime/data/towers.js';
import { wavePreview } from './runtime/sim/waves.js';

const args = process.argv.slice(2);

function structural() {
  console.log('=== structural checks ===');
  let fails = 0;
  const lens = [];
  for (const lv of allLevels()) {
    const n = lv.cells.length;
    lens.push(n);
    const turns = lv.waves.length;
    if (n < 26) { console.log(`FAIL path too short ${lv.id}: ${n}`); fails++; }
    if (lv.waves.length < 8) { console.log(`FAIL too few waves ${lv.id}: ${lv.waves.length}`); fails++; }
    for (const w of lv.waves) {
      for (const g of w.groups) {
        if (!g.count || g.count < 1) { console.log(`FAIL bad group ${lv.id}`, g); fails++; }
      }
    }
    // unique path per level: fingerprint
  }
  const fps = new Set(allLevels().map((lv) => lv.cells.map((c) => c.join('.')).join('|')));
  if (fps.size !== 45) { console.log(`FAIL: only ${fps.size}/45 unique paths`); fails++; }
  console.log(`45 levels, path len min=${Math.min(...lens)} max=${Math.max(...lens)}, unique paths=${fps.size}`);
  console.log(fails ? `STRUCTURAL FAILS: ${fails}` : 'structural: OK');
  return fails === 0;
}

// ---- greedy auto-player ----------------------------------------------------
function coverageScore(lv, cx, cy, range) {
  // how many route sample points within range of this cell
  const w = cellToWorld(cx, cy);
  let n = 0;
  const step = 1.0;
  for (let d = 0; d < lv.route.total; d += step) {
    const p = posAlong(lv.route, d);
    if ((p.x - w.x) ** 2 + (p.z - w.z) ** 2 <= range * range) n++;
  }
  return n;
}

function buildPlan(sim, lv) {
  // rank buildable cells by coverage with a mid-range radius
  const spots = [];
  for (let cx = 0; cx < GRID_W; cx++) {
    for (let cy = 0; cy < GRID_H; cy++) {
      if (!sim.canBuild(cx, cy).ok) continue;
      const cov = coverageScore(lv, cx, cy, 7);
      if (cov > 4) spots.push({ cx, cy, cov });
    }
  }
  spots.sort((a, b) => b.cov - a.cov);
  return spots;
}

function autoPlay(bi, li, { verbose = false, endless = false } = {}) {
  const lv = levelDef(bi, li);
  const sim = createSim(bi, li, { endless });
  // preferred build mix by biome (counters)
  const mixes = [
    ['bolt', 'frost', 'bolt', 'cannon', 'sniper', 'bolt', 'frost', 'cannon', 'sniper', 'bolt'],
    ['bolt', 'frost', 'ember', 'cannon', 'sniper', 'banner', 'bolt', 'frost', 'ember', 'sniper'],
    ['storm', 'bolt', 'ember', 'frost', 'sniper', 'banner', 'storm', 'cannon', 'ember', 'sniper'],
    ['storm', 'venom', 'ember', 'frost', 'sniper', 'banner', 'venom', 'storm', 'ember', 'sniper'],
    ['storm', 'venom', 'ember', 'frost', 'sniper', 'banner', 'storm', 'venom', 'sniper', 'ember'],
  ];
  const mix = mixes[bi].filter((t) => isTowerUnlocked(t, bi, li));
  let mixIdx = 0;
  const placed = [];

  const ANTI_AIR = ['bolt', 'sniper', 'storm', 'ember', 'frost'];
  function shop() {
    let guard = 40;
    while (guard-- > 0) {
      // read the wave preview like a human: flyers incoming -> buy anti-air
      let want = mix[mixIdx % mix.length];
      const preview = sim.nextWavePreview();
      const flyShare = preview.length
        ? preview.filter((p) => p.flying).reduce((a, p) => a + p.count, 0) /
          Math.max(1, preview.reduce((a, p) => a + p.count, 0))
        : 0;
      if (flyShare > 0.3 && !ANTI_AIR.includes(want)) {
        want = ANTI_AIR.find((t) => isTowerUnlocked(t, bi, li)) || want;
      }
      const def = TOWERS[want];
      if (sim.gold >= def.cost) {
        // recompute best open spot right now
        const spots = buildPlan(sim, lv);
        if (spots.length) {
          const r = sim.placeTower(want, spots[0].cx, spots[0].cy);
          if (r.ok) { mixIdx++; placed.push(r.tower); continue; }
        }
      }
      // upgrade the damage tower with the most kills (best positioned)
      let didUp = false;
      const ranked = placed
        .filter((tw) => tw.level < 2 && sim.towers.includes(tw))
        .sort((a, b) => (b.dmgDealt + b.kills * 20) - (a.dmgDealt + a.kills * 20));
      for (const tw of ranked) {
        const c = upgradeCost(tw.type, tw.level);
        if (sim.gold >= c) { sim.upgradeTower(tw.id); didUp = true; break; }
      }
      if (!didUp) break;
    }
  }

  const maxWaves = endless ? 40 : lv.waves.length;
  let stuckGuard = 0;
  while (sim.phase !== 'won' && sim.phase !== 'lost') {
    if (sim.phase === 'idle' || sim.phase === 'prep') {
      shop();
      sim.startWave();
    }
    sim.fastForward(12); // short chunks so the bot shops mid-wave like a human
    shop();
    sim.drainEvents();
    if (endless && sim.waveIdx >= maxWaves) break;
    if (++stuckGuard > 900) { return { result: 'STUCK', sim, lv }; }
  }
  return {
    result: sim.phase, stars: sim.stars(), lives: sim.lives, gold: sim.gold,
    kills: sim.stats.kills, leaks: sim.stats.leaks, towers: sim.towers.length,
    waves: sim.waveIdx + 1, sim, lv,
  };
}

function smoke() {
  console.log('=== sim smoke (0,0 minimal) ===');
  const sim = createSim(0, 0);
  const lv = levelDef(0, 0);
  const spots = buildPlan(sim, lv);
  for (let i = 0; i < 4 && i < spots.length; i++) {
    const r = sim.placeTower('bolt', spots[i].cx, spots[i].cy);
    if (!r.ok) console.log('place fail', r.reason);
  }
  sim.startWave();
  sim.fastForward(120);
  const ev = sim.drainEvents();
  console.log(`t=${sim.time.toFixed(1)} phase=${sim.phase} wave=${sim.waveIdx} kills=${sim.stats.kills} gold=${sim.gold} lives=${sim.lives} events=${ev.length}`);
  if (sim.stats.kills === 0) { console.log('FAIL: no kills in smoke test'); return false; }
  console.log('smoke: OK');
  return true;
}

if (args.includes('--balance')) {
  console.log('=== balance auto-play (greedy builder) ===');
  const rows = [];
  for (let bi = 0; bi < 5; bi++) {
    for (let li = 0; li < 9; li++) {
      const r = autoPlay(bi, li);
      rows.push({ bi, li, ...r });
      console.log(`b${bi}l${li} ${levelDef(bi, li).name.padEnd(24)} ${String(r.result).padEnd(5)} stars=${r.stars} lives=${String(r.lives).padStart(2)} waves=${r.waves} towers=${r.towers} kills=${r.kills} leaks=${r.leaks} goldLeft=${r.gold}`);
    }
  }
  const wins = rows.filter((r) => r.result === 'won').length;
  console.log(`\nwins: ${wins}/45`);
} else if (args.includes('--level')) {
  const i = args.indexOf('--level');
  const bi = +args[i + 1], li = +args[i + 2];
  const r = autoPlay(bi, li, { verbose: true });
  console.log(r.result, 'stars', r.stars, 'lives', r.lives, 'kills', r.kills, 'leaks', r.leaks);
} else {
  const ok1 = structural();
  const ok2 = smoke();
  process.exit(ok1 && ok2 ? 0 : 1);
}
