// GENESIS — ARC §3 open defiance (stage B): the harm load's weights, the level and the terror that suppresses it, the
// acts (stones at the god's storm, the curse at dusk, the idol), the classification of the god's answer (mercy, wrath,
// a sign, patience at day 10), wrath's trust never cheaper than the same harm elsewhere (D4), memory's decay with and
// without a landmark (D5), daughters, the newborn bias, the free text, and save/load.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../src/sim/sim.ts';
import { town, must } from './helpers/god.ts';
import { GODS, TASK } from '../src/sim/people/defs.ts';
import { srel, freshen } from '../src/sim/god/regard.ts';
import { arcNewbornBias, defianceTarget, answeredWords, DEFY } from '../src/sim/god/defiance.ts';
import { emptyMemory } from '../src/sim/god/arc.ts';
import type { Settlement } from '../src/sim/people/state.ts';

const P = (sim: Sim) => sim.u.planets[0];
const dayOf = (sim: Sim) => Math.max(60, Math.round(P(sim).st.dayHours * 60));
const yearOf = (sim: Sim) => Math.max(dayOf(sim), Math.round(P(sim).st.orbit.period));
type Ev = { t: string; data?: Record<string, unknown> };
const events = (sim: Sim): Ev[] => sim.drainEvents() as Ev[];

function mean(sim: Sim, st: Settlement, col: 'love' | 'fear' | 'faith'): number {
  const ps = P(sim).people;
  const m = ps.members.get(st.id) ?? [];
  let t = 0;
  for (const s of m) t += ps.agents[col][s * GODS];
  return t / Math.max(1, m.length);
}
function setCol(sim: Sim, st: Settlement, col: 'love' | 'fear' | 'faith', v: number): void {
  const ps = P(sim).people;
  for (const s of ps.members.get(st.id) ?? []) ps.agents[col][s * GODS] = v;
}
/** a thunderstorm painted over the town by the god */
function storm(sim: Sim, st: Settlement): void {
  must(sim, { k: 'weather.paint', kind: 'thunderstorm', pos: [st.pos[0], st.pos[1], st.pos[2]], radius: 900, duration: 6 * 1440, pinned: true } as never);
}
/** the town angry and held there (low trust, proud), bold enough to go out */
function angry(sim: Sim, st: Settlement, v = 0.8): void {
  must(sim, { k: 'defiance.set', settlement: st.id, value: v } as never);
  must(sim, { k: 'pride.set', settlement: st.id, value: 0.7 } as never);
  setCol(sim, st, 'love', 0.1);
  setCol(sim, st, 'fear', 0.2);
}
/** step hour by hour until a defy event (of kind k) or the limit; returns it */
function untilDefy(sim: Sim, hours: number, k?: string): Ev | undefined {
  for (let h = 0; h < hours * 6; h++) {
    sim.step(10);
    const e = events(sim).find((q) => q.t === 'defy' && (!k || q.data?.kind === k));
    if (e) return e;
  }
  return undefined;
}

test('harmLoad: an unprovoked act counts 1 once; a provoked one 0.5 (§3.1 fix a)', () => {
  const { sim, st } = town();
  const r = srel(sim.u, P(sim).id, st.id);
  r.harmLoad = 0;
  must(sim, { k: 'miracle.lightning', pos: [st.pos[0], st.pos[1], st.pos[2]], wrath: 0.1 } as never);
  const a = r.harmLoad ?? 0;
  assert.ok(a >= 1 && a < 1.5, `unprovoked load ${a}`);
  const { sim: s2, st: t2 } = town();
  const r2 = srel(s2.u, P(s2).id, t2.id);
  r2.harmLoad = 0;
  r2.since.provoked = s2.u.tick;
  must(s2, { k: 'miracle.lightning', pos: [t2.pos[0], t2.pos[1], t2.pos[2]], wrath: 0.1 } as never);
  const b = r2.harmLoad ?? 0;
  assert.ok(b >= 0.5 && b < 0.8, `provoked load ${b}`);
});

