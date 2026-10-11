// GENESIS — the god walks among them (god/seen.ts, the walk camera's `god.seen`): the people near the body see the god;
// believers kneel and pray, the fearful run, the rest stop and stare; nobody far off notices; the god's record does
// not move (being seen is not an act); and the same sighting on two copies of a world plays out identically.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { town, must } from './helpers/god.ts';
import { TASK, GODS } from '../src/sim/people/defs.ts';
import type { UnitVec } from '../src/sim/types.ts';

const pt = [0, 0, 0];

test('god.seen: the people near the body see the god and react by their faith', () => {
  const { sim, st } = town();
  const p = sim.u.planets[0];
  const A = p.people.agents;
  const members = (p.people.members.get(st.id) ?? []).filter((s) => A.alive[s] && A.inside[s] < 0 && A.boat[s] < 0 && !A.mission[s]);
  assert.ok(members.length >= 6, 'enough people out in the open');
  // three believers, three who fear the god, the rest as they are
  const believers = members.slice(0, 3), fearful = members.slice(3, 6);
  for (const s of believers) { A.love[s * GODS] = 0.9; A.fear[s * GODS] = 0; A.task[s] = TASK.idle; }
  for (const s of fearful) { A.love[s * GODS] = 0; A.fear[s * GODS] = 0.9; A.task[s] = TASK.idle; }
  const g0 = { ...sim.u.god.god(0)! };
  const acts0 = sim.u.god.stats.acts ?? 0;
  // the body stands among them: a radius that takes in the whole town
  const r = must(sim, { k: 'god.seen', planet: 0, pos: st.pos as UnitVec, radius: 250 });
  assert.match(r.msg ?? '', /see/);
  for (const s of believers) assert.equal(A.task[s], TASK.pray, 'a believer kneels and prays');
  const fled = fearful.filter((s) => A.task[s] === TASK.flee).length;
  assert.ok(fled >= 2, `the fearful run (${fled} of 3)`);
  // and they run AWAY from the body
  sim.step(8);
  for (const s of fearful) {
    if (A.task[s] !== TASK.flee) continue;
    A.posAt(s, sim.tick, pt);
    const d = Math.acos(Math.min(1, pt[0] * st.pos[0] + pt[1] * st.pos[1] + pt[2] * st.pos[2])) * p.st.radius;
    assert.ok(d > 3, `a fearful one is ${d.toFixed(1)} m from the body`);
  }
  // being seen is not an act: no alignment change, no act counted
  const g1 = sim.u.god.god(0)!;
  assert.equal(g1.alignment, g0.alignment);
  assert.equal(g1.acts, g0.acts);
  assert.equal(sim.u.god.stats.acts ?? 0, acts0);
});

test('god.seen: nobody notices from far away', () => {
  const { sim, st } = town();
  const A = sim.u.planets[0].people.agents;
  const tasks = Array.from(A.task.subarray(0, A.hi));
  // the far side of the world
  const far: UnitVec = [-st.pos[0], -st.pos[1], -st.pos[2]];
  const r = must(sim, { k: 'god.seen', planet: 0, pos: far, radius: 40 });
  assert.match(r.msg ?? '', /No one/);
  assert.deepEqual(Array.from(A.task.subarray(0, A.hi)), tasks, 'nobody broke off what they were doing');
});

test('god.seen is deterministic: the same sighting on two copies of a world plays out the same', () => {
  const a = town(), b = town();
  for (const w of [a, b]) {
    must(w.sim, { k: 'god.seen', planet: 0, pos: w.st.pos as UnitVec, radius: 120 });
    w.sim.step(40);
  }
  const A = a.sim.u.planets[0].people.agents, B = b.sim.u.planets[0].people.agents;
  assert.equal(A.hi, B.hi);
  for (let s = 0; s < A.hi; s++) {
    assert.equal(A.task[s], B.task[s]);
    assert.equal(A.love[s * GODS], B.love[s * GODS]);
    A.posAt(s, a.sim.tick, pt);
    const ax = pt[0];
    B.posAt(s, b.sim.tick, pt);
    assert.equal(ax, pt[0]);
  }
});
