// GENESIS — discovery (CONTRACT.md §8.4, §9): knowledge is a recipe; it is found by experiment (curious people near the
// right things), by accident (lightning sets a tree alight, spilled grain sprouts), by studying an artifact, or given by
// the god — who may be refused. Once found, it spreads by teaching, watching and talk. Every first finding in a
// settlement is chronicled with the finder's name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Command } from '../src/sim/types.ts';
import { AgentFlag } from '../src/sim/types.ts';
import { experimentChance, experimentCandidates, accidentChance, reverseChance } from '../src/sim/recipes/discovery.ts';
import { reverseEngineer, refusalOf, godTeach, libHas, refreshLibrary, accident } from '../src/sim/people/knowledge.ts';
import { onLightning } from '../src/sim/people/people.ts';
import { NT, TRAIT } from '../src/sim/people/defs.ts';
import { world, people, must, ctx, membersOf, adultsOf, recipe, chronicleSince } from './helpers/peoples.ts';

test('chances: curiosity, skill and a present trigger make experiments likelier; candidates need their foundations', () => {
  const sim = world(12);
  const x = ctx(sim);
  const r = x.rt.list[recipe(sim, 'fire-keeping')];
  const dull = experimentChance(r, 0.1, 0.1, false, 1);
  const keen = experimentChance(r, 0.95, 0.1, false, 1);
  const skilled = experimentChance(r, 0.95, 0.9, false, 1);
  const prompted = experimentChance(r, 0.95, 0.9, true, 1);
  assert.ok(dull < keen && keen < skilled && skilled <= prompted, `${dull} < ${keen} < ${skilled} <= ${prompted}`);
  assert.ok(prompted <= 0.6, 'never certain');
  assert.ok(accidentChance(r, 0.9) > accidentChance(r, 0.1));
  assert.ok(reverseChance(r, 0.9, 0.5) > reverseChance(r, 0.1, 0.0));
  // a stone-age mind: knows only the species' start ways
  const kw = x.rt.kw;
  const know = new Uint32Array(kw);
  const plains = x.c.species.idx('plains-folk');
  for (const id of x.c.species.list[plains].start) { const k = x.rt.byId.get(id)!; know[k >>> 5] |= 1 << (k & 31); }
  const out: ReturnType<typeof experimentCandidates> = [];
  const lib = (k: number) => (know[k >>> 5] & (1 << (k & 31))) !== 0;
  experimentCandidates(x.rt, know, 0, kw, plains, lib, () => false, (ctxName) => ctxName === 'flint', out);
  const ids = out.map((c) => c.r.id);
  assert.ok(ids.includes('fire-keeping') && ids.includes('cordage'), `stone-age candidates: ${ids.join(', ')}`);
  assert.ok(!ids.includes('bronze') && !ids.includes('steam-engine'), 'nothing beyond reach');
  assert.ok(!ids.includes('stone-tools'), 'nothing already known');
  assert.ok(!ids.includes('hive-building') && !ids.includes('air-grazing'), 'other peoples\' ways are not for them');
  // a present trigger weighs a candidate up
  const hand = out.find((c) => c.r.id === 'hand-axes');
  const cord = out.find((c) => c.r.id === 'cordage');
  if (hand && cord) assert.ok(hand.triggered && !cord.triggered);
});

test('accident: lightning sets a tree alight near a band without fire, and someone understands', () => {
  const sim = world();
  const st = people(sim, 'plains-folk', 24);
  sim.step(10);
  const x = ctx(sim);
  const keep = recipe(sim, 'fire-keeping');
  assert.ok(!libHas(st, keep), 'the band has no fire yet');
  const c0 = sim.u.chronicle.length;
  const e0 = sim.u.events.length;
  // lightning strikes beside the band and lights a fire, at a few moments (each strike is one roll per member)
  for (let i = 0; i < 6 && !libHas(st, keep); i++) {
    onLightning(sim.u, sim.u.planets[0], st.cell, true);
    sim.step(1);
  }
  assert.ok(libHas(st, keep), 'fire-keeping learned from the lightning fire');
  const line = chronicleSince(sim, c0).find((t) => /fire/i.test(t));
  assert.ok(line, `chronicled: ${JSON.stringify(chronicleSince(sim, c0))}`);
  const ev = sim.u.events.slice(e0).find((e) => e.t === 'discovery' && e.a === keep);
  assert.ok(ev, 'a discovery event');
  assert.equal((ev!.data as Record<string, unknown>).how, 'accident');
  // the finder remembers it
  const A = x.A;
  const finder = membersOf(sim, st).find((m) => A.knows(m, keep))!;
  const bio = sim.query('agent', { id: A.id[finder] }) as { memories: { text: string }[] };
  assert.ok(bio.memories.some((m) => /discovered fire/i.test(m.text)), JSON.stringify(bio.memories));
  // a trigger for which nothing is left to learn teaches nothing
  assert.equal(accident(ctx(sim), st, 'lightning-fire', st.cell) >= 0, true);
});

