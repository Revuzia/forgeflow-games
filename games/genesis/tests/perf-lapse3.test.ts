// GENESIS — SIM perf push 3: the peoples' time-lapse (src/sim/perf/plapse.ts) and the coarser schedules of the worlds
// the camera is not on (src/sim/perf/lapse.ts planetLevel). Level 0 keeps no state; the same seed + the same command
// log (speed and focus changes included) gives the same hash, stepped tick by tick or in chunks, saved and loaded
// mid-stretch, rewound; every settlement step and every scheduled system integrates exactly the time that passed;
// water stays conserved and the sea calms on an unwatched world; a speed change is not a god act.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../src/sim/sim.ts';
import type { Command } from '../src/sim/types.ts';
import type { Universe } from '../src/sim/world/universe.ts';
import type { Planet } from '../src/sim/world/planet.ts';
import type { Settlement, Building } from '../src/sim/people/state.ts';
import type { PCtx } from '../src/sim/people/ctx.ts';
import { makeCtx } from '../src/sim/people/ctx.ts';
import { storePoint } from '../src/sim/people/tasks.ts';
import { conservedVolume } from '../src/sim/fields/hydrology.ts';
import { countCommonBits } from '../src/sim/core/activeset.ts';
import {
  lapseDue, planetLevel, setTimeScale, stagger, LAPSE_BIOME, LAPSE_CLIMATE, LAPSE_HYDRO, LAPSE_RAIN, LAPSE_SAND, LAPSE_SHEETS,
  LAPSE_TERRAIN, LAPSE_VEG, LAPSE_WEATHER, type LapseSys,
} from '../src/sim/perf/lapse.ts';
import { ctxOf, litOf, lowHearthOf, penIn, settleHours, templeIn, SETTLE_HOURS } from '../src/sim/perf/plapse.ts';
import { PHASE, TASK } from '../src/sim/people/defs.ts';

const OPTS = { seed: 4242, scenario: 'sandbox', overrides: { n: 24, vegetation: 1 } };
const PEOPLE: [number, Command][] = [
  [3, { k: 'life.spawn-people', species: 'plains-folk', count: 40, era: 'bronze', settled: true } as unknown as Command],
  [4, { k: 'life.spawn-people', species: 'plains-folk', count: 30, era: 'clay', settled: true, lat: 12, lon: 30 } as unknown as Command],
];

/** play `ticks` ticks of OPTS with `script` (sorted by tick), stepping in chunks, optionally saving / loading at saveAt */
function play(script: [number, Command][], ticks: number, chunk: number, saveAt = -1): Sim {
  let sim = new Sim(OPTS);
  let si = 0;
  while (sim.tick < ticks) {
    while (si < script.length && script[si][0] === sim.tick) {
      const r = sim.applyNow(script[si][1]);
      assert.ok(r.ok, r.msg);
      si++;
    }
    if (sim.tick === saveAt) sim = Sim.load(sim.save());
    let k = chunk;
    if (si < script.length) k = Math.min(k, script[si][0] - sim.tick);
    if (saveAt > sim.tick) k = Math.min(k, saveAt - sim.tick);
    sim.step(Math.min(k, ticks - sim.tick));
  }
  return sim;
}

const stretched = (sim: Sim): number => { const A = sim.u.planets[0].people.agents; let n = 0; for (let s = 0; s < A.hi; s++) if (A.alive[s] && A.dmg[s] !== 0) n++; return n; };

test('peoples time-lapse: level 0 keeps no state — no stretched task, no settlement record — and a 10x preset is the plain sim', () => {
  const a = play(PEOPLE, 900, 900);
  const b = play([...PEOPLE, [5, { k: 'time.scale', scale: 10 }]], 900, 900);
  assert.ok(a.u.planets[0].people.agents.count >= 60, 'the people are there');
  assert.equal(stretched(a), 0);
  assert.equal(stretched(b), 0);
  const recs = (sim: Sim) => Object.keys(sim.u.settings.lapse?.run ?? {}).filter((k) => /:s\d+$/.test(k));
  assert.deepEqual(recs(b), []);
  assert.equal(a.hash(), b.hash(), 'the whole state (a speed change is not even a god act: god/powers.ts PLUMBING)');
  assert.equal(a.u.god.stats.acts ?? 0, b.u.god.stats.acts ?? 0);
});

