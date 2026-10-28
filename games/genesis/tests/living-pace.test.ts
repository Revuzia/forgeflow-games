// GENESIS — LIVING PACE (LIVING.md §1): slow and realistic, with speed steps. The clock (1x = one game minute a real
// second; presets 1x–3000x; `time.scale { tps }` puts 1000x / 3000x on the old 100x / 1000x paths, the same hash), the
// 1.5 save (a 1.4 save loads), the working day (2 m a minute; everyday work within a day trip; far work a trip with a
// camp; nothing far begun after dusk; nights on the road are camps), and fire without the god (dry lightning, fire
// seasons, a fire seen is a fire learned).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../src/sim/sim.ts';
import { SPEED_PRESETS, TICKS_PER_SECOND_1X, type Command } from '../src/sim/types.ts';
import { LEVEL_SCALE, lapseLevel, levelOfScale, levelOfTps } from '../src/sim/perf/lapse.ts';
import { readSave, SAVE_MAJOR, SAVE_MINOR } from '../src/sim/core/serialize.ts';
import { BASE_WALK, DAY_TRIP, TASK, PHASE } from '../src/sim/people/defs.ts';
import { MAX_WORK_COST, dayTripCost, flowCost, availability, itemIdx } from '../src/sim/people/resources.ts';
import { NEAR_HOME_M, TRIP_DAYS, camping, daylightLeft, paceWork, provisioned } from '../src/sim/perf/pace.ts';
import { startTask } from '../src/sim/people/tasks.ts';
import { distM, sunElevation, spotInCell } from '../src/sim/people/world.ts';
import { strikeAt, HEAT_STRIKES_PER_HOUR } from '../src/sim/fields/weather.ts';
import { FIRE_SEEN_M } from '../src/sim/people/firewatch.ts';
import { planetArrays } from '../src/sim/world/planet.ts';
import { Hasher } from '../src/sim/core/hash.ts';
import { world, must, people, ctx, adultsOf } from './helpers/peoples.ts';
import { twoTowns } from './helpers/god.ts';
import type { Settlement } from '../src/sim/people/state.ts';

// ───────────────────────────── the clock and the speed steps ─────────────────────────────

test('pace: 1x is one game minute a real second; the presets 1x-3000x and their time-lapse levels', () => {
  assert.equal(TICKS_PER_SECOND_1X, 1);
  assert.deepEqual([...SPEED_PRESETS], [0, 1, 2, 3, 5, 10, 30, 100, 300, 1000, 3000]);
  for (const s of [1, 2, 3, 5, 10, 30, 100, 300]) assert.equal(levelOfTps(s), 0, `${s}x is the plain sim`);
  assert.equal(levelOfTps(1000), 1);
  assert.equal(levelOfTps(3000), 2);
  // the legacy multiplier keeps its meaning, and each level is saved as its legacy multiplier
  for (const lv of [0, 1, 2] as const) assert.equal(levelOfScale(LEVEL_SCALE[lv]), lv);
  const sim = new Sim({ seed: 3, scenario: 'sandbox', overrides: { n: 16 } });
  const q = sim.query('pace') as { tps: number; level: number; realSecondsPerDay: number; realSecondsPerYear: number; presets: { preset: number; level: number }[] };
  assert.equal(q.tps, 1);
  assert.equal(q.level, 0);
  assert.equal(q.realSecondsPerDay, 1440, 'a day lasts 24 real minutes at 1x');
  assert.equal(q.realSecondsPerYear, sim.u.planets[0].st.orbit.period, 'a 12-day year lasts 4.8 real hours at 1x');
  assert.deepEqual(q.presets.map((x) => x.level), [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2]);
  assert.equal(sim.snapshot({ drain: false }).lapseLevel, 0);
  must(sim, { k: 'time.scale', tps: 3000 });
  assert.equal(sim.snapshot({ drain: false }).lapseLevel, 2, 'the HUD badge reads the logged level');
});

