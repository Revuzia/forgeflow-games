// GENESIS — release minor item #2 (balance to the owner defaults: hunting >= 20 kills per 100 people a year and a hunted
// share of food 0.15-0.35; under-15 share 0.35-0.45). Each test failed on the tree before its change; the 8-seed
// measurements are in _harness/scratch/minor26/balance.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Sim } from '../src/sim/sim.ts';
import { AgentFlag } from '../src/sim/types.ts';
import type { Settlement } from '../src/sim/people/state.ts';
import type { PCtx } from '../src/sim/people/ctx.ts';
import { makeCtx } from '../src/sim/people/ctx.ts';
import { ROLE, TASK } from '../src/sim/people/defs.ts';
import { distM, cellPos, isLand } from '../src/sim/people/world.ts';
import { spawnHerd, reindexHerds, herdPos } from '../src/sim/life/herds.ts';
import { landOf } from '../src/sim/people/ledger.ts';
import { huntEncounter, onFoot, HUNTERS_BAND, HUNTERS_TOWN, MEAT_DAYS } from '../src/sim/people/hunt.ts';
import { MOUTHS_K, mouths } from '../src/sim/people/demography.ts';
import { frailty } from '../src/sim/life/disease.ts';
import { world, must, people, adultsOf } from './helpers/peoples.ts';

function village(): { sim: Sim; st: Settlement } {
  const sim = world(24, 3);
  must(sim, { k: 'set', path: 'disasters.natural', value: 0 });
  const st = people(sim, 'plains-folk', 30, { era: 'bronze', settled: true });
  sim.step(30);
  return { sim, st };
}

function gameLandAt(x: PCtx, st: Settlement, lo: number, hi: number): number {
  const p = x.p;
  for (let c = 0; c < p.count; c++) {
    if (!isLand(p, c) || p.f.water[c] > 0.05) continue;
    const d = distM(p, cellPos(p, c), st.pos);
    if (d >= lo && d <= hi && onFoot(x, st, st.pos, c)) return c;
  }
  return -1;
}

/** two hunters of st in a party after a fresh herd of `count` wild horses, standing by it on task `data2` */
function party(count: number, data2: number) {
  const { sim, st } = village();
  const x = makeCtx(sim.u, sim.u.planets[0]);
  const A = x.A;
  x.ps.herds = x.ps.herds.filter((h) => h.owner >= 0);
  x.ps.eco.immigration = false;
  reindexHerds(x);
  const horse = x.c.animals.idx('wild-horse');
  const c = gameLandAt(x, st, 250, 600);
  assert.ok(c >= 0, 'land on foot near the village');
  const h = spawnHerd(x, horse, c, count);
  const L = landOf(st);
  L.party = null; delete L.more;
  const two = adultsOf(sim, st).slice(0, 2);
  const q = [0, 0, 0];
  herdPos(h, x.tick, q);
  for (const s of two) {
    A.role[s] = ROLE.hunter;
    for (const it of x.info[A.species[s]].foods) A.take(s, it, 1e6);
    A.place(s, q[0], q[1], q[2], x.tick);
    A.task[s] = TASK.hunt; A.tData2[s] = data2; A.tTarget[s] = h.id;
  }
  L.party = { id: 777, members: two.map((s) => A.id[s]), herd: h.id, species: horse, since: x.tick, lastTry: -1, kills: 0 };
  return { x, st, h, two, p: L.party };
}

// Before: huntEncounter returned at once on a tracking leg (data2 1), so a party that walked up to a drifting herd on its
// legs had no try until a stalk began within 1.5 edges of it (8-seed diag: parties of two 32-100 h out with 0-6 tries).
test('balance: a tracking leg that ends by the herd is an encounter (release minor #2)', () => {
  const { x, st, two, p } = party(12, 1);
  huntEncounter({ ...x, tick: x.tick + 61 }, two[0], st);
  assert.equal(p.lastTry, x.tick + 61, 'the party tried for the herd at the end of its leg');
});

// Before: a herd hunted down to two head could not lose another (spare 0 unless in famine): the party stalked it to the
// end of its days for nothing.
test('balance: a herd of two may lose one to the hunters (release minor #2)', () => {
  const { x, st, h, two, p } = party(2, 0);
  for (let t = 1; t < 400 && p.kills === 0; t++) huntEncounter({ ...x, tick: x.tick + t * 61 }, two[0], st);
  assert.equal(p.kills, 1, 'one of the pair brought down');
  assert.equal(h.count, 1);
});

// Before: births slowed only past 1.5 children an adult and an epidemic's grave case fell on every age alike (8 seeds x
// 25 y: under-15 share 0.465 against 0.35-0.45).
test('balance: births slow past 1.2 children an adult; the grown are hardier to a grave case than children and the old (release minor #2)', () => {
  assert.equal(MOUTHS_K, 1.2);
  const { sim, st } = village();
  const x = makeCtx(sim.u, sim.u.planets[0]);
  const f = mouths(x, st);
  assert.ok(f >= 0.3 && f <= 1, `the mouths factor ${f}`);
  assert.ok(frailty(0) < frailty(AgentFlag.child) && frailty(AgentFlag.child) <= frailty(AgentFlag.elder), 'adult < child <= elder');
  assert.ok(frailty(AgentFlag.elder) <= 1, 'no age is frailer than the disease itself');
});

// Before (m2: a farming town's hunters 15 % of its food workers, resting while the store held 3 days of meat a head) a
// world sent 7-13 parties a year and the 8-seed hunted share of food sat at 0.105; m3 (25 %, 5 days) 0.14 with kills,
// under-15 share and population held (_harness/scratch/minor26/balance.md).
test('balance: a farming town keeps a quarter of its food workers hunting, and they rest only on 5 days of meat a head (release minor #2)', () => {
  assert.ok(HUNTERS_TOWN >= 0.25 && HUNTERS_TOWN <= HUNTERS_BAND, `HUNTERS_TOWN ${HUNTERS_TOWN}`);
  assert.ok(MEAT_DAYS >= 5, `MEAT_DAYS ${MEAT_DAYS}`);
});
