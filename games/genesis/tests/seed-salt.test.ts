// GENESIS — the seed reaches the peoples (CONTRACT.md §6.1, §8): ids are handed out alike in every world (the first
// band is settlement 1, its people agents 1..n, whatever the seed), so a roll keyed on ids and ticks alone repeats
// the same people in every world — the same ages, sexes, traits and skills, the same deaths of old age on the same
// days. Every such roll is salted with the planet seed: two seeds give two peoples, one seed gives the same one again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../src/sim/sim.ts';
import type { Command } from '../src/sim/types.ts';
import { AgentFlag } from '../src/sim/types.ts';
import * as settlement from '../src/sim/people/settlement.ts';
import { cellPos, distM } from '../src/sim/people/world.ts';
import { NS, NT } from '../src/sim/people/defs.ts';
import type { Settlement } from '../src/sim/people/state.ts';
import { world, people, ctx, membersOf, must } from './helpers/peoples.ts';

const SEED_A = 20261008, SEED_B = 31337;

/** each seed's bare world is built once; tests take fresh copies of it (a load is ~15x quicker than a build) */
const bare = new Map<number, Uint8Array>();
function fresh(seed: number): Sim {
  let b = bare.get(seed);
  if (!b) { b = world(24, seed).save(); bare.set(seed, b); }
  return Sim.load(b);
}

/** what a member is at birth, by id: age (years), sex, traits, skills, knowledge words */
interface Born { id: number; age: number; female: boolean; traits: number[]; skills: number[]; know: number[] }
function born(sim: Sim, st: Settlement): Born[] {
  const x = ctx(sim), A = x.A;
  return membersOf(sim, st).map((s) => ({
    id: A.id[s],
    age: Math.round(((x.tick - A.birth[s]) / x.year) * 1000) / 1000,
    female: !!(A.flags[s] & AgentFlag.female),
    traits: Array.from(A.traits.subarray(s * NT, s * NT + NT), (v) => Math.round(v * 1e4)),
    skills: Array.from(A.skills.subarray(s * NS, s * NS + NS), (v) => Math.round(v * 1e4)),
    know: Array.from(A.know.subarray(s * A.kw, s * A.kw + A.kw)),
  })).sort((a, b) => a.id - b.id);
}

/** how many of two seeds' same-id members differ in a field */
function differing(a: Born[], b: Born[], f: (m: Born) => unknown): number {
  let n = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (JSON.stringify(f(a[i])) !== JSON.stringify(f(b[i]))) n++;
  return n;
}

test('a founding band differs by seed: ages, sexes, traits, skills and where each stands; one seed repeats it', () => {
  const band = (sim: Sim) => {
    const st = people(sim, 'plains-folk', 24);
    const x = ctx(sim), A = x.A;
    const centre = cellPos(x.p, st.cell);
    const at = [0, 0, 0];
    // (each member stands 3-21 m from the band's cell centre, at an angle: the distance is the roll, whatever the cell)
    const off = membersOf(sim, st).sort((a, b) => A.id[a] - A.id[b]).map((s) => { A.posAt(s, x.tick, at); return Math.round(distM(x.p, at, centre) * 100) / 100; });
    return { st, members: born(sim, st), off, cohort: st.cohort.n.slice(), span: x.info[st.species].def.lifespan };
  };
  const a = band(fresh(SEED_A)), again = band(world(24, SEED_A)), b = band(fresh(SEED_B));
  // (ages stay those of a living band, whatever the seed: settlement.ts createBand draws up to 1.5 lifespans)
  for (const m of [...a.members, ...b.members]) assert.ok(m.age >= 0 && m.age < a.span * 1.5, `age ${m.age}`);
  // the same ids in both worlds: what differs is the people, not the numbering
  assert.equal(a.st.id, b.st.id);
  assert.deepEqual(a.members.map((m) => m.id), b.members.map((m) => m.id), 'ids are handed out alike in every world');
  // one seed, one people (a fresh build, not a copy)
  assert.deepEqual(again.members, a.members, 'the same seed gives the same people');
  assert.deepEqual(again.off, a.off, 'standing in the same places');
  // two seeds, two peoples
  const n = a.members.length;
  assert.ok(differing(a.members, b.members, (m) => m.age) >= n * 0.75, `ages: ${differing(a.members, b.members, (m) => m.age)} of ${n} differ between seeds`);
  assert.notDeepEqual(a.members.map((m) => m.age).sort((p, q) => p - q), b.members.map((m) => m.age).sort((p, q) => p - q), 'the age distributions differ, not only their order');
  assert.ok(differing(a.members, b.members, (m) => m.female) >= 3, `sexes: ${differing(a.members, b.members, (m) => m.female)} of ${n} differ`);
  assert.ok(differing(a.members, b.members, (m) => m.traits) >= n * 0.75, `traits: ${differing(a.members, b.members, (m) => m.traits)} of ${n} differ`);
  assert.ok(differing(a.members, b.members, (m) => m.skills) >= n * 0.5, `skills: ${differing(a.members, b.members, (m) => m.skills)} of ${n} differ`);
  let moved = 0;
  for (let i = 0; i < n; i++) if (a.off[i] !== b.off[i]) moved++;
  assert.ok(moved >= n * 0.75, `${moved} of ${n} stand at another distance from the centre`);
});

