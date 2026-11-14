// Bastion Realms: Stronghold — headless selftest + balance harness.
// node selftest.mjs            — structural + smoke
// node selftest.mjs --balance  — greedy bot plays ALL 45 levels
// node selftest.mjs --level W L — one level verbose
import { allLevels, levelDef } from './runtime/data/levels.js';
import { GRID_W, GRID_H, cellToWorld, posAlong, isPlaza } from './runtime/sim/map.js';
import { createSim } from './runtime/sim/sim.js';
import { TOWERS, isTowerUnlocked, upgradeCost } from './runtime/data/towers.js';

const args = process.argv.slice(2);

function structural() {
  console.log('=== structural ===');
  let fails = 0;
  const fps = new Set();
  for (const lv of allLevels()) {
    fps.add(lv.map.roads.map((r) => r.map((c) => c.join('.')).join('|')).join('#'));
    for (const r of lv.map.roads) if (r.length < 12) { console.log('SHORT ROAD', lv.id); fails++; }
    if (lv.waves.length < 8) { console.log('FEW WAVES', lv.id); fails++; }
    for (const w of lv.waves) for (const g of w.groups) {
      if (!g.count || g.roadIdx == null) { console.log('BAD GROUP', lv.id, g); fails++; }
    }
  }
  console.log(`45 levels, unique maps=${fps.size}`);
  if (fps.size !== 45) { console.log('FAIL: maps not unique'); fails++; }
  console.log(fails ? `STRUCTURAL FAILS: ${fails}` : 'structural: OK');
  return fails === 0;
}

// ---- greedy bot ------------------------------------------------------------
function roadPoints(lv) {
  const pts = [];
  for (const route of lv.map.routes) {
    for (let d = 0; d < route.total; d += 1.2) {
      const p = posAlong(route, d);
      pts.push([p.x, p.z, d / route.total]);
    }
  }
  return pts;
}

function groundSpots(sim, lv) {
  const pts = roadPoints(lv);
  const spots = [];
  for (let cx = 0; cx < GRID_W; cx++) {
    for (let cy = 0; cy < GRID_H; cy++) {
      if (!sim.canBuild('ballista', cx, cy).ok) continue;
      const w = cellToWorld(cx, cy);
      let cov = 0, nearPlaza = Math.hypot(w.x, w.z) < 7 ? 1 : 0;
      for (const [px, pz, frac] of pts) {
        const d = Math.hypot(px - w.x, pz - w.z);
        if (d <= 7) cov += 1 + frac * 0.8; // weight coverage near the bastion higher
      }
      if (cov > 4) spots.push({ cx, cy, cov: cov + nearPlaza * 6 });
    }
  }
  spots.sort((a, b) => b.cov - a.cov);
  return spots;
}

function roadSpots(sim, lv, type) {
  const spots = [];
  for (const route of lv.map.routes) {
    // near the end of each road (close to bastion) = maximum traffic
    for (const frac of [0.8, 0.65, 0.5, 0.9, 0.35]) {
      const idxCell = lv.map.roads[lv.map.routes.indexOf(route)];
      const cell = idxCell[Math.floor(idxCell.length * frac)];
      if (cell && sim.canBuild(type, cell[0], cell[1]).ok) spots.push({ cx: cell[0], cy: cell[1] });
    }
  }
  return spots;
}

const ANTI_AIR = ['ballista', 'crossbow', 'spire', 'storm', 'beacon'];

