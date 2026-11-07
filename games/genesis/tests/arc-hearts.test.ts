// GENESIS — ARC §1 (visible moods) and §2.1 (pride): the per-person heart, the settlement heart with its 3-day hysteresis,
// the proud flag, dusk, the hearts view and query, the per-agent sign block, pride's target, the lazy fill of an old
// save's town, and that saving keeps it all (ARC §6.1, §6.2, §6.6, §7).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../src/sim/sim.ts';
import { town } from './helpers/god.ts';
import { makeCtx } from '../src/sim/people/ctx.ts';
import { GODS } from '../src/sim/people/defs.ts';
import { AgentFlag } from '../src/sim/types.ts';
import { srel } from '../src/sim/god/regard.ts';
import { ARC, personHeart, prideTarget, heartsDaily, emptyMemory } from '../src/sim/god/arc.ts';

function setAll(sim: Sim, sid: number, v: { fear?: number; love?: number; faith?: number; loyalty?: number; mood?: number }): void {
  const p = sim.u.planets[0], A = p.people!.agents;
  for (const s of p.people!.members.get(sid) ?? []) {
    const i = s * GODS;
    if (v.fear !== undefined) A.fear[i] = v.fear;
    if (v.love !== undefined) A.love[i] = v.love;
    if (v.faith !== undefined) A.faith[i] = v.faith;
    if (v.loyalty !== undefined) A.loyalty[i] = v.loyalty;
    if (v.mood !== undefined) A.mood[s] = v.mood;
  }
}

test('§1.1 the per-person heart: the first rule that holds wins', () => {
  const { sim, st } = town();
  const p = sim.u.planets[0], A = p.people!.agents;
  const s = (p.people!.members.get(st.id) ?? []).find((q) => !(A.flags[q] & AgentFlag.child))!;
  const i = s * GODS;
  A.fear[i] = 0.8; A.love[i] = 0.2; A.faith[i] = 0.6; A.loyalty[i] = 0.5; A.mood[s] = 0.7;
  assert.equal(personHeart(A, s, 0, 0), 'fearful');
  A.fear[i] = 0.2; A.love[i] = 0.6;
  assert.equal(personHeart(A, s, 0, 0), 'devoted');
  A.faith[i] = 0.2; A.love[i] = 0.2; A.loyalty[i] = 0.2;
  assert.equal(personHeart(A, s, 0, 0.6), 'restless', 'little faith in a proud town');
  assert.equal(personHeart(A, s, 0, 0.2), 'quiet');
  A.mood[s] = 0.3;
  assert.equal(personHeart(A, s, 0, 0), 'restless', 'low mood');
});

test('§2.1 pride target sanity values (T1)', () => {
  // year 2, stone age, unharmed, faith 0.5 (P from a young town's prosperity of about 3.3)
  const a = prideTarget({ P: 0.33, T: 0, U: 0, L: 2 / 15, F: 0.5 }, 0.2, 0.5, emptyMemory(), 60);
  assert.ok(Math.abs(a - 0.20) <= 0.03, `young town ${a}`);
  // year 30, bronze, 3 kin towns, never harmed, faith 0.3 (P 0.6)
  const b = prideTarget({ P: 0.6, T: 0.67, U: 2 / 3, L: 1, F: 0.7 }, 0.2, 0.5, emptyMemory(), 120);
  assert.ok(Math.abs(b - 0.73) <= 0.03, `old proud town ${b}`);
  // the same, harmed last year with fear 0.6
  const c = prideTarget({ P: 0.6, T: 0.67, U: 2 / 3, L: 1 / 15, F: 0.7 }, 0.6, 0.3, emptyMemory(), 120);
  assert.ok(Math.abs(c - 0.37) <= 0.05, `harmed town ${c}`);
  assert.equal(prideTarget({ P: 1, T: 1, U: 1, L: 1, F: 1 }, 0, 0, emptyMemory(), 39), 0, 'no pride under 40 people');
});

