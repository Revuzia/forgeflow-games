// GENESIS — the god's standing with its people (CONTRACT.md §11.1, §11.4, §8.8): every act is witnessed (help brings
// love, harm brings fear); by default nothing fails for want of worship (pillar 1), while restraint mode makes powers
// cost worship and cool down, refusing readably; disciples carry the god's will; possession walks a person and makes
// them act; rival gods act on their own through the same commands and win believers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { town, must, meanFear } from './helpers/god.ts';
import type { Sim } from '../src/sim/sim.ts';
import type { Settlement } from '../src/sim/people/state.ts';
import { Sim as SimClass } from '../src/sim/sim.ts';
import { AgentFlag } from '../src/sim/types.ts';
import { worshipOf } from '../src/sim/god/belief.ts';
import { moveBy, bearingDir } from '../src/sim/god/util.ts';
import { distM } from '../src/sim/people/world.ts';

function meanLove(sim: Sim, st: Settlement): number {
  const ps = sim.u.planets[0].people;
  const m = ps.members.get(st.id) ?? [];
  return m.reduce((a, s) => a + ps.agents.love[s * 4], 0) / Math.max(1, m.length);
}

test('every act is witnessed: help brings love, harm brings fear', () => {
  const { sim, st } = town();
  const love0 = meanLove(sim, st), fear0 = meanFear(sim, st);
  must(sim, { k: 'miracle.food', pos: st.pos });
  const love1 = meanLove(sim, st);
  assert.ok(love1 > love0, `food from the sky: love ${love0.toFixed(3)} -> ${love1.toFixed(3)}`);
  must(sim, { k: 'miracle.lightning', pos: moveBy(st.pos, bearingDir(st.pos, 1), 60, sim.u.planets[0].st.radius) });
  assert.ok(meanFear(sim, st) > fear0, 'a bolt beside them: fear');
  const g = sim.u.god.god(0)!;
  assert.ok(g.help > 0 && g.harm > 0 && g.acts >= 2, 'the god keeps its record');
});

test('by default no power fails for want of worship; with restraint on they cost worship and cool down', () => {
  const { sim, st } = town();
  const ps = sim.u.planets[0].people;
  ps.worship[0] = 0;
  const heal = sim.content.powers.list.find((pw) => pw.command === 'miracle.heal')!;
  assert.ok((heal.cost ?? 0) > 0 && (heal.cooldown ?? 0) > 0, 'healing has a price in restraint');
  // omnipotent: no worship, still works
  for (let i = 0; i < 3; i++) must(sim, { k: 'miracle.heal', pos: st.pos });
  must(sim, { k: 'meta.restraint', on: true });
  assert.equal(sim.snapshot().restraint, true);
  const no = sim.applyNow({ k: 'miracle.heal', pos: st.pos });
  assert.equal(no.ok, false);
  assert.match(no.msg ?? '', /needs \d+(\.\d+)? worship; you have 0/);
  ps.worship[0] = (heal.cost ?? 0) * 3;
  must(sim, { k: 'miracle.heal', pos: st.pos });
  assert.ok(Math.abs(worshipOf(sim.u, 0) - (heal.cost ?? 0) * 2) < 0.02, `paid (${worshipOf(sim.u, 0)} left)`);
  const again = sim.applyNow({ k: 'miracle.heal', pos: st.pos });
  assert.equal(again.ok, false);
  assert.match(again.msg ?? '', /still gathering strength/);
  sim.step((heal.cooldown ?? 0) + 1);
  must(sim, { k: 'miracle.heal', pos: st.pos });
  must(sim, { k: 'meta.restraint', on: false });
  ps.worship[0] = 0;
  must(sim, { k: 'miracle.heal', pos: st.pos });
});

test('possession: the god walks a person somewhere and makes them act', () => {
  const { sim, st } = town();
  const p = sim.u.planets[0];
  const A = p.people.agents;
  const s0 = (p.people.members.get(st.id) ?? []).find((s) => A.health[s] > 0.8)!;
  const id = A.id[s0];
  must(sim, { k: 'agent.possess', id, on: true });
  assert.ok(A.flags[A.slotOf(id)] & AgentFlag.possessed);
  // somewhere dry 60 m off (the town is on a coast: a walk into the sea is a slow swim; people walk ~0.25 m a tick)
  const dry = (q: number[]) => { const c = p.cellAt(q); return !p.s.ocean[c] && p.f.water[c] < 0.3; };
  let to = moveBy(st.pos, bearingDir(st.pos, 0), 60, p.st.radius);
  for (let b = 0; b < 6.28; b += 0.4) {
    const q = moveBy(st.pos, bearingDir(st.pos, b), 60, p.st.radius);
    if (dry(q) && dry(moveBy(st.pos, bearingDir(st.pos, b), 30, p.st.radius))) { to = q; break; }
  }
  must(sim, { k: 'possess.move', id, pos: to });
  const pt = [0, 0, 0];
  let d = Infinity;
  for (let t = 0; t < 120 && d > 3; t++) { sim.step(10); A.posAt(A.slotOf(id), sim.tick, pt); d = distM(p, pt, to); }
  assert.ok(d <= 3, `walked there (${d.toFixed(1)} m off)`);
  // and stays (their own wants do not pull them away while possessed and idle)
  sim.step(120);
  A.posAt(A.slotOf(id), sim.tick, pt);
  assert.ok(distM(p, pt, to) < 5, 'waits for the next order');
  must(sim, { k: 'possess.act', id, act: 'pray' });
  sim.step(5);
  const q = sim.query('agent', { id }) as { doing?: string } | null;
  assert.ok(q && /pray/i.test(q.doing ?? ''), `praying (${q?.doing})`);
  must(sim, { k: 'agent.possess', id, on: false });
  assert.ok(!(A.flags[A.slotOf(id)] & AgentFlag.possessed), 'released');
  assert.equal(sim.u.god.possession.length, 0);
});

