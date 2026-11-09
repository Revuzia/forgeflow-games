// GENESIS — ARC §5.1-§5.4 (stage C2): the spine (annals, godActs), ages opened from defining events (precedence, the
// same kind extending within 3 years, numbering), the first wrong closing `plenty`, the debug `arc.age`, the story's
// shape (title, opening, characters, epithet, <= 8 sentences an age, generations <= 12, closing never "The End") and
// its voice, the views, and an old world's migration (one `making` age, an open age from the load tick, the note).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../src/sim/sim.ts';
import { town, must } from './helpers/god.ts';
import { pushArc } from '../src/sim/god/tower.ts';
import { openAge, epithetOf, story } from '../src/sim/god/story.ts';
import { lintLine } from './scripture_lint.test.ts';

const P = (sim: Sim) => sim.u.planets[0];
const dayOf = (sim: Sim) => Math.max(60, Math.round(P(sim).st.dayHours * 60));
const yearOf = (sim: Sim) => Math.max(dayOf(sim), Math.round(P(sim).st.orbit.period));
const ages = (sim: Sim) => (sim.query('ages', { planet: 0 }) as { kind: string; name: string; begun: number; ended: number; closing?: string }[]);

test('a fresh world: making, then plenty at the first town; the first wrong closes plenty with its line', () => {
  const { sim, st } = town();
  sim.step(dayOf(sim) * 2);
  const k0 = ages(sim).map((a) => a.kind);
  assert.deepEqual(k0, ['making', 'plenty'], k0.join(','));
  assert.equal(sim.snapshot().planets[0].age?.kind, 'plenty');
  must(sim, { k: 'miracle.lightning', pos: [st.pos[0], st.pos[1], st.pos[2]], wrath: 0.3 } as never);
  sim.step(dayOf(sim) * 2);
  const plenty = ages(sim).find((a) => a.kind === 'plenty')!;
  assert.ok(plenty.ended >= 0, 'plenty closed');
  assert.match(plenty.closing ?? '', /^And the years of plenty ended, when the god first struck Aru\.$/);
  assert.ok((sim.u.god.rel?.arcEvents ?? []).some((e) => e.kind === 'firstwrong'));
  assert.ok((sim.u.god.rel?.godActs?.['0']?.harm ?? 0) >= 1, 'godActs.harm counted');
});

test('event ages open at once by precedence; the same kind within 3 years extends; repeats are numbered', () => {
  const { sim, st } = town();
  sim.step(dayOf(sim) * 2);
  sim.drainEvents();
  // one day: a tower begun and a great flood: the flood (precedence) opens
  pushArc(sim.u, { planet: 0, tick: sim.u.tick, kind: 'tower', name: 'the tower of Aru', towns: [st.id], god: 'none', dead: 0 });
  pushArc(sim.u, { planet: 0, tick: sim.u.tick, kind: 'great', name: 'The Flood of Aru', towns: [st.id], god: 'wrath', dead: 30, ref: st.id });
  sim.step(dayOf(sim));
  const a1 = ages(sim);
  assert.equal(a1[a1.length - 1].kind, 'flood');
  assert.match(a1[a1.length - 1].name, /Flood|Waters/);
  const ev = (sim.drainEvents() as { t: string; data?: Record<string, unknown> }[]).find((e) => e.t === 'chronicle.age');
  assert.equal(ev?.data?.kind, 'flood');
  assert.ok(sim.u.chronicle.some((e) => e.kind === 'age' && /So began /.test(e.text)));
  // another flood within 3 years: extends
  pushArc(sim.u, { planet: 0, tick: sim.u.tick, kind: 'great', name: 'The Flood of Aru', towns: [st.id], god: 'wrath', dead: 30, ref: st.id });
  sim.step(dayOf(sim));
  assert.equal(ages(sim).filter((a) => a.kind === 'flood').length, 1, 'extended');
  // forced repeats are numbered
  const second = openAge(sim.u, P(sim), 'flood', { place: st, force: true })!;
  assert.match(second.name, /^(The Second |When the Waters Took Aru, a Second Time)/);
  assert.ok(must(sim, { k: 'arc.age', kind: 'covenant' } as never).ok);
  assert.equal(sim.snapshot().planets[0].age?.kind, 'covenant');
  assert.equal(sim.snapshot().planets[0].age?.since, sim.u.tick, 'since is the begun tick');
  assert.equal(sim.applyNow({ k: 'arc.age', kind: 'nonsense' } as never).ok, false);
});