test('defiance target: load, pride and low trust raise it; terror suppresses it; memory biases it (§3.1, §0.4)', () => {
  const r = { harmLoad: 3, pride: 0.7, lapses: 0, memory: emptyMemory() } as never as Parameters<typeof defianceTarget>[0];
  const wronged = defianceTarget(r, 0.3, 0.1);
  assert.ok(wronged >= 0.8, `a proud, wronged people defies (${wronged})`);
  const crushed = defianceTarget(r, 0.9, 0.1);
  assert.ok(crushed <= wronged - 0.2 + 1e-9, `terror suppresses (${crushed} vs ${wronged})`);
  r.memory!.mercy = 1;
  assert.ok(Math.abs(defianceTarget(r, 0.3, 0.1) - (wronged - 0.1)) < 1e-9, 'mercy remembered: -0.10');
});

test('hurl: a defiant town under the god\'s storm throws stones; the storm is unchanged; terror stops it (D1, D3)', () => {
  const { sim, st } = town();
  angry(sim, st);
  storm(sim, st);
  events(sim);
  const e = untilDefy(sim, 24 * 5, 'hurl');
  assert.ok(e, 'a hurl act within five days (one roll a day)');
  assert.equal(e!.data!.settlement, st.id);
  assert.ok(Number(e!.data!.count) >= 1);
  const A = P(sim).people.agents;
  const out = (P(sim).people.members.get(st.id) ?? []).filter((s) => A.task[s] === TASK.defy && A.tData[s] === 2);
  assert.equal(out.length, e!.data!.count, 'the throwers are out with TASK.defy (tData 2)');
  assert.ok(out.length <= DEFY.hurlN);
  // futile: the weather is exactly what it is in the same world where nobody defied
  const { sim: tw, st: tst } = town();
  storm(tw, tst);
  tw.step(sim.u.tick - tw.u.tick);
  assert.equal(JSON.stringify(P(tw).weather), JSON.stringify(P(sim).weather), 'the storm is untouched');
  const r = srel(sim.u, P(sim).id, st.id);
  assert.ok(r.answer, 'an answer window is open (the first open act holds it)');
  // the snapshot carries the act and the hurl sign
  const snap = sim.snapshot() as unknown as { planets: { settlements?: { id: number; defiant?: { kind: string } }[] }[] };
  const v = snap.planets[0].settlements?.find((q) => q.id === st.id);
  assert.equal(v?.defiant?.kind, 'hurl');
  // terror: the same town at fear 0.9 does not go out
  const { sim: s2, st: t2 } = town();
  angry(s2, t2);
  setCol(s2, t2, 'fear', 0.9);
  srel(s2.u, P(s2).id, t2.id).means[1] = 0.9;
  storm(s2, t2);
  events(s2);
  for (let h = 0; h < 24 * 5; h++) { setCol(s2, t2, 'fear', 0.9); s2.step(60); assert.ok(!events(s2).some((q) => q.t === 'defy' && q.data?.kind === 'hurl'), 'no hurl at fear 0.9'); }
});

test('no storm, no stones: hurl happens only under a god storm (D1)', () => {
  const { sim, st } = town();
  angry(sim, st);
  events(sim);
  for (let h = 0; h < 24 * 5; h++) { sim.step(60); assert.ok(!events(sim).some((q) => q.t === 'defy' && q.data?.kind === 'hurl')); }
});

test('mercy after the stones lowers defiance by >= 0.15 within 3 days; the answer is classified (D4)', () => {
  const { sim, st } = town();
  angry(sim, st);
  storm(sim, st);
  events(sim);
  assert.ok(untilDefy(sim, 24 * 5, 'hurl'), 'a hurl act');
  const r = srel(sim.u, P(sim).id, st.id);
  delete r.since.dHold; delete r.since.dHoldV;
  const d0 = r.defiance!;
  must(sim, { k: 'defiance.answer', settlement: st.id, how: 'mercy' } as never);
  const ev = events(sim).find((q) => q.t === 'defy.answered');
  assert.equal(ev?.data?.how, 'mercy');
  assert.equal(r.answer, null, 'the window closes');
  sim.step(3 * dayOf(sim));
  assert.ok(d0 - r.defiance! >= 0.15, `defiance ${d0} -> ${r.defiance}`);
  assert.equal(r.memory!.mercy >= 1, true);
  assert.match(answeredWords(r), /shown mercy once/);
});