test('§1.2 the settlement heart: taken at once on the first day, then only after 3 days; events and a chronicle line', () => {
  const { sim, st } = town();
  const p = sim.u.planets[0];
  const day = makeCtx(sim.u, p).day;
  sim.step(day * 2);
  const r = srel(sim.u, p.id, st.id);
  assert.ok(r.hearts, 'hearts after two days');
  assert.ok(r.since.arc0 !== undefined && r.memory && typeof r.pride === 'number' && r.prideWhy && r.dusk);
  const snap = sim.snapshot();
  const v = snap.planets[0].settlements!.find((q) => q.id === st.id)!;
  assert.ok(v.heart, 'SettlementView.heart (M1)');
  assert.equal(typeof v.heart!.caption, 'string');
  const b = snap.planets[0].agents!;
  assert.ok(b.heart && b.heart.length === b.count, 'MoverBlock.heart, count long');
  // make them afraid: the kind changes only after it has held three days
  const before = r.hearts!.kind;
  assert.notEqual(before, 'fearful');
  sim.drainEvents();
  const x = makeCtx(sim.u, p);
  const days: string[] = [];
  for (let d = 0; d < 4; d++) {
    setAll(sim, st.id, { fear: 0.9, love: 0.1, faith: 0.4, mood: 0.7 });
    x.tick = sim.u.tick + d * day;
    heartsDaily(x, st);
    days.push(r.hearts!.kind);
  }
  assert.deepEqual(days.slice(0, 2), [before, before], 'not before three days');
  assert.equal(days[2], 'fearful', 'taken on the third day');
  assert.ok(r.hearts!.fearful >= ARC.heartShare);
  const ev = sim.drainEvents().filter((e) => e.t === 'heart');
  assert.equal(ev.length, 1);
  assert.deepEqual(ev[0].data, { settlement: st.id, from: before, to: 'fearful' });
  assert.ok(sim.u.chronicle.some((c) => /watch the sky and speak quietly|one eye on the clouds/.test(c.text)), 'heart.fearful told');
  const q = sim.query('hearts', { settlement: st.id }) as { kind: string; caption: string; line: string }[];
  assert.equal(q.length, 1);
  assert.equal(q[0].kind, 'fearful');
  assert.equal(q[0].caption, 'They watch the sky');
  assert.ok(q[0].line.includes(st.name));
});

test('§1.2 dusk: no bow at dusk is told once when the ema falls from above 0.45 to below 0.25', () => {
  const { sim, st } = town();
  const p = sim.u.planets[0];
  const x = makeCtx(sim.u, p);
  const r = srel(sim.u, p.id, st.id);
  heartsDaily(x, st);
  r.dusk = { ema: 0.5, today: 0.5, low: false, yearAgo: 0.5 };
  r.vespers = { t: x.tick, went: [] };
  let told = 0;
  for (let d = 1; d < 30; d++) {
    x.tick += x.day;
    r.vespers.t = x.tick;
    const n0 = sim.u.chronicle.length;
    heartsDaily(x, st);
    if (sim.u.chronicle.slice(n0).some((c) => /no longer bow at dusk|stands empty at evening/.test(c.text))) told++;
  }
  assert.ok(r.dusk.low, `low (ema ${r.dusk.ema})`);
  assert.equal(told, 1, 'heart.nobow once');
});

test('§7 an old save: the first ARC daily fills the town lazily (pride at its target, arc0 at the load tick)', () => {
  const { sim, st } = town();
  const p = sim.u.planets[0];
  const r = srel(sim.u, p.id, st.id);
  for (const k of ['pride', 'prideWhy', 'hearts', 'memory', 'dusk', 'told', 'lastHarm', 'harmLoad', 'defiance'] as const) delete r[k];
  delete r.since.arc0;
  const rel = sim.u.god.rel as unknown as Record<string, unknown>;
  for (const k of ['towers', 'covenants', 'offers', 'ages', 'annals', 'godActs', 'arcEvents']) delete rel[k];
  const sim2 = Sim.load(sim.save());
  assert.deepEqual(sim2.u.god.rel.towers, [], 'emptyRel defaults through the spread');
  assert.deepEqual(sim2.u.god.rel.annals, {});
  const p2 = sim2.u.planets[0], st2 = p2.people!.settlement(st.id)!;
  const x = makeCtx(sim2.u, p2);
  x.tick += 400 * x.day; // the town is long founded
  heartsDaily(x, st2);
  const r2 = srel(sim2.u, p2.id, st2.id);
  assert.equal(r2.since.arc0, x.tick, 'arc0 = the load tick for an old town');
  assert.ok(r2.hearts && r2.memory && r2.prideWhy);
  assert.equal(r2.prideWhy!.L, 0, 'long-unpunished starts at 0');
});

test('ARC state survives a save and the run stays deterministic', () => {
  const { sim, st } = town();
  const day = makeCtx(sim.u, sim.u.planets[0]).day;
  sim.step(day * 3);
  const a = Sim.load(sim.save());
  assert.equal(a.hash(), sim.hash(), 'the same state after a reload');
  a.step(day * 2); sim.step(day * 2);
  assert.equal(a.hash(), sim.hash(), 'the same run after a reload');
  assert.deepEqual(srel(a.u, 0, st.id).hearts, srel(sim.u, 0, st.id).hearts);
});
