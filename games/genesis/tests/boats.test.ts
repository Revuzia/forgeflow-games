// GENESIS — boats (CONTRACT.md §8.6, §10): people with boats cross water. Two shores no one can walk between trade by
// sea (the traders sail real boats along a real sea route, and the chronicle says so); a settlement on an island that
// splits sends its colonists over the water by boat to found a town on another shore; a dock stands at the water's edge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Sim } from '../src/sim/sim.ts';
import type { Planet } from '../src/sim/world/planet.ts';
import { distM, isLand } from '../src/sim/people/world.ts';
import { siteScore } from '../src/sim/people/settlement.ts';
import { meet } from '../src/sim/people/culture.ts';
import { findPath } from '../src/sim/grid/pathfind.ts';
import { AgentFlag, BuildingFlag } from '../src/sim/types.ts';
import { world, people, ctx, must } from './helpers/peoples.ts';

const cellPos = (p: Planet, c: number): number[] => [p.grid.pos[c * 3], p.grid.pos[c * 3 + 1], p.grid.pos[c * 3 + 2]];

/** connected dry-land components (water above 0.5 m divides) */
function landComponents(p: Planet): { comp: Int32Array; size: number[] } {
  const g = p.grid;
  const comp = new Int32Array(p.count).fill(-1);
  const size: number[] = [];
  for (let c = 0; c < p.count; c++) {
    if (comp[c] >= 0 || !isLand(p, c) || p.f.water[c] > 0.5) continue;
    const id = size.length;
    let n = 0;
    const q = [c];
    comp[c] = id;
    while (q.length) {
      const a = q.pop()!;
      n++;
      for (let e = g.nbrStart[a]; e < g.nbrStart[a + 1]; e++) {
        const o = g.nbr[e];
        if (comp[o] < 0 && isLand(p, o) && p.f.water[o] <= 0.5) { comp[o] = id; q.push(o); }
      }
    }
    size.push(n);
  }
  return { comp, size };
}

/** step a number of days, a day at a time, stopping early when `done` says so */
function days(sim: Sim, n: number, done: () => boolean): number {
  for (let d = 1; d <= n; d++) {
    sim.step(1440);
    if (done()) return d;
  }
  return -1;
}

test('two shores nobody can walk between trade by sea: boats carry the goods both ways', () => {
  const sim = world(32, 7);
  const p = sim.u.planets[0];
  const x = ctx(sim);
  // two good coastal sites, 0.9..2.6 km apart, with no way between them on foot but one by boat
  const coast: number[] = [];
  for (let c = 0; c < p.count; c += 3) if (p.s.coast[c] > 0 && p.f.water[c] < 0.1 && siteScore(x, 0, c) > 3) coast.push(c);
  const path: number[] = [];
  let pair: [number, number] | null = null;
  for (let i = 0; i < coast.length && !pair; i += 2) {
    for (let j = i + 1; j < coast.length; j += 3) {
      const a = coast[i], b = coast[j];
      const d = distM(p, cellPos(p, a), cellPos(p, b));
      if (d < 900 || d > 2600) continue;
      if (findPath(p, a, b, { swim: 0, fly: false, maxExpand: 6000 }, path)) continue;
      if (!findPath(p, a, b, { swim: 2.2, fly: false, maxExpand: 6000 }, path)) continue;
      pair = [a, b];
      break;
    }
  }
  assert.ok(pair, 'two shores across the water');
  const town = (c: number) => people(sim, 'plains-folk', 40, { era: 'bronze', settled: true, cell: c, pos: cellPos(p, c) });
  const a = town(pair![0]), b = town(pair![1]);
  const boat = x.c.items.idx('boat'), grain = x.c.items.idx('grain'), salt = x.c.items.idx('salt');
  // one shore has grain to spare and no salt; the other salt and little to eat
  a.store[boat] = 3; b.store[boat] = 2;
  a.store[grain] = 600; a.store[salt] = 0; b.store[salt] = 80;
  for (const i of x.info[b.species].foods) b.store[i] = Math.min(b.store[i], 20);
  // they have heard of each other (a voyage of discovery found the far shore)
  meet(x, a, b, true);
  assert.ok(a.contacts.includes(b.id) && b.contacts.includes(a.id));
  const A = p.people.agents;
  let afloat = 0, seaMission = false;
  const traded = () => {
    for (let s = 0; s < A.hi; s++) if (A.alive[s] && A.flags[s] & AgentFlag.boat) afloat++;
    if (p.people.missions.some((m) => m.kind === 'trade' && m.sea)) seaMission = true;
    const r = p.people.relation(a.polity, b.polity);
    return !!r && r.trade > 0 && sim.u.chronicle.some((e) => e.kind === 'trade' && /^Year \d+\. Boats from/.test(e.text));
  };
  const d = days(sim, 14, traded);
  assert.ok(seaMission, 'the traders go by sea');
  assert.ok(afloat > 0, 'people were seen afloat in boats');
  assert.ok(d > 0, 'goods crossed the water and the chronicle tells of the boats');
  assert.ok(a.contacts.includes(b.id));
});

test('an island town that splits sends its colonists over the water by boat', () => {
  const sim = world(32, 7);
  const p = sim.u.planets[0];
  const x = ctx(sim);
  // the best town site on a small island
  const { comp, size } = landComponents(p);
  let best = -1, bs = 0;
  for (let c = 0; c < p.count; c++) {
    if (comp[c] < 0 || size[comp[c]] < 6 || size[comp[c]] >= 120) continue;
    const v = siteScore(x, 0, c);
    if (v > bs) { bs = v; best = c; }
  }
  assert.ok(best >= 0 && bs > 3.2, 'an island fit to live on');
  const st = people(sim, 'plains-folk', 60, { era: 'bronze', settled: true, cell: best, pos: cellPos(p, best) });
  const boat = x.c.items.idx('boat');
  st.store[boat] = 6;
  sim.step(600);
  // a dock at the water's edge (on dry land, near the water)
  const dock = p.people.of(st.id).find((b) => x.c.buildings.list[b.type].function === 'dock' && !(b.flags & BuildingFlag.ruined));
  if (dock) assert.ok(isLand(p, dock.cell) && p.f.water[dock.cell] <= 0.15, 'the dock stands on the shore');
  must(sim, { k: 'settlement.split', settlement: st.id });
  const child = p.people.settlements[p.people.settlements.length - 1];
  assert.notEqual(child.id, st.id);
  assert.ok(child.band, 'the leavers set out as a band');
  assert.ok(child.recent.colony !== undefined, 'they go by sea');
  assert.ok(child.store[boat] >= 1, 'with boats');
  assert.ok(child.target && comp[p.cellAt(child.target)] !== comp[best], 'to another shore');
  const founded = days(sim, 10, () => !child.band);
  assert.ok(founded > 0, 'the colonists landed and founded their town');
  assert.notEqual(comp[child.cell], comp[best], 'across the water');
  assert.ok(sim.u.chronicle.some((e) => e.kind === 'diaspora' && e.text.includes('crossed the water by boat') && e.text.includes(child.name)), 'the chronicle tells of the crossing');
});