test('a band beyond the cap: its cohort\'s make-up differs by seed, and keeps a living band\'s shape', () => {
  const split = (seed: number) => {
    const sim = fresh(seed);
    sim.u.settings.maxAgents = 4;
    return people(sim, 'plains-folk', 200).cohort.n.slice();
  };
  const a = split(SEED_A), b = split(SEED_B);
  assert.deepEqual(split(SEED_A), a);
  assert.equal(a[0] + a[1] + a[2], b[0] + b[1] + b[2]);
  assert.notDeepEqual(a, b, `children / adults / elders ${a} vs ${b}`);
  // the salt changes the draw, not its law: ~22 % children, ~68 % adults, ~10 % elders (196 draws a seed; ±3.3 sd)
  for (const n of [a, b]) {
    const all = n[0] + n[1] + n[2];
    assert.ok(n[0] / all > 0.12 && n[0] / all < 0.32, `children ${n[0]} of ${all}`);
    assert.ok(n[2] / all > 0.03 && n[2] / all < 0.18, `elders ${n[2]} of ${all}`);
  }
});

test('old age: who dies of it and when differs by seed; one seed repeats it', () => {
  const run = (seed: number) => {
    const sim = fresh(seed);
    const st = people(sim, 'plains-folk', 24, { settled: true });
    const x = ctx(sim), A = x.A;
    // everyone three lifespans old: the yearly hazard of old age is at its cap (lifecycle.ts ageHazard)
    const span = x.info[st.species].def.lifespan;
    for (const s of membersOf(sim, st)) A.birth[s] = x.tick - Math.round(3 * span * x.year);
    const ids = membersOf(sim, st).map((s) => A.id[s]).sort((p, q) => p - q);
    sim.drainEvents();
    const deaths: string[] = [];
    for (let h = 0; h < 120; h++) {
      sim.step(60);
      for (const e of sim.drainEvents()) if (e.t === 'death' && e.data?.cause === 'old age') deaths.push(`${e.ref?.id}@${sim.tick}`);
    }
    return { ids, deaths };
  };
  const a = run(SEED_A), again = run(SEED_A), b = run(SEED_B);
  assert.deepEqual(a.ids, b.ids, 'the same ids in both worlds');
  assert.ok(a.deaths.length >= 3 && b.deaths.length >= 3, `deaths of old age: ${a.deaths.length} / ${b.deaths.length}`);
  assert.deepEqual(again.deaths, a.deaths, 'the same seed: the same deaths on the same ticks');
  assert.notDeepEqual(b.deaths, a.deaths, `seed ${SEED_A}: ${a.deaths.join(' ')}; seed ${SEED_B}: ${b.deaths.join(' ')}`);
  const whoA = new Set(a.deaths.map((d) => d.split('@')[0])), whoB = new Set(b.deaths.map((d) => d.split('@')[0]));
  assert.notDeepEqual([...whoB].sort(), [...whoA].sort(), 'not the same people die of old age');
  // independent draws: a death of the same agent on the same tick in both worlds is a rare coincidence (≈ 0.03 expected)
  const shared = b.deaths.filter((d) => a.deaths.includes(d)).length;
  assert.ok(shared <= 1, `${shared} identical (agent, tick) deaths of old age on both seeds`);
  // the salt changes who and when, not how many: 2 × 24 × (1 − (1 − 60 / year)^120) ≈ 16.4 expected
  const n = a.deaths.length + b.deaths.length;
  assert.ok(n >= 6 && n <= 30, `deaths of old age over two seeds: ${n}`);
});

