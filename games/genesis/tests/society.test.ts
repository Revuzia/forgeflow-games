// GENESIS — societies (CONTRACT.md §8.6): an iron monopoly breeds war; complementary settlements trade (real caravans
// carrying real goods); and a treaty can end a war. Two iron-age towns of different peoples set down a few hundred
// metres apart on a small living world.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Sim } from '../src/sim/sim.ts';
import type { Settlement } from '../src/sim/people/state.ts';
import { offsetPoint, distM } from '../src/sim/people/world.ts';
import { updateResources } from '../src/sim/people/resources.ts';
import { TRAIT, NT } from '../src/sim/people/defs.ts';
import { world, people, ctx, membersOf } from './helpers/peoples.ts';
import { routeBetween } from '../src/sim/people/missions.ts';

/** two settled towns of separate polities, about `dist` metres apart */
function twoTowns(seed: number, era: string, dist = 650, count = 40): { sim: Sim; a: Settlement; b: Settlement } {
  const sim = world(32, seed);
  const a = people(sim, 'plains-folk', count, { era, settled: true });
  const p = sim.u.planets[0];
  let b: Settlement | null = null;
  for (let k = 0; k < 12 && !b; k++) {
    const at = offsetPoint(a.pos, dist, k * 0.52, p.st.radius, [0, 0, 0]);
    if (p.f.water[p.cellAt(at)] > 0.1) continue;
    b = people(sim, 'plains-folk', count, { era, settled: true, pos: at });
  }
  assert.ok(b, 'a second town');
  assert.notEqual(a.polity, b!.polity, 'two peoples');
  assert.ok(distM(p, a.pos, b!.pos) < 1200, 'within reach of each other');
  return { sim, a, b: b! };
}

const STRATEGIC = ['iron', 'iron-ore', 'steel', 'meteoric-iron', 'iron-tools', 'iron-sword', 'copper', 'copper-ore', 'tin', 'tin-ore', 'bronze', 'coal', 'coke'];

/** what a town holds of the strategic metals, set by hand: none at all, or plenty */
function metals(sim: Sim, st: Settlement, plenty: boolean): void {
  const x = ctx(sim);
  const p = sim.u.planets[0];
  for (const id of STRATEGIC) { const it = x.c.items.idx(id); if (it >= 0) st.store[it] = plenty && !id.endsWith('-ore') ? 20 : 0; }
  if (!plenty) for (const c of st.flow?.cells ?? []) if (p.f.oreType[c] > 0) { const ore = x.c.ores.list[p.f.oreType[c] - 1]?.id; if (ore && ['iron', 'copper', 'tin', 'coal'].includes(ore)) p.f.oreType[c] = 0; }
  updateResources(x, st);
}

/** a warlike people */
function warlike(sim: Sim, st: Settlement): void {
  const A = ctx(sim).A;
  for (const m of membersOf(sim, st)) A.traits[m * NT + TRAIT.aggression] = Math.min(1, 0.6 + 0.35 * ((A.id[m] * 2654435761 >>> 0) / 4294967296));
}

function opinion(sim: Sim, of: Settlement, toward: Settlement): number {
  const r = sim.u.planets[0].people.relation(of.polity, toward.polity);
  return r ? r.op[r.a === of.polity ? 0 : 1] : 0;
}

test('an iron monopoly drives the have-nots toward war (a town that holds iron as well stays at peace)', () => {
  const run = (monopoly: boolean) => {
    const { sim, a, b } = twoTowns(7, 'iron');
    metals(sim, a, true);
    metals(sim, b, !monopoly);
    warlike(sim, b);
    let war = '';
    let low = 1;
    // b's opinion of a at the end of each day (compared day for day: the monopoly run stops when its war starts)
    const daily: number[] = [];
    for (let d = 0; d < 18 && !war; d++) {
      sim.step(1440);
      const r = sim.u.planets[0].people.relation(a.polity, b.polity);
      if (r && r.war >= 0 && r.aggressor === b.polity) war = r.cause;
      daily.push(opinion(sim, b, a));
      low = Math.min(low, daily[daily.length - 1]);
    }
    return { sim, war, low, daily };
  };
  const mono = run(true);
  assert.equal(mono.war, 'iron', `the have-nots went to war over iron (opinion fell to ${mono.low.toFixed(2)})`);
  assert.ok(mono.sim.u.chronicle.some((e) => e.kind === 'war' && /iron/.test(e.text)), 'the chronicle names the cause');
  const fair = run(false);
  assert.notEqual(fair.war, 'iron', 'no war over iron when both hold it');
  // on the day the have-nots went to war, the town that holds iron too thinks markedly better of its neighbour
  const day = mono.daily.length - 1;
  assert.ok(fair.daily[day] > mono.daily[day] + 0.15, `opinions stay warmer without the monopoly (day ${day + 1}: ${fair.daily[day].toFixed(2)} vs ${mono.daily[day].toFixed(2)})`);
});

