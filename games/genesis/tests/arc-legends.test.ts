// GENESIS — ARC §5.6 (stage C3): wordFor is a pure hash of a town's tongue; a town retells its heaviest remembered arc
// event 12 years on, then once a generation; the gen-2 telling differs from gen-1; every legend fits 140 characters;
// the first retelling restores the event's memory tally to 0.6 of its peak, once per event per town; the Book's
// "As it is told now" line; the tower.apart line in each town's own word.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../src/sim/sim.ts';
import { town } from './helpers/god.ts';
import { pushArc } from '../src/sim/god/tower.ts';
import { srel } from '../src/sim/god/regard.ts';
import { emptyMemory } from '../src/sim/god/arc.ts';
import { wordFor, compose } from '../src/sim/god/legends.ts';
import { lintLine } from './scripture_lint.test.ts';

const P = (sim: Sim) => sim.u.planets[0];
const dayOf = (sim: Sim) => Math.max(60, Math.round(P(sim).st.dayHours * 60));
const yearOf = (sim: Sim) => Math.max(dayOf(sim), Math.round(P(sim).st.orbit.period));

test('wordFor: a pure hash of the tongue; a new tongue, a new word', () => {
  const { sim, st } = town();
  const c = sim.u.content;
  const w = wordFor(c, st, 'god');
  assert.ok(/^[A-Za-z' -]{2,}$/.test(w), w);
  assert.equal(wordFor(c, st, 'god'), w);
  assert.notEqual(wordFor(c, st, 'tower'), w);
  const lang = st.language;
  st.language = lang + 7919;
  assert.notEqual(wordFor(c, st, 'god'), w);
  st.language = lang;
  sim.step(dayOf(sim) * 3);
  const v = sim.snapshot().planets[0].settlements?.find((q) => q.id === st.id);
  assert.equal(v?.heart?.theyCall, w);
});

test('legends: retold 12 years on, then a generation later and changed; <= 140; the memory refresh once', () => {
  const { sim, st } = town();
  const yr = yearOf(sim);
  const r = srel(sim.u, 0, st.id);
  r.memory ??= emptyMemory();
  r.memory.wrath = 1;
  const e = pushArc(sim.u, { planet: 0, tick: sim.u.tick - 13 * yr, kind: 'great', name: 'The Flood of Aru', towns: [st.id], god: 'wrath', dead: 23, ref: st.id });
  sim.step(dayOf(sim)); // the peak is noted while the tally stands at 1
  r.memory.wrath = 0.2; // a generation of fading
  sim.step(yr + dayOf(sim));
  const l1 = (r.legends ?? []).filter((l) => l.event === e.id);
  assert.equal(l1.length, 1, 'retold once in the year');
  assert.equal(l1[0].gen, 1);
  assert.ok(l1[0].text.length <= 140);
  assert.deepEqual(lintLine(l1[0].text), []);
  assert.ok(Math.abs(r.memory.wrath - 0.6) < 0.05, `refreshed to 0.6 x peak: ${r.memory.wrath}`);
  assert.deepEqual(r.memory.refreshed, [e.id]);
  assert.ok(sim.u.chronicle.some((q) => q.text.includes(`In Aru they tell it now: ${l1[0].text}`)));
  // a generation on: gen 2, a different telling, and no second refresh
  l1[0].told -= 25 * yr;
  r.memory.wrath = 0.1;
  sim.step(yr + dayOf(sim));
  const l2 = (r.legends ?? []).filter((l) => l.event === e.id);
  assert.equal(l2.length, 2);
  assert.equal(l2[1].gen, 2);
  assert.notEqual(l2[1].text, l2[0].text);
  assert.ok(l2[1].text.length <= 140);
  assert.ok(r.memory.wrath < 0.2, 'no second refresh');
  // gen 4 with every clause still fits
  for (let g = 1; g <= 6; g++) assert.ok(compose(sim.u, sim.u.content, P(sim), st, r, e, g).length <= 140);
  // the Book's told line on the age opened by the event
  const R = sim.u.god.rel!;
  R.ages!.push({ id: R.next++, planet: 0, kind: 'flood', name: 'The Flood of Aru', begun: e.tick, ended: -1, event: e.id, n: 1 });
  const s = sim.query('story', {}) as { ages: { name: string; told?: string }[] };
  assert.match(s.ages.find((a) => a.name === 'The Flood of Aru')?.told ?? '', /^As it is told now in Aru: /);
  const back = Sim.load(sim.save());
  assert.deepEqual(srel(back.u, 0, st.id).legends, r.legends);
});
