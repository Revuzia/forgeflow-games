// GENESIS — danger before thirst (CONTRACT.md §8.2–8.3): people standing in a wildfire run from it; they never stand in
// the flames drinking. A parched band whose village catches fire must get out first and drink where it is safe; people
// beside a burning cell move away before it reaches them; people far from the fire carry on as before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { igniteArea } from '../src/sim/fields/fire.ts';
import { TASK } from '../src/sim/people/defs.ts';
import { NEED_N, WATER } from '../src/sim/people/needs.ts';
import { world, people, membersOf } from './helpers/peoples.ts';

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