const SPEEDS: [number, Command][] = [
  ...PEOPLE,
  [60, { k: 'time.scale', scale: 1000 }],
  [433, { k: 'time.scale', scale: 100 }],
  [721, { k: 'time.scale', scale: 1 }],
  [905, { k: 'time.scale', scale: 1000 }],
  [1180, { k: 'focus', planet: 1, lat: 0, lon: 0 } as unknown as Command],
  [1260, { k: 'focus', planet: 0, lat: 10, lon: 20 } as unknown as Command],
];

test('peoples time-lapse: same seed + same log (speed and focus changes) => same hash; chunked, saved mid-stretch, identical', () => {
  const a = play(SPEEDS, 1400, 1);
  const b = play(SPEEDS, 1400, 97);
  const c = play(SPEEDS, 1400, 1400, 300);
  const d = play(SPEEDS, 1400, 64, 1100);
  const e = play(SPEEDS, 1400, 1400, 347);
  assert.equal(b.hash(), a.hash(), 'chunks of 97');
  assert.equal(c.hash(), a.hash(), 'save / load at 300 (1000x, tasks stretched)');
  assert.equal(d.hash(), a.hash(), 'save / load at 1100 (1000x again)');
  assert.equal(e.hash(), a.hash(), 'save / load mid-hour at 347');
});

test('peoples time-lapse: the decision context answers from the live state (no cache survives a change it would miss)', () => {
  const sim = play(SPEEDS.filter(([t]) => t < 120), 120, 60);
  const p = sim.u.planets[0];
  const x = makeCtx(sim.u, p);
  const ps = p.people;
  const defs = x.c.buildings.list;
  const plain = (st: Settlement) => {
    const bs = ps.of(st.id);
    let low: Building | null = null;
    for (const b of bs) if (b.progress >= 1 && !(b.flags & 2) && defs[b.type].function === 'hearth' && b.fuel < 300 && (!low || b.fuel < low.fuel)) low = b;
    const store = bs.find((b) => b.progress >= 1 && b.damage < 0.9 && defs[b.type].provides.includes('store'));
    return {
      low: low?.id ?? -1,
      lit: bs.find((b) => b.fuel > 0 && b.progress >= 1)?.id ?? -1,
      temple: bs.find((b) => b.progress >= 1 && b.damage < 0.9 && defs[b.type].function === 'temple')?.id ?? -1,
      pen: bs.find((b) => b.progress >= 1 && defs[b.type].function === 'pen')?.id ?? -1,
      store: store ? store.cell : st.cell,
    };
  };
  const cached = (st: Settlement) => {
    const cx = ctxOf(x, st)!;
    assert.ok(cx, 'a context at 1000x');
    return { low: lowHearthOf(cx)?.id ?? -1, lit: litOf(cx)?.id ?? -1, temple: templeIn(cx)?.id ?? -1, pen: penIn(cx)?.id ?? -1, store: storePoint(x, st, [0, 0, 0]) };
  };
  let checked = 0;
  for (const st of ps.settlements) {
    if (st.fallen >= 0 || !ps.of(st.id).length) continue;
    assert.deepEqual(cached(st), plain(st), `settlement ${st.id}`);
    // within the same hour and with the same building list: a store ruined, a hearth burnt down and refuelled, a site
    // completed — the next answers must be the plain ones at once (a save / load here would rebuild the context)
    const bs = ps.of(st.id);
    for (let i = 0; i < bs.length; i++) {
      const b = bs[i];
      if (i % 3 === 0) b.damage = b.damage < 0.9 ? 0.95 : 0.1;
      if (i % 3 === 1) b.fuel = b.fuel > 0 ? 0 : 120;
      if (i % 4 === 2) b.progress = b.progress >= 1 ? 0.5 : 1;
      if (i % 5 === 3) b.flags ^= 2;
    }
    assert.equal(ps.of(st.id), bs, 'the same building list (no version change)');
    assert.deepEqual(cached(st), plain(st), `settlement ${st.id} after the changes`);
    checked++;
  }
  assert.ok(checked >= 2, `${checked} settlements checked`);
});

