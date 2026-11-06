// GENESIS — ARC §10: the river's warning before a flood. A natural flood is seen coming 6-12 game hours ahead (rain over
// the catchment upstream, the river rising and running brown: `params.warning`, `params.rise`, `params.silt`), every
// settlement in reach is told to go up to high ground, and nobody is harmed before the water comes; a god-sent flood
// warns only when its cast carries a warning.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../src/sim/sim.ts';
import { town, twoTowns, must } from './helpers/god.ts';
import { makeCtx } from '../src/sim/people/ctx.ts';
import type { Mission } from '../src/sim/people/state.ts';
import { ROLE } from '../src/sim/people/defs.ts';
import { AgentFlag } from '../src/sim/types.ts';
import { startTask } from '../src/sim/people/tasks.ts';
import { spawnDisaster, CAST_FLOOD_AFTER, riverFlood, planetTraits } from '../src/sim/god/disasters.ts';
import { paintWeather } from '../src/sim/fields/weather.ts';
import type { DisasterState } from '../src/sim/god/state.ts';
import { dangerRadius, warningTicks } from '../src/sim/god/precursors.ts';
import { srel } from '../src/sim/god/regard.ts';
import { distM } from '../src/sim/people/world.ts';
import { TASK } from '../src/sim/people/defs.ts';
import { offset } from '../src/sim/god/util.ts';

test('a natural flood: 6-12 hours of warning, the town goes up to high ground, nobody harmed before the water', () => {
  const { sim: s0, st } = town();
  const bytes = s0.save();
  const sim = Sim.load(bytes);
  const p = sim.u.planets[0], ps = p.people!, A = ps.agents;
  const ids = (ps.members.get(st.id) ?? []).map((s) => A.id[s]);
  const hp0 = new Map(ids.map((id) => [id, A.health[A.slotOf(id)]]));
  sim.drainEvents();
  const d = spawnDisaster(sim.u, p, 'flood', { pos: st.pos, god: -1, cause: 'nature' });
  assert.ok(typeof d !== 'string', String(d));
  const Wn = d.st.Wn ?? 0;
  assert.ok(Wn >= 360 && Wn <= 720, `warning phase ${Wn} ticks`);
  const ev = sim.drainEvents();
  const warn = ev.find((e) => e.t === 'warning');
  assert.equal((warn?.data as { kind?: string } | undefined)?.kind, 'flood', 'a warning event of kind flood');
  assert.ok(ev.some((e) => e.t === 'evacuate' && (e.data as { settlement?: number }).settlement === st.id), 'the evacuation goes out');
  const def = sim.u.content.disasters.find('flood')!;
  const R = dangerRadius(def, d);
  for (const t of ps.settlements) {
    if (t.fallen >= 0 || t.band || distM(p, t.pos, d.pos) > R + t.territory + 100) continue;
    const o = srel(sim.u, p.id, t.id).evacuate;
    assert.ok(o && o.kind === 'flood' && o.disaster === d.id && o.until > sim.u.tick + Wn, `${t.name} is ordered out`);
  }
  assert.ok(d.st.wU !== undefined && p.weather.some((w) => w.id === d.st.wU), 'rain over the catchment');
  assert.ok(sim.u.chronicle.some((c) => /runs high and brown|climbs its banks/.test(c.text)), 'the chronicle tells the rising river');
  // halfway through: the river rising brown; the people on their way or gone
  sim.step(Math.floor(Wn / 2));
  const v = sim.u.god.disasters.find((q) => q.id === d.id)!;
  assert.equal(v.params.warning, 1);
  assert.ok((v.params.rise ?? 0) > 0.3 && v.params.silt === 1, `rise ${v.params.rise}`);
  sim.step(Wn - Math.floor(Wn / 2) - 1);
  // a tick before the water: nobody dead, nobody hurt by it, most of the town out of reach or on the road
  const alive = ids.filter((id) => A.slotOf(id) >= 0);
  assert.equal(alive.length, ids.length, 'nobody died before the water came');
  assert.equal(d.dead, 0);
  for (const id of alive) assert.ok(A.health[A.slotOf(id)] >= hp0.get(id)! - 0.05, 'nobody harmed before the water');
  const pt: [number, number, number] = [0, 0, 0];
  let out = 0;
  for (const id of alive) { const s = A.slotOf(id); A.posAt(s, sim.u.tick, pt); if (distM(p, pt, d.pos) > R || A.task[s] === TASK.evacuate) out++; }
  assert.ok(out / alive.length >= 0.7, `${out} of ${alive.length} out of reach or leaving`);
  sim.step(2);
  assert.ok(v.params.warning === undefined && v.params.rise === undefined, 'the warning is over when the water comes');
});