function autoPlay(wi, li, { endless = false } = {}) {
  const lv = levelDef(wi, li);
  const sim = createSim(wi, li, { endless });
  const mixes = [
    ['ballista', 'thorn', 'ballista', 'cauldron', 'crossbow', 'ballista', 'thorn', 'cauldron', 'crossbow'],
    ['ballista', 'thorn', 'rune', 'cauldron', 'crossbow', 'spire', 'ballista', 'rune', 'crossbow'],
    ['spire', 'ballista', 'beacon', 'thorn', 'crossbow', 'cauldron', 'spire', 'rune', 'crossbow'],
    ['ballista', 'spire', 'crossbow', 'thorn', 'storm', 'cauldron', 'crossbow', 'rune', 'beacon'],
    ['storm', 'spire', 'beacon', 'thorn', 'crossbow', 'cauldron', 'storm', 'spire', 'crossbow'],
  ];
  const mix = mixes[wi].filter((t) => isTowerUnlocked(t, wi, li));
  let mixIdx = 0;
  const placed = [];

  function shop() {
    let guard = 40;
    while (guard-- > 0) {
      let want = mix[mixIdx % mix.length];
      const preview = sim.nextWavePreview();
      const flyShare = preview.length
        ? preview.filter((p) => p.flying).reduce((a, p) => a + p.count, 0) /
          Math.max(1, preview.reduce((a, p) => a + p.count, 0))
        : 0;
      if (flyShare > 0.3 && !ANTI_AIR.includes(want)) {
        want = ANTI_AIR.find((t) => isTowerUnlocked(t, wi, li)) || want;
      }
      const def = TOWERS[want];
      if (sim.gold >= def.cost) {
        const spots = def.placement === 'road' ? roadSpots(sim, lv, want) : groundSpots(sim, lv);
        if (spots.length) {
          const r = sim.placeTower(want, spots[0].cx, spots[0].cy);
          if (r.ok) { mixIdx++; placed.push(r.tower); continue; }
        }
        mixIdx++; // placement blocked (e.g. road cap) — move on
        continue;
      }
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

  let stuckGuard = 0;
  while (sim.phase !== 'won' && sim.phase !== 'lost') {
    if (sim.phase === 'idle' || sim.phase === 'prep') { shop(); sim.startWave(); }
    sim.fastForward(12);
    shop();
    sim.drainEvents();
    if (endless && sim.waveIdx >= 40) break;
    if (++stuckGuard > 900) return { result: 'STUCK', sim, lv };
  }
  return {
    result: sim.phase, stars: sim.stars(), hp: Math.round(sim.bastionHp),
    kills: sim.stats.kills, breaches: sim.stats.breaches,
    towers: sim.towers.length, waves: sim.waveIdx + 1, gold: sim.gold, sim, lv,
  };
}

function smoke() {
  console.log('=== smoke (0,0) ===');
  const sim = createSim(0, 0);
  const lv = levelDef(0, 0);
  const spots = groundSpots(sim, lv);
  for (let i = 0; i < 4 && i < spots.length; i++) sim.placeTower('ballista', spots[i].cx, spots[i].cy);
  sim.startWave();
  sim.fastForward(120);
  console.log(`t=${sim.time.toFixed(0)} phase=${sim.phase} wave=${sim.waveIdx + 1} kills=${sim.stats.kills} hp=${sim.bastionHp} gold=${sim.gold}`);
  if (sim.stats.kills === 0) { console.log('FAIL: no kills'); return false; }
  console.log('smoke: OK');
  return true;
}

if (args.includes('--balance')) {
  const t0 = Date.now();
  let wins = 0;
  for (let wi = 0; wi < 5; wi++) {
    for (let li = 0; li < 9; li++) {
      const r = autoPlay(wi, li);
      if (r.result === 'won') wins++;
      console.log(`w${wi}l${li} ${levelDef(wi, li).name.padEnd(22)} ${String(r.result).padEnd(5)} stars=${r.stars} hp=${String(r.hp).padStart(3)} waves=${r.waves} towers=${r.towers} kills=${r.kills} breaches=${r.breaches}`);
    }
  }
  console.log(`\nwins: ${wins}/45  (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
} else if (args.includes('--level')) {
  const i = args.indexOf('--level');
  const r = autoPlay(+args[i + 1], +args[i + 2]);
  console.log(r.result, 'stars', r.stars, 'hp', r.hp, 'kills', r.kills, 'breaches', r.breaches);
} else {
  const ok1 = structural();
  const ok2 = smoke();
  process.exit(ok1 && ok2 ? 0 : 1);
}