test('peoples time-lapse: at 1000x tasks are stretched, and back at 1x every stretch and settlement record runs out', () => {
  const sim = play(SPEEDS.filter(([t]) => t < 400), 400, 50);
  const A = sim.u.planets[0].people.agents;
  const who = new Set<number>();
  // (round 2: a task is stretched only while no rival activity is within the decision jitter's reach — decide.ts
  // noteRivals — so over this world's first night hardly any is: watch a whole day)
  for (let i = 0; i < 160; i++) { sim.step(10); for (let s = 0; s < A.hi; s++) if (A.alive[s] && A.dmg[s] > 1) who.add(A.id[s]); }
  assert.ok(who.size >= 5, `${who.size} agents worked stretched tasks at 1000x`);
  assert.ok(sim.applyNow({ k: 'time.scale', scale: 1 }).ok);
  sim.step(2000);
  assert.equal(stretched(sim), 0, 'every stretched task ended');
  assert.equal(sim.u.settings.lapse?.run ? Object.keys(sim.u.settings.lapse.run).filter((k) => /:s\d+$/.test(k)).length : 0, 0, 'every settlement record consumed');
});

test('peoples time-lapse: rewind across speed changes replays the log to the lived state', () => {
  const sim = new Sim(OPTS);
  sim.keyframeEvery = 240;
  const at: Record<number, string> = {};
  const script = new Map<number, Command>(SPEEDS);
  for (let t = 0; t < 1400; t++) {
    const cmd = script.get(sim.tick);
    if (cmd) assert.ok(sim.applyNow(cmd).ok);
    if (sim.tick % 100 === 37) at[sim.tick] = sim.hash();
    sim.step(1);
  }
  let n = 0;
  for (const t of [1337, 1137, 837]) {
    if (t < sim.rewindRange()[0]) continue;
    assert.ok(sim.rewind(t), `rewind to ${t}`);
    assert.equal(sim.hash(), at[t], `rewound to ${t}`);
    sim.step(1400 - t);
    n++;
  }
  assert.ok(n >= 1, 'at least one rewind within the ring');
});

test('peoples time-lapse: every settlement step integrates exactly the hours since the last, across speed and focus changes', () => {
  // a bare context: settleHours reads the tick, the settings, the focus and the settlement's id / state
  const planet = { id: 0 } as unknown as Planet;
  const u = { tick: 0, settings: { maxAgents: 0, restraint: false }, focus: { planet: 0, pos: [0, 0, 1] }, planets: [planet] } as unknown as Universe;
  const sts = [3, 4, 7, 11].map((id) => ({ id, fallen: -1, band: false }) as unknown as Settlement);
  const x = { u, p: planet, tick: 0 } as unknown as PCtx;
  const switches = new Map<number, () => void>([
    [97, () => setTimeScale(u, 1000)], [530, () => setTimeScale(u, 100)], [1201, () => setTimeScale(u, 1)],
    [1449, () => setTimeScale(u, 1000)], [1702, () => { u.focus = { planet: 5, pos: [0, 0, 1] }; }],
    [2333, () => setTimeScale(u, 10)], [2900, () => setTimeScale(u, 1000)], [3306, () => { u.focus = { planet: 0, pos: [0, 0, 1] }; }],
    [4001, () => setTimeScale(u, 1)],
  ]);
  const last = new Map<number, number>();
  let coarse = 0;
  for (let t = 0; t < 5000; t++) {
    u.tick = t; x.tick = t;
    switches.get(t)?.();
    for (const st of sts) {
      if ((t + st.id * 7) % 60 !== 0) continue; // people.ts: the settlement's minute of every hour
      const h = settleHours(x, st);
      if (!h) continue;
      const prev = last.get(st.id);
      if (prev !== undefined) assert.equal(t - h * 60, prev, `settlement ${st.id} at tick ${t}: ${h} hours after ${prev}`);
      if (h > 1) coarse++;
      last.set(st.id, t);
    }
  }
  assert.ok(coarse > 50, `${coarse} multi-hour steps`);
  assert.equal(SETTLE_HOURS[0], 1);
  // (the world's own systems keep their records here: nothing in this bare context runs them)
  assert.deepEqual(Object.keys(u.settings.lapse?.run ?? {}).filter((k) => /:s\d+$/.test(k)), [], 'back at level 0 every settlement record was consumed');
});