test('a god-sent flood: no warning with warning 0 (as today); a cast warning is seen coming and counts as foretold', () => {
  const { sim: s0, st } = town();
  const bytes = s0.save();
  const a = Sim.load(bytes);
  a.drainEvents();
  const r = must(a, { k: 'disaster.spawn', kind: 'flood', pos: st.pos, warning: 0 });
  const d = a.u.god.disasters.find((q) => q.id === r.created![0].id)!;
  assert.ok(!d.st.Wn, 'no warning phase');
  const ev = a.drainEvents();
  assert.ok(!ev.some((e) => e.t === 'warning' || e.t === 'evacuate'), 'no warning, no evacuation');
  assert.equal(srel(a.u, 0, st.id).evacuate ?? null, null);

  const b = Sim.load(bytes);
  b.drainEvents();
  const r2 = must(b, { k: 'disaster.spawn', kind: 'flood', pos: st.pos, warning: 400 });
  const d2 = b.u.god.disasters.find((q) => q.id === r2.created![0].id)!;
  assert.equal(d2.st.Wn, 400);
  const ev2 = b.drainEvents();
  assert.ok(ev2.some((e) => e.t === 'warning' && (e.data as { kind?: string }).kind === 'flood'), 'the rising river shows');
  assert.equal(srel(b.u, 0, st.id).evacuate?.kind, 'flood', 'the order goes out');
  // a harm while the order for the rising river is in force came foretold (regard.ts foretoldAt)
  b.step(30);
  must(b, { k: 'miracle.lightning', pos: st.pos });
  b.step(30);
  const harm = srel(b.u, 0, st.id).acts.filter((x) => x.kind === 'harm').pop();
  assert.ok(harm && harm.foretold, `foretold: ${JSON.stringify(harm)}`);
});

test('the all-clear: when the order lapses after a natural flood the chronicle says they came home', () => {
  const { sim: s0, st } = town();
  const sim = Sim.load(s0.save());
  const p = sim.u.planets[0];
  // the river breaks its banks below the town: in reach (the order goes out), the town itself not drowned
  const d = spawnDisaster(sim.u, p, 'flood', { pos: offset(st.pos, 650, 1, p.st.radius), god: -1, cause: 'nature' });
  assert.ok(typeof d !== 'string');
  assert.ok(srel(sim.u, p.id, st.id).evacuate, 'in reach');
  const until = srel(sim.u, p.id, st.id).evacuate!.until;
  sim.step(until - sim.u.tick + 120);
  assert.equal(srel(sim.u, p.id, st.id).evacuate ?? null, null, 'the order is lifted');
  assert.ok(sim.u.chronicle.some((c) => /came down from the hill|came home to dry/.test(c.text)), 'the all-clear line');
});

// ── r1 (#3/#7/#13): the god's floods at the default wrath warn; the palette's Water power (water.flood) too ──

test('the Water power at the default wrath: the river rises brown first, the town is ordered out, then the water bursts out', () => {
  const { sim: s0, st } = town();
  const sim = Sim.load(s0.save());
  const p = sim.u.planets[0], ps = p.people!, A = ps.agents;
  const ids = (ps.members.get(st.id) ?? []).map((s) => A.id[s]);
  sim.drainEvents();
  const c = p.cellAt(st.pos);
  const w0 = p.f.water[c];
  const r = must(sim, { k: 'water.flood', pos: st.pos });
  assert.match(r.msg ?? '', /rise/);
  const d = sim.u.god.disasters.find((q) => q.id === r.created![0].id)!;
  assert.ok(d && d.kind === 'flood' && d.st.Cf === 1, 'a cast flood record');
  const Wn = d.st.Wn ?? 0;
  assert.ok(Wn >= 360 && Wn <= 720, `warning ${Wn}`);
  const ev = sim.drainEvents();
  assert.ok(ev.some((e) => e.t === 'warning' && (e.data as { kind?: string }).kind === 'flood'), 'the warning event');
  assert.equal(srel(sim.u, p.id, st.id).evacuate?.kind, 'flood', 'the order goes out');
  assert.ok(p.f.water[c] < w0 + 1, 'no flood water at the heart yet');
  sim.step(Math.floor(Wn / 2));
  assert.equal(d.params.warning, 1);
  assert.equal(d.params.silt, 1);
  sim.step(Wn - Math.floor(Wn / 2) - 1);
  assert.equal(ids.filter((id) => A.slotOf(id) >= 0).length, ids.length, 'nobody died before the water came');
  sim.step(3);
  let mx = 0;
  for (const q of p.cellsNear(st.pos, 200)) mx = Math.max(mx, p.f.water[q]);
  assert.ok(mx > 1, `the water bursts out when the warning ends (${mx.toFixed(2)} m)`);
  sim.step(CAST_FLOOD_AFTER + 5);
  assert.ok(!sim.u.god.disasters.some((q) => q.id === d.id), 'the cast flood ends');
});

