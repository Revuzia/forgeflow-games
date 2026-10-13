// GENESIS — danger before thirst (CONTRACT.md §8.2–8.3): people standing in a wildfire run from it; they never stand in
// the flames drinking. A parched band whose village catches fire must get out first and drink where it is safe; people
// beside a burning cell move away before it reaches them; people far from the fire carry on as before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { igniteArea } from '../src/sim/fields/fire.ts';
import { PATH_MAX, TASK } from '../src/sim/people/defs.ts';
import { NEED_N, WATER } from '../src/sim/people/needs.ts';
import { FIRE_HERE, fleeGoalAlight } from '../src/sim/people/danger.ts';
import { FIRE_CHECK } from '../src/sim/people/people.ts';
import { startTask } from '../src/sim/people/tasks.ts';
import { world, people, membersOf, ctx } from './helpers/peoples.ts';

/** a settled band, parched to the bone, its village set alight with fuel underfoot */
function burningVillage(seed = 20261008) {
  const sim = world(24, seed);
  const st = people(sim, 'plains-folk', 24, { settled: true });
  sim.step(30);
  const p = sim.u.planets[0];
  const A = p.people.agents;
  for (const s of membersOf(sim, st)) A.needs[s * NEED_N + WATER] = 0.04;
  // fuel the ground around the village so the fire takes and spreads
  for (const c of p.cellsNear(st.pos, 260)) {
    p.f.grass[c] = Math.max(p.f.grass[c], 0.9);
    p.f.tree[c] = Math.max(p.f.tree[c], 0.5);
    p.f.moisture[c] = Math.min(p.f.moisture[c], 0.1);
  }
  const lit = igniteArea(sim.u, p, st.pos, 120, 0.9);
  assert.ok(lit > 0, 'the village caught fire');
  return { sim, st, p, A };
}

test('parched people standing in a fire flee instead of drinking there', () => {
  const { sim, st, p, A } = burningVillage();
  let drinkingInFire = 0;
  let inFireTicks = 0;
  const burningStreak = new Map<number, number>();
  for (let t = 0; t < 240; t++) {
    sim.step(1);
    for (const s of membersOf(sim, st)) {
      if (!A.alive[s]) continue;
      const burning = p.f.fire[A.cell[s]] > 0.05 || p.f.lava[A.cell[s]] > 0.01;
      if (!burning) { burningStreak.delete(s); continue; }
      inFireTicks++;
      const k = (burningStreak.get(s) ?? 0) + 1;
      burningStreak.set(s, k);
      // one tick to notice (the fire step interrupts, the decision follows); after that a drink in the flames is the bug
      if (k >= 3 && A.task[s] === TASK.drink) drinkingInFire++;
    }
  }
  assert.ok(inFireTicks > 0, 'someone was caught in the fire (the test exercises the case)');
  assert.equal(drinkingInFire, 0, `agent-ticks spent drinking while standing in fire: ${drinkingInFire}`);
});

test('people caught in a fire get out of it, then drink where it is safe', () => {
  const { sim, st, p, A } = burningVillage(7);
  sim.step(180);
  const alive = membersOf(sim, st).filter((s) => A.alive[s]);
  const stillIn = alive.filter((s) => p.f.fire[A.cell[s]] > 0.05);
  assert.ok(stillIn.length <= Math.max(1, Math.floor(alive.length * 0.1)), `${stillIn.length} of ${alive.length} still stand in the fire after 3 h`);
  // they were parched: within the next day the survivors drink, and never at a burning spot
  let drankSafe = 0;
  let drankInFire = 0;
  for (let t = 0; t < 1440 && drankSafe === 0; t += 5) {
    sim.step(5);
    for (const s of membersOf(sim, st)) {
      if (!A.alive[s] || A.task[s] !== TASK.drink) continue;
      if (p.f.fire[A.cell[s]] > 0.05) drankInFire++;
      else drankSafe++;
    }
  }
  assert.equal(drankInFire, 0, 'nobody drinks inside a fire');
  assert.ok(drankSafe > 0, 'the parched survivors drink once they are safe');
});