test('unfocused worlds: every scheduled system integrates exactly the time since it last ran, across level and focus switches', () => {
  const mk = (id: number): Planet => {
    const ocean = new Uint8Array(256);
    ocean.fill(1, 0, 200);
    // (round 2: lava awake or not — the terrain step is coarse on an unwatched world only without lava: coarseIf)
    return { id, airy: true, count: 256, hydro: { oceanCells: 200 }, vents: [], s: { hAct: new Uint8Array(256), ocean, lAct: new Uint8Array(256) } } as unknown as Planet;
  };
  const planets = [mk(0), mk(1), mk(2)];
  const u = { tick: 0, settings: { maxAgents: 0, restraint: false }, planets, focus: { planet: 0, pos: [0, 0, 1] } } as unknown as Universe;
  const systems: [LapseSys, number, boolean, number][] = [
    [LAPSE_CLIMATE, 0, true, 1], [LAPSE_VEG, 30, true, 1], [LAPSE_WEATHER, 0, true, 1], [LAPSE_BIOME, 360, true, 1],
    [LAPSE_TERRAIN, 5, true, 1], [LAPSE_HYDRO, 0, false, 1], [LAPSE_RAIN, 0, true, 2], [LAPSE_SHEETS, 0, false, 2], [LAPSE_SAND, 5, true, 1],
  ];
  const sw = new Map<number, () => void>([
    [97, () => setTimeScale(u, 1000)], [530, () => { u.focus = { planet: 1, pos: [0, 0, 1] }; }], [911, () => setTimeScale(u, 100)],
    [1201, () => { u.focus = { planet: 2, pos: [0, 0, 1] }; }], [1449, () => setTimeScale(u, 1000)], [1702, () => { u.focus = { planet: 0, pos: [0, 0, 1] }; }],
    [2333, () => setTimeScale(u, 10)], [2900, () => setTimeScale(u, 1000)], [3306, () => { u.focus = { planet: 1, pos: [0, 0, 1] }; }],
    [4001, () => setTimeScale(u, 1)],
  ]);
  const last = new Map<string, number>();
  let runs = 0, deep = 0, terrFine = 0, terrCoarse = 0;
  for (let t = 0; t < 5000; t++) {
    u.tick = t;
    sw.get(t)?.();
    for (const p of planets) {
      p.s.hAct.fill(((Math.floor(t / 37) * 7 + p.id * 131) % 997) < 300 ? 1 : 0, 0, 150);
      p.s.lAct[7] = (Math.floor(t / 53) + p.id) % 3 === 0 ? 1 : 0;
      let hydroRan = false, terrainRan = false;
      for (const [sys, phase, st, grid] of systems) {
        if (t % grid !== 0) continue;
        if ((sys === LAPSE_SHEETS || sys === LAPSE_RAIN) && !hydroRan) continue; // called from the hydrology step
        if (sys === LAPSE_SAND && !terrainRan) continue; // called from the terrain step
        const dt = lapseDue(u, p, sys, t + (st ? stagger(p) : 0), phase);
        if (!dt) continue;
        if (sys === LAPSE_HYDRO) { hydroRan = true; if (dt >= 8) deep++; }
        if (sys === LAPSE_TERRAIN) { terrainRan = true; if (planetLevel(u, p) === 3) { if (dt === 10) terrFine++; else if (dt > 10) terrCoarse++; } }
        const key = `${p.id}:${sys.key}`;
        const prev = last.get(key);
        if (prev !== undefined) assert.equal(t - dt, prev, `${key} at tick ${t} (level ${planetLevel(u, p)}): ran ${dt} ticks after ${prev}`);
        last.set(key, t);
        runs++;
      }
    }
  }
  assert.ok(runs > 5000);
  assert.ok(deep > 50, `${deep} 8-tick (or longer) hydrology steps on unwatched worlds`);
  assert.ok(terrFine > 20 && terrCoarse > 20, `unwatched terrain steps: ${terrFine} of 10 ticks (lava awake), ${terrCoarse} longer`);
  assert.equal(u.settings.lapse, undefined, 'back at level 0 for good: no state left');
});