test('the Water power with no warning: at wrath 1, with warning 0, or with nobody in reach the water comes at once', () => {
  const { sim: s0, st } = town();
  const bytes = s0.save();
  for (const extra of [{ wrath: 1 }, { warning: 0 }]) {
    const sim = Sim.load(bytes);
    const r = must(sim, { k: 'water.flood', pos: st.pos, ...extra });
    assert.ok(!r.created?.length && !sim.u.god.disasters.some((q) => q.kind === 'flood'), `instant (${JSON.stringify(extra)})`);
    let mx = 0;
    for (const q of sim.u.planets[0].cellsNear(st.pos, 200)) mx = Math.max(mx, sim.u.planets[0].f.water[q]);
    assert.ok(mx > 1, 'the water is there now');
  }
  const sim = Sim.load(bytes);
  const p = sim.u.planets[0];
  must(sim, { k: 'water.flood', pos: offset(st.pos, 6000, 2, p.st.radius) });
  assert.ok(!sim.u.god.disasters.some((q) => q.kind === 'flood'), 'nobody to warn: at once');
});

test('disaster.spawn flood at the default wrath warns 6-12 hours (warningTicks has a flood case; none at wrath 1)', () => {
  const { sim: s0, st } = town();
  const bytes = s0.save();
  const a = Sim.load(bytes);
  const r = must(a, { k: 'disaster.spawn', kind: 'flood', pos: st.pos });
  const d = a.u.god.disasters.find((q) => q.id === r.created![0].id)!;
  assert.ok((d.st.Wn ?? 0) >= 360 && (d.st.Wn ?? 0) <= 720, `Wn ${d.st.Wn}`);
  assert.equal(srel(a.u, 0, st.id).evacuate?.kind, 'flood');
  const b = Sim.load(bytes);
  const r2 = must(b, { k: 'disaster.spawn', kind: 'flood', pos: st.pos, wrath: 1 });
  assert.ok(!b.u.god.disasters.find((q) => q.id === r2.created![0].id)!.st.Wn, 'no warning at wrath 1');
  assert.equal(warningTicks(b.u, 'flood', 1), 0);
  assert.ok(warningTicks(b.u, 'flood', 0.75) > 0 && warningTicks(b.u, 'flood', 0.75) < 360);
});

// ── r1 (#4/#14): natural floods on a world that is not 'wet' as a whole — heavy rain over a town by its water ──

test('a dry world: heavy rain over a town by its water can bring a natural flood, with its warning; no rain, none', () => {
  const { sim: s0, st } = town();
  const run = (rain: boolean): DisasterState | null => {
    const sim = Sim.load(s0.save());
    const p = sim.u.planets[0];
    // a pool on land by the town (kept full: the fixture), and a rain held over it — or a clear sky
    const pond = p.cellsNear(st.pos, st.territory + 300).find((c) => !p.s.ocean[c] && c !== st.cell)!;
    assert.ok(pond !== undefined, 'a land cell by the town');
    must(sim, { k: 'weather.clear', everywhere: true });
    if (rain) paintWeather(sim.u, p, 'rain', st.pos, 900, 1e6, 1, true);
    const dry = () => ({ ...planetTraits(sim.u, p), wet: false });
    for (let day = 0; day < 40; day++) {
      p.f.water[pond] = Math.max(p.f.water[pond], 1.5);
      riverFlood(sim.u, p, 1, dry);
      const f = sim.u.god.disasters.find((q) => q.kind === 'flood' && q.cause === 'nature');
      if (f) {
        assert.ok(distM(p, f.pos, st.pos) < st.territory + 400 + 2 * p.edgeM, `at the town's water (${Math.round(distM(p, f.pos, st.pos))} m)`);
        return f;
      }
      sim.step(1440);
      if (!rain) must(sim, { k: 'weather.clear', everywhere: true });
    }
    return null;
  };
  const f = run(true);
  assert.ok(f, 'a natural flood came in 40 rainy days');
  assert.ok((f!.st.Wn ?? 0) >= 360 && (f!.st.Wn ?? 0) <= 720, 'with its warning');
  assert.equal(run(false), null, 'no rain, no river flood');
});

