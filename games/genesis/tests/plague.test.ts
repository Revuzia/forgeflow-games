// GENESIS — plagues (CONTRACT.md §10): SEIR among the people of a settlement (individuals and cohort alike), carried to
// the neighbours by contact (visits, caravans), never to a town nobody from there ever reaches; medicine (a settlement
// that knows it) makes far fewer of the sick die.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Sim } from '../src/sim/sim.ts';
import type { Settlement } from '../src/sim/people/state.ts';
import { offsetPoint, distM } from '../src/sim/people/world.ts';
import { learn } from '../src/sim/people/knowledge.ts';
import { world, people, ctx, membersOf, must } from './helpers/peoples.ts';

/** a town of `count` at `pos` (or the best site) */
function town(sim: Sim, count: number, pos?: number[]): Settlement {
  return people(sim, 'plains-folk', count, { era: 'iron', settled: true, ...(pos ? { pos } : {}) });
}

/** a land spot `dist` metres from a settlement */
function spotFrom(sim: Sim, st: Settlement, dist: number, salt: number): number[] {
  const p = sim.u.planets[0];
  for (let k = 0; k < 24; k++) {
    const at = offsetPoint(st.pos, dist, salt + k * 0.37, p.st.radius, [0, 0, 0]);
    if (p.f.water[p.cellAt(at)] < 0.05 && p.f.temperature[p.cellAt(at)] > 0) return at;
  }
  throw new Error('no land there');
}

/** step a day in hours, tracking who has had the disease and who died of it */
function day(sim: Sim, d: number, ever: Set<number>, dead: { n: number }): void {
  const A = sim.u.planets[0].people.agents;
  for (let h = 0; h < 24; h++) {
    sim.step(60);
    for (let s = 0; s < A.hi; s++) if (A.alive[s] && A.disease[s] === d) ever.add(A.id[s]);
    for (const e of sim.drainEvents()) if (e.t === 'death' && (e.data as { cause?: string })?.cause === 'sickness') dead.n++;
  }
}

test('a plague spreads by contact: through a town, to its neighbour, not to a town nobody reaches', () => {
  const sim = world(32, 21);
  const a = town(sim, 60);
  const b = town(sim, 40, spotFrom(sim, a, 450, 0.3));
  const p = sim.u.planets[0];
  // beyond the reach of any caravan or boat (traders and voyages go no further than ~4.5 km)
  const c = town(sim, 30, spotFrom(sim, a, 5200, 2.1));
  assert.ok(distM(p, a.pos, c.pos) > 4600 && distM(p, b.pos, c.pos) > 4600, 'the far town is out of reach');
  const x = ctx(sim);
  const plague = x.c.diseases.idx('plague');
  must(sim, { k: 'settlement.introduce', settlement: a.id, disease: 'plague', qty: 1 });
  const ever = new Set<number>(), dead = { n: 0 };
  const inB = () => membersOf(sim, b).some((s) => ever.has(x.A.id[s])) || b.recent.epidemic === plague + 1;
  let reachedB = -1;
  for (let d = 1; d <= 16; d++) {
    day(sim, plague, ever, dead);
    if (reachedB < 0 && inB()) reachedB = d;
  }
  const inA = [...ever].filter((id) => { const s = x.A.slotOf(id); return s < 0 || x.A.settlement[s] === a.id; }).length;
  assert.ok(inA >= 18, `one case became an epidemic in the town (${inA} had it)`);
  assert.ok(reachedB > 0, 'it reached the neighbouring town');
  assert.ok(!membersOf(sim, c).some((s) => ever.has(x.A.id[s])) && c.recent.epidemic === undefined, 'the far town was spared');
  assert.ok(sim.u.chronicle.some((e) => e.kind === 'plague' && e.text.includes(b.name)), 'the chronicle tells how it came to the neighbour');
  // the inspector sees it
  const q = sim.query('diseases') as { id: string; settlements: { id: number }[] }[];
  assert.ok(q.find((d) => d.id === 'plague'));
});

test('medicine: a town that knows it loses far fewer of its sick', () => {
  const run = (medicine: boolean) => {
    const sim = world(32, 21);
    const st = town(sim, 60);
    const x = ctx(sim);
    if (medicine) for (const s of membersOf(sim, st)) for (const id of ['herbalism', 'medicine']) learn(x, s, x.rt.byId.get(id)!, 'spawn');
    must(sim, { k: 'settlement.introduce', settlement: st.id, disease: 'plague', qty: 2 });
    const ever = new Set<number>(), dead = { n: 0 };
    for (let d = 0; d < 16; d++) day(sim, x.c.diseases.idx('plague'), ever, dead);
    return { sick: ever.size, dead: dead.n };
  };
  const without = run(false);
  const withMed = run(true);
  assert.ok(without.dead >= 5, `the plague kills without medicine (${without.dead} of ${without.sick})`);
  assert.ok(withMed.dead < without.dead * 0.7, `medicine: ${withMed.dead} of ${withMed.sick} died, against ${without.dead} of ${without.sick}`);
  // and per case, not only because fewer fell sick
  assert.ok(withMed.dead / Math.max(1, withMed.sick) < without.dead / Math.max(1, without.sick), 'fewer of the sick died');
});
