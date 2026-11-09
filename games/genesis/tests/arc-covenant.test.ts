// GENESIS — ARC §4 the covenant (stage C1, §8.4 C1-C4): the great-destruction thresholds and `ruined`, the offer shown
// 1-3 days later, the vow's gains, the scheduled bow at a low sun and the line told at it, the pre-check refusal and
// the cast that breaks, the break's cost and the trust ceiling, spare-the-many broken after the fact, the natural doubt,
// the halved second covenant, and save/load.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../src/sim/sim.ts';
import { town, must } from './helpers/god.ts';
import { GODS } from '../src/sim/people/defs.ts';
import { beginAct, endAct, srel } from '../src/sim/god/regard.ts';
import { wreckBuildings } from '../src/sim/god/harm.ts';
import { sunElevation } from '../src/sim/people/world.ts';
import { COVENANT } from '../src/sim/god/covenant.ts';
import type { Settlement } from '../src/sim/people/state.ts';

const P = (sim: Sim) => sim.u.planets[0];
const dayOf = (sim: Sim) => Math.max(60, Math.round(P(sim).st.dayHours * 60));
type Ev = { t: string; tick?: number; data?: Record<string, unknown> };

function mean(sim: Sim, st: Settlement, col: 'love' | 'fear' | 'faith'): number {
  const ps = P(sim).people;
  const m = ps.members.get(st.id) ?? [];
  let t = 0;
  for (const s of m) t += ps.agents[col][s * GODS];
  return t / Math.max(1, m.length);
}
/** an act that killed `dead` of the town (and ruined `ruined` of its buildings), closed as regard closes acts */
function fakeAct(sim: Sim, st: Settlement, dead: number, what = 'disaster:flood', o: { natural?: boolean; ruined?: number } = {}): void {
  const ctx = beginAct(sim.u, { key: `ctest${sim.u.tick}`, god: 0, natural: o.natural, what });
  ctx.dead[`0:${st.id}`] = dead;
  if (dead) ctx.killed = true;
  if (o.ruined) ctx.ruined[`0:${st.id}`] = o.ruined;
  endAct(sim.u, ctx);
}
function offerOn(sim: Sim, st: Settlement): void {
  must(sim, { k: 'covenant.offer', settlement: st.id } as never);
}

test('C1: a great destruction opens one offer, shown 1-3 days later; a small one opens none; ruined is recorded', () => {
  const { sim, st } = town();
  fakeAct(sim, st, 3);
  assert.equal(sim.u.god.rel?.offers?.length ?? 0, 0, '3 dead in a 30-person town is not great');
  fakeAct(sim, st, 25);
  const offers = sim.u.god.rel!.offers!;
  assert.equal(offers.length, 1);
  const o = offers[0];
  assert.equal(o.kind, 'flood');
  assert.match(o.name, /^the Flood of Aru$/);
  const d = dayOf(sim);
  assert.ok(o.opens - sim.u.tick >= d - 1 && o.opens - sim.u.tick <= 3 * d + 1, `opens in ${(o.opens - sim.u.tick) / d} days`);
  assert.equal(sim.snapshot().planets[0].covenantOffer ?? null, null, 'not shown before it opens');
  sim.drainEvents();
  let shown = -1;
  for (let i = 0; i < 4 * 24 && shown < 0; i++) {
    sim.step(60);
    const e = (sim.drainEvents() as Ev[]).find((q) => q.t === 'covenant.offered');
    if (e) shown = sim.u.tick;
  }
  assert.ok(shown >= o.opens && shown - o.opens <= 121, `covenant.offered fires at the opening hour (${shown - o.opens})`);
  assert.equal(sim.snapshot().planets[0].covenantOffer?.id, o.id);
  // a second great act on the planet replaces it (one open offer per planet)
  fakeAct(sim, st, 22, 'disaster:wildfire');
  assert.equal(sim.u.god.rel!.offers!.length, 1);
  assert.equal(sim.u.god.rel!.offers![0].kind, 'fire');
  // ruined, per town, inside an act
  const ctx = beginAct(sim.u, { key: 'cruin', god: 0, what: 'disaster:quake' });
  wreckBuildings(sim.u, P(sim), st.pos, 400, 50, 'quake', { flat: true });
  const ruined = ctx.ruined[`0:${st.id}`] ?? 0;
  endAct(sim.u, ctx);
  assert.ok(ruined >= 1, `ruined recorded: ${ruined}`);
});