test('pace: time.scale { tps } — 1000x is the old 100x path, 3000x the old 1000x path (same hash); 1x-300x the plain sim', () => {
  const run = (cmd: Command | null): Sim => {
    const s = new Sim({ seed: 5, scenario: 'sandbox', overrides: { n: 16 } });
    s.step(37);
    if (cmd) must(s, cmd);
    s.step(400);
    return s;
  };
  assert.equal(run({ k: 'time.scale', tps: 1000 }).hash(), run({ k: 'time.scale', scale: 100 }).hash(), '1000x = legacy 100x');
  assert.equal(run({ k: 'time.scale', tps: 3000 }).hash(), run({ k: 'time.scale', scale: 1000 }).hash(), '3000x = legacy 1000x');
  const plain = run(null).hash();
  for (const tps of [1, 2, 300]) assert.equal(run({ k: 'time.scale', tps }).hash(), plain, `${tps}x is the plain sim`);
  const s = run({ k: 'time.scale', tps: 1000 });
  assert.equal(lapseLevel(s.u), 1);
  assert.deepEqual(s.u.log.filter((e) => e.cmd.k === 'time.scale').map((e) => e.cmd.tps), [1000], 'logged with its tps');
  assert.equal(s.applyNow({ k: 'time.scale' }).ok, false, 'tps or the legacy scale is needed');
});

// ───────────────────────────── saves ─────────────────────────────

/** the same save as a 1.4 one: minor 4 in the header, and without the arrays 1.5 added */
function asV14(bytes: Uint8Array, drop: (name: string) => boolean): Uint8Array {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const hlen = dv.getUint32(8, true);
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + hlen))) as Record<string, unknown> & { __blobs: { n: string }[] };
  header.__blobs = header.__blobs.filter((b) => !drop(b.n));
  const start = (12 + hlen + 7) & ~7;
  const blobs = bytes.subarray(start);
  const json = new TextEncoder().encode(JSON.stringify(header));
  const nstart = (12 + json.length + 7) & ~7;
  const out = new Uint8Array(nstart + blobs.length);
  out.set(bytes.subarray(0, 12));
  const ov = new DataView(out.buffer);
  ov.setUint16(4, (SAVE_MAJOR << 8) | 4, true);
  ov.setUint32(8, json.length, true);
  out.set(json, 12);
  out.set(blobs, nstart);
  return out;
}

const PACE_COLUMNS = ['trip', 'camp', 'tripTask', 'dayWork'];

/** hash of the world arrays without the 1.5 agent columns */
function hashWithout(sim: Sim): string {
  const h = new Hasher();
  for (const p of sim.u.planets) for (const [name, arr] of planetArrays(p)) {
    if (PACE_COLUMNS.some((c) => name === `a.${c}`)) continue;
    h.str(name); h.typed(arr);
  }
  return h.hex();
}

test('pace: saves are 1.5; a 1.4 save (no trip columns) loads with everyone at home, keeps its world, and runs on deterministically', () => {
  assert.equal(SAVE_MINOR, 5);
  const sim = world(24);
  people(sim, 'plains-folk', 14, { settled: true });
  sim.step(600);
  const old = asV14(sim.save(), (n) => PACE_COLUMNS.some((c) => n.endsWith(`.a.${c}`)));
  assert.equal(readSave(old).header.migratedFrom, '1.4');
  const back = Sim.load(old);
  assert.equal(back.tick, sim.tick);
  assert.equal(hashWithout(back), hashWithout(sim), 'every array a 1.4 save has is loaded as it was');
  const A = back.u.planets[0].people.agents;
  for (let s = 0; s < A.hi; s++) {
    assert.equal(A.trip[s], 0); assert.equal(A.camp[s], -1); assert.equal(A.tripTask[s], 0); assert.equal(A.dayWork[s], 0);
  }
  // its hash survives save -> load, and two loads live on alike
  const again = Sim.load(back.save());
  assert.equal(again.hash(), back.hash());
  back.step(300); again.step(300);
  assert.equal(again.hash(), back.hash());
});

// ───────────────────────────── the working day ─────────────────────────────

