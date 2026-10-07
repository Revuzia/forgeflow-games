// probe (lane SIM): tick budget with 10 fighters + 150 minions + 40 structures on a 150 m map with
// walls and thickets, everyone fighting; plus whole-run determinism (same seed ⇒ same digest).
import { ability, buildCatalog, fighter, item, unit } from './fixtures/catalog_fixture.ts';
import { check, finish, makeSetup, section } from './fixtures/sim_fixture.ts';
import { equipItem, tryCast } from '../src/sim/abilities.ts';
import { createWorld, stateDigest } from '../src/sim/core.ts';
import type { Entity } from '../src/sim/entity.ts';
import { issueMove } from '../src/sim/movement.ts';
import { spawnUnit } from '../src/sim/spawn.ts';
import type { World } from '../src/sim/world.ts';
import { Rng } from '../src/sim/rng.ts';

const SIZE = 150;
const walls: [number, number][][] = [];
{
  const r = new Rng(99);
  for (let i = 0; i < 24; i++) {
    const x = r.range(20, 130), y = r.range(20, 130), s = r.range(3, 8);
    if (Math.abs(x - y) < 12) continue; // keep the diagonal lane open
    walls.push([[x, y], [x + s, y], [x + s, y + s * 0.5], [x, y + s * 0.5]]);
  }
}
const map = {
  id: 'fx_map', name: 'Fx Big', desc: 'synthetic', size: [SIZE, SIZE], navCell: 0.5, walls,
  thickets: [[[60, 80], [70, 80], [70, 90], [60, 90]], [[80, 60], [90, 60], [90, 70], [80, 70]]],
  lanes: [{ id: 'fx_lane', name: 'Fx Lane', path: [[10, 10], [140, 140]] }],
  bases: [
    { team: 0, spawn: [10, 10], fountain: { at: [5, 5], radius: 4 }, shop: { at: [5, 5], radius: 6 } },
    { team: 1, spawn: [140, 140], fountain: { at: [145, 145], radius: 4 }, shop: { at: [145, 145], radius: 6 } },
  ],
  art: {
    scene: 'assets/fx/scene.glb', sky: 'assets/fx/sky.hdr', lut: 'assets/fx/lut.cube', minimap: 'assets/fx/mm.png',
    lighting: { sunDir: [0, 1, 0], sunColor: '#ffffff', sunIntensity: 1, ambient: 0.3, fogColor: '#000000', fogDensity: 0, exposure: 1 },
    music: 'fx_music',
  },
  camera: { pitchDeg: 55, fovDeg: 40, distance: 20, minDistance: 10, maxDistance: 30 },
};
const kit = {
  a1: ability('fx_nova', [{ op: 'area', shape: { kind: 'circle', radius: 4 }, at: 'self', onHit: [{ op: 'damage', amount: 40, type: 'magic' }, { op: 'status', status: 'slow', duration: 1 }] }], { cooldown: 3 }),
  a2: ability('fx_bolt', [{ op: 'projectile', speed: 25, range: 10, width: 0.8, pierce: 1, onHit: [{ op: 'damage', amount: 60, type: 'phys' }] }], { cooldown: 2, targeting: { kind: 'direction' } }),
  a3: ability('fx_hop', [{ op: 'dash', mode: 'toPoint', distance: 4, speed: 18 }], { cooldown: 6, targeting: { kind: 'point', range: 6 } }),
  ult: ability('fx_field', [{ op: 'zone', id: 'fx_field_zone', shape: { kind: 'circle', radius: 3 }, at: 'self', duration: 3, interval: 0.5, onTick: [{ op: 'damage', amount: 15, type: 'magic' }] }], { cooldown: 10 }),
};
const cat = buildCatalog({
  fighters: [
    fighter('fx_fighter_a', { base: { hp: 3000, ad: 60, attackSpeed: 0.9 }, ...kit }),
    fighter('fx_fighter_b', { base: { hp: 2600, ad: 55, attackSpeed: 0.8 }, attack: { range: 5, windup: 0.25, projectileSpeed: 20 }, ...kit }),
  ],
  units: [
    unit('fx_minion', 'minion', { base: { hp: 1200, ad: 12, attackSpeed: 1, moveSpeed: 3 }, attack: { range: 1.2, windup: 0.3 } }),
    unit('fx_caster_minion', 'minion', { base: { hp: 900, ad: 15, attackSpeed: 0.8, moveSpeed: 3 }, attack: { range: 5, windup: 0.3, projectileSpeed: 18 } }),
    unit('fx_tower', 'structure', { base: { hp: 1e6, ad: 80, attackSpeed: 0.8, moveSpeed: 0 }, collisionRadius: 1, attack: { range: 7, windup: 0.2, projectileSpeed: 22 } }),
  ],
  items: [item('fx_item_crit', { stats: { crit: 0.25 } })],
  maps: [map],
});