test('C2: covenant.make raises trust 0.10-0.15; the bow comes within a day at a 5°-40° sun and is told then', () => {
  const { sim, st } = town();
  const ps = P(sim).people;
  for (const s of ps.members.get(st.id) ?? []) ps.agents.love[s * GODS] = 0.3;
  offerOn(sim, st);
  const t0 = mean(sim, st, 'love');
  const r = must(sim, { k: 'covenant.make', vow: 'no-flood' } as never);
  assert.ok(r.ok);
  const dt = mean(sim, st, 'love') - t0;
  assert.ok(dt >= 0.1 - 1e-6 && dt <= 0.15 + 1e-6, `trust +${dt}`);
  const cov = sim.u.god.rel!.covenants![0];
  assert.ok(cov.signAt > sim.u.tick && cov.signAt - sim.u.tick <= dayOf(sim) + 120, 'scheduled within a day');
  const el = sunElevation(sim.u, P(sim), cov.signAt, st.pos);
  assert.ok(el >= COVENANT.bowLo - 0.02 && el <= COVENANT.bowHi + 0.02, `sun at the bow ${Math.asin(el) * 180 / Math.PI}°`);
  const n0 = sim.u.chronicle.length;
  sim.drainEvents();
  let bow: Ev | undefined;
  for (let i = 0; i < 30 && !bow; i++) { sim.step(60); bow = (sim.drainEvents() as Ev[]).find((q) => q.t === 'covenant.bow'); }
  assert.ok(bow, 'the bow appears');
  assert.ok(P(sim).weather.some((w) => sim.u.content.weather.list[w.kind]?.id === 'rainbow'), 'rainbow weather over the town');
  const lines = sim.u.chronicle.slice(n0).map((e) => e.text);
  assert.ok(lines.some((l) => /A bow stood over Aru after the rain\. The god had promised never again to destroy them by water\./.test(l)), lines.join(' | '));
  assert.equal(sim.snapshot().planets[0].covenant?.status, 'kept');
  assert.equal(sim.snapshot().planets[0].settlements?.find((v) => v.id === st.id)?.covenant?.vow, 'no-flood');
});

test('C3: a flood is refused under no-flood; with break it runs and the covenant breaks (trust -0.25, ceiling); halved next time', () => {
  const { sim, st } = town();
  const ps = P(sim).people;
  for (const s of ps.members.get(st.id) ?? []) { ps.agents.love[s * GODS] = 0.6; ps.agents.fear[s * GODS] = 0.1; }
  offerOn(sim, st);
  must(sim, { k: 'covenant.make', vow: 'no-flood' } as never);
  const at = [st.pos[0], st.pos[1], st.pos[2]];
  const no = sim.applyNow({ k: 'disaster.spawn', kind: 'flood', pos: at } as never);
  assert.equal(no.ok, false);
  assert.equal(no.refusal?.kind, 'covenant');
  assert.equal(no.refusal?.vow, 'no-flood');
  assert.match(no.msg ?? '', /You promised the people of Aru never again to destroy by water\./);
  const no2 = sim.applyNow({ k: 'water.flood', pos: at } as never);
  assert.equal(no2.refusal?.kind, 'covenant');
  // not a flood: no refusal
  assert.ok(sim.applyNow({ k: 'miracle.lightning', pos: at, wrath: 0.1 } as never).ok);
  const t0 = mean(sim, st, 'love');
  const yes = sim.applyNow({ k: 'disaster.spawn', kind: 'flood', pos: at, covenant: 'break' } as never);
  assert.ok(yes.ok, yes.msg);
  const cov = sim.u.god.rel!.covenants![0];
  assert.equal(cov.status, 'broken');
  assert.ok(t0 - mean(sim, st, 'love') >= 0.25, `trust drop ${t0 - mean(sim, st, 'love')}`);
  const r = srel(sim.u, 0, st.id);
  assert.equal(r.memory?.betrayed, 1);
  // the ceiling: 0.9 - 0.2 w = 0.7 for every member after a daily pass
  for (const s of ps.members.get(st.id) ?? []) ps.agents.love[s * GODS] = 0.95;
  sim.step(dayOf(sim) * 8);
  for (const s of ps.members.get(st.id) ?? []) assert.ok(ps.agents.love[s * GODS] <= 0.7 + 1e-3, `trust ${ps.agents.love[s * GODS]}`);
  assert.ok(sim.u.chronicle.some((e) => /In Aru they say: (if the god breaks its word|we were fools)/.test(e.text)), 'the answer a week later');
  // a second covenant after another great destruction: half the gains
  for (const s of ps.members.get(st.id) ?? []) { ps.agents.love[s * GODS] = 0.3; ps.agents.fear[s * GODS] = 0.3; }
  offerOn(sim, st);
  const t1 = mean(sim, st, 'love');
  must(sim, { k: 'covenant.make', vow: 'gentle' } as never);
  const d2 = mean(sim, st, 'love') - t1;
  assert.ok(d2 > 0.04 && d2 <= 0.076, `halved trust gain ${d2}`);
  assert.equal(sim.u.god.rel!.covenants![1].halved, true);
  const g = sim.applyNow({ k: 'miracle.lightning', pos: at, wrath: 0.6 } as never);
  assert.equal(g.refusal?.vow, 'gentle');
  assert.ok(sim.applyNow({ k: 'miracle.lightning', pos: at, wrath: 0.2 } as never).ok, 'gentle wrath is no break');
});