test('unfocused worlds: at 1000x water is conserved on a world the camera is not on, and its sea calms after a tsunami', () => {
  const sim = new Sim({ seed: 21, scenario: 'twoworlds', overrides: { n: 24 } });
  assert.ok(sim.applyNow({ k: 'set', path: 'disasters.natural', value: 0 }).ok);
  // the camera on the desert world: the terran world with its sea is the one nobody watches
  const seaWorld = sim.u.planets.reduce((a, b) => (b.hydro.oceanCells > a.hydro.oceanCells ? b : a));
  const other = sim.u.planets.find((p) => p !== seaWorld && p.airy)!;
  assert.ok(sim.applyNow({ k: 'focus', planet: other.id, lat: 0, lon: 0 } as unknown as Command).ok);
  assert.ok(sim.applyNow({ k: 'time.scale', scale: 1000 }).ok);
  const far = sim.u.planets.find((p) => p.airy && p.hydro.oceanCells > 100 && planetLevel(sim.u, p) === 3);
  assert.ok(far, 'an unwatched world with a sea');
  assert.ok(sim.u.planets.some((p) => planetLevel(sim.u, p) === 2), 'and the watched one at 1000x');
  sim.step(200);
  far.cfg.evaporation = 0;
  far.cfg.infiltration = 0;
  assert.ok(sim.applyNow({ k: 'weather.global', planet: far.id, kind: 'monsoon' }).ok);
  const v0 = conservedVolume(far);
  sim.step(600);
  let sea = -1;
  for (let c = 0; c < far.count && sea < 0; c++) if (far.s.ocean[c] && far.f.water[c] > 5) sea = c;
  const P = far.grid.pos;
  assert.ok(sim.applyNow({ k: 'water.tsunami', planet: far.id, pos: [P[sea * 3], P[sea * 3 + 1], P[sea * 3 + 2]], radius: 250, height: 4 }).ok);
  sim.step(60);
  const awake0 = countCommonBits(far.s.hAct, far.s.ocean, far.count, far.count);
  sim.step(2880);
  const drift = Math.abs(conservedVolume(far) - v0) / far.waterVolume();
  assert.ok(drift < 1e-9, `conserved volume drift ${drift.toExponential(2)} on the unwatched world`);
  const awake = countCommonBits(far.s.hAct, far.s.ocean, far.count, far.count);
  assert.ok(awake0 > 20, `the tsunami woke the sea (${awake0} cells)`);
  assert.ok(awake < Math.max(64, far.hydro.oceanCells >> 6), `two days on the sea has calmed: ${awake} of ${far.hydro.oceanCells} cells awake (${awake0} after the wave)`);
});

/** run means (6-hourly samples) of humidity, temperature, soil moisture and plant cover on every living world but the
 * home one, and each sample's biome histogram */
interface Unwatched { name: string; H: number; T: number; M: number; veg: number; count: number; bio: number[][] }
function unwatchedMeans(scale: number, days: number): Unwatched[] {
  const sim = new Sim({ seed: 3, scenario: 'system', overrides: { n: 24 } });
  assert.ok(sim.applyNow({ k: 'set', path: 'disasters.natural', value: 0 }).ok);
  if (scale > 1) assert.ok(sim.applyNow({ k: 'time.scale', scale }).ok);
  const foc = sim.u.focus?.planet;
  const ps = sim.u.planets.filter((p) => p.airy && p.id !== foc);
  if (scale > 1) assert.ok(ps.every((p) => planetLevel(sim.u, p) === 3), 'the other worlds are unwatched');
  const m: Unwatched[] = ps.map((p) => ({ name: p.name, H: 0, T: 0, M: 0, veg: 0, count: p.count, bio: [] }));
  const n = days * 4;
  for (let i = 0; i < n; i++) {
    sim.step(360);
    ps.forEach((p, j) => {
      let H = 0, T = 0, M = 0;
      const h = new Array<number>(64).fill(0);
      for (let c = 0; c < p.count; c++) { H += p.f.humidity[c]; T += p.f.temperature[c]; M += p.f.moisture[c]; h[p.f.biome[c]]++; }
      m[j].H += H / p.count / n; m[j].T += T / p.count / n; m[j].M += M / p.count / n; m[j].veg += p.vegTotal / n;
      m[j].bio.push(h);
    });
  }
  return m;
}