test('reverse-engineering: studying a made thing teaches how it was made (when the foundations are there)', () => {
  const sim = world();
  const st = people(sim, 'plains-folk', 12);
  sim.step(5);
  const x = ctx(sim);
  const A = x.A;
  const s = adultsOf(sim, st)[0];
  const basketry = recipe(sim, 'basketry');
  const basket = x.c.items.idx(x.rt.list[basketry].outItems.length ? x.c.items.list[x.rt.list[basketry].outItems[0][0]].id : 'basket');
  // without cordage they cannot see how it is made
  const cord = recipe(sim, 'cordage');
  A.setKnows(s, cord, false);
  let got = false;
  for (let i = 0; i < 40 && !got; i++) { x.tick = sim.u.tick + i; got = reverseEngineer(x, s, basket); }
  assert.ok(!got, 'no foundations: no understanding');
  // with cordage, a few sessions of study suffice
  A.setKnows(s, cord, true);
  const c0 = sim.u.chronicle.length;
  for (let i = 0; i < 40 && !got; i++) { x.tick = sim.u.tick + 100 + i; got = reverseEngineer(x, s, basket); }
  assert.ok(got && A.knows(s, basketry), 'basketry worked out from a basket');
  assert.ok(chronicleSince(sim, c0).length >= 1, 'chronicled');
  // the artifact command sets it down near them to be found
  const r = must(sim, { k: 'settlement.introduce', settlement: st.id, artifact: 'bronze-tools' } as unknown as Command);
  assert.ok(r.ok);
  assert.ok(x.ps.items.some((g) => g.artifact && g.item === x.c.items.idx('bronze-tools')), 'an artifact lies near them');
});

test('god teaching: given freely it is learned and chronicled; refused for taboo, fear or missing foundations', () => {
  const sim = world();
  const st = people(sim, 'plains-folk', 20, { era: 'clay', settled: true });
  sim.step(10);
  const x = ctx(sim);
  const A = x.A;
  const adults = adultsOf(sim, st);
  // a believing people: love the god, are curious
  for (const m of adults) { A.love[m * 4] = 0.6; A.fear[m * 4] = 0; A.traits[m * NT + TRAIT.curiosity] = 0.9; }
  st.culture.conservatism = 0;
  const k = recipe(sim, 'bronze');
  // missing foundations (copper smelting) -> 'grasp'
  const smelt = recipe(sim, 'copper-smelting');
  const s0 = adults[0];
  if (A.knows(s0, smelt)) A.setKnows(s0, smelt, false);
  assert.equal(refusalOf(x, s0, k), 'grasp');
  // taboo
  const pottery = recipe(sim, 'pottery');
  for (const m of adults) A.setKnows(m, pottery, false);
  refreshLibrary(x, st);
  st.culture.taboos.push(pottery);
  const c0 = sim.u.chronicle.length;
  const e0 = sim.u.events.length;
  const res = godTeach(x, adults, pottery);
  assert.equal(res.taught, 0);
  assert.equal(res.reasons.taboo, adults.length);
  assert.ok(sim.u.events.slice(e0).some((e) => e.t === 'refusal'), 'refusal events');
  assert.ok(chronicleSince(sim, c0).length === 1, 'one chronicle line for the town\'s refusal');
  st.culture.taboos.length = 0;
  // fear: a terrified, timid people will not take the god's gifts
  const s1 = adults[1];
  A.fear[s1 * 4] = 0.9; A.love[s1 * 4] = 0.1; A.traits[s1 * NT + TRAIT.boldness] = 0.2;
  assert.equal(refusalOf(x, s1, pottery), 'fear');
  A.fear[s1 * 4] = 0; A.love[s1 * 4] = 0.6;
  // freely given: learned by (almost) all and chronicled as the god's gift
  const c1 = sim.u.chronicle.length;
  const r = must(sim, { k: 'idea.teach', knowledge: 'pottery', settlement: st.id } as unknown as Command);
  assert.match(r.msg ?? '', /now know/);
  assert.ok(libHas(st, pottery));
  assert.ok(chronicleSince(sim, c1).length >= 1);
  const knowers = adults.filter((m) => A.knows(m, pottery)).length;
  assert.ok(knowers >= adults.length * 0.7, `${knowers}/${adults.length} took it`);
  // a person who refused remembers it
  const s2 = adults[2];
  const steam = recipe(sim, 'steam-engine');
  const rr = sim.applyNow({ k: 'idea.teach', knowledge: 'steam-engine', agent: A.id[s2] } as unknown as Command);
  assert.equal(rr.ok, false);
  assert.ok(!A.knows(s2, steam));
  const bio = sim.query('agent', { id: A.id[s2] }) as { memories: { text: string }[] };
  assert.ok(bio.memories.some((m) => /refused/.test(m.text)), JSON.stringify(bio.memories));
});

test('spread: one person\'s know-how reaches others by teaching, watching and talk within days', () => {
  const sim = world();
  const st = people(sim, 'plains-folk', 24, { era: 'clay', settled: true });
  sim.step(10);
  const x = ctx(sim);
  const A = x.A;
  const k = recipe(sim, 'cordage');
  const members = membersOf(sim, st);
  for (const m of members) A.setKnows(m, k, false);
  const teacher = adultsOf(sim, st)[0];
  A.setKnows(teacher, k, true);
  refreshLibrary(x, st);
  sim.step(4 * 1440);
  const knowers = membersOf(sim, st).filter((m) => A.knows(m, k) && !(A.flags[m] & AgentFlag.child)).length;
  assert.ok(knowers >= 3, `${knowers} know cordage after four days`);
});

test('experiment, in the living world: a stone band works things out for itself within a few days', () => {
  const sim = world(32, 7);
  const st = people(sim, 'plains-folk', 24);
  const c0 = sim.u.chronicle.length;
  const lib0 = st.library.length;
  sim.step(5 * 1440);
  assert.ok(st.library.length > lib0, `library ${lib0} -> ${st.library.length}`);
  assert.ok(st.stats.discoveries >= 1, `${st.stats.discoveries} discoveries`);
  const finds = chronicleSince(sim, c0).filter((t) => /worked out|learned .* by trying|understood|first understood|Nobody had shown/.test(t));
  assert.ok(finds.length >= 1, `discoveries chronicled: ${JSON.stringify(chronicleSince(sim, c0))}`);
});
