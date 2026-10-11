// GENESIS — the dice of age belong to the world. Ids count 1, 2, 3… per kind in every world, so dice keyed by ids
// alone gave the first band of every seed the same ages, and the same agents died of old age at the same ticks: the
// 12-seed fidelity runs of perf push 3 were a single draw for old age. A band's initial ages, the ages of cohort
// members promoted on focus and the hourly old-age roll are now salted with the planet's seed (itself drawn from the
// world seed), so two seeds are two independent draws — while one seed still replays exactly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Sim } from '../src/sim/sim.ts';
import type { Settlement } from '../src/sim/people/state.ts';
import { world, people, membersOf, ctx } from './helpers/peoples.ts';
import { promote } from '../src/sim/people/cohorts.ts';
import { AgentFlag } from '../src/sim/types.ts';

const N = 16;

/** ages in years of a settlement's members (ascending id) */
function ages(sim: Sim, st: Settlement, only?: Set<number>): number[] {
  const x = ctx(sim);
  return membersOf(sim, st).filter((s) => !only || only.has(x.A.id[s])).map((s) => (x.tick - x.A.birth[s]) / x.year);
}

/** how many positions of two equally long lists differ */
function differing(a: number[], b: number[]): number {
  assert.equal(a.length, b.length);
  return a.reduce((n, v, i) => n + (v !== b[i] ? 1 : 0), 0);
}

test('a band set down on two world seeds draws two sets of initial ages; one seed replays them', () => {
  const bands = new Map<number, { sim: Sim; st: Settlement }>();
  for (const seed of [1, 2, 3, 4]) {
    const sim = world(N, seed);
    bands.set(seed, { sim, st: people(sim, 'plains-folk', 24, { settled: true }) });
  }
  const twin = world(N, 1);
  const twinSt = people(twin, 'plains-folk', 24, { settled: true });
  const a1 = ages(bands.get(1)!.sim, bands.get(1)!.st);
  assert.equal(a1.length, 24);
  // every world's first band is settlement 1 with agents 1..24: only the seed can tell them apart
  for (const { st } of bands.values()) assert.equal(st.id, 1);
  assert.deepEqual(ages(twin, twinSt), a1, 'the same seed draws the same ages');
  for (const seed of [2, 3, 4]) {
    const d = differing(ages(bands.get(seed)!.sim, bands.get(seed)!.st), a1);
    assert.ok(d >= 20, `seed ${seed}: ${d} of 24 initial ages differ from seed 1's (the dice ignored the seed)`);
  }
  // the band keeps its shape over the seeds: ~22 % children, ~68 % adults, ~10 % elders (96 people)
  let kids = 0, elders = 0, all = 0;
  for (const { sim, st } of bands.values()) {
    const x = ctx(sim);
    const def = x.info[st.species].def;
    for (const s of membersOf(sim, st)) {
      const age = (x.tick - x.A.birth[s]) / x.year;
      assert.ok(age >= 0 && age < def.lifespan * 1.5, `age ${age}`);
      if (x.A.flags[s] & AgentFlag.child) kids++;
      if (x.A.flags[s] & AgentFlag.elder) elders++;
      all++;
    }
  }
  assert.ok(kids / all > 0.1 && kids / all < 0.34, `children ${kids}/${all}`);
  assert.ok(elders / all > 0.03 && elders / all < 0.19, `elders ${elders}/${all}`);
});

test('cohort members promoted to individuals take ages drawn per world seed', () => {
  const promoted = (seed: number): { ages: number[]; elder: number; maturity: number } => {
    const sim = world(N, seed);
    const st = people(sim, 'plains-folk', 12, { settled: true });
    const x = ctx(sim);
    const before = new Set(membersOf(sim, st).map((s) => x.A.id[s]));
    st.cohort.n[1] += 10;
    assert.equal(promote(x, st, 10), 10);
    const fresh = new Set(membersOf(sim, st).map((s) => x.A.id[s]).filter((id) => !before.has(id)));
    assert.equal(fresh.size, 10);
    const def = x.info[st.species].def;
    return { ages: ages(sim, st, fresh), elder: def.elder, maturity: def.maturity };
  };
  const p1 = promoted(1), p2 = promoted(2);
  // adults by their cohort band, but not the same adults on every seed
  for (const a of [...p1.ages, ...p2.ages]) assert.ok(a >= p1.maturity - 1e-3 && a <= p1.elder + 1e-3, `adult age ${a}`);
  const d = differing(p1.ages, p2.ages);
  assert.ok(d >= 8, `${d} of 10 promoted ages differ between seeds 1 and 2 (the dice ignored the seed)`);
});

test('old-age rolls are drawn per world seed: equally old people die at other ticks on another seed', () => {
  // 40 settled people all aged 1.3 lifespans (the hazard at its cap of one death per person-year) on each world, so
  // the hazard is the same everywhere and only the dice can differ; three game days of the hourly roll
  const run = (seed: number): string[] => {
    const sim = world(N, seed);
    const st = people(sim, 'plains-folk', 40, { settled: true });
    const x = ctx(sim);
    const span = x.info[st.species].def.lifespan;
    for (const s of membersOf(sim, st)) x.A.birth[s] = Math.round(x.tick - span * 1.3 * x.year);
    sim.drainEvents();
    const dead: string[] = [];
    for (let d = 0; d < 3; d++) {
      sim.step(x.day);
      for (const e of sim.drainEvents()) {
        if (e.t === 'death' && (e.data as { cause?: string } | undefined)?.cause === 'old age') dead.push(`${e.ref?.id}@${e.tick}`);
      }
    }
    return dead;
  };
  const d1 = run(1), twin = run(1), d2 = run(2);
  assert.deepEqual(twin, d1, 'the same seed rolls the same deaths');
  assert.notDeepEqual(d2, d1, `seeds 1 and 2 lost the same people at the same ticks: ${d1.join(' ')}`);
  const shared = d2.filter((k) => d1.includes(k)).length;
  assert.ok(shared <= 2, `${shared} identical (agent, tick) old-age deaths on seeds 1 and 2`);
  // the salt changes who and when, not how many: 2 × 40 × (1 − (1 − 60/year)^72) ≈ 17.7 expected
  const n = d1.length + d2.length;
  assert.ok(n >= 7 && n <= 30, `old-age deaths over two seeds: ${n}`);
});