test('pace: people walk 2 m a game minute; everyday work lies within a day trip; far work is a trip that camps at night', () => {
  assert.equal(BASE_WALK, 2);
  assert.equal(DAY_TRIP, 60);
  const sim = world(48, 7);
  const st = people(sim, 'plains-folk', 20, { settled: true });
  sim.step(120);
  const x = ctx(sim);
  const p = sim.u.planets[0];
  assert.ok(dayTripCost(p) >= BASE_WALK * DAY_TRIP);
  // a cell beyond a day trip within the work reach, with wood on it
  const wood = itemIdx(x, 'wood');
  let far = -1;
  for (const c of st.flow!.cells) {
    const k = flowCost(st, c);
    if (k > dayTripCost(p) + 20 && k < MAX_WORK_COST && availability(x, wood, c) > 0.1 && p.f.water[c] < 0.05) { far = c; break; }
  }
  assert.ok(far >= 0, 'a far wood lot');
  // an adult at home in the morning sets out for it: a trip with a camp, provisioned
  const s = adultsOf(sim, st)[0];
  let tries = 0;
  while (daylightLeft(x, s) < 8 * 60 && tries++ < 48) { sim.step(30); x.tick = sim.tick; }
  const goal = spotInCell(p, far, x.A.id[s], 23, [0, 0, 0]);
  const t = paceWork(x, s, st, { kind: TASK.chop, goal, goalCell: far, work: 150, data: wood });
  assert.ok(t, 'set out in daylight');
  assert.ok(camping(x, s) && provisioned(x, s), 'a trip with a camp at the site');
  assert.ok(x.A.trip[s] <= sim.tick + TRIP_DAYS * x.day);
  startTask(x, s, t!);
  // through the next night: they sleep at the camp, far from home, not walking home in the dark
  let camped = false, walkedHomeAtNight = false;
  const P = [0, 0, 0];
  for (let k = 0; k < 1440 && !camped; k += 10) {
    sim.step(10);
    const A = sim.u.planets[0].people.agents;
    if (!A.alive[s]) break;
    A.posAt(s, sim.tick, P);
    const night = sunElevation(sim.u, p, sim.tick, P) < -0.03;
    if (A.task[s] === TASK.camp && A.phase[s] === PHASE.working) camped = distM(p, P, st.pos) > 60;
    if (night && A.task[s] === TASK.store && A.phase[s] === PHASE.moving) walkedHomeAtNight = true;
  }
  assert.ok(camped, 'a night at the camp, away from home');
  assert.ok(!walkedHomeAtNight, 'no load carried home in the dark');
});

test('pace: no far work is begun when the walk out, the work and the walk back do not fit before dusk', () => {
  const sim = world(48, 7);
  const st = people(sim, 'plains-folk', 20, { settled: true });
  sim.step(60);
  const x = ctx(sim);
  const p = sim.u.planets[0];
  const s = adultsOf(sim, st)[0];
  // a day-trip cell beyond the village (the next ring of cells)
  let c0 = -1;
  for (const c of st.flow!.cells) { const d = distM(p, [p.grid.pos[c * 3], p.grid.pos[c * 3 + 1], p.grid.pos[c * 3 + 2]], st.pos); if (d > 50 && d < 140 && flowCost(st, c) <= dayTripCost(p) && p.f.water[c] < 0.05) { c0 = c; break; } }
  assert.ok(c0 >= 0, 'a day-trip cell beyond the village');
  const task = () => ({ kind: TASK.forage, goal: spotInCell(p, c0, x.A.id[s], 19, [0, 0, 0]), goalCell: c0, work: 150, data: itemIdx(x, 'berries') });
  // an hour before dusk (and at night): refused; with the day ahead: taken
  let hourBefore = false, morning = false, night = false;
  for (let k = 0; k < 1440 * 2 && !(hourBefore && morning && night); k += 15) {
    sim.step(15); x.tick = sim.tick;
    const A = sim.u.planets[0].people.agents;
    A.trip[s] = 0; A.camp[s] = -1;
    const light = daylightLeft(x, s);
    if (light > 0 && light < 60 && !hourBefore) { assert.equal(paceWork(x, s, st, task()), null, 'nothing far begun before dusk'); hourBefore = true; }
    if (light > 8 * 60 && !morning) { assert.ok(paceWork(x, s, st, task()), 'the day ahead: taken'); morning = true; }
    if (light === 0 && !night) { assert.equal(paceWork(x, s, st, task()), null, 'nothing far begun at night'); night = true; }
    A.trip[s] = 0; A.camp[s] = -1;
  }
  assert.ok(hourBefore && morning && night);
  // work at home is not far work
  const home = { kind: TASK.craft, goal: [st.pos[0], st.pos[1], st.pos[2]], goalCell: st.cell, work: 60 };
  assert.ok(NEAR_HOME_M > 0 && paceWork(x, s, st, home));
});