function scenario(seed: number): { w: World; fighters: Entity[]; minions: Entity[] } {
  const seats = Array.from({ length: 10 }, (_, i) => ({ fighter: i % 2 ? 'fx_fighter_b' : 'fx_fighter_a', team: i < 5 ? 0 : 1 }));
  const w = createWorld(cat, makeSetup(seats, { seed }));
  const fighters = w.players.map((p) => p.ent!);
  fighters.forEach((f, i) => {
    const t = f.team;
    f.x = t === 0 ? 30 + i * 2 : 120 - (i - 5) * 2; f.y = t === 0 ? 30 : 120;
    for (let s = 0; s < 4; s++) f.slots[s]!.rank = 1;
    equipItem(w, f, 0, 'fx_item_crit');
  });
  const minions: Entity[] = [];
  for (let k = 0; k < 150; k++) {
    const team = k % 2;
    const lane = (k >> 1) % 5;
    const row = Math.floor(k / 10);
    const base = team === 0 ? 20 + row * 1.2 : 130 - row * 1.2;
    const off = (lane - 2) * 2.5;
    const m = spawnUnit(w, k % 3 === 0 ? 'fx_caster_minion' : 'fx_minion', team, base + off, base - off);
    minions.push(m);
  }
  for (let k = 0; k < 40; k++) {
    const team = k % 2;
    const d = 12 + Math.floor(k / 2) * 6;
    const x = team === 0 ? d : SIZE - d, y = team === 0 ? d + 8 : SIZE - d - 8;
    spawnUnit(w, 'fx_tower', team, x, y);
  }
  for (const m of minions) issueMove(w, m, m.team === 0 ? 120 : 30, m.team === 0 ? 120 : 30, true);
  for (const f of fighters) issueMove(w, f, f.team === 0 ? 110 : 40, f.team === 0 ? 110 : 40, true);
  return { w, fighters, minions };
}

/** keep the army at 150: dead minions are replaced at their base (exercises death → corpse → removal) */
function topUp(w: World, minions: Entity[]): void {
  for (let k = 0; k < minions.length; k++) {
    const m = minions[k];
    if (m.alive || w.entity(m.id)) continue; // still a corpse
    const team = m.team;
    const n = spawnUnit(w, m.def, team, team === 0 ? 22 + (k % 5) : 128 - (k % 5), team === 0 ? 22 - (k % 3) : 128 + (k % 3));
    issueMove(w, n, team === 0 ? 120 : 30, team === 0 ? 120 : 30, true);
    minions[k] = n;
  }
}

function drive(w: World, fighters: Entity[], tick: number, minions?: Entity[]): void {
  if (minions && tick % 30 === 0) topUp(w, minions);
  // fighters cast on a fixed rotation (deterministic): exercises areas, projectiles, dashes, zones
  for (let i = 0; i < fighters.length; i++) {
    const f = fighters[i];
    if (!f.alive) continue;
    const slot = (tick + i * 7) % 120;
    if (slot === 0) tryCast(w, f, 0);
    else if (slot === 30) tryCast(w, f, 1, f.x + (f.team === 0 ? 5 : -5), f.y + (f.team === 0 ? 5 : -5));
    else if (slot === 60) tryCast(w, f, 2, f.x + (f.team === 0 ? 3 : -3), f.y + (f.team === 0 ? 3 : -3));
    else if (slot === 90) tryCast(w, f, 3);
    if (tick % 150 === i * 10) issueMove(w, f, f.team === 0 ? 110 : 40, f.team === 0 ? 110 : 40, true);
  }
}