test('complementary settlements trade: caravans carry the surplus of each to the other', () => {
  // two towns a walk apart (the world's water moves with its climate: a seed whose towns ended up across a lake trades
  // by boat, which is the next test's case, not this one)
  let towns: ReturnType<typeof twoTowns> | null = null;
  for (const seed of [11, 12, 14, 15, 16, 17]) {
    const t = twoTowns(seed, 'bronze');
    if (routeBetween(ctx(t.sim), t.a, t.b).land) { towns = t; break; }
  }
  assert.ok(towns, 'two towns with a road between them');
  const { sim, a, b } = towns!;
  const x = ctx(sim);
  const grain = x.c.items.idx('grain'), salt = x.c.items.idx('salt');
  // a granary town without salt, a salt town short of food
  a.store[grain] = 600;
  a.store[salt] = 0;
  b.store[salt] = 80;
  for (const i of x.info[b.species].foods) b.store[i] = Math.min(b.store[i], 20);
  const salt0 = a.store[salt], grainB0 = b.store[grain];
  let r = sim.u.planets[0].people.relation(a.polity, b.polity);
  let caravan = false;
  for (let d = 0; d < 14 && !(r && r.trade > 0); d++) {
    sim.step(1440);
    r = sim.u.planets[0].people.relation(a.polity, b.polity);
    caravan ||= sim.u.planets[0].people.missions.some((m) => m.kind === 'trade' && m.members.length > 0);
  }
  assert.ok(caravan, 'traders set out');
  assert.ok(r && r.trade > 0, 'goods changed hands');
  assert.ok(a.store[salt] > salt0 || b.store[grain] > grainB0 + 5, `salt reached the granary town (${a.store[salt]}) or grain the salt town (${b.store[grain].toFixed(0)} from ${grainB0.toFixed(0)})`);
  assert.ok(sim.u.chronicle.some((e) => e.kind === 'trade'), 'the first caravan is chronicled');
  const ev = (sim.query('relations') as { trade: number }[])[0];
  assert.ok(ev.trade > 0, 'the inspector sees the trade');
});

test('a treaty can end a war', () => {
  const { sim, a, b } = twoTowns(13, 'bronze');
  const res = sim.applyNow({ k: 'settlement.start-war', settlement: b.id, other: a.id });
  assert.ok(res.ok, res.msg);
  const ps = sim.u.planets[0].people;
  const r = ps.relation(a.polity, b.polity)!;
  assert.ok(r.war >= 0, 'at war');
  let days = 0;
  while (r.war >= 0 && days < 40) { sim.step(1440); days++; }
  assert.equal(r.war, -1, `peace within forty days (casualties ${r.casualties.join('/')})`);
  assert.ok(r.truce > sim.u.tick, 'a truce holds after the treaty');
  const lines = sim.u.chronicle.filter((e) => e.kind === 'treaty' || (e.kind === 'war' && /ended/.test(e.text)));
  assert.ok(lines.length > 0, 'the peace is chronicled');
  // and the god can make peace too
  const r2 = sim.applyNow({ k: 'settlement.start-war', settlement: a.id, other: b.id });
  if (r2.ok) {
    const peace = sim.applyNow({ k: 'settlement.make-peace', settlement: a.id, other: b.id });
    assert.ok(peace.ok, peace.msg);
    assert.equal(ps.relation(a.polity, b.polity)!.war, -1);
  }
});