test('pace: a settled village lives a day at 1x walking a fraction of its waking hours, nothing far begun in the dark', () => {
  const sim = world(48, 7);
  const st = people(sim, 'plains-folk', 24, { settled: true });
  sim.step(1440); // a day to settle in
  const p = sim.u.planets[0];
  const A = p.people.agents;
  let awake = 0, walking = 0, farAtNight = 0;
  const last = new Map<number, number>();
  const P = [0, 0, 0];
  for (let k = 0; k < 1440; k += 5) {
    sim.step(5);
    for (const s of p.people.members.get(st.id) ?? []) {
      if (A.flags[s] & 1) continue;
      const task = A.task[s];
      if (task === TASK.sleep || task === TASK.camp) { last.set(s, task); continue; }
      awake++;
      if (A.phase[s] === PHASE.moving && task !== TASK.idle) walking++;
      if (last.get(s) !== task && (task === TASK.forage || task === TASK.chop || task === TASK.quarry || task === TASK.fish || task === TASK.farm)) {
        A.posAt(s, sim.tick, P);
        const g = [A.gx[s], A.gy[s], A.gz[s]];
        if (sunElevation(sim.u, p, sim.tick, P) < -0.03 && distM(p, g, st.pos) > 60 && A.camp[s] < 0) farAtNight++;
      }
      last.set(s, task);
    }
  }
  const share = walking / Math.max(1, awake);
  assert.ok(share < 0.35, `adults walk ${(share * 100).toFixed(1)} % of their waking time (was ~70 % at 0.25 m a minute)`);
  assert.equal(farAtNight, 0, 'no far work begun in the dark by anyone not at a camp');
});

// ───────────────────────────── fire without the god ─────────────────────────────

/** a land cell near the equator with a disc of dry grass around it */
function dryGrass(sim: Sim, biome: string, radius = 1500): { c: number; cells: number[] } {
  const p = sim.u.planets[0];
  const f = p.f, P = p.grid.pos;
  let c = -1;
  for (let i = 0; i < p.count; i++) if (!p.s.ocean[i] && Math.abs(P[i * 3 + 1]) < 0.25 && f.water[i] < 0.01) { c = i; break; }
  assert.ok(c >= 0);
  const b = sim.u.content.biomes.idx(biome);
  const cells = p.cellsNear([P[c * 3], P[c * 3 + 1], P[c * 3 + 2]], radius).slice().filter((o) => !p.s.ocean[o]);
  for (const o of cells) dry(p, o, b);
  return { c, cells };
}
function dry(p: Sim['u']['planets'][0], o: number, biome: number): void {
  const f = p.f;
  f.water[o] = 0; f.snow[o] = 0; f.precip[o] = 0; f.moisture[o] = 0.08; f.wetness[o] = 0; f.temperature[o] = 28;
  f.grass[o] = 0.9; f.shrub[o] = 0.3; f.tree[o] = 0.1; f.biome[o] = biome; f.fire[o] = 0;
}

test('fire: a dry strike lights cured fuel where a strike on its own storm\'s rain never did', () => {
  const sim = new Sim({ seed: 11, scenario: 'sandbox', overrides: { n: 32, vegetation: 1 } });
  const { cells } = dryGrass(sim, 'savanna');
  const p = sim.u.planets[0];
  const lit = (dryKind: number) => {
    let n = 0;
    for (let i = 0; i < 60; i++) {
      const c = cells[i % cells.length];
      p.f.fire[c] = 0;
      sim.u.tick += 7;
      strikeAt(sim.u, p, c, 1, 12, 1, dryKind);
      if (p.f.fire[c] > 0) n++;
      p.f.fire[c] = 0;
    }
    return n;
  };
  assert.equal(lit(0), 0, 'a strike under its own rain: the ground reads wet');
  assert.ok(lit(1) >= 3, `dry strikes on the leading edge light fires (${lit(1)} of 60)`);
});

test('fire: storms strike dry on their leading edge; in the dry season grass country burns without a storm', () => {
  const sim = new Sim({ seed: 11, scenario: 'sandbox', overrides: { n: 32, vegetation: 1 } });
  must(sim, { k: 'set', path: 'disasters.natural', value: 0 });
  const p = sim.u.planets[0];
  const savanna = sim.u.content.biomes.idx('savanna');
  const { c, cells } = dryGrass(sim, 'savanna', 2200);
  assert.ok(HEAT_STRIKES_PER_HOUR > 0);
  // a thunderstorm drifting over the dry land: some of its strikes fall on the cells it just entered
  const P = p.grid.pos;
  must(sim, { k: 'weather.paint', kind: 'thunderstorm', pos: [P[c * 3], P[c * 3 + 1], P[c * 3 + 2]], radius: 700, intensity: 1, duration: 600 });
  let dryStrikes = 0, heatStrikes = 0, fires = 0;
  for (let k = 0; k < 36 * 6; k++) {
    // (keep the land in its dry season: the hourly climate pass and the biome pass would otherwise move it)
    for (const o of cells) if (p.f.fire[o] <= 0 && p.f.burnt[o] < 0.05 && p.f.precip[o] <= 0) dry(p, o, savanna);
    sim.step(10);
    for (const e of sim.drainEvents()) {
      if (e.t === 'lightning' && e.data?.dry === 1) dryStrikes++;
      if (e.t === 'lightning' && e.data?.dry === 2) heatStrikes++;
      if (e.t === 'fire.start' && e.data?.cause === 'lightning') fires++;
    }
  }
  assert.ok(dryStrikes > 0, `a moving storm strikes dry on its leading edge (${dryStrikes})`);
  assert.ok(heatStrikes > 0, `dry-season strikes in grass country (${heatStrikes})`);
  assert.ok(fires > 0, `lightning fires (${fires})`);
});