test('patience is classified at day 10 when the god does nothing (D4)', () => {
  const { sim, st } = town();
  const r = srel(sim.u, P(sim).id, st.id);
  r.answer = { tick: sim.u.tick, kind: 'curse' };
  (r.defied ??= {}).curse = sim.u.tick;
  events(sim);
  sim.step(9 * dayOf(sim));
  assert.ok(r.answer, 'still open at day 9');
  sim.step(2 * dayOf(sim));
  assert.equal(r.answer, null);
  const ev = events(sim).find((q) => q.t === 'defy.answered');
  assert.equal(ev?.data?.how, 'patience');
  assert.ok(r.memory!.patience >= 1);
});

test('wrath never costs less trust than the same harm on a town that did not defy (D4)', () => {
  const run = (defied: boolean) => {
    const { sim, st } = town();
    setCol(sim, st, 'love', 0.5);
    const r = srel(sim.u, P(sim).id, st.id);
    if (defied) { r.answer = { tick: sim.u.tick, kind: 'curse' }; (r.defied ??= {}).curse = sim.u.tick; }
    const t0 = mean(sim, st, 'love');
    must(sim, { k: 'miracle.lightning', pos: [st.pos[0], st.pos[1], st.pos[2]], wrath: 0.3 } as never);
    return { lost: t0 - mean(sim, st, 'love'), how: (events(sim).find((q) => q.t === 'defy.answered')?.data?.how) };
  };
  const plain = run(false), wrath = run(true);
  assert.equal(wrath.how, 'wrath');
  assert.equal(plain.how, undefined);
  assert.ok(wrath.lost >= plain.lost - 1e-6, `wrath ${wrath.lost} vs plain ${plain.lost}`);
});

test('defiance.answer sign: faith +0.10 and defiance -0.1; patience records and does nothing', () => {
  const { sim, st } = town();
  const r = srel(sim.u, P(sim).id, st.id);
  r.defiance = 0.6;
  r.answer = { tick: sim.u.tick, kind: 'curse' };
  (r.defied ??= {}).curse = sim.u.tick;
  const f0 = mean(sim, st, 'faith');
  const res = sim.applyNow({ k: 'defiance.answer', settlement: st.id, how: 'sign' } as never) as { ok: boolean; msg: string };
  assert.ok(res.ok, res.msg);
  assert.equal(events(sim).find((q) => q.t === 'defy.answered')?.data?.how, 'sign');
  assert.ok(mean(sim, st, 'faith') - f0 >= 0.08, 'faith rises');
  assert.ok(r.defiance! <= 0.5 + 1e-9);
  r.answer = { tick: sim.u.tick, kind: 'curse' };
  must(sim, { k: 'defiance.answer', settlement: st.id, how: 'patience' } as never);
  assert.ok(r.answer, 'patience does nothing now');
  assert.equal(r.since.patience, sim.u.tick);
});

test('curse at dusk: the defiant gather and curse; the idol is raised with a building record (D1)', () => {
  const { sim, st } = town();
  angry(sim, st, 0.9);
  setCol(sim, st, 'faith', 0.1);
  events(sim);
  const c = untilDefy(sim, 24 * 8, 'curse');
  assert.ok(c, 'a curse within eight days');
  const A = P(sim).people.agents;
  assert.ok((P(sim).people.members.get(st.id) ?? []).some((s) => A.task[s] === TASK.defy && A.tData[s] === 1), 'cursers out');
  const r = srel(sim.u, P(sim).id, st.id);
  let idol: number | undefined;
  for (let d = 0; d < 30 && idol === undefined; d++) { setCol(sim, st, 'faith', 0.1); sim.step(dayOf(sim)); idol = r.idol; }
  assert.ok(idol !== undefined, 'an idol within 30 days');
  const b = P(sim).people.building(idol!);
  assert.ok(b && sim.u.content.buildings.list[b.type].id === 'idol', 'a building record of type idol');
});