test('people beside a fire move away before it reaches them; people far away do not flee', () => {
  const sim = world(24, 3);
  const st = people(sim, 'plains-folk', 24, { settled: true });
  sim.step(30);
  const p = sim.u.planets[0];
  const A = p.people.agents;
  const g = p.grid;
  // light one cell next to the village (not the village itself) with fuel around
  const home = p.cellAt(st.pos);
  let next = -1;
  for (let e = g.nbrStart[home]; e < g.nbrStart[home + 1]; e++) { const o = g.nbr[e]; if (p.f.water[o] < 0.05) { next = o; break; } }
  assert.ok(next >= 0);
  p.f.grass[next] = 1; p.f.tree[next] = 0.8; p.f.moisture[next] = 0.05;
  const pos = [g.pos[next * 3], g.pos[next * 3 + 1], g.pos[next * 3 + 2]];
  assert.ok(igniteArea(sim.u, p, pos, 5, 1) > 0);
  // who stands in a cell beside the burning one?
  const beside = membersOf(sim, st).filter((s) => {
    const c = A.cell[s];
    if (c === next) return false;
    for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) if (g.nbr[e] === next) return true;
    return false;
  });
  let fled = 0;
  for (let t = 0; t < 30; t++) {
    sim.step(1);
    for (const s of beside) if (A.alive[s] && A.task[s] === TASK.flee) { fled++; break; }
    if (fled) break;
  }
  if (beside.length) assert.ok(fled > 0, `${beside.length} people stood beside the fire and nobody moved away`);
  // a second village far away: no flight
  const far = people(sim, 'plains-folk', 12, { settled: true });
  sim.step(60);
  const fleeingFar = membersOf(sim, far).filter((s) => A.alive[s] && A.task[s] === TASK.flee && p.f.fire[A.cell[s]] <= 0.02);
  // nobody flees unless the fire is actually near them
  for (const s of fleeingFar) {
    const c = A.cell[s];
    let near = false;
    for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) if (p.f.fire[g.nbr[e]] > 0.05) near = true;
    assert.ok(near, `agent ${A.id[s]} flees with no fire in or beside its cell`);
  }
});

test('a flight whose goal catches fire turns elsewhere within a fire step', () => {
  const { sim, st, p, A } = burningVillage(11);
  // since when each fleeing agent's goal has been alight (the fire step looks every FIRE_CHECK ticks; the decision follows)
  const since = new Map<number, { goal: number; t: number }>();
  let fled = 0;
  let stuck = 0;
  for (let t = 0; t < 300; t++) {
    sim.step(1);
    for (const s of membersOf(sim, st)) {
      if (!A.alive[s] || A.task[s] !== TASK.flee) { since.delete(s); continue; }
      fled++;
      const goal = A.gcell[s];
      if (!fleeGoalAlight(p, goal, A.tData[s])) { since.delete(s); continue; }
      const was = since.get(s);
      if (!was || was.goal !== goal) { since.set(s, { goal, t }); continue; }
      if (t - was.t > FIRE_CHECK + 2) { stuck++; since.delete(s); }
    }
  }
  assert.ok(fled > 0, 'people fled (the test exercises the case)');
  assert.equal(stuck, 0, `flights that kept running into a goal the fire had reached: ${stuck}`);
});

test('an errand goes around a burning cell when there is a way round', () => {
  const sim = world(24, 5);
  const st = people(sim, 'plains-folk', 12, { settled: true });
  sim.step(30);
  const p = sim.u.planets[0];
  const A = p.people.agents;
  const g = p.grid;
  const P = g.pos;
  const land = (c: number): boolean => p.f.water[c] < 0.05 && !p.s.ocean[c];
  const nbrs = (c: number): number[] => { const o: number[] = []; for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) o.push(g.nbr[e]); return o; };
  const s = membersOf(sim, st).find((m) => A.alive[m] && !(A.flags[m] & 1))!;
  let checked = 0;
  for (let attempt = 0; attempt < 6 && checked < 3; attempt++) {
    const c0 = A.cell[s];
    // a land cell two steps away and the cells between (set alight); a way round must exist over unburnt land
    const ring1 = nbrs(c0).filter(land);
    const ring2 = [...new Set(ring1.flatMap(nbrs))].filter((c) => c !== c0 && !nbrs(c0).includes(c) && land(c)).sort((a, b) => a - b);
    const goal = ring2[attempt % Math.max(1, ring2.length)];
    if (goal === undefined) break;
    const middle = nbrs(c0).filter((c) => nbrs(goal).includes(c));
    for (const c of middle) { p.f.fire[c] = 0.8; p.f.grass[c] = 0.8; }
    const round = ring1.filter((c) => !middle.includes(c)).some((c) => nbrs(c).some((d) => !middle.includes(d) && land(d) && nbrs(d).includes(goal)));
    if (round && middle.length) {
      startTask(ctx(sim), s, { kind: TASK.wander, goal: [P[goal * 3], P[goal * 3 + 1], P[goal * 3 + 2]], goalCell: goal, work: 5 });
      const path = Array.from(A.path.slice(s * PATH_MAX, s * PATH_MAX + A.pathLen[s]));
      const hot = [A.cell[s], ...path].filter((c) => p.f.fire[c] > FIRE_HERE);
      assert.deepEqual(hot, [], `the way to ${goal} runs through the fire at ${hot.join(', ')} (path ${path.join(' ')})`);
      checked++;
    }
    for (const c of middle) p.f.fire[c] = 0;
    sim.step(40);
  }
  assert.ok(checked > 0, 'at least one errand had a way round the fire');
});