test('unwatched worlds: their air, temperatures, soils, plants and biomes stay with 1x (a time-lapse approximation, within tolerances)', { timeout: 600_000 }, () => {
  // push 3 round 2: the air of a world nobody watched relaxed 12x slower (one hourly humidity update per 12-hour pass —
  // the dry and cold worlds kept their starting humidity: +23 % / +34 % on the small grid, +64 / +81 % at full size),
  // and lava stepped every 30 ticks ran the volcanic world 5 °C warm. The tolerances are the measured approximation
  // (CONTRACT §5; this grid, seeds 3 and 11, against a 1x twin perturbed once): humidity within 3 % (twin 0.1 %), the
  // lava world 1.2-1.6 °C cool (its passes see newly spread lava late; 0.05-0.4 °C at full size), the others within
  // 0.25 °C, soil moisture up to +8 % on the desert world (twin 0.2 %), plants within 1 %, and 2-3 % of the cells in
  // another biome on the 6-hourly average (twin ≤ 0.4 %: a soil a little wetter tips cells over the wetland line)
  const ref = unwatchedMeans(1, 6), lap = unwatchedMeans(1000, 6);
  for (let j = 0; j < ref.length; j++) {
    const a = ref[j], b = lap[j];
    const dH = (b.H - a.H) / Math.max(0.02, a.H);
    assert.ok(Math.abs(dH) < 0.05, `${a.name}: humidity ${b.H.toFixed(4)} vs ${a.H.toFixed(4)} at 1x (${(100 * dH).toFixed(1)} %)`);
    const tolT = a.T > 100 ? 2.5 : 0.6;
    assert.ok(Math.abs(b.T - a.T) < tolT, `${a.name}: temperature ${b.T.toFixed(2)} vs ${a.T.toFixed(2)} °C at 1x`);
    const dM = (b.M - a.M) / Math.max(0.02, a.M);
    assert.ok(Math.abs(dM) < 0.12, `${a.name}: soil moisture ${b.M.toFixed(4)} vs ${a.M.toFixed(4)} at 1x (${(100 * dM).toFixed(1)} %)`);
    if (a.veg > 50) {
      const dV = (b.veg - a.veg) / a.veg;
      assert.ok(Math.abs(dV) < 0.03, `${a.name}: plant cover ${b.veg.toFixed(0)} vs ${a.veg.toFixed(0)} at 1x (${(100 * dV).toFixed(1)} %)`);
    }
    // the share of cells in another biome: half the L1 distance of the biome histograms, averaged over the samples
    let bs = 0;
    for (let i = 0; i < a.bio.length; i++) {
      let d = 0;
      for (let k = 0; k < a.bio[i].length; k++) d += Math.abs(a.bio[i][k] - b.bio[i][k]);
      bs += d / 2 / a.count / a.bio.length;
    }
    assert.ok(bs < 0.05, `${a.name}: ${(100 * bs).toFixed(2)} % of the cells in another biome than at 1x`);
  }
});

test('peoples time-lapse: an interrupted stretched task yields the whole sessions already worked', () => {
  // round 2: interrupt() (a fire close by, a move, the god's hand, a settlement merge) dropped every session of a
  // stretched task; now each whole session worked is credited, at its own tick, as the 1x agent finished it
  const sim = new Sim(OPTS);
  for (const [, cmd] of PEOPLE) assert.ok(sim.applyNow(cmd).ok);
  assert.ok(sim.applyNow({ k: 'time.scale', scale: 1000 }).ok);
  sim.step(1500);
  const p = sim.u.planets[0], A = p.people!.agents;
  const carried = (s: number): number => { let t = 0; for (let i = 0; i < 4; i++) t += A.invQty[s * 4 + i]; return t; };
  const GATHER: number[] = [TASK.forage, TASK.chop, TASK.quarry, TASK.dig, TASK.fish];
  let found = -1;
  for (let i = 0; i < 6000 && found < 0; i++) {
    sim.step(1);
    for (let s = 0; s < A.hi; s++) {
      const d = A.dmg[s];
      if (!A.alive[s] || d <= 1 || A.phase[s] !== PHASE.working || !GATHER.includes(A.task[s])) continue;
      const e = Math.floor(d / 16), w = A.tWork[s] + e;
      // a gatherer (its yield goes into the hand) that has worked a whole session and is not due yet
      if (sim.tick - A.t1[s] >= w + 2 && sim.tick < A.next[s] - 2) { found = s; break; }
    }
  }
  assert.ok(found >= 0, 'a stretched gatherer a whole session into its work');
  const id = A.id[found], before = carried(found);
  const P = [0, 0, 0];
  A.posAt(found, sim.tick, P);
  assert.ok(sim.applyNow({ k: 'agent.move', planet: 0, id, pos: P } as unknown as Command).ok);
  const s = A.slotOf(id);
  if (s < 0 || !A.alive[s]) return;
  assert.equal(A.dmg[s], 0, 'the stretch is cleared');
  assert.ok(carried(s) > before, `the whole session worked is in hand (${before.toFixed(2)} → ${carried(s).toFixed(2)})`);
});
