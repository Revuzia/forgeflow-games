// fix-r3 (items 2 + 9): a fire does not make a people give up fire. The god's meteor (or lightning, a fireball) and an
// ordinary wildfire are fear and regard, never an oath; only a deadly fire of their own making (a hearth that got away:
// 3+ buildings, 2+ dead) makes one, and that oath is a rite — no new fire kindled for 5-20 years, fire-keeping (the
// hearth, cooking, every heat craft) never sworn off — after which they take up fire again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Sim } from '../src/sim/sim.ts';
import type { Settlement } from '../src/sim/people/state.ts';
import { makeCtx } from '../src/sim/people/ctx.ts';
import { cultureDaily } from '../src/sim/people/culture.ts';
import { NT, TRAIT } from '../src/sim/people/defs.ts';
import { BuildingFlag } from '../src/sim/types.ts';
import { world, must, people, membersOf } from './helpers/peoples.ts';

function stoneTown(seed: number): { sim: Sim; st: Settlement } {
  const sim = world(24, seed);
  must(sim, { k: 'set', path: 'disasters.natural', value: 0 });
  const st = people(sim, 'plains-folk', 40, { era: 'stone', settled: true });
  sim.step(60);
  return { sim, st };
}

const fireIds = (sim: Sim): number[] => {
  const x = makeCtx(sim.u, sim.u.planets[0]);
  return ['fire-making', 'fire-keeping'].map((id) => x.rt.byId.get(id)!);
};

test('fire oath: a default-wrath meteor on a stone town swears no one off fire (4 seeds)', () => {
  let burnedSomewhere = 0;
  for (const seed of [20261104, 1, 2, 3]) {
    const { sim, st } = stoneTown(seed);
    const n0 = sim.u.chronicle.length;
    must(sim, { k: 'disaster.spawn', kind: 'meteor', pos: st.pos });
    sim.step(2880);
    const lines = sim.u.chronicle.slice(n0).map((e) => e.text);
    if (lines.some((t) => /burned|Fire took/.test(t)) || sim.u.planets[0].people.of(st.id).some((b) => (b.flags & BuildingFlag.ruined) !== 0)) burnedSomewhere++;
    const [fm, fk] = fireIds(sim);
    assert.ok(!st.culture.taboos.includes(fm) && !st.culture.taboos.includes(fk), `seed ${seed}: no fire taboo after the god's meteor (${lines.filter((t) => /swore/.test(t)).join(' | ')})`);
    assert.ok(!lines.some((t) => /swore/.test(t) && /fire/.test(t)), `seed ${seed}: no fire oath told`);
  }
  assert.ok(burnedSomewhere > 0, 'the meteor did burn something somewhere (the test means something)');
});

test('fire oath: buildings burned by an act of god or a wildfire never raise one; a deadly fire of their own does — fire-making only, for 5-20 years', () => {
  const { sim, st } = stoneTown(20261104);
  const x = () => makeCtx(sim.u, sim.u.planets[0]);
  const [fm, fk] = fireIds(sim);
  const A = x().A;
  for (const s of membersOf(sim, st)) A.traits[s * NT + TRAIT.piety] = 1; // the most pious: an oath is certain when one is due
  // the god's fire: many burned, the god seen there
  st.recent.godSeen = x().tick;
  st.recent.burnedCount = 9;
  cultureDaily(x(), st);
  assert.ok(!st.culture.taboos.includes(fm) && !st.culture.taboos.includes(fk), 'the god\'s fire: no taboo');
  // a wildfire: burned, nobody's hearth
  delete st.recent.godSeen;
  st.recent.burnedCount = 9;
  cultureDaily(x(), st);
  assert.ok(!st.culture.taboos.includes(fm) && !st.culture.taboos.includes(fk), 'a wildfire: no taboo');
  // their own hearth fire that burned 4 buildings but killed no one: no oath either
  st.recent.ownBurned = 4;
  cultureDaily(x(), st);
  assert.ok(!st.culture.taboos.includes(fm), 'nobody died: no oath');
  // their own hearth fire that burned 4 buildings and killed 3: an oath on making new fire, never on keeping it
  const n0 = sim.u.chronicle.length;
  st.recent.ownBurned = 4;
  st.recent.ownFireDead = 3;
  cultureDaily(x(), st);
  assert.ok(st.culture.taboos.includes(fm), 'a deadly fire of their own: the oath');
  assert.ok(!st.culture.taboos.includes(fk), 'fire-keeping is never sworn off (cooking and every heat craft)');
  const until = st.culture.oathUntil?.[String(fm)];
  assert.ok(until !== undefined);
  const yrs = (until! - x().tick) / x().year;
  assert.ok(yrs >= 5 && yrs <= 20, `the oath runs 5-20 years, not 50 (${yrs.toFixed(1)})`);
  const told = sim.u.chronicle.slice(n0).map((e) => e.text).join(' | ');
  assert.ok(!/never to make fire again/.test(told) && !/as a gift/.test(told), `the line is a rite, not giving up fire: ${told}`);
  // the day it lapses: they take up fire again, and it is told
  sim.u.tick = until!;
  const n1 = sim.u.chronicle.length;
  cultureDaily(x(), st);
  assert.ok(!st.culture.taboos.includes(fm), 'the oath lapsed');
  assert.ok(sim.u.chronicle.slice(n1).some((e) => /took up fire again/.test(e.text)), 'told: they took up fire again');
});