test('ages and old-age rolls do not share a salt: dying of age says nothing of how old one came into the world', () => {
  // 24 bands of one: band k is settlement k and its member is agent k. Under one shared salt the old-age roll of agent
  // k at tick i WAS the age roll of member i of band k — at tick 0 each agent died of age exactly when it had come into
  // the world a child (both read the same roll below 0.22).
  const sim = fresh(SEED_A);
  const x = ctx(sim), A = x.A;
  const sts: Settlement[] = [];
  for (let k = 0; k < 24; k++) sts.push(people(sim, 'plains-folk', 1));
  const kids = new Set<number>();
  for (const st of sts) {
    const [s] = membersOf(sim, st);
    assert.equal(A.id[s], st.id, 'agent k leads band k');
    if (A.flags[s] & AgentFlag.child) kids.add(A.id[s]);
  }
  assert.ok(kids.size >= 1 && kids.size <= 23, `${kids.size} born children`);
  // all of them far past their span (hazard 1 a year) and a window of 0.22 of a year: each dies with chance 0.22
  assert.equal(x.tick, 0);
  const oldAge = settlement.oldAge;
  assert.equal(typeof oldAge, 'function', 'settlement.ts exports oldAge');
  const span = x.info[sts[0].species].def.lifespan;
  const dead = new Set<number>();
  for (const st of sts) {
    const [s] = membersOf(sim, st);
    const id = A.id[s];
    A.birth[s] = x.tick - Math.round(3 * span * x.year);
    oldAge(x, st, (0.22 * x.year) / 60);
    if (A.slotOf(id) < 0) dead.add(id);
  }
  assert.ok(dead.size >= 1, 'some die');
  assert.notDeepEqual([...dead].sort((p, q) => p - q), [...kids].sort((p, q) => p - q), 'the dead are not exactly those born young');
});

test('an established people: who knows which craft differs by seed; promoted cohort members differ by seed', () => {
  const run = (seed: number) => {
    const sim = fresh(seed);
    sim.u.settings.maxAgents = 40;
    const st = people(sim, 'plains-folk', 120, { era: 'clay', settled: true });
    const first = born(sim, st);
    // (promote takes the cohort's adults first: the first `adults` promoted, in id order, are adults)
    const adults = st.cohort.n[1];
    sim.u.settings.maxAgents = 100;
    must(sim, { k: 'focus', pos: st.pos } as unknown as Command);
    const ids = new Set(first.map((m) => m.id));
    const promoted = born(sim, st).filter((m) => !ids.has(m.id));
    const def = ctx(sim).info[st.species].def;
    return { first, promoted, adults, maturity: def.maturity, elder: def.elder };
  };
  const a = run(SEED_A), again = run(SEED_A), b = run(SEED_B);
  assert.deepEqual(again, a, 'the same seed: the same people, the same promotions');
  assert.deepEqual(a.first.map((m) => m.id), b.first.map((m) => m.id));
  assert.ok(a.promoted.length >= 10, `${a.promoted.length} promoted`);
  assert.deepEqual(a.promoted.map((m) => m.id), b.promoted.map((m) => m.id), 'the same ids promoted in both worlds');
  const n = a.first.length, m = a.promoted.length;
  assert.ok(differing(a.first, b.first, (q) => q.know) >= n * 0.5, `knowledge: ${differing(a.first, b.first, (q) => q.know)} of ${n} differ between seeds`);
  assert.ok(differing(a.promoted, b.promoted, (q) => q.age) >= m * 0.75, `promoted ages: ${differing(a.promoted, b.promoted, (q) => q.age)} of ${m} differ`);
  assert.ok(differing(a.promoted, b.promoted, (q) => q.know) >= m * 0.5, `promoted knowledge: ${differing(a.promoted, b.promoted, (q) => q.know)} of ${m} differ`);
  // other ages, the same law: the adults of the cohort come out adults (cohorts.ts promote) on every seed
  for (const r of [a, b]) {
    const grown = r.promoted.slice(0, Math.min(r.adults, r.promoted.length));
    assert.ok(grown.length >= 10, `${grown.length} adults promoted`);
    for (const q of grown) assert.ok(q.age >= r.maturity - 1e-3 && q.age <= r.elder + 1e-3, `promoted adult aged ${q.age}`);
  }
});
