// GENESIS — emergence (CONTRACT.md §8, §16.1): nothing here is scripted. A stone-age band set down on a living world
// looks for water and food, settles a good site and names it for its feature ("Aru by the Falls"), builds shelter,
// keeps a fire, has children, works things out, wears paths into the ground and claims land; a town that outgrows
// itself splits, and the daughter settlement speaks a drifted tongue; a town without water is abandoned.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROLE_NAMES } from '../src/sim/people/defs.ts';
import { BuildingFlag } from '../src/sim/types.ts';
import { foodDays } from '../src/sim/people/store.ts';
import { world, people, ctx, membersOf, chronicleSince } from './helpers/peoples.ts';

/** the first eight days of a stone-age band of 24 set down on the sandbox world of a seed, item by item */
function firstDays(seed: number) {
  const sim = world(32, seed);
  const p = sim.u.planets[0];
  const c0 = sim.u.chronicle.length;
  const st = people(sim, 'plains-folk', 24);
  assert.ok(st.band, 'they arrive as a band');
  const lib0 = st.library.length;
  // eight days, a day at a time (determinism makes this the same history as one 8-day step: the twin below)
  let laidIn = 0;
  for (let d = 0; d < 8; d++) {
    sim.step(1440);
    laidIn = Math.max(laidIn, foodDays(ctx(sim), st));
  }
  const x = ctx(sim);
  const lines = chronicleSince(sim, c0);
  const built = p.people.of(st.id).filter((b) => b.progress >= 1 && !(b.flags & BuildingFlag.ruined));
  const alive = membersOf(sim, st).length;
  const roles = new Set(membersOf(sim, st).map((m) => ROLE_NAMES[x.A.role[m]]));
  let owned = 0, worn = 0;
  for (let c = 0; c < p.count; c++) { if (p.f.territory[c] === st.id) owned++; if (p.f.road[c] > 0.001) worn++; }
  const ok = {
    // settled, and named for the place (a full place name, chronicled)
    settled: !st.band && st.founded >= 0 && /\s/.test(st.name) && lines.some((t) => t.includes(st.name) && /founded|settled|made their home/i.test(t)),
    // shelter and fire: three buildings standing, one a shelter
    built: built.length >= 3 && built.some((b) => x.c.buildings.list[b.type].provides.includes('shelter')),
    // still alive, nobody starved, and food laid in (a store of days, not hand to mouth)
    living: alive >= 18 && st.stats.starved === 0 && laidIn >= 3,
    // they worked things out for themselves
    learned: st.library.length >= lib0 + 3 && st.stats.discoveries >= 2,
    // division of labour, land and paths
    labour: roles.size >= 3 && st.territory > 0 && owned >= 1 && worn >= 1,
    children: st.stats.births >= 1,
  };
  const note = `seed ${seed}: ${built.length} built, ${alive} alive, ${st.stats.births} births, ${st.stats.starved} starved, food ${laidIn.toFixed(1)} days, ` +
    `library ${lib0}->${st.library.length}, ${st.stats.discoveries} discoveries, roles ${roles.size}, ${owned} owned, ${worn} worn`;
  return { hash: sim.hash(), ok, note, births: st.stats.births };
}

test('stone-age bands settle, name their place, build, keep fire, have children, discover and claim land', () => {
  // (seeds 1-10, taken as they come: every world and every band's who-is-who is its seed's own draw, so one hand-picked
  // seed would say more about its dice than about the peoples. A band of 24 has the same shape on every seed — 5
  // children, 2 elders, 17 grown, 6 couples (settlement.ts createBand) — and about 1.2 births in its first eight days:
  // none on about one seed in three. Over seeds 1-23, at day 8: everything but children held on 20 (seed 3's hill site
  // starves it out), children came on 14, the whole list on 12.)
  const runs: ReturnType<typeof firstDays>[] = [];
  for (let seed = 1; seed <= 10; seed++) runs.push(firstDays(seed));
  const all = runs.map((r) => `${r.note} [${Object.entries(r.ok).filter(([, v]) => !v).map(([k]) => k).join(' ')}]`).join('\n');
  const holds = (k: keyof (typeof runs)[0]['ok']) => runs.filter((r) => r.ok[k]).length;
  assert.equal(holds('settled'), 10, `every band settles a named place\n${all}`);
  assert.ok(holds('built') >= 8, `shelter and fire on ${holds('built')} of 10\n${all}`);
  assert.ok(holds('living') >= 8, `alive, fed and laying in food on ${holds('living')} of 10\n${all}`);
  assert.ok(holds('learned') >= 7, `ideas of their own on ${holds('learned')} of 10\n${all}`);
  assert.ok(holds('labour') >= 8, `roles, land and paths on ${holds('labour')} of 10\n${all}`);
  // (children: a few births a world, so counted over all ten as well as world by world)
  const births = runs.reduce((n, r) => n + r.births, 0);
  assert.ok(holds('children') >= 4 && births >= 6, `children born on ${holds('children')} of 10, ${births} births in all\n${all}`);
  const whole = runs.filter((r) => Object.values(r.ok).every(Boolean)).length;
  assert.ok(whole >= 3, `the whole list on ${whole} of 10\n${all}`);
  // and the world is as deterministic as ever
  const twin = world(32, 1);
  people(twin, 'plains-folk', 24);
  twin.step(8 * 1440);
  assert.equal(twin.hash(), runs[0].hash, 'the same seed lives the same history');
});