test('fire: a fire seen within 2 km is a fire learned (the wildfire accident: a brand carried home)', () => {
  const sim = world(32, 5);
  const st = people(sim, 'plains-folk', 16, { settled: true });
  sim.step(60);
  const p = sim.u.planets[0];
  const P = p.grid.pos;
  // a dry wood ~1.5 km off, and one ~2.6 km off
  const at = (m: number): number => {
    let best = -1, bd = Infinity;
    for (let c = 0; c < p.count; c++) {
      if (p.s.ocean[c] || p.f.water[c] > 0.03) continue;
      const d = Math.abs(distM(p, [P[c * 3], P[c * 3 + 1], P[c * 3 + 2]], st.pos) - m);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  };
  const burnAt = (c: number) => {
    for (const o of p.cellsNear([P[c * 3], P[c * 3 + 1], P[c * 3 + 2]], 250)) { p.f.tree[o] = 0.9; p.f.grass[o] = 0.6; p.f.moisture[o] = 0.05; p.f.wetness[o] = 0; p.f.water[o] = 0; p.f.precip[o] = 0; }
    must(sim, { k: 'fire.ignite', pos: [P[c * 3], P[c * 3 + 1], P[c * 3 + 2]], radius: 150, strength: 1 });
  };
  assert.ok(FIRE_SEEN_M === 2000);
  const farCell = at(2600);
  burnAt(farCell);
  delete st.recent.wildfire;
  sim.step(120);
  assert.equal(st.recent.wildfire, undefined, 'a fire 2.6 km off is out of sight');
  for (let c = 0; c < p.count; c++) p.f.fire[c] = 0;
  const nearCell = at(1500);
  burnAt(nearCell);
  sim.step(120);
  assert.ok(st.recent.wildfire !== undefined, 'a fire 1.5 km off is seen: someone goes for a brand');
});

test('fire: a fire lit between two towns\' staggered hourly steps is seen alike after a save and load (fix r1 #0)', () => {
  // (the burning cells used to be gathered once a game hour, by the first town to ask; a game loaded mid-hour gathered
  // them again from a fire field that had moved on, and the second town saw a fire the continuous run never showed it)
  const { sim, st, lune } = twoTowns();
  const p = sim.u.planets[0], g = p.grid;
  const minute = (id: number) => (((-7 * id) % 60) + 60) % 60; // settlement.ts: each town's minute of the hour
  const [first, second] = minute(st.id) < minute(lune.id) ? [st, lune] : [lune, st];
  const H0 = Math.ceil((sim.u.tick + 1) / 60) * 60 + 60;
  const dist = (c: number, s: Settlement) => distM(p, [g.pos[c * 3], g.pos[c * 3 + 1], g.pos[c * 3 + 2]], s.pos);
  let cell = -1;
  for (let c = 0; c < g.count && cell < 0; c++) if (p.f.water[c] <= 0.05 && p.f.tree[c] >= 0.2 && dist(c, second) > 800 && dist(c, second) < 1800 && dist(c, first) > 300) cell = c;
  assert.ok(cell >= 0, 'a wood within sight of the second town');
  sim.step(H0 + minute(first.id) + 2 - sim.u.tick); // the first town's step of this hour has run
  must(sim, { k: 'fire.ignite', pos: [g.pos[cell * 3], g.pos[cell * 3 + 1], g.pos[cell * 3 + 2]], radius: 80 });
  const loaded = Sim.load(sim.save());
  assert.equal(loaded.hash(), sim.hash());
  const T = H0 + minute(second.id) + 2;
  sim.step(T - sim.u.tick); loaded.step(T - loaded.u.tick);
  const seen = (s: Sim) => s.u.planets[0].people.settlement(second.id)!.recent.wildfire;
  assert.equal(seen(loaded), seen(sim), 'the second town sees the same fires');
  assert.equal(loaded.hash(), sim.hash(), 'after the second town\'s step');
  sim.step(600); loaded.step(600);
  assert.equal(loaded.hash(), sim.hash(), '+600 ticks');
});