test('memory halves in 25 years with no keeper (one year: x0.9727); x0.99 with a rubble landmark (D5)', () => {
  const { sim, st } = town();
  sim.step(dayOf(sim));
  const r = srel(sim.u, P(sim).id, st.id);
  r.memory = { ...emptyMemory(), wrath: 1, mercy: 1 };
  r.since.memY = sim.u.tick - yearOf(sim);
  sim.step(dayOf(sim));
  assert.ok(Math.abs(r.memory.wrath - Math.pow(0.5, 1 / 25)) < 1e-3, `wrath ${r.memory.wrath}`);
  // 25 years: 0.5 within 2 %
  assert.ok(Math.abs(Math.pow(DEFY.memDecay, 25) - 0.5) < 0.01);
  // a struck tower beside the town keeps the wrath its fall raised
  const R = sim.u.god.rel!;
  const ev = { id: 99901, planet: P(sim).id, tick: sim.u.tick, kind: 'strike' as const, name: 'x', towns: [st.id], god: 'wrath' as const, dead: 0, ref: 99900 };
  (R.arcEvents ??= []).push(ev);
  r.memEvents = [99901];
  (R.towers ??= []).push({ id: 99900, planet: P(sim).id, host: st.id, league: [st.id], name: 't', cell: st.cell, pos: [st.pos[0], st.pos[1], st.pos[2]], building: -1,
    material: 'mudbrick', begun: 0, ended: sim.u.tick, height: 10, goal: 80, tiers: 3, builders: 0, status: 'struck', answer: 'strike', answeredAt: 0, choiceAt: -1, choices: 0, omens: 0, converged: 0 });
  r.memory.wrath = 1; r.memory.mercy = 1;
  r.since.memY = sim.u.tick - yearOf(sim);
  sim.step(dayOf(sim));
  assert.ok(Math.abs(r.memory.wrath - 0.99) < 1e-3, `landmark wrath ${r.memory.wrath}`);
  assert.ok(Math.abs(r.memory.mercy - Math.pow(0.5, 1 / 25)) < 1e-3, 'mercy has no landmark');
  assert.ok(Math.pow(0.99, 25) >= 0.70);
});

test('newborn bias: wrath remembered adds fear, mercy adds trust, capped 0.2, only to the fresh (§0.4)', () => {
  const bias = arcNewbornBias({ memory: { ...emptyMemory(), wrath: 2, mercy: 10 } } as never)!;
  assert.deepEqual(bias, { fear: 0.1, trust: 0.2 });
  const A = { faith: new Float32Array(4), loyalty: new Float32Array(4), love: new Float32Array(4), fear: new Float32Array(4) };
  A.love[0] = 0.08; A.fear[0] = 0.04;
  freshen(A, 0, null, bias);
  assert.ok(Math.abs(A.fear[0] - 0.14) < 1e-6 && Math.abs(A.love[0] - 0.28) < 1e-6);
  freshen(A, 0, null, bias);
  assert.ok(Math.abs(A.love[0] - 0.28) < 1e-6, 'once');
  assert.equal(arcNewbornBias({ memory: emptyMemory() } as never), undefined);
});

test('free text: "forgive Aru" / "be patient with Aru" answer a town that defied; elsewhere they fall through', () => {
  const { sim, st } = town();
  const r = srel(sim.u, P(sim).id, st.id);
  r.answer = { tick: sim.u.tick, kind: 'curse' };
  (r.defied ??= {}).curse = sim.u.tick;
  const cmds = (t: string) => ((sim.parse(t).resolved ?? []) as { k: string; how?: string }[]);
  assert.deepEqual(cmds('forgive Aru').map((c) => [c.k, c.how]), [['defiance.answer', 'mercy']]);
  assert.deepEqual(cmds('be patient with Aru').map((c) => [c.k, c.how]), [['defiance.answer', 'patience']]);
  assert.deepEqual(cmds('punish Aru for their defiance').map((c) => [c.k, c.how]), [['defiance.answer', 'wrath']]);
  assert.deepEqual(cmds('show Aru a sign').map((c) => [c.k, c.how]), [['defiance.answer', 'sign']]);
  const { sim: s2 } = town();
  assert.ok(!(s2.parse('be merciful to Aru').resolved ?? []).some((c) => c.k === 'defiance.answer'), 'no defiance there: a disposition');
});

test('determinism: a defiant run saved mid-way and loaded continues identically', () => {
  const mk = () => { const { sim, st } = town(); angry(sim, st); storm(sim, st); return sim; };
  const a = mk(), b = mk();
  a.step(6 * 60); b.step(6 * 60);
  const c = Sim.load(b.save());
  a.step(30 * 60); c.step(30 * 60);
  assert.equal(JSON.stringify(a.u.god.rel!.st), JSON.stringify(c.u.god.rel!.st));
});