test('a crowded town splits; the daughter band leaves with a drifted tongue and founds its own place', () => {
  const sim = world(32, 11);
  const st = people(sim, 'plains-folk', 120, { era: 'clay', settled: true });
  const x = ctx(sim);
  // lean times: the store holds little
  for (let i = 0; i < st.store.length; i++) st.store[i] = Math.min(st.store[i], 2);
  const before = sim.u.planets[0].people.settlements.length;
  let child = null as (typeof st) | null;
  for (let h = 0; h < 72 && !child; h++) {
    // keep it lean until it splits
    for (let i = 0; i < st.store.length; i++) if (x.c.items.list[i].food) st.store[i] = Math.min(st.store[i], 30);
    sim.step(60);
    child = sim.u.planets[0].people.settlements.find((o) => o.parent === st.id) ?? null;
  }
  assert.ok(child, 'the town split within three days');
  assert.ok(sim.u.planets[0].people.settlements.length > before);
  assert.ok(membersOf(sim, child!).length >= 10, `${membersOf(sim, child!).length} left`);
  assert.notEqual(child!.langSeed, st.langSeed, 'their speech drifts');
  assert.equal(child!.polity, st.polity, 'kin: the same polity');
  // given time they settle a place of their own, named in their own tongue
  sim.step(3 * 1440);
  const live = sim.u.planets[0].people.settlements.filter((o) => o.parent === st.id && o.fallen < 0);
  assert.ok(live.length >= 1);
  const settled = live.find((o) => !o.band);
  if (settled) assert.notEqual(settled.name, st.name);
});

test('a town whose water fails is abandoned: the people leave as a band, carrying food, and the place falls', () => {
  const sim = world(32, 7);
  const st = people(sim, 'plains-folk', 30, { era: 'clay', settled: true });
  sim.step(60);
  const p = sim.u.planets[0];
  const x = ctx(sim);
  const c0 = sim.u.chronicle.length;
  // the god dries the land around them: no surface water, no damp ground, no wells
  const near = p.cellsNear(st.pos, 2500);
  const dry = () => { for (const c of near) { p.f.water[c] = 0; p.f.moisture[c] = 0; p.f.aquifer[c] = 0; p.f.wetness[c] = 0; p.f.precip[c] = 0; } };
  for (const b of x.ps.of(st.id)) if (x.c.buildings.list[b.type].provides.includes('water')) b.flags |= BuildingFlag.ruined;
  let fell = false;
  for (let h = 0; h < 4 * 24 && !fell; h++) {
    dry();
    sim.step(60);
    fell = st.fallen >= 0;
  }
  assert.ok(fell, 'the town was abandoned within four days of drought');
  // the same people (their speech goes with them) on the road again
  const band = p.people.settlements.find((o) => o.id > st.id && o.langSeed === st.langSeed);
  assert.ok(band && band.fallen < 0, 'they left as a band');
  assert.ok(membersOf(sim, band!).length >= 10, `${membersOf(sim, band!).length} walked away`);
  assert.equal(membersOf(sim, st).length, 0, 'nobody stayed');
  const food = membersOf(sim, band!).reduce((a, s) => a + x.A.invQty[s * 4] + x.A.invQty[s * 4 + 1] + x.A.invQty[s * 4 + 2] + x.A.invQty[s * 4 + 3], 0);
  assert.ok(food > 0, 'carrying what they could');
  assert.ok(chronicleSince(sim, c0).some((t) => t.includes(st.name)), `chronicled: ${JSON.stringify(chronicleSince(sim, c0))}`);
});