test('a disciple who preaches makes the town more devout than its twin without one', () => {
  const { sim, st } = town();
  const ps = sim.u.planets[0].people;
  const A = ps.agents;
  const twin = SimClass.load(sim.save());
  const s0 = (ps.members.get(st.id) ?? []).find((s) => A.health[s] > 0.8 && A.role[s] !== 16)!;
  must(sim, { k: 'agent.make-disciple', id: A.id[s0], mode: 'preach' });
  assert.equal(sim.u.god.disciples.length, 1);
  sim.step(2 * 1440);
  twin.step(2 * 1440);
  const a = sim.u.planets[0].people.settlement(st.id)!, b = twin.u.planets[0].people.settlement(st.id)!;
  assert.ok(a.belief > b.belief, `belief with a preacher ${a.belief.toFixed(3)} against ${b.belief.toFixed(3)}`);
});

test('a rival god acts on its own, through the same commands, and wins believers', () => {
  const { sim, st } = town();
  const r = must(sim, { k: 'rival.add', temperament: 'benevolent', settlement: st.id, name: 'Ysh' });
  const g = sim.u.god.gods.find((q) => q.kind === 'rival' && q.alive)!;
  assert.equal(g.name, 'Ysh');
  assert.ok(r.msg && /Ysh/.test(r.msg));
  const faith0 = st.faith[g.id] ?? 0;
  sim.step(3 * 1440);
  assert.ok(g.acts >= 2, `it acted (${g.acts} times)`);
  const now = sim.u.planets[0].people.settlement(st.id)!;
  assert.ok((now.faith[g.id] ?? 0) > faith0, `Aru's faith in Ysh grew (${faith0} -> ${now.faith[g.id]})`);
  assert.ok(sim.snapshot().worship.length >= 2, 'its worship is reported');
  must(sim, { k: 'rival.remove', id: g.id });
  assert.equal(g.alive, false);
});

test('the god layer is deterministic: the same acts give the same world, chunked or not, and a save mid-flight goes on identically', () => {
  const run = (chunk: number): Sim => {
    const { sim, st } = town();
    const p = sim.u.planets[0];
    const at = (b: number, m: number) => moveBy(st.pos, bearingDir(st.pos, b), m, p.st.radius);
    must(sim, { k: 'set', path: 'disasters.natural', value: 3 });
    must(sim, { k: 'disaster.spawn', kind: 'tornado', pos: at(0.5, 900), toward: st.pos });
    must(sim, { k: 'creature.adopt', template: 'ape', pos: at(1, 100) });
    must(sim, { k: 'rival.add', temperament: 'trickster', settlement: st.id });
    must(sim, { k: 'hand.grab', kind: 'rock', mass: 300, pos: at(3, 800) });
    must(sim, { k: 'hand.move', pos: st.pos, alt: 5 });
    must(sim, { k: 'hand.throw', toward: at(2, 200), speed: 60, angle: 50 });
    must(sim, { k: 'freeform', text: 'rain frogs over Aru' });
    must(sim, { k: 'disaster.spawn', kind: 'plague', pos: st.pos });
    for (let t = 0; t < 600; t += chunk) sim.step(chunk);
    return sim;
  };
  const a = run(600), b = run(1), c = run(50);
  assert.equal(a.hash(), b.hash(), 'one step of 600 = 600 steps of 1');
  assert.equal(a.hash(), c.hash(), '= 12 steps of 50');
  // a save while things fly, burn and spread: the copy lives the same future
  a.applyNow({ k: 'hand.grab', kind: 'rock', mass: 100, pos: a.u.god.creatures[0].pos });
  a.applyNow({ k: 'hand.throw', speed: 200, angle: 80 });
  a.step(1);
  const copy = SimClass.load(a.save());
  assert.equal(copy.hash(), a.hash());
  a.step(400);
  copy.step(400);
  assert.equal(copy.hash(), a.hash(), 'continued identically');
});