test('C4: spare-the-many breaks after the fact at 11 deaths; a natural flood in a no-flood town is doubt, not a break', () => {
  const { sim, st } = town();
  offerOn(sim, st);
  must(sim, { k: 'covenant.make', vow: 'spare-the-many' } as never);
  fakeAct(sim, st, 10, 'miracle.lightning');
  assert.equal(sim.u.god.rel!.covenants![0].status, 'kept', '10 dead keeps it');
  fakeAct(sim, st, 11, 'miracle.lightning');
  assert.equal(sim.u.god.rel!.covenants![0].status, 'broken', '11 dead breaks it');
  const b = town();
  offerOn(b.sim, b.st);
  must(b.sim, { k: 'covenant.make', vow: 'no-flood' } as never);
  const t0 = mean(b.sim, b.st, 'love');
  const n0 = b.sim.u.chronicle.length;
  fakeAct(b.sim, b.st, 2, 'disaster:flood', { natural: true });
  assert.equal(b.sim.u.god.rel!.covenants![0].status, 'kept');
  assert.ok(t0 - mean(b.sim, b.st, 'love') > 0.03, 'doubt costs trust');
  assert.ok(b.sim.u.chronicle.slice(n0).some((e) => /Aru asks why the god let the waters rise\./.test(e.text)));
});

test('warn-first: an unwarned strike on a covenant town is refused, a foretold one is not; decline; save/load keeps it', () => {
  const { sim, st } = town();
  offerOn(sim, st);
  must(sim, { k: 'covenant.decline' } as never);
  assert.equal(sim.u.god.rel!.offers!.length, 0);
  assert.ok(sim.u.chronicle.some((e) => /The survivors of Aru waited, and the sky said nothing\./.test(e.text)));
  assert.equal(sim.applyNow({ k: 'covenant.make', vow: 'gentle' } as never).ok, false, 'no offer, no covenant');
  offerOn(sim, st);
  must(sim, { k: 'covenant.make', vow: 'warn-first' } as never);
  const at = [st.pos[0], st.pos[1], st.pos[2]];
  assert.equal(sim.applyNow({ k: 'miracle.lightning', pos: at, wrath: 0.1 } as never).refusal?.vow, 'warn-first');
  must(sim, { k: 'god.omen', settlement: st.id } as never);
  sim.step(30);
  assert.ok(sim.applyNow({ k: 'miracle.lightning', pos: at, wrath: 0.1 } as never).ok, 'foretold by an omen');
  const q = sim.query('covenants', {}) as { covenants: { vowWords: string; townNames: string[] }[] };
  assert.equal(q.covenants[0].vowWords, 'Always warn first');
  assert.deepEqual(q.covenants[0].townNames, ['Aru']);
  const back = Sim.load(sim.save());
  assert.deepEqual(back.u.god.rel!.covenants, sim.u.god.rel!.covenants);
  assert.equal(back.hash(), sim.hash());
});

test('determinism: offer, covenant, bow, break — the same run twice and through a save gives the same hash', () => {
  const run = (saveAt: number | null): string => {
    let { sim, st } = town();
    const d = dayOf(sim);
    offerOn(sim, st);
    must(sim, { k: 'covenant.make', vow: 'gentle' } as never);
    for (let i = 0; i < 6; i++) {
      sim.step(d / 2);
      if (saveAt === i) { sim = Sim.load(sim.save()); st = P(sim).people.settlement(st.id)!; }
    }
    must(sim, { k: 'miracle.lightning', pos: [st.pos[0], st.pos[1], st.pos[2]], wrath: 0.7, covenant: 'break' } as never);
    sim.step(d * 2);
    return sim.hash();
  };
  const a = run(null);
  assert.equal(run(null), a);
  assert.equal(run(2), a);
});

test('free text (§6.5): promises by their words, "what did I promise", "…, and break my covenant"', () => {
  const { sim, st } = town();
  offerOn(sim, st);
  const cases: [string, string | null][] = [['promise never to flood them again', 'no-flood'], ['swear never to destroy them by water', 'no-flood'],
    ['promise to spare them', 'spare-the-many'], ['promise to be gentle', 'gentle'], ['promise to always warn them', 'warn-first'], ['make a covenant', null]];
  for (const [t, vow] of cases) {
    const r = sim.parse(t);
    if (vow) assert.equal(r.resolved?.[0]?.vow, vow, t);
    else assert.match(r.msg ?? '', /^Promise what\?/);
  }
  assert.match(sim.parse('what did I promise').msg ?? '', /no promise/);
  const b = sim.parse('flood Aru, and break my covenant');
  assert.equal(b.resolved?.[0]?.covenant, 'break');
  assert.equal(sim.parse('I break my promise').msg, 'A promise is broken by a deed, not a word.');
});
