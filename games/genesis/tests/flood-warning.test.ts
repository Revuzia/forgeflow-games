// GENESIS — ARC §10: the river's warning before a flood. A natural flood is seen coming 6-12 game hours ahead (rain over
// the catchment upstream, the river rising and running brown: `params.warning`, `params.rise`, `params.silt`), every
// settlement in reach is told to go up to high ground, and nobody is harmed before the water comes; a god-sent flood
// warns only when its cast carries a warning.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../src/sim/sim.ts';
import { town, must } from './helpers/god.ts';
import { spawnDisaster } from '../src/sim/god/disasters.ts';
import { dangerRadius } from '../src/sim/god/precursors.ts';
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