test('a caravan in the flood: members on a mission inside the radius are stopped and walked out; one bound for the town waits beyond it (r2 #5)', () => {
  const { sim, st, lune } = twoTowns();
  const p = sim.u.planets[0], ps = p.people!, A = ps.agents;
  const x = makeCtx(sim.u, p);
  // Aru's caravan for Lune, mustering at home: asleep for the night inside what will be the danger
  const aruM = (ps.members.get(st.id) ?? []).filter((s) => !A.mission[s] && (sim.u.tick - A.birth[s]) / x.year > 18).slice(0, 4);
  // (built by hand: Lune lies over water from Aru and these towns have no boats; the route does not matter here)
  const errand = (from: typeof st, to: typeof st, mem: number[], phase: number): Mission => {
    const m: Mission = { id: sim.u.ids.alloc('mission'), kind: 'trade', from: from.id, to: to.id, members: [], phase, t0: sim.u.tick, tPhase: sim.u.tick, sea: false, boat: -1, boats: 0, out: [], back: [], strength: 0, siege: 0, note: '', path: [p.cellAt(from.pos), p.cellAt(to.pos)], done: [] };
    for (const s of mem) { A.mission[s] = m.id; A.role[s] = ROLE.trader; A.flags[s] |= AgentFlag.trader; m.members.push(A.id[s]); }
    m.members.sort((a, b) => a - b);
    ps.missions.push(m);
    return m;
  };
  const m1 = errand(st, lune, aruM, 0);
  for (const s of aruM) startTask(x, s, { kind: TASK.sleep, goal: null, goalCell: A.cell[s], work: 480, target: -1 });
  // Lune's caravan bound for Aru (outbound)
  const luneM = (ps.members.get(lune.id) ?? []).filter((s) => !A.mission[s] && (sim.u.tick - A.birth[s]) / x.year > 18).slice(0, 3);
  const m2 = errand(lune, st, luneM, 1);
  sim.drainEvents();
  const d = spawnDisaster(sim.u, p, 'flood', { pos: st.pos, god: -1, cause: 'nature' });
  assert.ok(typeof d !== 'string', String(d));
  const Wn = d.st.Wn ?? 0;
  const R = dangerRadius(sim.u.content.disasters.find('flood')!, d);
  const pt: [number, number, number] = [0, 0, 0];
  const inside = (s: number) => { A.posAt(s, sim.u.tick, pt); return distM(p, pt, d.pos) <= R; };
  sim.step(30);
  for (const id of m1.members) {
    const s = A.slotOf(id);
    if (s < 0) continue;
    assert.ok(!inside(s) || A.task[s] === TASK.evacuate, `Aru's caravan member ${id} is leaving (task ${A.task[s]})`);
  }
  // through the warning: Lune's caravan never walks into the danger; Aru's is never back at its errand inside it
  for (let t = 30; t < Wn - 1; t += 30) {
    sim.step(Math.min(30, Wn - 1 - t));
    for (const id of m2.members) { const s = A.slotOf(id); if (s >= 0) assert.ok(!inside(s), `Lune's caravan member ${id} waits beyond the danger (task ${A.task[s]}, t+${t})`); }
    for (const id of m1.members) { const s = A.slotOf(id); if (s >= 0 && inside(s)) assert.equal(A.task[s], TASK.evacuate, `Aru's caravan member ${id} inside the danger is leaving (t+${t})`); }
  }
  // a tick before the water: most of Aru's caravan is out (the walk to high ground is slow, as for the town)
  const out = m1.members.filter((id) => { const s = A.slotOf(id); return s < 0 || !inside(s); }).length;
  assert.ok(out >= Math.ceil(m1.members.length / 2), `${out} of ${m1.members.length} of Aru's caravan out before the water`);
});

test('the chronicle during the warning tells the rising river, not the flood as if it had struck (r2 #9)', () => {
  const { sim, st } = town();
  const p = sim.u.planets[0];
  const n0 = sim.u.chronicle.length;
  const d = spawnDisaster(sim.u, p, 'flood', { pos: st.pos, god: -1, cause: 'nature' });
  assert.ok(typeof d !== 'string', String(d));
  const Wn = d.st.Wn ?? 0;
  const during = () => sim.u.chronicle.slice(n0).map((c) => c.text);
  assert.ok(during().some((t) => /runs high and brown|climbs its banks/.test(t)), 'the rising river is told');
  assert.ok(!during().some((t) => /^Year \d+\. Flood /.test(t)), `no 'Flood on ...' before the water: ${JSON.stringify(during())}`);
  assert.ok(!during().some((t) => /fled before|left their homes/.test(t)), 'the leaving is not told as done before the water');
  sim.step(Wn - 1);
  assert.ok(!during().some((t) => /^Year \d+\. Flood /.test(t)), 'still none a tick before the water');
  sim.step(2);
  assert.equal(during().filter((t) => /^Year \d+\. Flood /.test(t)).length, 1, 'the flood line once, when the water comes');
  // a god-sent flood without a warning keeps its line at once
  const { sim: b, st: s2 } = town();
  const m = b.u.chronicle.length;
  must(b, { k: 'disaster.spawn', kind: 'flood', pos: s2.pos, warning: 0 });
  assert.ok(b.u.chronicle.slice(m).some((c) => /^Year \d+\. Flood /.test(c.text)), 'an unwarned flood is told at once');
});