interface Timing { avg: number; p50: number; p99: number; max: number; events: number; deaths: number; alive: number; fought: boolean; entities: number; searches: number; grid: number }
function measureRun(): Timing {
  const { w, fighters, minions } = scenario(4242);
  for (let t = 0; t < 90; t++) { drive(w, fighters, w.tick, minions); w.step(); } // warm-up (JIT)
  const N = 900;
  const times: number[] = [];
  let events = 0;
  let deaths = 0;
  for (let t = 0; t < N; t++) {
    drive(w, fighters, w.tick, minions);
    const t0 = performance.now();
    const evs = w.step();
    times.push(performance.now() - t0);
    events += evs.length;
    for (const e of evs) if (e.e === 'death') deaths++;
  }
  times.sort((a, b) => a - b);
  return {
    avg: times.reduce((a, b) => a + b, 0) / N, p50: times[Math.floor(N * 0.5)], p99: times[Math.floor(N * 0.99)], max: times[N - 1],
    events, deaths, alive: minions.filter((m) => m.alive).length,
    fought: minions.some((m) => m.hp < m.maxHp) && fighters.some((f) => f.hp < f.maxHp),
    entities: w.entities.length, searches: w.nav.searches, grid: w.nav.gridSearches,
  };
}

section('tick budget', () => {
  {
    const { w, fighters, minions } = scenario(4242);
    const units = w.entities.filter((e) => e.kind !== 'projectile' && e.kind !== 'zone').length;
    check('population: 10 fighters + 150 minions + 40 structures', units === 200 && fighters.length === 10 && minions.length === 150, units);
  }
  // Timing on a shared machine: GC pauses and CPU contention from other processes inflate single
  // ticks at random. A pathological spike in the sim shows up in EVERY run; scheduler noise does
  // not — so the budget checks take the best of up to 3 identical (deterministic) runs.
  const runs: Timing[] = [];
  for (let k = 0; k < 3; k++) {
    const r = measureRun();
    runs.push(r);
    console.log(`  info: run ${k + 1}: 900 ticks: avg ${r.avg.toFixed(3)} ms, p50 ${r.p50.toFixed(3)}, p99 ${r.p99.toFixed(3)}, max ${r.max.toFixed(3)}; ` +
      `${r.events} events, ${r.deaths} deaths; ${r.alive}/150 minions alive; entities ${r.entities}; nav searches ${r.searches} (grid ${r.grid})`);
    if (r.avg < 2 && r.p99 < 6) break;
  }
  const r = runs[0];
  check('units die and are replaced during the run', r.deaths > 10 && r.alive > 100, { deaths: r.deaths, alive: r.alive });
  check('the armies actually fight (damage taken on both sides)', r.fought);
  const bestAvg = Math.min(...runs.map((x) => x.avg)), bestP99 = Math.min(...runs.map((x) => x.p99));
  check('average tick under 2 ms (best of runs)', bestAvg < 2, `${bestAvg.toFixed(3)} ms`);
  check('p99 tick under 6 ms (no pathological spikes; best of runs)', bestP99 < 6, `${bestP99.toFixed(3)} ms`);
});

section('determinism', () => {
  const run = (seed: number): string => {
    const { w, fighters, minions } = scenario(seed);
    for (let t = 0; t < 450; t++) { drive(w, fighters, w.tick, minions); w.step(); }
    return stateDigest(w);
  };
  const d1 = run(7), d2 = run(7), d3 = run(8);
  check('same seed + same commands ⇒ same digest (15 s, full fight)', d1 === d2, [d1, d2]);
  check('different seed ⇒ different digest (crits differ)', d1 !== d3, [d1, d3]);
});

finish('probe_sim_core_perf');