test('the story: shape, voice, cost; the epithet; a town book', () => {
  const { sim, st } = town();
  sim.step(dayOf(sim) * 2);
  pushArc(sim.u, { planet: 0, tick: sim.u.tick, kind: 'great', name: 'The Flood of Aru', towns: [st.id], god: 'wrath', dead: 30, ref: st.id });
  sim.step(dayOf(sim));
  assert.equal(epithetOf(sim.u, 0), 'the One Who Drowned the World');
  const t0 = performance.now();
  const s = sim.query('story', {}) as ReturnType<typeof story>;
  assert.ok(performance.now() - t0 < 20, 'under 20 ms');
  assert.match(s.title, /^The Book of the .+ of .+$/);
  assert.ok(s.opening.length > 0 && s.people.line && s.god.line && s.god.epithet);
  assert.ok(s.ages.length >= 3);
  for (const a of s.ages) assert.ok(a.paragraphs.length <= 8, `${a.name}: ${a.paragraphs.length}`);
  assert.ok(s.generations.length <= 12);
  assert.ok(!/the end/i.test(s.closing));
  assert.equal(s.ages[s.ages.length - 1].paragraphs.slice(-1)[0], 'And so it is now.');
  const lines = [s.title, s.opening, s.people.line, s.god.line, s.closing, ...s.generations, ...s.promises, ...s.ages.flatMap((a) => a.paragraphs)];
  // age names are titles ("When the God Walked Near"): their title-case words are not names in a sentence
  const names = s.ages.map((a) => a.name);
  const bad = lines.map((l) => names.reduce((t, n) => t.split(n).join('The Age'), l)).flatMap((l) => lintLine(l).filter((e) => !/over 140/.test(e)).map((e) => `${l}: ${e}`));
  assert.deepEqual(bad, []);
  const t = sim.query('story', { settlement: st.id }) as ReturnType<typeof story>;
  assert.equal(t.title, 'The Book of Aru');
  assert.ok(Array.isArray(t.remember));
  assert.match(sim.parse('what kind of god am I').msg ?? '', /Their god|They were/);
});

test('an old world: one making age, an open age from the load tick, the note; save/load keeps the ages', () => {
  const { sim } = town();
  sim.step(dayOf(sim) * 32);
  const R = sim.u.god.rel!;
  // as a save from before stage C: no arc state at all
  delete R.arcSince; R.ages = []; R.annals = {}; R.godActs = {};
  const old = Sim.load(sim.save());
  old.step(dayOf(old) * 2);
  const a = ages(old);
  assert.equal(a[0].kind, 'making');
  const open = a.find((q) => q.ended < 0);
  assert.ok(open && open.kind !== 'making', a.map((q) => q.kind).join(','));
  assert.ok(open!.begun >= old.u.tick - dayOf(old) * 3, 'begun at the load');
  const s = old.query('story', {}) as ReturnType<typeof story>;
  assert.equal(s.note, 'What came before is remembered only in the chronicle.');
  const back = Sim.load(old.save());
  assert.deepEqual(back.u.god.rel!.ages, old.u.god.rel!.ages);
  assert.equal(back.hash(), old.hash());
  back.step(dayOf(back) * 2); old.step(dayOf(old) * 2);
  assert.equal(back.hash(), old.hash(), 'the same after loading');
  void yearOf;
});
